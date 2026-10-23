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

test('evictSnapshots：常用与临时分开算上限', () => {
  const many = [];
  for (let i = 1; i <= NAMED_SNAPSHOT_LIMIT + 2; i += 1) {
    many.push({ id: `n${i}`, kind: 'named', name: `常用${i}`, at: i });
  }
  for (let i = 1; i <= QUICK_SNAPSHOT_LIMIT + 2; i += 1) {
    many.push({ id: `q${i}`, kind: 'quick', name: '', at: 100 + i });
  }
  const kept = evictSnapshots(many);
  assert.equal(kept.filter((s) => s.kind === 'named').length, NAMED_SNAPSHOT_LIMIT);
  assert.equal(kept.filter((s) => s.kind === 'quick').length, QUICK_SNAPSHOT_LIMIT);
  // 留下的是最新的
  assert.ok(kept.some((s) => s.id === `n${NAMED_SNAPSHOT_LIMIT + 2}`));
  assert.ok(!kept.some((s) => s.id === 'n1'));
});

test('evictSnapshots：刚改名的旧快照不会被立刻顶掉', () => {
  const list = [];
  for (let i = 1; i <= NAMED_SNAPSHOT_LIMIT; i += 1) {
    list.push({ id: `n${i}`, kind: 'named', name: `名${i}`, at: i });
  }
  list.push({ id: 'old', kind: 'named', name: '刚改名', at: 0, promotedAt: 999 });
  const kept = evictSnapshots(list);
  assert.ok(kept.some((s) => s.id === 'old'));
  assert.equal(kept.length, NAMED_SNAPSHOT_LIMIT);
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
