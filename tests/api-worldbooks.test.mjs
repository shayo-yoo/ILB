// tests/api-worldbooks.test.mjs —— 世界书接口（v0.27.0 P0）
//
// 这一层是给角色卡兼容扩展用的：列书、取书、单本导出/导入（冲突策略）、批量导入。
// 这里用真 repository（内存存档）测语义，避免只测到假实现。

import test from 'node:test';
import assert from 'node:assert/strict';

import { createRepository } from '../adapters/repository.js';
import { createApi, API_VERSION, API_CAPS } from '../runtime/api.js';
import { normalizeBook } from '../core/model.js';

function makeHarness() {
  const bucket = { settings: {}, books: [], manualState: {}, chatStates: {}, importLog: [], ui: {}, snapshots: [], stats: { entries: {}, logics: {} }, logicGroups: [], logics: [] };
  const ctx = { extensionSettings: { independent_lorebook: bucket } };
  const repository = createRepository({ getContext: () => ctx });
  const api = createApi({ repository, getContext: () => ctx, getChatId: () => 'chat-1' });
  return { api, repository, bucket };
}

function seed(repository, extra = {}) {
  const book = normalizeBook({
    book_id: 'book-src',
    name: '源书',
    entries: [
      { id: 'e1', title: '一', content: '甲' },
      { id: 'e2', title: '二', content: '乙' },
    ],
    logic: [{ id: 'l1', name: '逻辑一', flow: { nodes: [] } }],
    ...extra,
  });
  repository.saveBook(book);
  return book;
}

test('worldbooks.list / get / has：返回摘要，取书拿完整对象', async () => {
  const { api, repository } = makeHarness();
  seed(repository);
  const list = await api.worldbooks.list();
  assert.equal(list.ok, true);
  assert.equal(list.books.length, 1);
  assert.deepEqual(list.books[0], {
    id: 'book-src',
    name: '源书',
    enabled: true,
    entries: 2,
    logics: 1,
    updatedAt: list.books[0].updatedAt,
    schemaVersion: 2,
  });
  assert.ok(list.books[0].updatedAt > 0);

  const full = await api.worldbooks.get('book-src');
  assert.equal(full.ok, true);
  assert.equal(full.book.entries.length, 2);

  const missing = await api.worldbooks.get('nope');
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'NOT_FOUND');

  assert.equal((await api.worldbooks.has('book-src')).exists, true);
  assert.equal((await api.worldbooks.has('nope')).exists, false);
});

test('worldbooks.list({detail:true}) 带完整书，但不与存档共享引用', async () => {
  const { api, repository } = makeHarness();
  seed(repository);
  const list = await api.worldbooks.list({ detail: true });
  assert.equal(list.books[0].book.entries.length, 2);
  list.books[0].book.name = '改坏了';
  const again = await api.worldbooks.list();
  assert.equal(again.books[0].name, '源书');
});

test('worldbooks.exportBook：带 schema_version，且改导出结果不影响存档', async () => {
  const { api, repository } = makeHarness();
  seed(repository);
  const out = await api.worldbooks.exportBook('book-src');
  assert.equal(out.ok, true);
  assert.equal(out.schema_version, 2);
  assert.equal(out.book.book_id, 'book-src');
  out.book.name = '改坏了';
  out.book.entries.length = 0;
  const again = await api.worldbooks.get('book-src');
  assert.equal(again.book.name, '源书');
  assert.equal(again.book.entries.length, 2);
  assert.equal((await api.worldbooks.exportBook('nope')).error.code, 'NOT_FOUND');
});

test('worldbooks.importBook：默认新建 id，冲突时 ask 返回 CONFLICT 不落盘', async () => {
  const { api, repository } = makeHarness();
  seed(repository);
  const payload = await api.worldbooks.exportBook('book-src');
  payload.book.book_id = 'book-src'; // 模拟"从别的设备导回来"
  const conflict = await api.worldbooks.importBook(payload);
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error.code, 'CONFLICT');
  assert.equal(conflict.error.id, 'book-src');
  assert.equal((await api.worldbooks.list()).books.length, 1);

  const created = await api.worldbooks.importBook(payload, { onConflict: 'new' });
  assert.equal(created.ok, true);
  assert.equal(created.action, 'created');
  assert.notEqual(created.id, 'book-src');
  const list = await api.worldbooks.list({ detail: true });
  assert.equal(list.books.length, 2);
  const imported = list.books.find((b) => b.id === created.id);
  assert.equal(imported.name, '源书');
  assert.equal(imported.entries, 2);
  assert.equal(imported.logics, 1);
});

