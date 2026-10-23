// core/import-native.js —— 纯函数
// 原生世界书 → ILB 书。一次性转换（ILB-3.3.2），此后与原件无关。
// 原则：不丢字段。认识的映射走附录 A，不认识的原样塞进 _source.unknown。

import { normalizeBook, deepClone } from './model.js';
import { stableHash } from './ids.js';

const POSITION_MAP = {
  0: { position: 'before_char', warn: null },
  1: { position: 'after_char', warn: null },
  2: { position: 'after_char', warn: '位置是「作者注释之前」，ILB 没有对应位置，已降级为「角色设定之后」' },
  3: { position: 'after_char', warn: '位置是「作者注释之后」，ILB 没有对应位置，已降级为「角色设定之后」' },
  4: { position: 'in_chat', warn: null },
  5: { position: 'after_char', warn: '位置是「示例消息之前」，ILB 没有对应位置，已降级为「角色设定之后」' },
  6: { position: 'after_char', warn: '位置是「示例消息之后」，ILB 没有对应位置，已降级为「角色设定之后」' },
};

const ROLE_MAP = { 0: 'system', 1: 'user', 2: 'assistant' };

const LOGIC_MAP = { 0: 'AND_ANY', 1: 'NOT_ALL', 2: 'NOT_ANY', 3: 'AND_ALL' };

// 已消费的原生字段；其余的进 _source.unknown
const CONSUMED = new Set([
  'uid', 'key', 'keysecondary', 'selective', 'selectiveLogic', 'content', 'comment',
  'constant', 'vectorized', 'order', 'position', 'depth', 'role', 'disable',
  'caseSensitive', 'matchWholeWords', 'scanDepth', 'sticky', 'cooldown', 'delay',
  'useProbability', 'probability', 'group', 'excludeRecursion', 'preventRecursion',
]);

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** 原生文件可能是"对象按 uid 索引"或"数组"，两种都认 */
export function listNativeEntries(raw) {
  const entries = raw?.entries;
  if (Array.isArray(entries)) return entries.map((e, i) => ({ uid: String(e?.uid ?? i), entry: e }));
  if (entries && typeof entries === 'object') {
    return Object.keys(entries).map((k) => ({ uid: String(entries[k]?.uid ?? k), entry: entries[k] }));
  }
  return [];
}

export function isNativeWorld(raw) {
  if (!raw || typeof raw !== 'object') return false;
  const entries = raw.entries;
  return Array.isArray(entries) || (!!entries && typeof entries === 'object');
}

/**
 * @returns {{book: object, warnings: {code: string, message: string, uid: string|null}[], stats: object}}
 */
