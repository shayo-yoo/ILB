// tests/flow-vars.test.mjs —— 流程里的「记住」与「激活条目」两个节点（v0.8.0）。
// 这两个节点让条目逻辑能"写状态"和"拉别的条目一起出现"，但都不碰存档：
// 写入只是被收集起来，由 runtime/pipeline.js 决定落到哪张聊天。

import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateFlow, normalizeFlow, makeNode, describeNode } from '../core/flow.js';
import { evaluate } from '../core/evaluate.js';
import { normalizeBook } from '../core/model.js';

function makeBook(entries, patch = {}) {
  return normalizeBook({
    schema_version: 2,
    book_id: patch.name ?? 'T',
    name: 'T',
    activation: { mode: 'always', characters: [], manual: true },
    pool: { share: false },
    entries,
    ...patch,
  });
}

function run(book, requestPatch = {}, settingsPatch = {}) {
  return evaluate(
    { messages: [{ role: 'user', content: '' }], userInput: '', scanDepth: 3, ...requestPatch },
    { books: [book], context: {}, settings: { ...settingsPatch } },
  );
}

const ids = (result) => result.activated.map((a) => a.entryId);
const num = (value) => ({ type: 'number', value });

test('「记住」把值放进变量表，并收集成待落盘的写入', () => {
  const flow = normalizeFlow({ nodes: [{ kind: 'remember', name: '金币', value: num(20) }] });
  const r = evaluateFlow(flow, { vars: {} });
  assert.equal(r.passed, true);
  assert.equal(r.writes.金币, 20);
  assert.equal(r.vars.金币, 20);
  assert.match(r.steps[0].reason, /记住/);
});

test('「记住」没写名字时跳过，不会写一个空名字', () => {
  const flow = normalizeFlow({ nodes: [{ kind: 'remember', name: '', value: num(1) }] });
  const r = evaluateFlow(flow, { vars: {} });
  assert.deepEqual(r.writes, {});
  assert.match(r.steps[0].reason, /没有写名字/);
});

test('「激活条目」只登记 id，去重，不重复要求同一条', () => {
  const flow = normalizeFlow({
    nodes: [
      { kind: 'activate', entryId: 'T::2' },
      { kind: 'activate', entryId: 'T::2' },
      { kind: 'activate', entryId: '' },
    ],
  });
  const r = evaluateFlow(flow, {});
  assert.deepEqual(r.activations, ['T::2']);
});

test('两个节点都能被 normalizeFlow 保留，也能被人话描述', () => {
  const flow = normalizeFlow({
    nodes: [
      { kind: 'remember', name: '金币', value: { type: 'var', name: '旧金币' } },
      { kind: 'activate', entryId: '9' },
    ],
  });
  assert.equal(flow.nodes[0].kind, 'remember');
  assert.equal(flow.nodes[1].entryId, '9');
  assert.match(describeNode(flow.nodes[0]), /记住/);
  assert.match(describeNode(flow.nodes[1]), /激活条目/);
});

test('makeNode 给两个新节点准备好的默认形状', () => {
  const remember = makeNode('remember');
  assert.equal(remember.name, '');
  assert.equal(remember.value.type, 'text');
  const activate = makeNode('activate');
  assert.equal(activate.entryId, '');
});

test('嵌在检测里也能生效：成立时才记住', () => {
  const flow = normalizeFlow({
    nodes: [{
      kind: 'test',
      condition: { what: 'contains', text: '王城' },
      then: [{ kind: 'remember', name: '到过王城', value: { type: 'number', value: 1 } }],
    }],
  });
  const yes = evaluateFlow(flow, { messages: [{ content: '王城的夜' }] });
  assert.equal(yes.writes['到过王城'], 1);
  const no = evaluateFlow(flow, { messages: [{ content: '海边' }] });
  assert.equal(no.passed, false);
  assert.deepEqual(no.writes, {});
});

test('整条链路：流程激活的条目会出现在这一轮，写值会一起返回', () => {
  const book = makeBook([
    {
      id: '1',
      content: '甲',
      trigger: { any: ['王城'] },
      logic: {
        nodes: [
          { kind: 'remember', name: '金币', value: num(5) },
          { kind: 'activate', entryId: 'T::2' },
        ],
      },
    },
    {
      id: '2',
      content: '乙',
      trigger: { any: ['这个词永远不会出现'] },
    },
  ]);
  const r = run(book, { userInput: '王城' });
  assert.ok(ids(r).includes('T::1'));
  assert.ok(ids(r).includes('T::2'), '被激活的条目应当出现');
  assert.equal(r.varWrites.金币, 5);
});

test('激活一条不存在或已关闭的条目：只记一条诊断，不让这一轮崩掉', () => {
  const book = makeBook([
    {
      id: '1',
      content: '甲',
      trigger: { any: ['王城'] },
      logic: { nodes: [{ kind: 'activate', entryId: 'T::99' }] },
    },
  ]);
  const r = run(book, { userInput: '王城' });
  assert.deepEqual(ids(r), ['T::1']);
  assert.ok(r.diagnostics.some((d) => d.stage === 'activate' && d.passed === false));
});

test('激活可以有限连锁：被激活条目的「记住」与再次点名都算数', () => {
  const book = makeBook([
    {
      id: '1',
      content: '甲',
      trigger: { any: ['王城'] },
      logic: { nodes: [{ kind: 'activate', entryId: 'T::2' }] },
    },
    {
      id: '2',
      content: '乙',
      logic: {
        nodes: [
          { kind: 'remember', name: '金币', value: num(7) },
          { kind: 'activate', entryId: 'T::3' },
        ],
      },
    },
    { id: '3', content: '丙' },
  ]);
  const r = run(book, { userInput: '王城' });
  assert.deepEqual([...ids(r)].sort(), ['T::1', 'T::2', 'T::3']);
  assert.equal(r.varWrites.金币, 7);
  assert.ok(r.diagnostics.some((d) => d.stage === 'activate' && /第 1 层/.test(d.reason)));
});

test('连锁深度可关：maxActivateDepth=0 时只认直接点名', () => {
  const book = makeBook([
    { id: '1', content: '甲', trigger: { any: ['王城'] }, logic: { nodes: [{ kind: 'activate', entryId: 'T::2' }] } },
    { id: '2', content: '乙', logic: { nodes: [{ kind: 'activate', entryId: 'T::3' }] } },
    { id: '3', content: '丙' },
  ]);
  const r = run(book, { userInput: '王城' }, { maxActivateDepth: 0 });
  assert.deepEqual([...ids(r)].sort(), ['T::1', 'T::2']);
});

test('互相点名不会死循环', () => {
  const book = makeBook([
    { id: '1', content: '甲', trigger: { any: ['王城'] }, logic: { nodes: [{ kind: 'activate', entryId: 'T::2' }] } },
    { id: '2', content: '乙', logic: { nodes: [{ kind: 'activate', entryId: 'T::1' }] } },
  ]);
  const r = run(book, { userInput: '王城' });
  assert.deepEqual([...ids(r)].sort(), ['T::1', 'T::2']);
});
