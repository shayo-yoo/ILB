// adapters/repository.js —— 数据端口（ILB-3.1.2）
// ILB 的书、设置、手动开关、时效状态全都存在 extension_settings.independent_lorebook 里。
// 不用扩展目录、不用 IndexedDB：前者前端没有写权限，后者清缓存就丢。
// 这个文件只认"拿来一个 getContext 就能读写"的对象，不 import 宿主。

import { DEFAULT_SETTINGS } from '../core/settings-defaults.js';
import { normalizeBook, normalizeLogic } from '../core/model.js';
import { DATA_VERSION, migrateBucket } from '../core/migrate.js';
import { createSnapshot, evictSnapshots } from '../core/snapshot.js';
import { normalizeBinding, normalizeBindings, planRename } from '../core/bindings.js';

function safeClone(v, fallback) {
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return fallback;
  }
}

function emptyStats() {
  return { entries: {}, logics: {} };
}

function emptyState() {
  return {
    settings: {},
    books: [],
    manualState: {},
    chatStates: {},
    importLog: [],
    ui: {},
    snapshots: [],
    // 触发次数（v0.22.0）：只做界面排序用，不参与判定。老存档里没有这个键，读的时候补空。
    stats: emptyStats(),
    // 独立逻辑（v0.23.0）：逻辑组 + 不挂在任何书上的逻辑。老存档没有这两个键，读的时候补空。
    logicGroups: [],
    logics: [],
    // 角色卡 ↔ 世界书的关联（v0.28.0）：老存档没有这个键，读的时候补空；
    // 数据格式版本（DATA_VERSION）不跟着涨——它只是多了一个可选键。
    bindings: [],
  };
}

/** 逻辑组：可以独立启用/停用，也可以选择"某本书启用时我才跑"。 */
function normalizeLogicGroup(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const id = String(src.id || '').trim() || `g-${Date.now().toString(36)}`;
  return {
    id,
    name: String(src.name || '未命名逻辑组').slice(0, 60),
    enabled: src.enabled !== false,
    // 空 = 不跟着任何书；填 book_id = 那本书启用时才跑这组
    followBookId: String(src.followBookId || ''),
    ui: {
      order: Number(src.ui?.order) || 0,
      createdAt: Number(src.ui?.createdAt) || Date.now(),
      updatedAt: Number(src.ui?.updatedAt) || Date.now(),
    },
  };
}

/** 不挂书的逻辑：id 原样保留（可能是从书里搬过来的 book::L::xxx），只补 groupId。 */
function normalizeStandaloneLogic(raw, fallbackGroupId = '') {
  const src = raw && typeof raw === 'object' ? raw : {};
  const logic = normalizeLogic(src, '');
  logic.groupId = String(src.groupId || fallbackGroupId || '');
  return logic;
}

/**
 * @param {object} options
 * @param {Function} options.getContext 拿宿主上下文
 * @param {string} [options.namespace] extension_settings 里的命名空间
 * @param {Function} [options.persist] 把 extension_settings 写进磁盘（宿主提供的 saveSettingsDebounced）。
 *   少了这一步，改动只活在内存里，刷新页面就全没了。
 */
