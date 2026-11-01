// tests/double-inject.test.mjs —— 同源双重注入策略（ILB-4.10 / ILB-4.23.11）
// 规格：warn/allow 原样注入；skip 只摘掉"跟着原生书启用的 ILB 副本"，
// 被摘掉的书不再贡献内容，但原生书仍由酒馆注入（这部分 ILB 不碰）。

import test from 'node:test';
import assert from 'node:assert/strict';

import { applyDoubleInjectPolicy, findDoubleInjects } from '../core/double-inject.js';
import { evaluate } from '../core/evaluate.js';
import { normalizeBook } from '../core/model.js';

function makeBook(entries, patch = {}) {
  return normalizeBook({
    schema_version: 2,
    book_id: patch.name ?? 'T',
    name: patch.name ?? 'T',
    activation: { mode: 'always', strategy: 'auto', characters: [], manual: true },
    pool: { share: false },
    entries,
    ...patch,
  });
}

function detail(patch = {}) {
  return {
    enabled: true,
    rule: 'auto',
    strategy: 'auto',
    override: 'auto',
    reason: '当前角色关联了这本书',
    sources: [],
    matched: ['原生书'],
    candidate: [],
    ...patch,
  };
}

function resolvedFor(book, det = detail()) {
  return {
    activeBooks: [book.book_id],
    inactiveBooks: [],
    reasons: { [book.book_id]: det.reason },
    details: { [book.book_id]: det },
    warnings: [],
    entriesByBook: { [book.book_id]: book.entries },
    pool: [...book.entries],
    isPooled: (id) => book.entries.some((e) => e.id === id),
  };
}

test('只把"启用且命中原生书"的书算作同源副本', () => {
  const resolved = {
    details: {
      a: detail(),
      b: detail({ enabled: false }),
      c: detail({ matched: [] }),
      d: detail({ enabled: false, matched: ['x'] }),
    },
  };
  assert.deepEqual(findDoubleInjects(resolved), ['a']);
  assert.deepEqual(findDoubleInjects({}), []);
  assert.deepEqual(findDoubleInjects(null), []);
});

test('warn 与 allow 不改动这一轮：引用原样返回', () => {
  const book = makeBook([{ id: '1', content: '王城', trigger: { any: ['王城'] } }]);
  const resolved = resolvedFor(book);
  for (const policy of ['warn', 'allow']) {
    const out = applyDoubleInjectPolicy(resolved, [book], policy);
    assert.equal(out.resolved, resolved);
    assert.deepEqual(out.skipped, []);
    assert.deepEqual(out.duplicates, [book.book_id]);
  }
});

test('不认识的策略按默认 warn 处理，不静默跳过', () => {
  const book = makeBook([{ id: '1', content: '王城' }]);
  const resolved = resolvedFor(book);
  const out = applyDoubleInjectPolicy(resolved, [book], 'whatever');
  assert.equal(out.policy, 'warn');
  assert.equal(out.resolved, resolved);
});

test('skip：摘掉副本、写清原因、加进停用列表', () => {
  const book = makeBook([{ id: '1', content: '王城', trigger: { any: ['王城'] } }]);
  const out = applyDoubleInjectPolicy(resolvedFor(book), [book], 'skip');
  const id = book.book_id;
  assert.deepEqual(out.skipped, [id]);
  assert.deepEqual(out.resolved.activeBooks, []);
  assert.deepEqual(out.resolved.inactiveBooks, [id]);
  assert.equal(out.resolved.details[id].enabled, false);
  assert.equal(out.resolved.details[id].rule, 'double-inject-skip');
  assert.match(out.resolved.details[id].reason, /同源双重注入/);
  assert.match(out.resolved.reasons[id], /同源双重注入/);
  assert.equal(out.resolved.pool.length, 0);
});

test('skip 不动没有同源副本的书', () => {
  const a = makeBook([{ id: '1', content: 'A' }], { name: 'A' });
  const b = makeBook([{ id: '1', content: 'B' }], { name: 'B' });
  const resolved = resolvedFor(a);
  resolved.details[b.book_id] = detail({ matched: [] });
  resolved.activeBooks.push(b.book_id);
  resolved.inactiveBooks = [];
  const out = applyDoubleInjectPolicy(resolved, [a, b], 'skip');
  assert.deepEqual(out.skipped, [a.book_id]);
  assert.deepEqual(out.resolved.activeBooks, [b.book_id]);
  assert.equal(out.resolved.details[b.book_id].enabled, true);
  assert.equal(out.resolved.pool.length, 1);
});

test('skip 之后 evaluate 真的不再激活那本书的条目', () => {
  const book = makeBook([{ id: '1', content: '王城', trigger: { any: ['王城'] } }]);
  const skipped = applyDoubleInjectPolicy(resolvedFor(book), [book], 'skip').resolved;
  const result = evaluate(
    { messages: [{ role: 'user', content: '' }], userInput: '我走进王城', scanDepth: 3 },
    { resolved: skipped, settings: {} },
  );
  assert.deepEqual(result.books.active, []);
  assert.equal(result.activated.length, 0);
  assert.equal(result.poolSize, 0);
});

test('skip 不误伤显式共享进候选池的条目？—— 共享也只在不被跳过时生效', () => {
  // pool.share 是"给别的书用"，不是"注入这本书"；被跳过时一并收起，避免"以为跳过了其实还在"。
  const book = makeBook([{ id: '1', content: '王城' }], { pool: { share: true } });
  const out = applyDoubleInjectPolicy(resolvedFor(book), [book], 'skip');
  assert.equal(out.resolved.pool.length, 0);
  assert.equal(out.resolved.isPooled(book.entries[0].id), false);
});
