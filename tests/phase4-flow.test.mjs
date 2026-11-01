// tests/phase4-flow.test.mjs —— Phase 4 的第一批：加权随机、调用的参数与返回值（v0.18.0）
//
// 这两件事的共同点是"看起来能跑，其实把数据悄悄吞掉"：
// - 权重写成 0 的候选仍然被抽中；
// - 参数算不出来却传了个空字符串进去；
// - 要了返回值，被调用的逻辑里没有那个变量，结果悄悄变成空。
// 所以这里的断言重点不是"能跑通"，而是"出问题时看得见"。

import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateFlow, normalizeFlow, makeNode } from '../core/flow.js';
import { validateFlow, summarizeProblems } from '../core/validate.js';
import { evaluate } from '../core/evaluate.js';
import { normalizeBook } from '../core/model.js';

const flowOf = (nodes) => normalizeFlow({ mode: 'flow', nodes });

function pickOnce(weights, seed = 's1', extra = {}) {
  const flow = flowOf([
    { kind: 'choose', id: 'c1', candidates: ['甲', '乙'], weights, target: '签', persist: true },
  ]);
  return evaluateFlow(flow, { seed, ...extra });
}

test('加权随机：同一楼层同一个种子，抽到的永远是同一条', () => {
  const a = pickOnce([3, 1], 'floor-42');
  const b = pickOnce([3, 1], 'floor-42');
  assert.equal(a.vars.签, b.vars.签);
  assert.deepEqual(a.writes, b.writes);
});

test('加权随机：权重 0 的候选永远不会被抽中', () => {
  for (let i = 0; i < 60; i += 1) {
    assert.equal(pickOnce([1, 0], `seed-${i}`).vars.签, '甲');
    assert.equal(pickOnce([0, 1], `seed-${i}`).vars.签, '乙');
  }
});

test('加权随机：权重全是 0 时退回等概率，而不是一律取第一条', () => {
  const seen = new Set();
  for (let i = 0; i < 80; i += 1) seen.add(pickOnce([0, 0], `seed-${i}`).vars.签);
  assert.deepEqual([...seen].sort(), ['乙', '甲']);
});

test('加权随机：步骤里写清楚用的是哪条权重', () => {
  const r = pickOnce([2, 2], 'seed-x');
  const step = r.steps.find((s) => s.reason.includes('随机选择'));
  assert.ok(step, '应该有一步说明随机选择的结果');
  assert.match(step.reason, /权重 \d+\/4/);
});

test('调用：参数在本层求好再传进去', () => {
  const seen = [];
  const flow = flowOf([
    {
      kind: 'call',
      id: 'call1',
      logicId: 'L',
      args: [
        { name: 'hp', value: { type: 'number', value: 5 } },
        { name: '谁', value: { type: 'var', name: 'name' } },
      ],
    },
  ]);
  const r = evaluateFlow(flow, {
    vars: { name: '甲' },
    callLogic(id, args) {
      seen.push([id, args]);
      return { passed: true };
    },
  });
  assert.deepEqual(seen, [['L', { hp: 5, 谁: '甲' }]]);
  assert.equal(r.passed, true);
});

test('调用：参数算不出来就不调用，并把原因写进步骤', () => {
  const seen = [];
  const flow = flowOf([
    {
      kind: 'call',
      id: 'call1',
      logicId: 'L',
      args: [{ name: 'hp', value: { type: 'expr', value: '不存在的函数(1)' } }],
    },
  ]);
  const r = evaluateFlow(flow, {
    callLogic(id, args) {
      seen.push([id, args]);
      return { passed: true };
    },
  });
  assert.deepEqual(seen, [], '参数算不出来时不能把空值传进去');
  const bad = r.steps.find((s) => s.passed === false);
  assert.ok(bad, '要有一步说明参数失败');
  assert.match(bad.reason, /没有执行/);
});

test('调用：返回值按名字取回来，可选写进聊天', () => {
  const flow = flowOf([
    {
      kind: 'call',
      id: 'call1',
      logicId: 'L',
      returns: [{ name: 'gold', target: '钱' }],
      persist: true,
    },
  ]);
  const r = evaluateFlow(flow, {
    callLogic() {
      return { passed: true, locals: { gold: 7 } };
    },
  });
  assert.equal(r.vars.钱, 7);
  assert.equal(r.writes.钱, 7);
  assert.ok(r.steps.some((s) => s.reason.includes('取回返回值')));
});