export function createRepository({ getContext, namespace = 'independent_lorebook', persist = null }) {
  let cache = null;
  /** 最近一次迁移的结果，给诊断页显示（成功也要说，用户才知道数据被动过） */
  let lastMigration = null;

  /** 每次写完都叫一声宿主。写盘失败不算错误：内存里已经有了，下次写成功时会一起落盘。 */
  function commit() {
    if (typeof persist !== 'function') return false;
    try {
      persist();
      return true;
    } catch {
      return false;
    }
  }

  function bucket() {
    const ctx = getContext();
    if (!ctx || typeof ctx !== 'object') throw new Error('拿不到 SillyTavern 上下文');
    if (!ctx.extensionSettings || typeof ctx.extensionSettings !== 'object') {
      ctx.extensionSettings = {};
    }
    if (!ctx.extensionSettings[namespace] || typeof ctx.extensionSettings[namespace] !== 'object') {
      ctx.extensionSettings[namespace] = emptyState();
    }
    const b = ctx.extensionSettings[namespace];
    b.settings = b.settings && typeof b.settings === 'object' ? b.settings : {};
    b.books = Array.isArray(b.books) ? b.books : [];
    b.manualState = b.manualState && typeof b.manualState === 'object' ? b.manualState : {};
    b.chatStates = b.chatStates && typeof b.chatStates === 'object' ? b.chatStates : {};
    b.importLog = Array.isArray(b.importLog) ? b.importLog : [];
    b.ui = b.ui && typeof b.ui === 'object' ? b.ui : {};
    b.snapshots = Array.isArray(b.snapshots) ? b.snapshots : [];
    b.stats = b.stats && typeof b.stats === 'object' ? b.stats : emptyStats();
    b.stats.entries = b.stats.entries && typeof b.stats.entries === 'object' ? b.stats.entries : {};
    b.stats.logics = b.stats.logics && typeof b.stats.logics === 'object' ? b.stats.logics : {};
    b.logicGroups = Array.isArray(b.logicGroups) ? b.logicGroups : [];
    b.logics = Array.isArray(b.logics) ? b.logics : [];
    // 关联是"只加键"：老存档读到就在这里补空数组，不触发迁移、不改版本号
    b.bindings = Array.isArray(b.bindings) ? b.bindings : [];
    migrateIfNeeded(b);
    cache = b;
    return b;
  }

  /**
   * 存档迁移（ILB-7.15）：老存档第一次被读到时就地升级。
   * 顺序严格是「先备份 → 再迁移 → 失败就什么都不动」。
   * 幂等：已经迁过的版本号对得上，直接返回，不拍快照也不写盘。
   */
  function migrateIfNeeded(b) {
    if (Number(b.version) >= DATA_VERSION) return;
    const from = Number(b.version) || 1;
    try {
      const backup = createSnapshot(b.books, b.manualState, {
        name: `迁移前 v${from}`,
        note: 'ILB 存档格式迁移前的自动备份（可在这里整套恢复）',
        auto: true,
      });
      b.snapshots = evictSnapshots([...(b.snapshots ?? []), backup]);
    } catch (err) {
      // 备份都存不下就不迁移——宁可这轮按老格式读，也不能把用户的数据改坏
      lastMigration = { ok: false, from, to: DATA_VERSION, error: `备份失败，已放弃迁移：${err?.message ?? err}`, at: Date.now() };
      return;
    }
    const result = migrateBucket(b, { now: Date.now() });
    if (result.error) {
      lastMigration = { ok: false, from: result.from, to: result.to, error: result.error, at: Date.now() };
      return;
    }
    Object.assign(b, result.data);
    lastMigration = { ok: true, from: result.from, to: result.to, notes: result.notes, books: result.books, at: Date.now() };
    commit();
  }

  function getSettings() {
    try {
      const b = bucket();
      return { ...DEFAULT_SETTINGS, ...safeClone(b.settings, {}) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings(patch = {}) {
    const b = bucket();
    b.settings = { ...getSettings(), ...safeClone(patch, {}) };
    commit();
    return getSettings();
  }

  function listBooks() {
    try {
      const b = bucket();
      return b.books.map((raw) => normalizeBook(raw));
    } catch {
      return [];
    }
  }

  function getBook(bookId) {
    return listBooks().find((book) => book.book_id === String(bookId)) ?? null;
  }

  function saveBook(raw) {
    const book = normalizeBook(raw);
    // 任何一次保存都算"改过"：排序里的「上次修改」看这个时间。
    book.updated_at = Date.now();
    const b = bucket();
    const idx = b.books.findIndex((x) => x && x.book_id === book.book_id);
    if (idx >= 0) b.books[idx] = book;
    else b.books.push(book);
    commit();
    return book;
  }

  function deleteBook(bookId) {
    const b = bucket();
    const id = String(bookId);
    const before = b.books.length;
    b.books = b.books.filter((x) => x && x.book_id !== id);
    delete b.manualState[id];
    // 书没了，指向它的关联也没有意义了：跟着删，免得留下"指向不存在的书"的记录
    const bindingsBefore = b.bindings.length;
    b.bindings = b.bindings.filter((x) => !x || String(x.bookId ?? '') !== id);
    if (b.books.length !== before || b.bindings.length !== bindingsBefore) commit();
    return b.books.length !== before;
  }

  // ---- 角色卡 ↔ 世界书的关联（v0.28.0） ----
  //
  // 这里只做存/取/改/删。能不能建（书在不在、重复不重复、超没超上限）由
  // runtime/api.js 判断——数据层不认识"规则"，只认识数组；读到的坏记录丢掉并说一句。

  const warnBinding = (message) => console.warn(`[ILB] ${message}`);

  function listBindings() {
    try {
      return normalizeBindings(bucket().bindings, { warn: warnBinding }).map((one) => safeClone(one, one));
    } catch {
      return [];
    }
  }

  function getBinding(id) {
    const key = String(id ?? '');
    if (!key) return null;
    return listBindings().find((one) => one.id === key) ?? null;
  }

  /** 这本书还有几个角色挂着（被标成孤儿的算失效，不计数）。删书确认框要用。 */
  function countBindingsForBook(bookId) {
    const id = String(bookId ?? '');
    if (!id) return 0;
    return listBindings().filter((one) => one.bookId === id && !one.orphanedAt).length;
  }

  function createBinding(raw) {
    const one = normalizeBinding(raw, { warn: warnBinding });
    if (!one) throw new Error('这条关联缺少角色卡标识或书 id');
    const b = bucket();
    b.bindings.push(one);
    commit();
    return safeClone(one, one);
  }

  function updateBinding(id, patch) {
    const key = String(id ?? '');
    const b = bucket();
    const idx = b.bindings.findIndex((x) => x && String(x.id) === key);
    if (idx < 0) return null;
    const next = normalizeBinding({ ...b.bindings[idx], ...patch, id: key, updatedAt: Date.now() }, { warn: warnBinding });
    if (!next) return null;
    b.bindings[idx] = next;
    commit();
    return safeClone(next, next);
  }

  function removeBinding(id) {
    const key = String(id ?? '');
    const b = bucket();
    const before = b.bindings.length;
    b.bindings = b.bindings.filter((x) => !x || String(x.id ?? '') !== key);
    if (b.bindings.length === before) return false;
    commit();
    return true;
  }

  /** 解除某个角色的全部关联（删角色卡时也走这条，不按书过滤）。 */
  function removeBindingsForCharacter(avatar) {
    const who = String(avatar ?? '').trim();
    if (!who) return 0;
    const b = bucket();
    const before = b.bindings.length;
    b.bindings = b.bindings.filter((x) => !x || String(x.character?.avatar ?? '').trim() !== who);
    const removed = before - b.bindings.length;
    if (removed > 0) commit();
    return removed;
  }

  /** 角色卡被删：不删关联，只打个时间戳（书还在，用户以后可能把卡找回来）。 */
  function markBindingsOrphaned(avatars, at = Date.now()) {
    const list = (Array.isArray(avatars) ? avatars : [avatars]).map((x) => String(x ?? '').trim()).filter(Boolean);
    if (list.length === 0) return 0;
    const b = bucket();
    let changed = 0;
    const when = Math.max(0, Math.trunc(Number(at) || Date.now()));
    b.bindings = b.bindings.map((x) => {
      if (!x || x.orphanedAt) return x;
      if (!list.includes(String(x.character?.avatar ?? '').trim())) return x;
      changed += 1;
      return { ...x, orphanedAt: when, updatedAt: when };
    });
    if (changed > 0) commit();
    return changed;
  }

  /** 清掉所有被标成孤儿的关联（角色卡已经删了、用户确认不再需要）。 */
  function purgeOrphanBindings() {
    const b = bucket();
    const before = b.bindings.length;
    b.bindings = b.bindings.filter((x) => !x || !x.orphanedAt);
    const removed = before - b.bindings.length;
    if (removed > 0) commit();
    return removed;
  }

  function renameBindings(oldAvatar, newAvatar, opts = {}) {
    const b = bucket();
    const plan = planRename(normalizeBindings(b.bindings, { warn: warnBinding }), oldAvatar, newAvatar, opts);
    if (!plan.changed) return { updated: 0, merged: 0 };
    b.bindings = plan.bindings;
    commit();
    return { updated: plan.updated, merged: plan.merged };
  }

  // ---- 独立逻辑组（v0.23.0）：逻辑不再必须以一本书为前提 ----

  function listLogicGroups() {
    try {
      return bucket().logicGroups.map((raw) => normalizeLogicGroup(raw));
    } catch {
      return [];
    }
  }

  function saveLogicGroup(raw) {
    const group = normalizeLogicGroup(raw);
    group.ui = { ...group.ui, updatedAt: Date.now() };
    const b = bucket();
    const idx = b.logicGroups.findIndex((x) => x && x.id === group.id);
    if (idx >= 0) b.logicGroups[idx] = group;
    else b.logicGroups.push(group);
    commit();
    return group;
  }

  function deleteLogicGroup(groupId) {
    const b = bucket();
    const id = String(groupId);
    b.logicGroups = b.logicGroups.filter((g) => g && g.id !== id);
    // 组没了，组里的逻辑一起删；删除前界面会二次确认
    const before = b.logics.length;
    b.logics = b.logics.filter((l) => String(l?.groupId ?? '') !== id);
    commit();
    return { removedLogics: before - b.logics.length };
  }

  function listStandaloneLogics(groupId) {
    try {
      const list = bucket().logics.map((raw) => normalizeStandaloneLogic(raw));
      if (groupId === undefined || groupId === null) return list;
      return list.filter((logic) => logic.groupId === String(groupId));
    } catch {
      return [];
    }
  }

  function saveStandaloneLogic(raw) {
    const logic = normalizeStandaloneLogic(raw);
    if (!logic.groupId) throw new Error('独立逻辑要指定一个逻辑组');
    logic.ui = { ...logic.ui, updatedAt: Date.now() };
    const b = bucket();
    const idx = b.logics.findIndex((x) => x && String(x.id) === String(logic.id));
    if (idx >= 0) b.logics[idx] = logic;
    else b.logics.push(logic);
    commit();
    return logic;
  }

  function deleteStandaloneLogic(logicId) {
    const b = bucket();
    const before = b.logics.length;
    b.logics = b.logics.filter((l) => String(l?.id ?? '') !== String(logicId));
    commit();
    return b.logics.length !== before;
  }

  function getManualState() {
    try {
      return safeClone(cache?.manualState ?? bucket().manualState, {});
    } catch {
      return {};
    }
  }

  function setManualState(bookId, on) {
    const b = bucket();
    b.manualState[String(bookId)] = on === true;
    commit();
    return getManualState();
  }

  function getChatState(chatId) {
    try {
      const b = bucket();
      return safeClone(b.chatStates[String(chatId)] ?? {}, {});
    } catch {
      return {};
    }
  }

  function mergeChatState(chatId, patch) {
    const b = bucket();
    const id = String(chatId);
    const current = b.chatStates[id] ?? {};
    for (const [bookId, entries] of Object.entries(patch ?? {})) {
      current[bookId] = current[bookId] ?? {};
      for (const [entryId, rec] of Object.entries(entries ?? {})) {
        current[bookId][entryId] = rec;
      }
    }
    b.chatStates[id] = current;
    commit();
    return current;
  }

  function clearChatState(chatId) {
    const b = bucket();
    delete b.chatStates[String(chatId)];
    commit();
  }

  // ---- 聊天变量（v0.8.0）----
  // 和时效状态放同一个 chatStates 桶，但单独一个保留键 `__vars`，不会和书/条目混。
  const VARS_KEY = '__vars';

  function getVars(chatId) {
    try {
      const b = bucket();
      const state = b.chatStates[String(chatId)] ?? {};
      return safeClone(state[VARS_KEY] ?? {}, {});
    } catch {
      return {};
    }
  }

  function mergeVars(chatId, patch = {}) {
    const b = bucket();
    const id = String(chatId);
    const current = b.chatStates[id] ?? {};
    const vars = current[VARS_KEY] && typeof current[VARS_KEY] === 'object' ? current[VARS_KEY] : {};
    for (const [name, value] of Object.entries(patch ?? {})) {
      const key = String(name ?? '').trim();
      if (!key) continue;
      vars[key] = value;
    }
    current[VARS_KEY] = vars;
    b.chatStates[id] = current;
    commit();
    return safeClone(vars, {});
  }

  function deleteVar(chatId, name) {
    const b = bucket();
    const id = String(chatId);
    const current = b.chatStates[id] ?? {};
    const vars = current[VARS_KEY] && typeof current[VARS_KEY] === 'object' ? current[VARS_KEY] : {};
    delete vars[String(name)];
    current[VARS_KEY] = vars;
    b.chatStates[id] = current;
    commit();
    return safeClone(vars, {});
  }

  const IMPORT_LOG_LIMIT = 50;

  function getImportLog() {
    try {
      return safeClone(bucket().importLog, []);
    } catch {
      return [];
    }
  }

  /** 追加一条导入记录（ILB-3.3.6）。写失败不得阻断导入，所以这里不抛。 */
  function appendImportLog(record) {
    try {
      const b = bucket();
      b.importLog.push(safeClone(record, {}));
      while (b.importLog.length > IMPORT_LOG_LIMIT) b.importLog.shift();
      commit();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 界面自己的位置记忆（浮窗拖到哪、多大、悬浮球在哪）。
   * 和判定无关，所以单独放一个格子；判定层永远读不到它。
   */
  function getUiState() {
    try {
      return safeClone(bucket().ui, {});
    } catch {
      return {};
    }
  }

  function saveUiState(patch = {}) {
    try {
      const b = bucket();
      b.ui = { ...(b.ui ?? {}), ...safeClone(patch, {}) };
      commit();
      return safeClone(b.ui, {});
    } catch {
      return {};
    }
  }

  // —— 快照（ILB-6.11）——
  // 存在同一个命名空间里。快照只装"开关状态"，不装正文，所以再多也不会撑大存档。

  function listSnapshots() {
    try {
      return safeClone(bucket().snapshots, []);
    } catch {
      return [];
    }
  }

  function getSnapshot(id) {
    return listSnapshots().find((s) => s && s.id === String(id)) ?? null;
  }

  /** 保存一份快照；超出上限时按"最早"顶掉（ILB-6.11.4） */
  function saveSnapshot(snapshot) {
    if (!snapshot || !snapshot.id) throw new Error('快照缺少 id');
    const b = bucket();
    const list = b.snapshots.filter((s) => s && s.id !== snapshot.id);
    list.push(safeClone(snapshot, {}));
    b.snapshots = evictSnapshots(list);
    commit();
    return safeClone(b.snapshots, []);
  }

  function deleteSnapshot(id) {
    const b = bucket();
    const before = b.snapshots.length;
    b.snapshots = b.snapshots.filter((s) => s && s.id !== String(id));
    commit();
    return b.snapshots.length !== before;
  }

  /**
   * 改名。改成有名字的就进"常用快照"，清空名字就退回临时快照。
   * 升为常用时记 promotedAt，这样它不会被"最早的那份"立即顶掉。
   */
  function renameSnapshot(id, name) {
    const b = bucket();
    const snap = b.snapshots.find((s) => s && s.id === String(id));
    if (!snap) return false;
    const clean = String(name ?? '').trim();
    snap.name = clean;
    snap.kind = clean ? 'named' : 'quick';
    if (clean) snap.promotedAt = Date.now();
    else delete snap.promotedAt;
    b.snapshots = evictSnapshots(b.snapshots);
    commit();
    return true;
  }

  /**
   * 记一次触发（条目真正出现 / 日志流程跑通）。只做排序统计，不参与任何判定。
   * chats 最多留 40 个聊天，避免一个用了两年的存档被统计表撑大。
   */
  function recordTrigger(kind, id, chatId) {
    const bucketName = kind === 'logics' ? 'logics' : 'entries';
    if (!id) return false;
    const b = bucket();
    const table = b.stats[bucketName];
    const key = String(id);
    const cur = table[key] && typeof table[key] === 'object' ? table[key] : { total: 0, chats: {} };
    cur.total = Math.max(0, Math.trunc(Number(cur.total) || 0)) + 1;
    if (chatId) {
      const cid = String(chatId);
      cur.chats = cur.chats && typeof cur.chats === 'object' ? cur.chats : {};
      cur.chats[cid] = Math.max(0, Math.trunc(Number(cur.chats[cid]) || 0)) + 1;
      const keys = Object.keys(cur.chats);
      if (keys.length > 40) {
        keys
          .sort((a, c) => (Number(cur.chats[a]) || 0) - (Number(cur.chats[c]) || 0))
          .slice(0, keys.length - 40)
          .forEach((k) => delete cur.chats[k]);
      }
    }
    table[key] = cur;
    commit();
    return true;
  }

  function getTriggerStats() {
    try {
      const b = bucket();
      return safeClone(b.stats, emptyStats());
    } catch {
      return emptyStats();
    }
  }

  function exportAll() {
    const b = bucket();
    return safeClone(
      {
        version: DATA_VERSION,
        dataVersion: DATA_VERSION,
        exportedAt: Date.now(),
        settings: b.settings,
        books: b.books,
        manualState: b.manualState,
        importLog: b.importLog,
        ui: b.ui,
        snapshots: b.snapshots,
        stats: b.stats,
        logicGroups: b.logicGroups,
        logics: b.logics,
        // 关联跟着整包走（v0.28.0）：导出的是规范化后的副本，改导出结果不影响存档
        bindings: normalizeBindings(b.bindings, { warn: warnBinding }),
      },
      {},
    );
  }

  function importAll(blob) {
    const data = safeClone(blob, null);
    if (!data || typeof data !== 'object') throw new Error('导入的内容不是有效的数据');
    // 导入旧 JSON 走同一个迁移入口（ILB-7.15）：先迁移再落地，迁移失败就整份拒绝。
    let source = data;
    if (Number(data.version) < DATA_VERSION) {
      const migrated = migrateBucket(data, { now: Date.now() });
      if (migrated.error) throw new Error(`这份数据的格式迁移失败，已拒绝导入：${migrated.error}`);
      source = migrated.data;
      lastMigration = { ok: true, from: migrated.from, to: migrated.to, notes: migrated.notes, books: migrated.books, at: Date.now() };
    }
    const b = bucket();
    if (source.settings && typeof source.settings === 'object') b.settings = source.settings;
    if (Array.isArray(source.books)) b.books = source.books.map((x) => normalizeBook(x));
    if (source.manualState && typeof source.manualState === 'object') b.manualState = source.manualState;
    if (source.importLog && Array.isArray(source.importLog)) b.importLog = source.importLog.slice(-IMPORT_LOG_LIMIT);
    if (source.ui && typeof source.ui === 'object') b.ui = source.ui;
    if (source.stats && typeof source.stats === 'object') {
      b.stats = { entries: source.stats.entries ?? {}, logics: source.stats.logics ?? {} };
    }
    if (Array.isArray(source.snapshots)) b.snapshots = evictSnapshots(source.snapshots);
    if (Array.isArray(source.logicGroups)) b.logicGroups = source.logicGroups.map((g) => normalizeLogicGroup(g));
    if (Array.isArray(source.logics)) b.logics = source.logics.map((l) => normalizeStandaloneLogic(l));
    // 关联（v0.28.0）：这份备份里有就整体替换；没有就保留现在这份——
    // 老备份不该把用户后来建的关联清空。
    if (Array.isArray(source.bindings)) b.bindings = normalizeBindings(source.bindings, { warn: warnBinding });
    // 导入的是"一整套存档"：版本号跟着走，下次打开不会再迁一遍
    b.version = DATA_VERSION;
    commit();
    return { books: b.books.length, bindings: b.bindings.length };
  }

  // ---- 单本世界书的导出/导入（v0.27.0，给角色卡兼容扩展用） ----
  //
  // 这里只做"数据层"的事：取一本、换 id、按策略处理冲突、落地。不认角色卡、
  // 不认包格式，也不问用户——策略由调用方传进来（ILB-API）。

  function findBookById(id) {
    const key = String(id ?? '');
    if (!key) return null;
    return bucket().books.find((x) => x && x.book_id === key) ?? null;
  }

  function exportBook(id) {
    const book = findBookById(id);
    if (!book) return null;
    return {
      schema_version: DATA_VERSION,
      exported_at: Date.now(),
      book: safeClone(book, {}),
    };
  }

  function uniqueBookId(existing, seed = 'book') {
    const taken = new Set(existing.map((x) => x && x.book_id).filter(Boolean));
    let id = `${seed}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    let n = 1;
    while (taken.has(id)) {
      n += 1;
      id = `${seed}-${Date.now().toString(36)}-${n}`;
    }
    return id;
  }

  /**
   * 导入一本世界书。
   * @param {object} blob  `{ book }` 或书本身；带 schema_version 的导出结果也接受。
   * @param {{onConflict?:'new'|'skip'|'overwrite'|'ask', targetId?:string}} opts
   * @returns {{id:string, action:'created'|'skipped'|'overwritten'}}
   */
  function importBook(blob, opts = {}) {
    const raw = blob && typeof blob === 'object' && blob.book && typeof blob.book === 'object' ? blob.book : blob;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      const err = new Error('导入的内容不是一本有效世界书');
      err.code = 'BAD_PAYLOAD';
      throw err;
    }
    // 版本校验（v0.28.0）：比这版新的书明确拒绝——假装能读只会把数据改坏。
    // 比这版老的书先走同一个迁移入口（core/migrate.js），迁不动就按坏数据处理。
    const declared = Number(
      blob && typeof blob === 'object' && blob.schema_version != null ? blob.schema_version : raw.schema_version,
    );
    let src = raw;
    if (Number.isFinite(declared) && declared > DATA_VERSION) {
      const err = new Error(`这本书的格式版本是 ${declared}，这一版 ILB 只认识到 ${DATA_VERSION}；请先升级 ILB 再导入`);
      err.code = 'NOT_SUPPORTED';
      throw err;
    }
    if (Number.isFinite(declared) && declared < DATA_VERSION) {
      const migrated = migrateBucket({ version: 1, books: [safeClone(raw, {})] }, { now: Date.now() });
      const next = migrated && !migrated.error && Array.isArray(migrated.data?.books) ? migrated.data.books[0] : null;
      if (!next) {
        const err = new Error(`这本书的格式版本是 ${declared}，迁移失败：${migrated?.error || '内容不完整'}`);
        err.code = 'BAD_PAYLOAD';
        throw err;
      }
      src = next;
    }
    const b = bucket();
    const incomingId = String(src.book_id ?? '').trim();
    const existing = incomingId ? findBookById(incomingId) : null;
    const policy = ['new', 'skip', 'overwrite', 'ask'].includes(opts.onConflict) ? opts.onConflict : 'ask';

    if (existing) {
      if (policy === 'skip') return { id: existing.book_id, action: 'skipped' };
      if (policy === 'ask') {
        const err = new Error(`这本书已经存在：${existing.name || existing.book_id}`);
        err.code = 'CONFLICT';
        err.id = existing.book_id;
        err.name = existing.name || '';
        throw err;
      }
      if (policy === 'overwrite') {
        const incoming = safeClone(src, {});
        // 覆盖时保留原来的创建时间与 id；显示名与内容以导入为准。
        incoming.book_id = existing.book_id;
        incoming.created_at = existing.created_at || incoming.created_at || Date.now();
        incoming.updated_at = Date.now();
        const next = normalizeBook(incoming);
        next.book_id = existing.book_id;
        const at = b.books.indexOf(existing);
        b.books[at] = next;
        commit();
        return { id: next.book_id, action: 'overwritten' };
      }
    }

    // 新建：不覆盖任何已有书。id 优先用调用方指定（包里有稳定 id 时），否则生成。
    const id = String(opts.targetId ?? '').trim() || uniqueBookId(b.books);
    const incoming = rebaseBookIds(safeClone(src, {}), incomingId, id);
    incoming.book_id = id;
    incoming.created_at = incoming.created_at || Date.now();
    incoming.updated_at = Date.now();
    const book = normalizeBook(incoming);
    book.book_id = id;
    b.books.push(book);
    commit();
    return { id, action: 'created' };
  }

  /**
   * 换书 id 时，把条目/逻辑的 id 前缀一起换掉，并把流程里对这些 id 的引用改过来。
   * 不这么做的话：新书里会出现 `新书::旧书::e1`，而条件/激活节点还指着 `旧书::e1`。
   */
  function rebaseBookIds(book, oldId, newId) {
    if (!oldId || !newId || oldId === newId) return book;
    const map = new Map();
    const rebase = (id) => {
      const s = String(id ?? '');
      if (!s.startsWith(`${oldId}::`)) return s;
      const next = `${newId}::${s.slice(oldId.length + 2)}`;
      map.set(s, next);
      return next;
    };
    const clone = safeClone(book, {});
    clone.entries = (clone.entries ?? []).map((e) => ({ ...e, id: rebase(e.id) }));
    clone.logic = (clone.logic ?? []).map((l) => ({ ...l, id: rebase(l.id) }));
    const walk = (value) => {
      if (Array.isArray(value)) return value.map(walk);
      if (value && typeof value === 'object') {
        const out = {};
        for (const key of Object.keys(value)) out[key] = walk(value[key]);
        return out;
      }
      if (typeof value === 'string' && map.has(value)) return map.get(value);
      return value;
    };
    clone.entries = walk(clone.entries);
    clone.logic = walk(clone.logic);
    return clone;
  }

  return {
    getSettings,
    saveSettings,
    listBooks,
    getBook,
    saveBook,
    deleteBook,
    // 角色卡 ↔ 世界书关联（v0.28.0）：数据层只做存取，规则在 runtime/api.js
    listBindings,
    getBinding,
    countBindingsForBook,
    createBinding,
    updateBinding,
    removeBinding,
    removeBindingsForCharacter,
    markBindingsOrphaned,
    purgeOrphanBindings,
    renameBindings,
    exportBook,
    importBook,
    getManualState,
    setManualState,
    getChatState,
    mergeChatState,
    clearChatState,
    getVars,
    mergeVars,
    deleteVar,
    getImportLog,
    appendImportLog,
    getUiState,
    saveUiState,
    recordTrigger,
    getTriggerStats,
    listLogicGroups,
    saveLogicGroup,
    deleteLogicGroup,
    listStandaloneLogics,
    saveStandaloneLogic,
    deleteStandaloneLogic,
    listSnapshots,
    getSnapshot,
    saveSnapshot,
    deleteSnapshot,
    renameSnapshot,
    exportAll,
    importAll,
    /** 存档格式版本与最近一次迁移结果（诊断页用） */
    getDataVersion() {
      try {
        return Number(bucket().version) || DATA_VERSION;
      } catch {
        return DATA_VERSION;
      }
    },
    getMigrationInfo() {
      return lastMigration ? { ...lastMigration } : null;
    },
    /** 手动触发一次迁移检查（导入后、或在诊断页点"检查数据"时） */
    migrateNow() {
      const b = bucket();
      migrateIfNeeded(b);
      return lastMigration ? { ...lastMigration } : { ok: true, from: DATA_VERSION, to: DATA_VERSION, notes: [], at: Date.now() };
    },
  };
}
