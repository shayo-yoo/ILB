// tests/flow.test.mjs —— 判定流程（ILB-4.11）的规格测试
// 运行方式：在 extension 目录下执行 `node --test tests/`
// 注意：这些测试在本机尚未运行过（开发环境无法执行 node），属于"写好了但没验证"。

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeFlow,
  hasFlow,
  countFlowNodes,
  evaluateFlow,
  compareValues,
  makeNode,
  describeFlow,
  MAX_NODES,
} from '../core/flow.js';
import { evaluate, previewEntry } from '../core/evaluate.js';
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

test('空流程：等于没有流程，规则仍按关键词工作', () => {
  const flow = normalizeFlow(undefined);
  assert.deepEqual(flow.nodes, []);
  assert.equal(hasFlow({ logic: flow }), false);
  assert.equal(describeFlow(flow), '没有流程（按关键词判定）');
  const r = evaluateFlow(flow, {});
  assert.equal(r.active, false);
  assert.equal(r.passed, true);
});

test('检测成立 + 后续没有节点 → 通过', () => {
  const flow = normalizeFlow({ nodes: [{ kind: 'test', condition: { what: 'contains', text: '王城', within: 3 } }] });
  const r = evaluateFlow(flow, { messages: [{ role: 'user', content: '我走进王城' }] });
  assert.equal(r.passed, true);
  assert.equal(r.steps.length, 1);
  assert.equal(r.steps[0].stage, 'logic');
});

test('检测不成立且没写"不成立时" → 这条规则不出现', () => {
  const flow = normalizeFlow({ nodes: [{ kind: 'test', condition: { what: 'contains', text: '王城', within: 3 } }] });
  const r = evaluateFlow(flow, { messages: [{ role: 'user', content: '海边' }] });
  assert.equal(r.passed, false);
  assert.match(r.reason, /不成立/);
});

test('判定：全部满足 / 满足任意一条', () => {
  const all = normalizeFlow({
    nodes: [{
      kind: 'judge',
      mode: 'all',
      conditions: [
        { what: 'contains', text: '王城' },
        { what: 'contains', text: '夜' },
      ],
    }],
  });
  assert.equal(evaluateFlow(all, { messages: [{ content: '王城的夜' }] }).passed, true);
  assert.equal(evaluateFlow(all, { messages: [{ content: '王城的白天' }] }).passed, false);

  const any = normalizeFlow({
    nodes: [{
      kind: 'judge',
      mode: 'any',
      conditions: [
        { what: 'contains', text: '王城' },
        { what: 'contains', text: '海边' },
      ],
    }],
  });
  assert.equal(evaluateFlow(any, { messages: [{ content: '海边' }] }).passed, true);
});

test('比较：数字按大小，文本按字典序', () => {
  assert.equal(compareValues(5, 3, '>'), true);
  assert.equal(compareValues('5', '3', '<'), false);
  assert.equal(compareValues('abc', 'abd', '<'), true);
  assert.equal(compareValues(2, 2, '=='), true);

  const flow = normalizeFlow({
    nodes: [{
      kind: 'compare',
      left: { type: 'number', value: 5 },
      op: '>',
      right: { type: 'number', value: 3 },
    }],
  });
  assert.equal(evaluateFlow(flow, {}).passed, true);
});

test('定义 + 计算 之后可以拿结果比较', () => {
  const flow = normalizeFlow({
    nodes: [
      { kind: 'define', name: 'a', value: { type: 'number', value: 2 } },
      { kind: 'calc', target: 'b', op: '+', left: { type: 'var', name: 'a' }, right: { type: 'number', value: 3 } },
      { kind: 'compare', left: { type: 'var', name: 'b' }, op: '==', right: { type: 'number', value: 5 } },
    ],
  });
  const r = evaluateFlow(flow, {});
  assert.equal(r.passed, true);
  assert.equal(r.vars.b, 5);
});

test('添加节点会拼进这条规则的正文，并计入预算', () => {
  const book = makeBook([{
    id: '1',
    content: '正文',
    trigger: { any: ['王城'] },
    logic: { nodes: [{ kind: 'add', text: '（追加）' }] },
  }]);
  const r = run(book, { userInput: '王城' });
  assert.equal(ids(r).length, 1);
  assert.equal(r.activated[0].content, '正文\n（追加）');
});

