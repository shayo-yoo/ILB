// core/merge-book.js —— 纯函数
// 重复导入同一本原生书时，把新转换的结果合并进已有的书（ILB-3.3.3 幂等）。
// 三条硬规矩：
//   1. 只增、只更新，不删除用户已经有的条目；
//   2. 用户在 ILB 里手改过正文的条目，不覆盖，只报告冲突；
//   3. 书的启用方式、是否进池、条目排序由用户掌握，重导入不改。

import { deepClone } from './model.js';
import { stableHash } from './ids.js';

// 参与"内容是否变了"比较的字段。ui 不在其中：排序位次是用户的，不属于源文件。
const COMPARED = [
  'title', 'content', 'enabled', 'always', 'trigger', 'scope', 'when',
  'group', 'weight', 'probability', 'useProbability', 'timed', 'chain', 'injection',
];

function fingerprintOf(entry) {
  const pick = {};
  for (const k of COMPARED) pick[k] = entry?.[k];
  try {
    return stableHash(JSON.stringify(pick));
  } catch {
    return stableHash(String(entry?.content ?? ''));
  }
}

/** 配对键：优先用源文件的 uid；没有 uid 时退回条目在书内的本地 id */
function pairKey(entry) {
  const uid = entry?._source?.uid;
  if (uid !== undefined && uid !== null) return `uid:${String(uid)}`;
  return `id:${String(entry?.localId ?? entry?.id ?? '')}`;
}

/** 判断条目是否被用户在 ILB 里改过正文（改了但没更新 content_hash） */
function editedByUser(entry) {
  const recorded = entry?._source?.content_hash;
  if (!recorded) return false;
  return recorded !== stableHash(String(entry?.content ?? ''));
}

/**
 * @param {object|null} existing 已有的书（同一本），没有则传 null
 * @param {object} incoming convertNativeWorld 刚转换出来的书
 * @returns {{book: object, stats: object, conflicts: {entryId: string, title: string}[]}}
 */
export function mergeImportedBook(existing, incoming, now = Date.now()) {
  const stats = { mode: existing ? 'merge' : 'first', added: 0, updated: 0, unchanged: 0, kept: 0, conflicts: 0, total: 0 };
  const conflicts = [];

  if (!existing) {
    stats.added = incoming.entries.length;
    stats.total = stats.added;
    const book = {
      ...incoming,
      _source: { ...incoming._source, imported_at: now, import_count: 1 },
    };
    return { book, stats, conflicts };
  }

  const index = new Map();
  for (const entry of existing.entries) index.set(pairKey(entry), entry);

  const seen = new Set();
  const merged = [];

  for (const inc of incoming.entries) {
    const key = pairKey(inc);
    seen.add(key);
    const old = index.get(key);

    if (!old) {
      merged.push(inc);
      stats.added += 1;
      continue;
    }

    if (editedByUser(old) && String(old.content ?? '') !== String(inc.content ?? '')) {
      merged.push(deepClone(old));
      stats.conflicts += 1;
      conflicts.push({ entryId: old.id, title: old.title });
      continue;
    }

    if (fingerprintOf(old) === fingerprintOf(inc)) {
      // 源文件没变，保留旧对象（连带旧的 ui.order 与内容哈希）
      merged.push(deepClone(old));
      stats.unchanged += 1;
      continue;
    }

    merged.push({
      ...inc,
      // id 与本地 id 保持不变：用户的 when 引用、时效记录都靠它
      id: old.id,
      localId: old.localId,
      ui: deepClone(old.ui ?? inc.ui),
    });
    stats.updated += 1;
  }

  for (const old of existing.entries) {
    if (seen.has(pairKey(old))) continue;
    // 源头已经没有的条目：保留，永不自动删除
    merged.push(deepClone(old));
    stats.kept += 1;
  }

  stats.total = merged.length;

  const book = {
    ...incoming,
    book_id: existing.book_id,
    name: existing.name || incoming.name,
    created_at: existing.created_at ?? incoming.created_at,
    updated_at: now,
    // 这三样是用户的决定，重导入不得覆盖
    activation: deepClone(existing.activation ?? incoming.activation),
    pool: deepClone(existing.pool ?? incoming.pool),
    entries: merged,
    _source: {
      ...incoming._source,
      imported_at: now,
      import_count: Math.max(0, Number(existing._source?.import_count) || 0) + 1,
    },
  };

  return { book, stats, conflicts };
}
