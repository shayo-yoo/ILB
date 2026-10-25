import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeBook } from '../core/model.js';
import { evaluateFlow, normalizeFlow, describeNode } from '../core/flow.js';
import { evaluate } from '../core/evaluate.js';
import { parseCalls } from '../core/calls.js';

function flowOf(nodes) {
  return normalizeFlow({ nodes });
}

test('独立逻辑：书里的 logic 归一化出带书 id 的 id，触发词默认两边都看', () => {
  const book = normalizeBook({
    book_id: 'b1',
    name: '书',
    entries: [{ id: 'e1', title: '条目', wait: true, trigger: { source: 'ai', any: ['抽卡'] } }],
    logic: [{ id: 'l1', name: '余额检查', trigger: { any: ['余额'] } }],
  });
  assert.equal(book.logic.length, 1);
  assert.equal(book.logic[0].id, 'b1::L::l1');
  assert.equal(book.logic[0].localId, 'l1');
  assert.equal(book.logic[0].enabled, true);
  assert.equal(book.logic[0].trigger.source, 'both');
  assert.equal(book.logic[0].call.exposed, false);
  assert.equal(book.entries[0].wait, true);
  assert.equal(book.entries[0].trigger.source, 'ai');
});

test('触发来源只认 both/user/ai，写错回落到 both', () => {
  const book = normalizeBook({ book_id: 'b', entries: [{ id: 'e', trigger: { source: '系统' } }] });
  assert.equal(book.entries[0].trigger.source, 'both');
});

test('跳转：往后跳到指定节点，跳过的节点不执行', () => {
  const flow = flowOf([
    { id: 'a', kind: 'add', text: 'A' },
    { id: 'g', kind: 'goto', target: 'c', max: 5, onLimit: 'stop' },
    { id: 'b', kind: 'add', text: 'B' },
    { id: 'c', kind: 'add', text: 'C' },
  ]);
  const r = evaluateFlow(flow);
  assert.equal(r.passed, true);
  assert.deepEqual(r.extra, ['A', 'C']);
});

test('跳转：往后跳超过上限时按设置终止', () => {
  const flow = flowOf([
    { id: 'x', kind: 'add', text: 'X' },
    { id: 'g', kind: 'goto', target: 'x', max: 2, onLimit: 'stop' },
  ]);
  const r = evaluateFlow(flow);
  assert.equal(r.passed, false);
  assert.match(r.reason, /超过上限 2/);
  assert.deepEqual(r.extra, ['X', 'X', 'X']);
});

test('跳转：超过上限时按设置跳过、继续往下', () => {
  const flow = flowOf([
    { id: 'x', kind: 'add', text: 'X' },
    { id: 'g', kind: 'goto', target: 'x', max: 1, onLimit: 'continue' },
    { id: 'y', kind: 'add', text: 'Y' },
  ]);
  const r = evaluateFlow(flow);
  assert.equal(r.passed, true);
  assert.deepEqual(r.extra, ['X', 'X', 'Y']);
});

test('跳转：目标不存在时不通过，并说清楚原因', () => {
  const flow = flowOf([{ id: 'g', kind: 'goto', target: '没有这个节点' }]);
  const r = evaluateFlow(flow);
  assert.equal(r.passed, false);
  assert.match(r.reason, /目标不存在/);
});

test('调用逻辑：被调用逻辑的写入/正文/激活条目都会并进来', () => {
  const flow = flowOf([{ id: 'c1', kind: 'call', logicId: 'b1::L::l1' }]);
  const calls = [];
  const r = evaluateFlow(flow, {
    vars: { 幸运: 10 },
    callLogic(id, _ctx) {
      calls.push(id);
      return { passed: true, reason: '被调用逻辑通过', writes: { 幸运: 85 }, extra: ['来自逻辑的正文'], activations: ['b1::e9'] };
    },
  });
  assert.deepEqual(calls, ['b1::L::l1']);
  assert.equal(r.passed, true);
  assert.equal(r.vars['幸运'], 85);
  assert.deepEqual(r.writes, { 幸运: 85 });
  assert.deepEqual(r.extra, ['来自逻辑的正文']);
  assert.deepEqual(r.activations, ['b1::e9']);
});

