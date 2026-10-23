// core/import-plan.js —— 导入策略与批量导入计划（纯函数，ILB-3.6）
// 两个问题在这里回答：
//   1. 导进来的条目，保留原件的开/关，还是统一全开/全关？
//   2. 一次导入很多本时，哪些跳过、哪些要更新？

export const IMPORT_POLICIES = ['ask', 'keep', 'on', 'off'];

export const IMPORT_POLICY_LABEL = {
  ask: '每次导入时问我',
  keep: '保留原生世界书里的开/关',
  on: '一律设为已启用',
  off: '一律设为已停用',
};

export function normalizeImportPolicy(value) {
  return IMPORT_POLICIES.includes(value) ? value : 'ask';
}

/**
 * 把策略作用到一本已经转换好的书上。
 * 'ask' 与 'keep' 都不改任何条目的开关——'ask' 交给界面先问用户，问完再传具体策略。
 */
export function applyImportPolicy(book, policy) {
  if (!book || typeof book !== 'object') return book;
  const mode = normalizeImportPolicy(policy);
  if (mode === 'keep' || mode === 'ask') return book;
  const enabled = mode === 'on';
  return {
    ...book,
    entries: (book.entries ?? []).map((entry) => ({ ...entry, enabled })),
  };
}

/** 导入一本时，界面上该显示哪几个按钮（'ask' 才弹） */
export function policyChoices() {
  return IMPORT_POLICIES.filter((p) => p !== 'ask').map((p) => ({ value: p, label: IMPORT_POLICY_LABEL[p] }));
}

/**
 * 批量导入计划。
 * 已导入过的书按 `_source.book_file` 认（不是按书名，书名可以重名）。
 * @param {Array} files 原生世界书列表 [{name}]
 * @param {Array} books 现有 ILB 书架
 * @param {{includeExisting?: boolean}} options
 */
export function planBatchImport(files, books, options = {}) {
  const includeExisting = options.includeExisting === true;
  const bySource = new Map();
  for (const book of Array.isArray(books) ? books : []) {
    const file = book?._source?.book_file;
    if (file) bySource.set(String(file), book);
  }

  const queue = [];
  const skipped = [];
  const seen = new Set();

  for (const file of Array.isArray(files) ? files : []) {
    const name = String(file?.name ?? '').trim();
    if (!name) continue;
    if (seen.has(name)) continue; // 宿主列表理论上不会重复，重复了也只导一次
    seen.add(name);
    const existing = bySource.get(name) ?? null;
    if (existing && !includeExisting) {
      skipped.push({ file: name, book: existing.name ?? existing.book_id, reason: 'already-imported' });
      continue;
    }
    queue.push({ file: name, bookId: existing?.book_id ?? null });
  }

  return { queue, skipped, total: seen.size };
}

export function describePlan(plan) {
  const q = plan?.queue?.length ?? 0;
  const s = plan?.skipped?.length ?? 0;
  if (q === 0 && s === 0) return '没有可导入的文件';
  if (s === 0) return `将导入 ${q} 本`;
  if (q === 0) return `${s} 本都已经导入过了，没有新的`;
  return `将导入 ${q} 本，跳过 ${s} 本已导入的`;
}
