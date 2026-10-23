// core/text-match.js —— 纯函数，无任何外部依赖
// 触发词匹配的唯一实现处。所有"包含/整词/大小写/正则"的判断都走这里，
// 保证规则表、诊断、判定层看到的是同一套语义。

const WORD_CHAR = /[A-Za-z0-9_]/;

export function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 纯 ASCII 词才谈得上"整词"；中文不存在词边界，整词开关对它无效 */
export function isAsciiWord(s) {
  return /^[A-Za-z0-9_]+$/.test(String(s));
}

/**
 * 文本里是否出现某个触发词。
 * @param {string} haystack
 * @param {string} needle
 * @param {{caseSensitive?: boolean, wholeWords?: boolean}} opts
 */
export function containsNeedle(haystack, needle, opts = {}) {
  const hayRaw = String(haystack ?? '');
  const needleRaw = String(needle ?? '');
  if (!needleRaw) return false;

  const caseSensitive = !!opts.caseSensitive;
  const hay = caseSensitive ? hayRaw : hayRaw.toLowerCase();
  const ndl = caseSensitive ? needleRaw : needleRaw.toLowerCase();

  // 整词开关只对纯 ASCII 词生效，否则退化为普通包含（避免中文误判）
  if (!opts.wholeWords || !isAsciiWord(needleRaw)) {
    return hay.includes(ndl);
  }

  const re = new RegExp(`(?:^|[^A-Za-z0-9_])${escapeRegExp(ndl)}(?:[^A-Za-z0-9_]|$)`);
  return re.test(hay);
}

/** 出现次数，用于"提到几次才算"之类的将来扩展；当前只用于诊断展示 */
export function countNeedle(haystack, needle, opts = {}) {
  const hayRaw = String(haystack ?? '');
  const needleRaw = String(needle ?? '');
  if (!needleRaw) return 0;
  const caseSensitive = !!opts.caseSensitive;
  const hay = caseSensitive ? hayRaw : hayRaw.toLowerCase();
  const ndl = caseSensitive ? needleRaw : needleRaw.toLowerCase();
  let count = 0;
  let from = 0;
  for (;;) {
    const at = hay.indexOf(ndl, from);
    if (at < 0) break;
    count++;
    from = at + Math.max(1, ndl.length);
  }
  return count;
}

const MAX_REGEX_SOURCE = 500;
const MAX_REGEX_INPUT = 20000;

/**
 * 编译一条正则。任何失败都返回 null（不抛错）——坏正则不能让整轮判定挂掉。
 * 输入长度做上限，是 ReDoS 的第一道（粗糙但有效）挡板；完整方案见 Phase 6。
 */
export function compileRegex(spec) {
  if (!spec) return null;
  const source = typeof spec === 'string' ? spec : spec.source;
  const flags = typeof spec === 'string' ? '' : String(spec.flags ?? '');
  if (typeof source !== 'string' || !source.length) return null;
  if (source.length > MAX_REGEX_SOURCE) return null;
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

/** 安全 test：限长输入 + 捕获异常 */
export function safeRegexTest(re, text) {
  if (!re) return false;
  const s = String(text ?? '').slice(0, MAX_REGEX_INPUT);
  try {
    return re.test(s);
  } catch {
    return false;
  }
}

/** 数组字段的安全取值：非数组一律当空数组，元素转字符串 */
export function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v ?? '')).filter((v) => v.length > 0);
}
