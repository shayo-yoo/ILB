// adapters/repository.js —— 数据端口（ILB-3.1.2）
// ILB 的书、设置、手动开关、时效状态全都存在 extension_settings.independent_lorebook 里。
// 不用扩展目录、不用 IndexedDB：前者前端没有写权限，后者清缓存就丢。
// 这个文件只认"拿来一个 getContext 就能读写"的对象，不 import 宿主。

import { DEFAULT_SETTINGS } from '../core/settings-defaults.js';
import { normalizeBook } from '../core/model.js';
import { evictSnapshots } from '../core/snapshot.js';

function safeClone(v, fallback) {
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return fallback;
  }
}

function emptyState() {
  return { settings: {}, books: [], manualState: {}, chatStates: {}, importLog: [], ui: {}, snapshots: [] };
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
    cache = b;
    return b;
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

  function exportAll() {
    const b = bucket();
    return safeClone(
      {
        version: 1,
        settings: b.settings,
        books: b.books,
        manualState: b.manualState,
        importLog: b.importLog,
        ui: b.ui,
        snapshots: b.snapshots,
      },
      {},
    );
  }

  function importAll(blob) {
    const data = safeClone(blob, null);
    if (!data || typeof data !== 'object') throw new Error('导入的内容不是有效的数据');
    const b = bucket();
    if (data.settings && typeof data.settings === 'object') b.settings = data.settings;
    if (Array.isArray(data.books)) b.books = data.books.map((x) => normalizeBook(x));
    if (data.manualState && typeof data.manualState === 'object') b.manualState = data.manualState;
    if (data.importLog && Array.isArray(data.importLog)) b.importLog = data.importLog.slice(-IMPORT_LOG_LIMIT);
    if (data.ui && typeof data.ui === 'object') b.ui = data.ui;
    if (Array.isArray(data.snapshots)) b.snapshots = evictSnapshots(data.snapshots);
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
    listSnapshots,
    getSnapshot,
    saveSnapshot,
    deleteSnapshot,
    renameSnapshot,
    exportAll,
    importAll,
  };
}
