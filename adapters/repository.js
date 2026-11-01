// adapters/repository.js —— 数据端口（ILB-3.1.2）
// ILB 的书、设置、手动开关、时效状态全都存在 extension_settings.independent_lorebook 里。
// 不用扩展目录、不用 IndexedDB：前者前端没有写权限，后者清缓存就丢。
// 这个文件只认"拿来一个 getContext 就能读写"的对象，不 import 宿主。

import { DEFAULT_SETTINGS } from '../core/settings-defaults.js';
import { normalizeBook } from '../core/model.js';
import { DATA_VERSION, migrateBucket } from '../core/migrate.js';
import { createSnapshot, evictSnapshots } from '../core/snapshot.js';

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
  };
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
    const before = b.books.length;
    b.books = b.books.filter((x) => x && x.book_id !== String(bookId));
    delete b.manualState[String(bookId)];
    commit();
    return b.books.length !== before;
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
    // 导入的是"一整套存档"：版本号跟着走，下次打开不会再迁一遍
    b.version = DATA_VERSION;
    commit();
    return { books: b.books.length };
  }

  return {
    getSettings,
    saveSettings,
    listBooks,
    getBook,
    saveBook,
    deleteBook,
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
