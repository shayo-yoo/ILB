// core/model.js —— 纯函数
// schema v2 的唯一"造物主"：默认值、归一化、校验都在这里。
// 其它模块不得自己拼对象字面量，否则字段一旦变动会到处改。

import { POSITIONS, ROLES, SECONDARY_LOGIC, ACTIVATION_MODES } from './settings-defaults.js';
import { normalizeFlow } from './flow.js';
import { normalizeFields } from './fields.js';

export function deepClone(value) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      /* 落到 JSON 兜底 */
    }
  }
  return JSON.parse(JSON.stringify(value));
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function str(v, fallback = '') {
  return typeof v === 'string' ? v : v == null ? fallback : String(v);
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pickOne(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

export function defaultTrigger() {
  return {
    any: [],
    all: [],
    not: [],
    matchCase: false,
    wholeWords: false,
    regex: [],
    secondary: { logic: 'AND_ANY', keys: [] },
  };
}

export function defaultEntry(overrides = {}) {
  return {
    id: '',
    title: '',
    content: '',
    enabled: true,
    always: false,
    trigger: defaultTrigger(),
    scope: { within: null },
    when: [],
    group: null,
    weight: 100,
    probability: 100,
    useProbability: false,
    timed: { sticky: 0, cooldown: 0, delay: 0 },
    chain: { participate: true },
    // 判定流程（ILB-4.11）。空流程 = 完全按原生那套工作。
    logic: { mode: 'and', nodes: [] },
    // 动态条目字段（ILB-4.13）：玩家在「状态」页可改的值，本质是聊天变量。
    fields: [],
    injection: { position: 'after_char', depth: 4, role: 'system' },
    _source: { book_file: null, uid: null, unknown: {}, content_hash: null },
    // 界面用的排序位次（ILB-4.2.1 第 8 步的第二级），不参与任何判定
    ui: { order: 0 },
    ...overrides,
  };
}

export function defaultBook(overrides = {}) {
  const now = Date.now();
  return {
    schema_version: 2,
    book_id: '',
    name: '未命名',
    created_at: now,
    updated_at: now,
    activation: { mode: 'manual', characters: [], manual: true },
    pool: { share: false },
    entries: [],
    // 来源与导入记录（ILB-3.3.1 / ILB-3.3.3）。content 改了但 content_hash 没变 = 用户改过。
    _source: { book_file: null, source_hash: null, imported_at: null, import_count: 0 },
    ...overrides,
  };
}

export function normalizeEntry(raw, bookId) {
  const base = defaultEntry();
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = { ...base, ...src };

  // id：书内 id 加 "<book_id>::" 前缀，成为全域唯一（ILB-3.4.1 / ILB-3.5.4）
  let localId = str(src.id, '');
  if (bookId && localId.startsWith(`${bookId}::`)) localId = localId.slice(bookId.length + 2);
  if (!localId) localId = `e-${Math.abs(hashString(str(src.title, 'entry')))}`;
  out.id = bookId ? `${bookId}::${localId}` : localId;
  out.localId = localId;

  out.title = str(src.title, '');
  out.content = str(src.content, '');
  out.enabled = src.enabled !== false;
  out.always = src.always === true;

  const t = src.trigger && typeof src.trigger === 'object' ? src.trigger : {};
  out.trigger = {
    ...defaultTrigger(),
    any: asArray(t.any).map((x) => str(x)),
    all: asArray(t.all).map((x) => str(x)),
    not: asArray(t.not).map((x) => str(x)),
    matchCase: t.matchCase === true,
    wholeWords: t.wholeWords === true,
    regex: asArray(t.regex)
      .map((r) => (typeof r === 'string' ? { source: r, flags: '' } : { source: str(r?.source, ''), flags: str(r?.flags, '') }))
      .filter((r) => r.source.length > 0),
    secondary: {
      logic: pickOne(t.secondary?.logic, SECONDARY_LOGIC, 'AND_ANY'),
      keys: asArray(t.secondary?.keys).map((x) => str(x)).filter(Boolean),
    },
  };

  const within = src.scope?.within;
  out.scope = { within: Number.isFinite(Number(within)) ? Math.min(50, Math.max(1, Math.trunc(Number(within)))) : null };

  out.when = asArray(src.when).filter((c) => c && typeof c === 'object');
  out.group = src.group == null || src.group === '' ? null : str(src.group);
  out.weight = Math.round(num(src.weight, 100));
  out.probability = Math.min(100, Math.max(0, Math.round(num(src.probability, 100))));
  out.useProbability = src.useProbability === true;
  out.timed = {
    sticky: Math.max(0, Math.trunc(num(src.timed?.sticky, 0))),
    cooldown: Math.max(0, Math.trunc(num(src.timed?.cooldown, 0))),
    delay: Math.max(0, Math.trunc(num(src.timed?.delay, 0))),
  };
  out.chain = { participate: src.chain?.participate !== false };
  out.logic = normalizeFlow(src.logic);
  out.fields = normalizeFields(src.fields);
  out.injection = {
    position: pickOne(src.injection?.position, POSITIONS, 'after_char'),
    depth: Math.max(0, Math.trunc(num(src.injection?.depth, 4))),
    role: pickOne(src.injection?.role, ROLES, 'system'),
  };
  out._source = {
    book_file: src._source?.book_file ?? null,
    uid: src._source?.uid ?? null,
    unknown: src._source?.unknown && typeof src._source.unknown === 'object' ? { ...src._source.unknown } : {},
    content_hash: src._source?.content_hash ?? null,
  };
  out.ui = { order: num(src.ui?.order, 0) };
  return out;
}

export function normalizeBook(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = defaultBook();
  out.schema_version = Math.trunc(num(src.schema_version, 2)) || 2;
  out.book_id = str(src.book_id, '') || `book-${Math.abs(hashString(str(src.name, 'book')))}`;
  out.name = str(src.name, '未命名') || '未命名';
  out.created_at = num(src.created_at, Date.now());
  out.updated_at = num(src.updated_at, out.created_at);
  out.activation = {
    mode: pickOne(src.activation?.mode, ACTIVATION_MODES, 'manual'),
    characters: asArray(src.activation?.characters).map((x) => str(x)).filter(Boolean),
    manual: src.activation?.manual !== false,
  };
  out.pool = { share: src.pool?.share === true };
  out._source = {
    book_file: src._source?.book_file ?? null,
    source_hash: src._source?.source_hash ?? null,
    imported_at: src._source?.imported_at ?? null,
    import_count: Math.max(0, Math.trunc(num(src._source?.import_count, 0))),
  };
  out.entries = asArray(src.entries).map((e) => normalizeEntry(e, out.book_id));
  return out;
}

/** 结构不变量校验（ILB-3.4.1）。返回人话问题列表；空数组 = 通过。 */
export function validateBook(book) {
  const problems = [];
  if (!book || typeof book !== 'object') return ['书不是对象'];
  if (book.schema_version !== 2) problems.push(`schema_version 是 ${book.schema_version}，本版本只认识 2`);
  if (!book.book_id) problems.push('缺少 book_id');
  const seen = new Set();
  for (const e of book.entries || []) {
    if (!e.id) problems.push('有条目没有 id');
    else if (seen.has(e.id)) problems.push(`条目 id 重复：${e.id}`);
    else seen.add(e.id);
    if (e.weight < 0) problems.push(`条目「${e.title}」的权重是负数`);
    if (e.probability < 0 || e.probability > 100) problems.push(`条目「${e.title}」的概率超出 0–100`);
    if (e.scope.within != null && e.scope.within > 50) problems.push(`条目「${e.title}」的扫描条数超过上限`);
    if (e.timed.sticky < 0 || e.timed.cooldown < 0 || e.timed.delay < 0) problems.push(`条目「${e.title}」的时效是负数`);
  }
  return problems;
}

export function makeEmptyBook(name = '新世界书') {
  const book = defaultBook({ name });
  book.book_id = `book-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return book;
}

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/** 统计一本书的 token（用估算，界面显示用） */
export function bookTokenEstimate(book, estimateTokens) {
  return (book.entries || []).reduce((sum, e) => sum + estimateTokens(e.content), 0);
}
