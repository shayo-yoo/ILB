import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createSnapshot, applySnapshot, summarizePayload, describeSnapshot,
  evictSnapshots, listNamed, listQuick,
  NAMED_SNAPSHOT_LIMIT, QUICK_SNAPSHOT_LIMIT,
} from '../core/snapshot.js';

function books() {
  return [{
    book_id: 'b1',
    name: '王城设定',
    activation: { mode: 'manual', characters: [], manual: true },
    pool: { share: false },
    entries: [
      { id: 'b1::1', title: '夜巡', enabled: true, always: false, content: '夜巡队每夜绕城一圈。' },
      { id: 'b1::2', title: '城墙', enabled: false, always: false, content: '城墙高十丈。' },
    ],
  }];
}

test('createSnapshot：有名字是常用，没名字是临时', () => {
  const named = createSnapshot(books(), {}, { name: '战斗风格', now: 1000 });
  const quick = createSnapshot(books(), {}, { name: '   ', now: 1000 });
  assert.equal(named.kind, 'named');
  assert.equal(quick.kind, 'quick');
  assert.equal(named.at, 1000);
  assert.ok(named.id.startsWith('snap'));
});

test('createSnapshot：只记开关，不记正文与触发词', () => {
  const snap = createSnapshot(books(), {}, { name: 'x', now: 1 });
  const saved = snap.payload[0].entries[0];
  assert.deepEqual(Object.keys(saved).sort(), ['always', 'enabled', 'id', 'title']);
  assert.equal('content' in saved, false);
});

test('createSnapshot：汇总数字说得清（启用几条、常驻几条）', () => {
  const snap = createSnapshot(books(), {}, { name: 'x', now: 1 });
  assert.deepEqual(snap.summary, { books: 1, entries: 2, enabled: 1, always: 0 });
  assert.ok(describeSnapshot(snap).includes('启用 1/2'));
});

test('summarizePayload：空输入不炸', () => {
  assert.deepEqual(summarizePayload(undefined), { books: 0, entries: 0, enabled: 0, always: 0 });
});

test('applySnapshot：把开关改回去，并数清楚动了几条', () => {
  const before = books();
  const snap = createSnapshot(before, {}, { name: 'x', now: 1 });

  const after = books();
  after[0].entries[0].enabled = false;
  after[0].entries[1].enabled = true;

  const result = applySnapshot(snap, after, {});
  assert.equal(result.books[0].entries[0].enabled, true);
  assert.equal(result.books[0].entries[1].enabled, false);
  assert.equal(result.report.booksTouched, 1);
  assert.equal(result.report.entriesTouched, 2);
});

test('applySnapshot：后来新加的条目保持原样，不算丢失', () => {
  const snap = createSnapshot(books(), {}, { name: 'x', now: 1 });
  const later = books();
  later[0].entries.push({ id: 'b1::99', title: '后来的', enabled: false, always: false });
  const result = applySnapshot(snap, later, {});
  assert.equal(result.books[0].entries.length, 3);
  assert.equal(result.books[0].entries[2].enabled, false);
  assert.equal(result.report.missingEntries, 0);
});

test('applySnapshot：书没了就报告，不硬造一本回来', () => {
  const snap = createSnapshot(books(), {}, { name: 'x', now: 1 });
  const result = applySnapshot(snap, [], {});
  assert.equal(result.books.length, 0);
  assert.deepEqual(result.report.missingBooks, ['王城设定']);
});

test('applySnapshot：改的是副本，不动传进来的数组', () => {
  const original = books();
  const snap = createSnapshot(original, {}, { name: 'x', now: 1 });
  original[0].entries[0].enabled = false;
  const result = applySnapshot(snap, original, {});
  assert.equal(result.books[0].entries[0].enabled, true);
  assert.equal(original[0].entries[0].enabled, false);
});

