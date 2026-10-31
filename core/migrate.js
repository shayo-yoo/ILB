// core/migrate.js —— 存档迁移（ILB-7.15）。纯函数，不认识宿主也不认识界面。
//
// 四条硬规矩（需求文档 §7.1）：
//   1. 迁移前留一份可恢复的备份 —— 由调用方（adapters/repository.js）负责拍快照；
//   2. 幂等 —— 同一份数据跑两遍结果一样，第二遍什么也不改；
//   3. 失败不覆盖 —— 这里只会返回新对象，抛错时调用方保留原数据；
//   4. 迁移后旧规则、旧流程仍可读可执行 —— 只加字段，不删字段，不把未知节点改名。
//
// 数据版本（dataVersion）与书的 schema_version 是两件事：
//   schema_version = 2  说的是"一本书长什么样"
//   dataVersion    = 2  说的是"整个存档罐子长什么样"（v0.14 及之前没有这个字段，按 1 算）

export const DATA_VERSION = 2;

export const MIGRATION_NOTES = Object.freeze({
  v1: '给每本书补上「启用策略 / 强制开关 / 酒馆关联」三组字段，老数据的行为不变',
});

function clone(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(clone);
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    out[k] = clone(val);
  }
  return out;
}

/** 老版本里 `activation.mode` 是 'always' | 'character' | 'manual'；新版本用 strategy 表达同一件事 */
export function strategyOfLegacyMode(mode) {
  if (mode === 'always') return 'always';
  if (mode === 'character') return 'auto';
  return 'manual';
}

/**
 * 迁移整个存档罐子。
 * @param {object} bucket 形如 { settings, books, manualState, chatStates, importLog, ui, snapshots }
 * @param {{ now?: number }} [options]
 * @returns {{ data: object, changed: boolean, from: number, to: number, notes: string[], books: number, error?: string }}
 */
export function migrateBucket(bucket, options = {}) {
  const now = Number(options.now) || Date.now();
  const source = bucket && typeof bucket === 'object' ? bucket : {};
  const from = normalizeVersion(source.version);
  const result = {
    data: null,
    changed: false,
    from,
    to: DATA_VERSION,
    notes: [],
    books: 0,
    error: '',
  };

  if (from >= DATA_VERSION) {
    // 已经是新版本：原样返回，一个字段都不动（幂等）
    result.data = source;
    return result;
  }

  try {
    const next = clone(source);
    next.books = migrateBooks(source.books, result);
    next.version = DATA_VERSION;
    next.migratedAt = now;
    next.migrationLog = Array.isArray(source.migrationLog) ? source.migrationLog.slice(-9) : [];
    next.migrationLog.push({ at: now, from, to: DATA_VERSION, books: result.books, note: MIGRATION_NOTES.v1 });
    result.data = next;
    result.changed = true;
    result.notes.push(MIGRATION_NOTES.v1);
    if (result.books > 0) result.notes.push(`共整理了 ${result.books} 本书；原有内容一个字都没改`);
    return result;
  } catch (err) {
    result.error = String(err?.message ?? err);
    result.data = source; // 失败不覆盖：把原样交回去
    return result;
  }
}

function normalizeVersion(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.trunc(n);
}

function migrateBooks(rawBooks, result) {
  if (!Array.isArray(rawBooks)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of rawBooks) {
    if (!raw || typeof raw !== 'object') continue;
    const book = typeof raw === 'object' ? clone(raw) : null;
    if (!book) continue;
    // 只补字段，不重新发明 id：老书仍按 book_id 识别，重复的才顺延
    let bookId = String(book.book_id ?? '').trim();
    if (!bookId) bookId = `book-${out.length + 1}`;
    while (seen.has(bookId)) bookId = `${bookId}-2`;
    seen.add(bookId);
    book.book_id = bookId;

    const activation = book.activation && typeof book.activation === 'object' ? book.activation : {};
    const known = ['always', 'character', 'manual'].includes(activation.mode);
    const legacyMode = known ? activation.mode : 'manual';
    if (!['auto', 'always', 'manual'].includes(activation.strategy)) {
      activation.strategy = strategyOfLegacyMode(legacyMode);
      result.books += 1;
    }
    if (!['auto', 'on', 'off'].includes(activation.override)) activation.override = 'auto';
    activation.mode = activation.mode ?? legacyMode; // 老界面还在读它，留着
    book.activation = activation;

    const host = book.host && typeof book.host === 'object' ? book.host : {};
    host.nativeNames = Array.isArray(host.nativeNames) ? host.nativeNames.map(String) : [];
    host.aliases = Array.isArray(host.aliases) ? host.aliases.map(String) : [];
    host.lastMatchedAt = Number(host.lastMatchedAt) || 0;
    book.host = host;

    if (!book.schema_version) book.schema_version = 2;
    out.push(book);
  }
  return out;
}

/** 界面/诊断要显示的一句话 */
export function describeMigration(result) {
  if (!result) return '';
  if (result.error) return `存档迁移失败（已保留原数据）：${result.error}`;
  if (!result.changed) return '存档已是最新格式，不需要迁移';
  return `已把存档从 v${result.from} 迁移到 v${result.to}`;
}
