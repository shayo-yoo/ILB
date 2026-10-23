// core/search.js —— 搜索与筛选（纯函数，ILB-6.10）
// 界面用，不参与判定。这里不 import 任何 DOM，也不认识 repository。

/** 统一大小写；全角空格也当分隔符，中文输入法常带出全角空格 */
function lower(value) {
  return String(value ?? '').toLowerCase();
}

/** 把用户输入的一句话拆成若干关键词（空格/全角空格/逗号都算分隔） */
export function splitQuery(query) {
  return lower(query)
    .split(/[\s,，、]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 一条规则里所有"能被搜到"的文字：标题、正文、触发词、分组 */
export function entryHaystack(entry) {
  if (!entry || typeof entry !== 'object') return '';
  const trigger = entry.trigger ?? {};
  const parts = [
    entry.title,
    entry.content,
    entry.group,
    ...(Array.isArray(trigger.any) ? trigger.any : []),
    ...(Array.isArray(trigger.all) ? trigger.all : []),
    // 正则在存储里是 {source, flags}，直接 join 会变成 "[object Object]"
    ...(Array.isArray(trigger.regex)
      ? trigger.regex.map((r) => (typeof r === 'string' ? r : r?.source ?? ''))
      : []),
  ];
  return lower(parts.filter(Boolean).join(' \u0001 '));
}

/**
 * 关键词全部命中才算命中（AND）。这样"王城 夜巡"能缩小范围，而不是越搜越多。
 * 空关键词视为命中。
 */
export function matchesQuery(entry, query) {
  const words = splitQuery(query);
  if (words.length === 0) return true;
  const hay = entryHaystack(entry);
  return words.every((w) => hay.includes(w));
}

export function listGroups(entries) {
  const seen = new Set();
  for (const entry of entries ?? []) {
    const group = entry?.group;
    if (group === null || group === undefined || group === '') continue;
    seen.add(String(group));
  }
  return [...seen].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

export const RULE_MODES = ['all', 'enabled', 'disabled', 'always', 'keyword', 'chain'];
export const RULE_MODE_LABEL = {
  all: '全部',
  enabled: '已启用',
  disabled: '已停用',
  always: '常驻',
  keyword: '靠触发词',
  chain: '允许连锁',
};

function matchMode(entry, mode) {
  switch (mode) {
    case 'enabled':
      return entry?.enabled !== false;
    case 'disabled':
      return entry?.enabled === false;
    case 'always':
      return entry?.always === true;
    case 'keyword':
      return entry?.always !== true;
    case 'chain':
      return entry?.chain?.participate === true;
    default:
      return true;
  }
}

/**
 * @param {Array} entries
 * @param {{q?: string, group?: string, mode?: string}} filters
 */
export function filterEntries(entries, filters = {}) {
  const q = filters.q ?? '';
  const group = filters.group ?? '';
  const mode = filters.mode ?? 'all';
  const list = Array.isArray(entries) ? entries : [];
  return list.filter((entry) => {
    if (group && String(entry?.group ?? '') !== group) return false;
    if (!matchMode(entry, mode)) return false;
    return matchesQuery(entry, q);
  });
}

/** 书架上按书名 + 来源文件 + 条目标题搜 */
export function filterBooks(books, query) {
  const words = splitQuery(query);
  const list = Array.isArray(books) ? books : [];
  if (words.length === 0) return list;
  return list.filter((book) => {
    const hay = lower([
      book?.name,
      book?._source?.book_file,
      ...(book?.entries ?? []).map((e) => e?.title),
    ].filter(Boolean).join(' \u0001 '));
    return words.every((w) => hay.includes(w));
  });
}

/** 只给界面用的一句话总结，例如「12 条里命中 3 条」 */
export function describeFilter(filters = {}, shown = 0, total = 0) {
  const bits = [];
  if (splitQuery(filters.q ?? '').length) bits.push('关键词');
  if (filters.group) bits.push(`分组 ${filters.group}`);
  if ((filters.mode ?? 'all') !== 'all') bits.push(RULE_MODE_LABEL[filters.mode] ?? filters.mode);
  if (bits.length === 0) return `共 ${total} 条`;
  return `${bits.join(' · ')}：${shown} / ${total} 条`;
}
