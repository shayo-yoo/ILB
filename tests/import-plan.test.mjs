import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  IMPORT_POLICIES, IMPORT_POLICY_LABEL, normalizeImportPolicy,
  applyImportPolicy, policyChoices, planBatchImport, describePlan,
} from '../core/import-plan.js';

function book(patch = {}) {
  return {
    book_id: patch.book_id ?? 'b1',
    name: patch.name ?? '王城设定',
    _source: patch._source ?? { book_file: 'wong.json' },
    entries: patch.entries ?? [
      { id: 'b1::1', enabled: true },
      { id: 'b1::2', enabled: false },
    ],
  };
}

test('normalizeImportPolicy：不认识的值退回 ask', () => {
  assert.equal(normalizeImportPolicy('on'), 'on');
  assert.equal(normalizeImportPolicy('乱写'), 'ask');
  assert.equal(normalizeImportPolicy(undefined), 'ask');
});

test('IMPORT_POLICY_LABEL：四档都有中文说明', () => {
  for (const p of IMPORT_POLICIES) assert.ok(IMPORT_POLICY_LABEL[p], p);
});

test('applyImportPolicy：on 全开，off 全关', () => {
  const on = applyImportPolicy(book(), 'on');
  assert.deepEqual(on.entries.map((e) => e.enabled), [true, true]);
  const off = applyImportPolicy(book(), 'off');
  assert.deepEqual(off.entries.map((e) => e.enabled), [false, false]);
});

test('applyImportPolicy：keep 与 ask 都不改原件的开关', () => {
  assert.deepEqual(applyImportPolicy(book(), 'keep').entries.map((e) => e.enabled), [true, false]);
  assert.deepEqual(applyImportPolicy(book(), 'ask').entries.map((e) => e.enabled), [true, false]);
});

test('applyImportPolicy：不改原件对象（纯函数）', () => {
  const source = book();
  const applied = applyImportPolicy(source, 'on');
  assert.notEqual(applied, source);
  assert.equal(source.entries[0].enabled, true);
  assert.equal(source.entries[1].enabled, false);
});

test('policyChoices：不给 ask（ask 是"先问"，不是一个选项）', () => {
  const values = policyChoices().map((c) => c.value);
  assert.deepEqual(values, ['keep', 'on', 'off']);
});

test('planBatchImport：已经导入过的按来源文件跳过，不是按书名', () => {
  const files = [{ name: 'wong.json' }, { name: 'wild.json' }];
  const plan = planBatchImport(files, [book({ book_id: 'b1', name: '完全不同的书名', _source: { book_file: 'wong.json' } })]);
  assert.deepEqual(plan.queue.map((q) => q.file), ['wild.json']);
  assert.deepEqual(plan.skipped.map((s) => s.file), ['wong.json']);
  assert.equal(plan.skipped[0].book, '完全不同的书名');
  assert.equal(plan.total, 2);
});

test('planBatchImport：重新导入时会把已有书的 id 带上，好做合并', () => {
  const plan = planBatchImport([{ name: 'wong.json' }], [book({ book_id: 'b1', _source: { book_file: 'wong.json' } })], { includeExisting: true });
  assert.equal(plan.queue.length, 1);
  assert.equal(plan.queue[0].bookId, 'b1');
  assert.equal(plan.skipped.length, 0);
});

test('planBatchImport：宿主列表里重复的文件只导一次', () => {
  const plan = planBatchImport([{ name: 'a.json' }, { name: 'a.json' }, { name: '  ' }], []);
  assert.deepEqual(plan.queue.map((q) => q.file), ['a.json']);
  assert.equal(plan.total, 1);
});

test('planBatchImport：空列表不炸', () => {
  const plan = planBatchImport(undefined, undefined);
  assert.deepEqual(plan.queue, []);
  assert.equal(plan.total, 0);
});

test('describePlan：三种情况都说人话', () => {
  assert.equal(describePlan({ queue: [], skipped: [] }), '没有可导入的文件');
  assert.equal(describePlan({ queue: [{ file: 'a' }], skipped: [] }), '将导入 1 本');
  assert.equal(describePlan({ queue: [], skipped: [{ file: 'a' }] }), '1 本都已经导入过了，没有新的');
  assert.ok(describePlan({ queue: [{ file: 'a' }], skipped: [{ file: 'b' }] }).includes('跳过 1 本'));
});
