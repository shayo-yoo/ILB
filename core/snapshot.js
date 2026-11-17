// core/snapshot.js —— 快照（纯函数，ILB-6.11）
// 快照只记"哪些条目开着、哪几本书在场"。正文、触发词、注入位置都不进快照：
// 那些是"这本书是什么"，快照记的是"这一轮想用什么风格"。
// 这样用户在两个风格之间来回切，不会因为切快照把正文改掉。

import { makeId } from './ids.js';

// 快照不设数量上限；旧常量仅供兼容读取，不再用于淘汰。
export const NAMED_SNAPSHOT_LIMIT = Infinity;
export const QUICK_SNAPSHOT_LIMIT = Infinity;

function clone(v, fallback) {
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return fallback;
  }
}

function isOn(manualState, book) {
  if (manualState && Object.prototype.hasOwnProperty.call(manualState, book.book_id)) {
    return manualState[book.book_id] !== false;
  }
  return book?.activation?.manual !== false;
}

/**
 * 把"当前状态"压成一份快照。
 * @param {Array} books
 * @param {object} manualState
 * @param {{name?: string, note?: string, now?: number, auto?: boolean, chatId?: string, character?: {avatar?: string, name?: string}, characterAvatar?: string, characterName?: string}} options
 */
export function createSnapshot(books, manualState, options = {}) {
  const now = Number(options.now) || Date.now();
  const name = String(options.name ?? '').trim();
  const list = Array.isArray(books) ? books : [];
  const payload = list.map((book) => ({
    book_id: book.book_id,
    name: book.name ?? book.book_id,
    activation: {
      mode: book?.activation?.mode ?? 'manual',
      characters: clone(book?.activation?.characters ?? [], []),
      manual: book?.activation?.manual !== false,
    },
    pool: book?.pool?.share === true,
    manual: isOn(manualState, book),
    entries: (book.entries ?? []).map((entry) => ({
      id: entry.id,
      title: entry.title ?? '',
      enabled: entry.enabled !== false,
      always: entry.always === true,
    })),
  }));

  return {
    id: makeId('snap'),
    name,
    note: String(options.note ?? ''),
    at: now,
    kind: name ? 'named' : 'quick',
    auto: options.auto === true,
    bindings: Array.isArray(options.bindings) ? clone(options.bindings, []) : [],
    context: {
      chatId: String(options.chatId ?? '').trim(),
      character: {
        avatar: String(options.character?.avatar ?? options.characterAvatar ?? '').trim(),
        name: String(options.character?.name ?? options.characterName ?? '').trim(),
      },
    },
    payload,
    summary: summarizePayload(payload),
  };
}

export function summarizePayload(payload) {
  const books = Array.isArray(payload) ? payload : [];
  let enabled = 0;
  let total = 0;
  let always = 0;
  for (const book of books) {
    for (const entry of book.entries ?? []) {
      total += 1;
      if (entry.enabled) enabled += 1;
      if (entry.enabled && entry.always) always += 1;
    }
  }
  return { books: books.length, entries: total, enabled, always };
}

export function describeSnapshot(snapshot) {
  const s = snapshot?.summary ?? summarizePayload(snapshot?.payload);
  const when = new Date(Number(snapshot?.at) || Date.now()).toLocaleString();
  return `${when} · ${s.books} 本书 · 启用 ${s.enabled}/${s.entries} 条（其中常驻 ${s.always} 条）`;
}

/**
 * 把快照套回当前的书。
 * 只动四样东西：书的启用方式、书的启用方式里的角色绑定、手动开关、条目的启用与常驻。
 * 快照里没有的条目（后来新加的）保持原样，并在结果里报告，免得用户以为"恢复了就全没了"。
 */
export function applySnapshot(snapshot, books, manualState) {
  const list = clone(Array.isArray(books) ? books : [], []);
  const manual = clone(manualState ?? {}, {});
  const report = { booksTouched: 0, entriesTouched: 0, missingBooks: [], missingEntries: 0 };

  const payload = Array.isArray(snapshot?.payload) ? snapshot.payload : [];
  const byId = new Map(list.map((book) => [book.book_id, book]));

  for (const saved of payload) {
    const book = byId.get(saved.book_id);
    if (!book) {
      report.missingBooks.push(saved.name ?? saved.book_id);
      continue;
    }
    book.activation = {
      ...(book.activation ?? {}),
      mode: saved.activation?.mode ?? book.activation?.mode ?? 'manual',
      characters: clone(saved.activation?.characters ?? [], []),
      manual: saved.activation?.manual !== false,
    };
    book.pool = { ...(book.pool ?? {}), share: saved.pool === true };
    if (typeof saved.manual === 'boolean') manual[book.book_id] = saved.manual;
    report.booksTouched += 1;

    const entriesById = new Map((book.entries ?? []).map((entry) => [entry.id, entry]));
    for (const savedEntry of saved.entries ?? []) {
      const entry = entriesById.get(savedEntry.id);
      if (!entry) {
        report.missingEntries += 1;
        continue;
      }
      const before = `${entry.enabled !== false}|${entry.always === true}`;
      entry.enabled = savedEntry.enabled !== false;
      entry.always = savedEntry.always === true;
      if (before !== `${entry.enabled}|${entry.always}`) report.entriesTouched += 1;
    }
  }

  return { books: list, manualState: manual, report };
}

