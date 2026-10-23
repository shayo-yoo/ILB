// core/ids.js —— 纯函数，无任何外部依赖
// 作用：生成与比较 id、提供可复现的哈希（随机种子要用它）

/**
 * FNV-1a 32 位哈希。稳定、跨平台一致，用来把"种子 + 条目 id"变成 0..1 的数。
 * 用它而不是 Math.random()，是为了同一 seed 两次调用结果完全一致（ILB-4.8.2）。
 */
export function stableHash(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 由哈希导出的 0..1 浮点数（只取高位，低位分布更均匀） */
export function hashToUnit(str) {
  return (stableHash(str) >>> 8) / 0x1000000;
}

/** 生成一个 id。优先用 crypto，缺失时退化为时间 + 随机，绝不抛错。 */
export function makeId(prefix = 'id') {
  let body;
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      body = crypto.randomUUID();
    }
  } catch {
    body = null;
  }
  if (!body) {
    body = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
  return `${prefix}-${body}`;
}

/** 字典序比较，用于三级排序的最后一级（ILB-4.2.1 第 8 步） */
export function compareId(a, b) {
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

/** 把 "书::条目" 拆开，拿不到就返回 { bookId: null, localId: id } */
export function splitEntryId(entryId) {
  const s = String(entryId ?? '');
  const i = s.indexOf('::');
  if (i < 0) return { bookId: null, localId: s };
  return { bookId: s.slice(0, i), localId: s.slice(i + 2) };
}