test('evictSnapshots：现在不设数量上限，只过滤无效记录并保留顺序', () => {
  const many = Array.from({ length: 100 }, (_, i) => ({ id: `s${i}`, kind: i % 2 ? 'quick' : 'named', at: i }));
  const kept = evictSnapshots([...many, null, { id: '' }]);
  assert.equal(kept.length, 100);
  assert.deepEqual(kept.map((s) => s.id), many.map((s) => s.id));
});

test('快照可绑定聊天与角色卡，并支持自动匹配模式', async () => {
  const { autoSnapshotMatches, selectAutoSnapshots } = await import('../core/snapshot.js');
  const snapshot = createSnapshot(books(), {}, {
    name: '战斗', chatId: 'chat-1', character: { avatar: 'hero.png', name: 'Hero' },
  });
  snapshot.activationMode = 'normal';
  assert.equal(autoSnapshotMatches(snapshot, { chatId: 'chat-1', character: { avatar: 'hero.png', name: 'Hero' } }), true);
  assert.equal(autoSnapshotMatches(snapshot, { chatId: 'chat-2', character: { avatar: 'hero.png' } }), false);
  assert.equal(selectAutoSnapshots([snapshot], { enabled: true, mode: 'normal', snapshotIds: [snapshot.id] }, { chatId: 'chat-1', character: { avatar: 'hero.png', name: 'Hero' } }).length, 1);
});

test('什么都没开时不会凭空激活：老快照与自动备份都不参与', async () => {
  const { selectAutoSnapshots, snapshotActivationPlan, snapshotActivationMode } = await import('../core/snapshot.js');
  const legacy = createSnapshot(books(), {}, { name: '老快照', chatId: 'c1' });
  const backup = createSnapshot(books(), {}, { name: '', auto: true, chatId: 'c1' });
  assert.equal(snapshotActivationMode(legacy), 'off');
  assert.equal(snapshotActivationMode(backup), 'off');
  assert.deepEqual(selectAutoSnapshots([legacy, backup], {}, { chatId: 'c1' }), []);
  const plan = snapshotActivationPlan([legacy, backup], {}, { chatId: 'c1' }, { b1: true });
  assert.equal(plan.matched, false);
  assert.deepEqual(plan.forced, {});
  assert.deepEqual(plan.manualState, { b1: true });
});

test('命中快照只算临时强制开关，不把手动状态改成"已激活"', async () => {
  const { snapshotActivationPlan } = await import('../core/snapshot.js');
  const snap = createSnapshot(books(), {}, { name: '战斗', chatId: 'c1' });
  snap.activationMode = 'normal';
  const plan = snapshotActivationPlan([snap], {}, { chatId: 'c1' }, { b1: false });
  assert.equal(plan.matched, true);
  assert.deepEqual(plan.manualState, { b1: false }, '手动状态必须原样返回，不能落盘成激活');
  assert.deepEqual(plan.forced, { b1: 'on' });
});

test('多个仅激活快照同时命中：合并成一次临时允许集合', async () => {
  const { snapshotActivationPlan } = await import('../core/snapshot.js');
  const first = createSnapshot(books(), {}, { name: 'A', chatId: 'c1' });
  first.activationMode = 'only';
  const second = createSnapshot([{ ...books()[0], book_id: 'b2', name: '另一本' }], {}, { name: 'B', chatId: 'c1' });
  second.activationMode = 'only';
  const plan = snapshotActivationPlan([first, second], {}, { chatId: 'c1' }, { b1: true, b2: true });
  assert.equal(plan.mode, 'only');
  assert.deepEqual(plan.forced, { b1: 'on', b2: 'on' });
});

test('listNamed / listQuick：按名字认定，不只看 kind', () => {
  const list = [
    { id: 'a', kind: 'named', name: 'A' },
    { id: 'b', kind: 'quick', name: '' },
    { id: 'c', kind: 'quick', name: '有名字的' },
  ];
  assert.deepEqual(listNamed(list).map((s) => s.id), ['a', 'c']);
  assert.deepEqual(listQuick(list).map((s) => s.id), ['b']);
});