test('worldbooks.importBook：skip 不动原件，overwrite 换内容但保留 id 与创建时间', async () => {
  const { api, repository } = makeHarness();
  const original = seed(repository);
  const payload = await api.worldbooks.exportBook('book-src');
  payload.book.name = '覆盖后的名字';
  payload.book.entries = [{ id: 'e9', title: '新条目', content: '丙' }];

  const skipped = await api.worldbooks.importBook(payload, { onConflict: 'skip' });
  assert.deepEqual({ id: skipped.id, action: skipped.action }, { id: 'book-src', action: 'skipped' });
  const still = await api.worldbooks.get('book-src');
  assert.equal(still.book.name, '源书');
  assert.equal(still.book.entries.length, 2);

  const before = (await api.worldbooks.get('book-src')).book;
  const overwritten = await api.worldbooks.importBook(payload, { onConflict: 'overwrite' });
  assert.equal(overwritten.action, 'overwritten');
  assert.equal(overwritten.id, 'book-src');
  const after = (await api.worldbooks.get('book-src')).book;
  assert.equal(after.name, '覆盖后的名字');
  assert.equal(after.entries.length, 1);
  assert.equal(after.created_at, before.created_at);
  assert.equal(original.book_id, after.book_id);
});

test('worldbooks.importBook：坏数据返回 BAD_PAYLOAD，不抛异常', async () => {
  const { api } = makeHarness();
  for (const bad of [null, 42, 'text', [], {}]) {
    if (bad && typeof bad === 'object' && !Array.isArray(bad) && Object.keys(bad).length === 0) {
      // 空对象会被 normalizeBook 补成一本空书；这是有意容忍的，跳过
      continue;
    }
    const out = await api.worldbooks.importBook(bad);
    assert.equal(out.ok, false, `应该拒绝：${JSON.stringify(bad)}`);
    assert.equal(out.error.code, 'BAD_PAYLOAD');
  }
});

test('worldbooks.importMany：逐本返回结果，一本失败不影响其它本', async () => {
  const { api, repository } = makeHarness();
  seed(repository);
  const dup = await api.worldbooks.exportBook('book-src');
  const one = {
    book: { book_id: 'book-a', name: '甲书', entries: [{ id: 'x', title: 'x', content: 'x' }] },
  };
  const two = {
    book: { book_id: 'book-b', name: '乙书', entries: [] },
  };
  const out = await api.worldbooks.importMany([one, dup, two], { onConflict: 'skip' });
  assert.equal(out.ok, true);
  assert.deepEqual(out.imported.map((x) => x.action), ['created', 'skipped', 'created']);
  assert.equal(out.failed.length, 0);

  const out2 = await api.worldbooks.importMany({ books: [one, dup] }, { onConflict: 'ask' });
  assert.equal(out2.ok, false);
  assert.equal(out2.imported.length, 1); // 第一本是新 id，不冲突
  assert.equal(out2.failed.length, 1);
  assert.equal(out2.failed[0].error.code, 'CONFLICT');
  assert.equal(out2.failed[0].index, 1);

  const bad = await api.worldbooks.importMany(42);
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, 'BAD_PAYLOAD');
});

test('worldbooks：导出 → 删除 → 导入回来，条目与逻辑都还在', async () => {
  const { api, repository } = makeHarness();
  seed(repository);
  const payload = await api.worldbooks.exportBook('book-src');
  repository.deleteBook('book-src');
  assert.equal((await api.worldbooks.has('book-src')).exists, false);

  const back = await api.worldbooks.importBook(payload, { onConflict: 'new', targetId: 'book-back' });
  assert.equal(back.ok, true);
  assert.equal(back.id, 'book-back');
  const book = (await api.worldbooks.get('book-back')).book;
  assert.equal(book.name, '源书');
  assert.equal(book.entries.length, 2);
  assert.equal(book.logic.length, 1);
  assert.equal(book.entries[0].id, 'book-back::e1');
});

test('api.ready 能 await，caps 里声明了 worldbooks', async () => {
  const { api } = makeHarness();
  assert.equal(await api.ready, api);
  assert.ok(API_CAPS.includes('worldbooks'));
  assert.ok(API_CAPS.includes('ready'));
  assert.equal(api.version, API_VERSION);
  // 1.4 多了 deleteBook：6 → 7
  assert.equal(api.describe().worldbooks.length, 7);
  assert.ok(api.describe().worldbooks.includes('deleteBook'));
});