/** 超出上限时丢掉最早的；已命名的与未命名的分开算（ILB-6.11.4）
 *  排序用 promotedAt ?? at：把一份旧快照改名成"常用"时，它算新加入的，不该被立刻顶掉。
 */
export function evictSnapshots(snapshots) {
  // 历史 API 保留，但快照现在不设数量上限；只过滤无效记录并保持原顺序。
  return (Array.isArray(snapshots) ? snapshots : []).filter((s) => s && s.id);
}

export const AUTO_SNAPSHOT_MODES = ['normal', 'only', 'off'];

/**
 * 一份快照在"自动激活"里算什么状态。
 *
 * 只有用户在快照卡片上**明确选了**激活模式才算数：
 *   - 自动备份 / 迁移备份（auto===true）永远不参与自动激活；
 *   - 没有 activationMode 的老快照一律视为「不激活」。
 * 这样"什么都没开"时不会凭空激活任何东西。
 */
export function snapshotActivationMode(snapshot) {
  if (!snapshot || snapshot.auto === true) return 'off';
  const mode = snapshot.activationMode;
  return AUTO_SNAPSHOT_MODES.includes(mode) ? mode : 'off';
}

export function normalizeAutoSnapshot(raw = {}) {
  const mode = AUTO_SNAPSHOT_MODES.includes(raw.mode) ? raw.mode : 'off';
  const ids = Array.isArray(raw.snapshotIds) ? raw.snapshotIds.map(String).filter(Boolean) : [];
  return { enabled: raw.enabled === true, mode, snapshotIds: [...new Set(ids)] };
}

export function autoSnapshotMatches(snapshot, context = {}) {
  if (!snapshot || !snapshot.id) return false;
  const bindings = Array.isArray(snapshot.bindings) ? snapshot.bindings : [];
  if (bindings.length > 0) {
    return bindings.some((binding) => {
      if (binding?.type === 'chat') return String(binding.id ?? '') === String(context.chatId ?? '');
      if (binding?.type === 'character') return String(binding.avatar ?? '') === String(context.character?.avatar ?? '');
      return false;
    });
  }
  const wanted = snapshot.context ?? {};
  if (wanted.chatId && String(wanted.chatId) !== String(context.chatId ?? '')) return false;
  const wc = wanted.character ?? {};
  const cc = context.character ?? {};
  if (wc.avatar && String(wc.avatar) !== String(cc.avatar ?? '')) return false;
  if (wc.name && String(wc.name) !== String(cc.name ?? '')) return false;
  return true;
}

export function selectAutoSnapshots(snapshots, config = {}, context = {}) {
  const cfg = normalizeAutoSnapshot(config);
  const selected = (Array.isArray(snapshots) ? snapshots : []).filter((s) => {
    const mode = snapshotActivationMode(s);
    if (mode === 'off') return false; // 没明确打开的快照一律不参与
    // 兼容老配置：填了 snapshotIds 就只认这些 id
    if (cfg.snapshotIds.length > 0 && !cfg.snapshotIds.includes(String(s.id))) return false;
    return autoSnapshotMatches(s, context);
  });
  const only = selected.filter((s) => snapshotActivationMode(s) === 'only');
  return only.length ? only : selected;
}

/**
 * 命中快照后应该怎么影响这一轮：**只算临时强制开关，不写回手动状态**。
 *
 * 需求（v0.30 起）：快照不允许把世界书永久设成"已激活"，只在匹配到上下文时
 * 一次性开 / 关；离开上下文或下次不匹配就等于什么都没发生（forced 为空）。
 * 所以这里的 manualState 始终等于传进来的当前值，调用方不需要、也不应该落盘。
 */
export function snapshotActivationPlan(snapshots, config = {}, context = {}, currentManual = {}) {
  const matched = selectAutoSnapshots(snapshots, config, context);
  if (matched.length === 0) return { matched: false, key: '', snapshots: [], manualState: { ...currentManual }, forced: {}, mode: 'none' };
  const key = `${String(context.chatId ?? '')}::${String(context.character?.avatar ?? '')}`;
  const only = matched.some((snapshot) => snapshotActivationMode(snapshot) === 'only');
  const forced = {};
  for (const snapshot of matched) {
    for (const book of Array.isArray(snapshot.payload) ? snapshot.payload : []) {
      if (!book?.book_id) continue;
      const id = String(book.book_id);
      if (book.manual === true) forced[id] = 'on';          // 快照里开着的：这一轮强制开
      else if (only) forced[id] = 'off';                     // 仅激活：快照里关着的强制关
    }
  }
  return { matched: true, key, snapshots: matched, manualState: { ...currentManual }, forced, mode: only ? 'only' : 'normal' };
}

export function listNamed(snapshots) {
  return (Array.isArray(snapshots) ? snapshots : []).filter((s) => s.kind === 'named' || Boolean(String(s.name ?? '').trim()));
}

export function listQuick(snapshots) {
  return (Array.isArray(snapshots) ? snapshots : []).filter((s) => !(s.kind === 'named' || Boolean(String(s.name ?? '').trim())));
}