export function convertNativeWorld(raw, options = {}) {
  const warnings = [];
  const fileName = String(options.fileName ?? 'unknown.json');
  const bookName = String(options.bookName ?? fileName.replace(/\.json$/i, '') ?? '导入的书');

  if (!isNativeWorld(raw)) {
    warnings.push({ code: 'not-a-world', message: '这个文件里没有 entries，看起来不是世界书', uid: null });
    return { book: null, warnings, stats: { total: 0, imported: 0 } };
  }

  const list = listNativeEntries(raw);
  const entries = [];
  // 源文件指纹：用来判断"还是不是同一份原件"（ILB-3.3.3 幂等）
  const sourceHash = stableHash(safeJson(raw));

  for (const { uid, entry } of list) {
    if (!entry || typeof entry !== 'object') {
      warnings.push({ code: 'bad-entry', message: `条目 ${uid} 不是对象，已跳过`, uid });
      continue;
    }

    const key = asArray(entry.key).map((x) => String(x)).filter(Boolean);
    const keySecondary = asArray(entry.keysecondary).map((x) => String(x)).filter(Boolean);
    const selective = entry.selective === true;
    const constant = entry.constant === true;

    if (constant && key.length > 0) {
      warnings.push({ code: 'constant-with-keys', message: `条目「${entry.comment || uid}」标为常驻却填了触发词，原生里这些词不生效，已保留为「永远都在」`, uid });
    }

    const position = POSITION_MAP[num(entry.position, 1)] ?? { position: 'after_char', warn: null };
    if (position.warn) warnings.push({ code: 'position-downgraded', message: position.warn, uid });

    if (entry.vectorized === true) {
      warnings.push({ code: 'vectorized', message: `条目「${entry.comment || uid}」用了向量匹配，ILB 暂不支持，该能力会丢失`, uid });
    }

    let within = null;
    const rawScan = num(entry.scanDepth, null);
    if (rawScan != null && rawScan > 0) {
      within = Math.min(10, Math.trunc(rawScan));
      if (rawScan > 10) warnings.push({ code: 'scan-depth-clamped', message: `条目「${entry.comment || uid}」的扫描深度 ${rawScan} 超过 10，已截到 10`, uid });
    }

    if (!selective && keySecondary.length > 0) {
      warnings.push({ code: 'secondary-dropped', message: `条目「${entry.comment || uid}」填了第二组触发词但没开「选择性」，原生里这组词不生效，导入时已丢弃`, uid });
    }

    const unknown = {};
    for (const k of Object.keys(entry)) {
      if (!CONSUMED.has(k)) unknown[k] = deepClone(entry[k]);
    }

    entries.push({
      id: String(uid),
      title: String(entry.comment || '').trim() || `条目 ${uid}`,
      content: String(entry.content ?? ''),
      enabled: entry.disable !== true,
      always: constant,
      trigger: {
        any: key,
        all: [],
        not: [],
        matchCase: entry.caseSensitive === true,
        wholeWords: entry.matchWholeWords === true,
        regex: [],
        secondary: selective
          ? { logic: LOGIC_MAP[num(entry.selectiveLogic, 0)] ?? 'AND_ANY', keys: keySecondary }
          : { logic: 'AND_ANY', keys: [] },
      },
      scope: { within },
      when: [],
      group: entry.group ? String(entry.group) : null,
      weight: Math.round(num(entry.order, 100)),
      probability: Math.min(100, Math.max(0, Math.round(num(entry.probability, 100)))),
      useProbability: entry.useProbability === true,
      timed: {
        sticky: Math.max(0, Math.trunc(num(entry.sticky, 0))),
        cooldown: Math.max(0, Math.trunc(num(entry.cooldown, 0))),
        delay: Math.max(0, Math.trunc(num(entry.delay, 0))),
      },
      chain: { participate: !(entry.excludeRecursion === true || entry.preventRecursion === true) && options.importedChainDefault === true },
      injection: {
        position: position.position,
        depth: Math.max(0, Math.trunc(num(entry.depth, 4))),
        role: ROLE_MAP[num(entry.role, 0)] ?? 'system',
      },
      _source: { book_file: fileName, uid, unknown, content_hash: stableHash(String(entry.content ?? '')) },
    });
  }

  const book = normalizeBook({
    schema_version: 2,
    name: bookName,
    activation: { mode: 'manual', characters: [], manual: true },
    pool: { share: false },
    entries,
    _source: { book_file: fileName, source_hash: sourceHash, imported_at: Date.now(), import_count: 1 },
  });

  return {
    book,
    warnings,
    stats: { total: list.length, imported: book.entries.length, warningCount: warnings.length, sourceHash },
  };
}

/**
 * 给一份原生世界书算指纹。导入时存一份，之后就能回答"原件到底改过没有"。
 * 界面用（书架上点"检查原件"），判定层不需要它。
 */
export function sourceHashOf(raw) {
  return stableHash(safeJson(raw));
}

/** 稳定序列化：键排序后再 stringify，避免字段顺序不同导致指纹不同 */
function safeJson(value) {
  try {
    return JSON.stringify(sortKeys(value));
  } catch {
    return String(value);
  }
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const k of Object.keys(value).sort()) out[k] = sortKeys(value[k]);
  return out;
}