test('通过 / 不通过 节点会立刻结束整条流程', () => {
  const passed = normalizeFlow({
    nodes: [
      { kind: 'pass' },
      { kind: 'test', condition: { what: 'contains', text: '不可能出现的词' } },
    ],
  });
  assert.equal(evaluateFlow(passed, { messages: [{ content: '随便' }] }).passed, true);

  const failed = normalizeFlow({ nodes: [{ kind: 'fail' }] });
  assert.equal(evaluateFlow(failed, {}).passed, false);
});

test('分支可以嵌套：成立时再判断一层', () => {
  const flow = normalizeFlow({
    nodes: [{
      kind: 'test',
      condition: { what: 'contains', text: '王城' },
      then: [{
        kind: 'test',
        condition: { what: 'contains', text: '夜' },
        then: [{ kind: 'add', text: '夜巡开始' }],
      }],
    }],
  });
  const yes = evaluateFlow(flow, { messages: [{ content: '王城的夜' }] });
  assert.equal(yes.passed, true);
  assert.deepEqual(yes.extra, ['夜巡开始']);

  const noDeep = evaluateFlow(flow, { messages: [{ content: '王城的白天' }] });
  assert.equal(noDeep.passed, false);
});

test('节点数量上限：超出部分被丢掉，不会无限膨胀', () => {
  const nodes = [];
  for (let i = 0; i < MAX_NODES + 20; i += 1) nodes.push({ kind: 'add', text: `第 ${i} 段` });
  const flow = normalizeFlow({ nodes });
  assert.equal(countFlowNodes(flow.nodes), MAX_NODES);
});

test('模式 only：关键词不参与判定，只看流程', () => {
  const book = makeBook([{
    id: '1',
    content: '只靠流程出现',
    trigger: { any: ['这个词永远不会出现'] },
    logic: { mode: 'only', nodes: [{ kind: 'pass' }] },
  }]);
  const r = run(book, { userInput: '随便一句话' });
  assert.equal(ids(r).length, 1);

  const book2 = makeBook([{
    id: '1',
    content: '流程说不通过',
    trigger: { any: ['王城'] },
    logic: { mode: 'only', nodes: [{ kind: 'fail' }] },
  }]);
  assert.equal(run(book2, { userInput: '王城' }).activated.length, 0);
});

test('流程不通过时，诊断里说的是「判定流程」', () => {
  const book = makeBook([{
    id: '1',
    content: 'x',
    trigger: { any: ['王城'] },
    logic: { nodes: [{ kind: 'test', condition: { what: 'contains', text: '夜' } }] },
  }]);
  const r = run(book, { userInput: '王城' });
  assert.equal(r.activated.length, 0);
  const diag = r.diagnostics.find((d) => d.entryId.endsWith('::1'));
  assert.equal(diag.stage, 'logic');
});

test('试一句会走到流程，并把每一步列出来', () => {
  const entry = {
    id: 'T::1',
    content: 'x',
    enabled: true,
    trigger: { any: ['王城'] },
    logic: { nodes: [{ kind: 'test', condition: { what: 'contains', text: '夜' } }] },
  };
  const pass = previewEntry(entry, { text: '王城的夜', messageCount: 3 });
  assert.equal(pass.passed, true);
  assert.equal(pass.steps.some((s) => s.stage === 'logic'), true);

  const fail = previewEntry(entry, { text: '王城的白天', messageCount: 3 });
  assert.equal(fail.passed, false);
  assert.equal(fail.steps.some((s) => s.stage === 'logic' && s.passed === false), true);
});

test('makeNode 造出的节点能直接被执行（字段齐全）', () => {
  for (const kind of ['test', 'judge', 'compare', 'define', 'calc', 'add', 'pass', 'fail']) {
    const node = makeNode(kind);
    assert.equal(node.kind, kind);
    assert.equal(typeof node.id, 'string');
  }
  const flow = normalizeFlow({ nodes: [makeNode('test')] });
  assert.equal(flow.nodes.length, 1);
});