test('调用：要了返回值但对方没有这个变量时，要报出来而不是给空', () => {
  const flow = flowOf([
    {
      kind: 'call',
      id: 'call1',
      logicId: 'L',
      returns: [{ name: 'gold', target: '钱' }],
    },
  ]);
  const r = evaluateFlow(flow, {
    callLogic() {
      return { passed: true, locals: {} };
    },
  });
  assert.equal('钱' in r.vars, false);
  const miss = r.steps.find((s) => s.passed === false);
  assert.ok(miss);
  assert.match(miss.reason, /没有给出返回值/);
});

test('调用的参数不会留在外层变量里', () => {
  const book = normalizeBook({
    schema_version: 2,
    book_id: 'b1',
    name: 'B',
    activation: { mode: 'always', characters: [], manual: true },
    pool: { share: false },
    entries: [
      {
        id: 'e1',
        title: '调用方',
        trigger: { any: ['开始'] },
        logic: {
          mode: 'flow',
          nodes: [
            {
              kind: 'call',
              id: 'call1',
              logicId: 'b1::L::l1',
              args: [{ name: 'hp', value: { type: 'number', value: 5 } }],
              returns: [{ name: '看到', target: '结果' }],
              persist: true,
            },
          ],
        },
      },
    ],
    logic: [
      {
        id: 'l1',
        name: '看参数',
        trigger: { any: [] },
        flow: {
          mode: 'flow',
          nodes: [{ kind: 'remember', name: '看到', value: { type: 'var', name: 'hp' }, persist: true }],
        },
      },
    ],
  });
  const r = evaluate(
    { messages: [{ role: 'user', content: '开始' }], userInput: '', scanDepth: 3 },
    { books: [book], logics: book.logic, context: {}, settings: {} },
  );
  assert.equal(r.varWrites.结果, 5, '内层读到了传进去的 hp');
  assert.equal('hp' in r.varWrites, false, '参数不能漏进外层变量');
});

test('验证器：调用参数的写错与权重写错都要报', () => {
  const flow = flowOf([
    { kind: 'choose', id: 'c1', candidates: ['甲', '乙'], weights: [0, 0] },
    {
      kind: 'call',
      id: 'call1',
      logicId: 'L',
      args: [{ name: '', value: { type: 'text', value: 'x' } }],
      returns: [{ name: 'a', target: '' }],
    },
  ]);
  const result = validateFlow(flow);
  const codes = result.problems.map((p) => p.code);
  assert.ok(codes.includes('zero-weights'));
  assert.ok(codes.includes('bad-call-arg'));
  assert.ok(codes.includes('bad-call-return'));
  assert.match(summarizeProblems(result), /会挡住运行的问题/);
});

test('老数据没有权重/参数时按默认值补齐，不当作坏数据', () => {
  assert.deepEqual(makeNode('choose', { candidates: ['甲', '乙'] }).weights, [1, 1]);
  const call = makeNode('call', { logicId: 'L' });
  assert.deepEqual(call.args, []);
  assert.deepEqual(call.returns, []);
  assert.equal(call.persist, false);
});

test('局部变量：被调用逻辑里普通修改变量不会漏到调用方，只是当轮局部值', () => {
  const book = normalizeBook({
    schema_version: 2,
    book_id: 'b2',
    name: 'B2',
    activation: { mode: 'always', characters: [], manual: true },
    pool: { share: false },
    entries: [
      {
        id: 'e1',
        title: '调用方',
        trigger: { any: ['开始'] },
        logic: {
          mode: 'flow',
          nodes: [
            {
              kind: 'call',
              id: 'call1',
              logicId: 'b2::L::l1',
              returns: [{ name: '局部', target: '结果' }],
              persist: true,
            },
          ],
        },
      },
    ],
    logic: [
      {
        id: 'l1',
        name: '算一个局部值',
        trigger: { any: [] },
        flow: {
          mode: 'flow',
          nodes: [
            { kind: 'set', id: 's1', name: '局部', op: 'set', value: { type: 'number', value: 9 }, persist: false },
          ],
        },
      },
    ],
  });
  const r = evaluate(
    { messages: [{ role: 'user', content: '开始' }], userInput: '', scanDepth: 3 },
    { books: [book], logics: book.logic, context: {}, settings: {} },
  );
  assert.equal(r.varWrites.结果, 9, '调用方按名字取到了内层的局部值');
  assert.equal('局部' in r.varWrites, false, '内层的局部变量不能漏进聊天变量');
});
