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

export function snapshotActivationMode(snapshot) {
  const mode = snapshot?.activationMode ?? (snapshot?.auto === true ? 'normal' : 'off');
  return AUTO_SNAPSHOT_MODES.includes(mode) ? mode : 'off';
}

export function normalizeAutoSnapshot(raw = {}) {
  const mode = AUTO_SNAPSHOT_MODES.includes(raw.mode) ? raw.mode : 'normal';
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
    const selectedByLegacyConfig = cfg.snapshotIds.length === 0 || cfg.snapshotIds.includes(String(s.id));
    return mode !== 'off' && selectedByLegacyConfig && autoSnapshotMatches(s, context);
  });
  const only = selected.filter((s) => snapshotActivationMode(s) === 'only');
  return only.length ? only : selected;
}

/** 计算上下文切换时应写入的手动开关；不匹配时 matched=false，调用方不得改动。 */
export function snapshotActivationPlan(snapshots, config = {}, context = {}, currentManual = {}) {
  const matched = selectAutoSnapshots(snapshots, config, context);
  if (matched.length === 0) return { matched: false, key: '', snapshots: [], manualState: { ...currentManual }, mode: 'none' };
  const key = `${String(context.chatId ?? '')}::${String(context.character?.avatar ?? '')}`;
  const only = matched.some((snapshot) => snapshotActivationMode(snapshot) === 'only');
  const next = only ? Object.fromEntries(Object.keys(currentManual).map((id) => [id, false])) : { ...currentManual };
  const forced = {};
  for (const snapshot of matched) {
    for (const book of Array.isArray(snapshot.payload) ? snapshot.payload : []) {
      if (!book?.book_id) continue;
      if (book.manual === true) { next[book.book_id] = true; forced[book.book_id] = 'on'; }
      else if (only) forced[book.book_id] = 'off';
    }
  }
  return { matched: true, key, snapshots: matched, manualState: next, forced, mode: only ? 'only' : 'normal' };
}

export function listNamed(snapshots) {
  return (Array.isArray(snapshots) ? snapshots : []).filter((s) => s.kind === 'named' || Boolean(String(s.name ?? '').trim()));
}

export function listQuick(snapshots) {
  return (Array.isArray(snapshots) ? snapshots : []).filter((s) => !(s.kind === 'named' || Boolean(String(s.name ?? '').trim())));
}