test('调用逻辑：没选逻辑或这里不能调用时跳过而不是炸掉', () => {
  const none = evaluateFlow(flowOf([{ id: 'c1', kind: 'call', logicId: '' }]));
  assert.equal(none.passed, true);
  const noResolver = evaluateFlow(flowOf([{ id: 'c2', kind: 'call', logicId: 'x' }]));
  assert.equal(noResolver.passed, true);
  assert.match(noResolver.steps.map((s) => s.reason).join('\n'), /不能调用逻辑/);
});

test('节点说明里能看到跳转上限与到限做法', () => {
  assert.match(describeNode({ kind: 'goto', target: 'n1', max: 5, onLimit: 'continue' }), /最多 5 次，超了跳过继续/);
});

function bookWith(logic, entries = []) {
  return normalizeBook({ book_id: 'b', name: '书', entries, logic });
}

test('等候模式的条目不会自己出现，但会被独立逻辑点名带出来', () => {
  const book = bookWith(
    [{ id: 'l1', name: '探路', trigger: { any: ['探路'] }, flow: { nodes: [{ kind: 'activate', entryId: 'b::w1' }] } }],
    [{ id: 'w1', title: '等着的条目', content: '被点到才出现', wait: true, trigger: { any: ['等'] } }],
  );
  const r = evaluate(
    { messages: [{ is_user: true, content: '探路' }] },
    { pool: book.entries, logics: book.logic },
  );
  assert.deepEqual(r.activated.map((a) => a.entryId), ['b::w1']);
  const zero = evaluate(
    { messages: [{ is_user: true, content: '等等等' }] },
    { pool: book.entries, logics: book.logic },
  );
  assert.equal(zero.activated.length, 0);
});

test('触发来源 ai：用户说触发词不算，AI 说了才算', () => {
  const book = bookWith([], [{ id: 'e1', title: 'AI 触发', content: 'AI 专属', trigger: { any: ['抽卡'], source: 'ai' } }]);
  const userOnly = evaluate(
    { messages: [{ is_user: true, content: '抽卡' }] },
    { pool: book.entries, logics: [] },
  );
  assert.equal(userOnly.activated.length, 0);
  const aiSaid = evaluate(
    { messages: [{ is_user: true, content: '好' }, { is_user: false, content: '那就抽卡' }] },
    { pool: book.entries, logics: [] },
  );
  assert.deepEqual(aiSaid.activated.map((a) => a.entryId), ['b::e1']);
});

test('触发来源 user：AI 说触发词不算', () => {
  const book = bookWith([], [{ id: 'e1', title: '用户触发', content: '专属', trigger: { any: ['/roll'], source: 'user' } }]);
  const aiOnly = evaluate(
    { messages: [{ is_user: true, content: '好' }, { is_user: false, content: '/roll' }] },
    { pool: book.entries, logics: [] },
  );
  assert.equal(aiOnly.activated.length, 0);
  const userSaid = evaluate(
    { messages: [{ is_user: true, content: '/roll' }] },
    { pool: book.entries, logics: [] },
  );
  assert.deepEqual(userSaid.activated.map((a) => a.entryId), ['b::e1']);
});

test('独立逻辑能看楼层数，并把正文当成一条输出', () => {
  const book = bookWith([
    {
      id: 'l1',
      name: '第三章开头',
      trigger: { any: ['开始'] },
      when: [{ type: 'messages', count: 2 }],
      output: { text: '旁白：夜色沉下来。' },
      flow: { nodes: [] },
    },
  ]);
  const early = evaluate(
    { messages: [{ is_user: true, content: '开始' }] },
    { pool: [], logics: book.logic },
  );
  assert.equal(early.activated.length, 0);
  const ok = evaluate(
    { messages: [{ is_user: true, content: '开始' }, { is_user: false, content: '好' }] },
    { pool: [], logics: book.logic },
  );
  assert.deepEqual(ok.activated.map((a) => a.entryId), ['b::L::l1']);
  assert.match(ok.activated[0].content, /夜色沉下来/);
});

