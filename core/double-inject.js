// core/double-inject.js —— 纯函数
// 同源双重注入（ILB-4.10 / ILB-4.23.11）：同一本内容既是酒馆原生世界书、又是 ILB 导入副本时，
// 两边各注入一次就重复了。设置 doubleInjectPolicy 决定"看见之后怎么办"：
//   warn  —— 照常注入，只在诊断页提醒（默认；v0.15 的老行为）
//   allow —— 照常注入，不提醒
//   skip  —— 跳过 ILB 这一侧的副本（原生书仍由酒馆注入）
//
// 这里只做"启用集合与候选池的纯函数重算"，不读宿主、不写存档、不弹提示。
// 判定依据是 resolveBooks 产出的 details：enabled === true 且 matched 非空，
// 也就是"这本书这一轮真的跟着某本原生世界书启用了"。

export const DOUBLE_INJECT_POLICIES = ['warn', 'allow', 'skip'];
export const DOUBLE_INJECT_REASON = '同源双重注入：按设置跳过 ILB 这一侧（原生书仍由酒馆注入）';

/** 找出这一轮"会被两边各注入一次"的书（只认启用且命中原生来源的）。 */
export function findDoubleInjects(resolved) {
  const details = resolved?.details ?? {};
  const ids = [];
  for (const id of Object.keys(details)) {
    const d = details[id];
    if (!d || d.enabled !== true) continue;
    if (!Array.isArray(d.matched) || d.matched.length === 0) continue;
    ids.push(id);
  }
  return ids;
}

/**
 * 按设置决定要不要把"同源副本"从这一轮里摘掉。
 * @param {object} resolved resolveBooks 的结果
 * @param {object[]} books 归一化后的书（重算候选池用）
 * @param {string} policy 'warn' | 'allow' | 'skip'
 * @returns {{resolved: object, duplicates: string[], skipped: string[], policy: string}}
 */
export function applyDoubleInjectPolicy(resolved, books, policy = 'warn') {
  const base = resolved ?? {};
  const duplicates = findDoubleInjects(base);
  const effective = DOUBLE_INJECT_POLICIES.includes(policy) ? policy : 'warn';
  if (effective !== 'skip' || duplicates.length === 0) {
    return { resolved: base, duplicates, skipped: [], policy: effective };
  }

  const skipped = new Set(duplicates);
  const details = { ...(base.details ?? {}) };
  const reasons = { ...(base.reasons ?? {}) };
  for (const id of duplicates) {
    details[id] = { ...details[id], enabled: false, rule: 'double-inject-skip', reason: DOUBLE_INJECT_REASON };
    reasons[id] = DOUBLE_INJECT_REASON;
  }

  const activeBooks = (base.activeBooks ?? []).filter((id) => !skipped.has(id));
  const inactiveBooks = [...(base.inactiveBooks ?? [])];
  for (const id of duplicates) if (!inactiveBooks.includes(id)) inactiveBooks.push(id);

  const activeSet = new Set(activeBooks);
  const list = Array.isArray(books) ? books.filter((b) => b && b.book_id) : [];
  const entriesByBook = {};
  const pool = [];
  const poolIds = new Set();
  for (const book of list) {
    const id = book.book_id;
    entriesByBook[id] = Array.isArray(book.entries) ? book.entries : [];
    // 被跳过的书不再贡献内容；除非它明确把条目共享进候选池（pool.share）——
    // 共享是用户显式的"给别的书用"，和"注入这本书"不是一回事。
    const contributes = activeSet.has(id) || (book.pool?.share === true && !skipped.has(id));
    if (!contributes) continue;
    for (const entry of entriesByBook[id]) {
      if (!entry || !entry.id || poolIds.has(entry.id)) continue;
      poolIds.add(entry.id);
      pool.push(entry);
    }
  }

  return {
    resolved: {
      ...base,
      activeBooks,
      inactiveBooks,
      reasons,
      details,
      entriesByBook,
      pool,
      isPooled: (id) => poolIds.has(id),
    },
    duplicates,
    skipped: duplicates,
    policy: effective,
  };
}
