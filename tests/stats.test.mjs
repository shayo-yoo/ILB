// 触发次数统计 + 「上次修改」时间戳（v0.22.0）
// 统计只给界面排序用，不参与判定；但写坏了会让用户看不懂排序，所以单独测。

import test from 'node:test';
import assert from 'node:assert/strict';

import { createRepository } from '../adapters/repository.js';
import { normalizeBook, normalizeEntry, normalizeLogic } from '../core/model.js';

function makeRepo() {
  const bucket = { settings: {}, books: [], manualState: {}, chatStates: {}, importLog: [], ui: {}, snapshots: [] };
  const ctx = { extensionSettings: { independent_lorebook: bucket } };
  return { repo: createRepository({ getContext: () => ctx }), bucket };
}

test('触发次数：总数与分聊天各记一份，没记录时是 0', () => {
  const { repo } = makeRepo();
  const empty = repo.getTriggerStats();
  assert.deepEqual(empty, { entries: {}, logics: {} });

  repo.recordTrigger('entries', 'b1::e1', 'chatA');
  repo.recordTrigger('entries', 'b1::e1', 'chatA');
  repo.recordTrigger('entries', 'b1::e1', 'chatB');
  repo.recordTrigger('logics', 'b1::L::l1', 'chatA');

  const stats = repo.getTriggerStats();
  assert.equal(stats.entries['b1::e1'].total, 3);
  assert.equal(stats.entries['b1::e1'].chats.chatA, 2);
  assert.equal(stats.entries['b1::e1'].chats.chatB, 1);
  assert.equal(stats.logics['b1::L::l1'].total, 1);
});

test('触发次数：没给聊天 id 也能记总数（只有全局可看）', () => {
  const { repo } = makeRepo();
  repo.recordTrigger('entries', 'e1', '');
  const rec = repo.getTriggerStats().entries.e1;
  assert.equal(rec.total, 1);
  assert.deepEqual(rec.chats, {});
});

test('触发次数：分聊天最多留 40 个，先丢次数最少的', () => {
  const { repo } = makeRepo();
  // 先给 chat-0 攒 6 次，再灌 45 个只记 1 次的聊天：chat-0 不会被当成“最少”丢掉
  for (let i = 0; i < 6; i += 1) repo.recordTrigger('entries', 'e1', 'chat-0');
  for (let i = 1; i < 46; i += 1) repo.recordTrigger('entries', 'e1', `chat-${i}`);
  const chats = repo.getTriggerStats().entries.e1.chats;
  assert.equal(Object.keys(chats).length, 40);
  assert.equal(chats['chat-0'], 6);
  assert.equal(chats['chat-45'], 1);
});

test('保存一本书会刷新 updated_at（排序里的「上次修改」）', async () => {
  const { repo } = makeRepo();
  const book = normalizeBook({ book_id: 'b1', name: '书' });
  repo.saveBook(book);
  const first = repo.getBook('b1').updated_at;
  await new Promise((r) => setTimeout(r, 5));
  const again = repo.getBook('b1');
  again.name = '改过名字';
  repo.saveBook(again);
  const second = repo.getBook('b1').updated_at;
  assert.ok(second > first, `updated_at 没变：${first} → ${second}`);
});

test('条目与逻辑的界面时间戳：老数据补 0，读写保留', () => {
  const entry = normalizeEntry({ id: 'e1', title: 'x', ui: { order: 3, createdAt: 111, updatedAt: 222 } }, 'b1');
  assert.equal(entry.ui.order, 3);
  assert.equal(entry.ui.createdAt, 111);
  assert.equal(entry.ui.updatedAt, 222);

  const old = normalizeEntry({ id: 'e2', title: 'y' }, 'b1');
  assert.equal(old.ui.createdAt, 0);
  assert.equal(old.ui.updatedAt, 0);

  const logic = normalizeLogic({ id: 'l1', name: 'z', ui: { createdAt: 1, updatedAt: 2 } }, 'b1');
  assert.equal(logic.ui.createdAt, 1);
  assert.equal(logic.ui.updatedAt, 2);
});

test('导出全部数据时把统计一起带上，导入时能读回来', () => {
  const { repo } = makeRepo();
  repo.recordTrigger('entries', 'e1', 'c1');
  const blob = repo.exportAll();
  assert.equal(blob.stats.entries.e1.total, 1);

  const { repo: repo2 } = makeRepo();
  repo2.importAll(blob);
  assert.equal(repo2.getTriggerStats().entries.e1.total, 1);
});