test('AI 调用：只认开放给 AI 的逻辑，参数按声明顺序绑定', () => {
  const book = bookWith([
    {
      id: 'l1',
      name: '补给',
      call: { exposed: true, params: ['数量'] },
      trigger: { any: ['不会出现'] },
      flow: { nodes: [{ kind: 'remember', name: '库存', value: { type: 'var', name: '数量' } }] },
    },
  ]);
  const r = evaluate(
    {
      messages: [
        { is_user: true, content: '开始' },
        { is_user: false, content: '拿好 [[ILB:补给(3)]]，别掉了。' },
      ],
    },
    { pool: [], logics: book.logic, settings: { aiCallsEnabled: true } },
  );
  assert.equal(r.varWrites['库存'], '3');
  assert.equal(r.aiCalls[0].ok, true);
});

test('AI 调用幂等：同一段正文重放不会再把扣款执行一遍', () => {
  const book = bookWith([
    {
      id: 'l1',
      name: '扣款',
      call: { exposed: true, params: ['数量'] },
      trigger: { any: ['不会出现'] },
      flow: {
        nodes: [
          { kind: 'calc', target: '余额', op: '-', left: { type: 'var', name: '余额' }, right: { type: 'var', name: '数量' }, persist: true },
        ],
      },
    },
  ]);
  const messages = [
    { is_user: true, content: '买咖啡' },
    { is_user: false, content: '好。[[ILB:扣款(3)]]' },
  ];
  const first = evaluate(
    { messages, vars: { 余额: 10 } },
    { pool: [], logics: book.logic, settings: { aiCallsEnabled: true } },
  );
  assert.equal(first.varWrites['余额'], 7);
  const second = evaluate(
    { messages, vars: { 余额: 7, __ilbCallsSeen: first.varWrites['__ilbCallsSeen'] } },
    { pool: [], logics: book.logic, settings: { aiCallsEnabled: true } },
  );
  assert.equal(second.varWrites['余额'], undefined, '重放时不能再写一次');
  assert.equal(second.aiCalls.length, 0, '重放时不应再执行调用');
});

test('AI 调用：没开放的名字会被说出来，不会悄悄吞掉', () => {  const book = bookWith([{ id: 'l1', name: '补给', trigger: { any: ['x'] }, flow: { nodes: [] } }]);
  const r = evaluate(
    {
      messages: [
        { is_user: true, content: '开始' },
        { is_user: false, content: '[[ILB:补给(3)]]' },
      ],
    },
    { pool: [], logics: book.logic, settings: { aiCallsEnabled: true } },
  );
  assert.equal(r.aiCalls[0].ok, false);
  assert.match(r.aiCalls[0].reason, /没有开放给 AI/);
});

test('AI 调用默认关闭：同样的正文不动任何变量', () => {
  const book = bookWith([
    {
      id: 'l1',
      name: '补给',
      call: { exposed: true },
      trigger: { any: ['y'] },
      flow: { nodes: [{ kind: 'remember', name: '库存', value: { type: 'number', value: 1 } }] },
    },
  ]);
  const r = evaluate(
    { messages: [{ is_user: false, content: '[[ILB:补给]]' }] },
    { pool: [], logics: book.logic },
  );
  assert.deepEqual(r.varWrites, {});
  assert.equal(r.aiCalls.length, 0);
});

test('parseCalls 去重，并支持中文名字与多个参数', () => {
  const calls = parseCalls('[[ILB:抽卡]] [[ILB:抽卡]] [[ILB:补给(2, 铜钥匙)]]');
  assert.deepEqual(calls.map((c) => c.name), ['抽卡', '补给']);
  assert.deepEqual(calls[1].args, ['2', '铜钥匙']);
});
