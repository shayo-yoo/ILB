// core/budget.js —— 纯函数
// token 估算与预算计算。同步路径上只能用字符估算（ILB-4.7.3），
// 精确值由异步 tokenizer 事后回填，不在这里做。

import { DEFAULT_SETTINGS } from './settings-defaults.js';

export { DEFAULT_SETTINGS };

function isCJK(cp) {
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) || // 基本汉字
    (cp >= 0x3400 && cp <= 0x4dbf) || // 扩展 A
    (cp >= 0x3000 && cp <= 0x303f) || // 中文标点
    (cp >= 0xf900 && cp <= 0xfaff) || // 兼容汉字
    (cp >= 0x3040 && cp <= 0x30ff) || // 日文假名
    (cp >= 0xac00 && cp <= 0xd7af)    // 韩文
  );
}

/**
 * 字符估算：CJK 约 3.5 字/token，拉丁约 4 字/token，按字符类别加权。
 * 故意偏保守（宁可估多），因为估少了会超预算。
 */
export function estimateTokens(text) {
  const s = String(text ?? '');
  if (!s) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of s) {
    if (isCJK(ch.codePointAt(0))) cjk++;
    else other++;
  }
  return Math.ceil(cjk / 3.5 + other / 4);
}

/** budget = min(上下文 × 比例, 上限)，clamp 到 [200, 8000] */
export function computeBudgetTokens({ contextSize, ratio, cap } = {}) {
  const r = Number.isFinite(ratio) ? ratio : DEFAULT_SETTINGS.budgetRatio;
  const c = Number.isFinite(cap) ? cap : DEFAULT_SETTINGS.budgetCap;
  const ctx = Number(contextSize);
  if (!Number.isFinite(ctx) || ctx <= 0) {
    return Math.max(200, Math.min(c || DEFAULT_SETTINGS.budgetCap, DEFAULT_SETTINGS.budgetCap));
  }
  const value = Math.min(ctx * r, c);
  return Math.max(200, Math.min(8000, Math.round(value)));
}

/** 一组正文的总估算 */
export function estimateTokensOf(contents) {
  return (contents || []).reduce((sum, c) => sum + estimateTokens(c), 0);
}
