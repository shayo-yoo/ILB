// tests/phase2-flow.test.mjs —— 逻辑表达（Phase 2）的规格测试
// 覆盖：条件组（并且/或者/不是）、变量动作、随机选择、重复、提前结束、概率分支、
// 未知节点保留、以及静态验证器。

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FLOW_KINDS,
  MAX_REPEAT,
  countFlowNodes,
  describeCondition,
  describeNode,
  evaluateFlow,
  makeCondition,
  makeNode,
  normalizeFlow,
  normalizeNode,
} from '../core/flow.js';
import { summarizeProblems, validateFlow } from '../core/validate.js';

function run(nodes, ctxPatch = {}) {
  const flow = normalizeFlow({ nodes });
  const result = evaluateFlow(flow, {
    messages: [{ role: 'user', content: '我要买药水' }],
    userInput: '我要买药水',
    seed: 'chat-1:7',
    vars: {},
    ...ctxPatch,
  });
  return result;
}

// —— 条件组 ——

test('条件组：并且 / 或者 / 不是，可以任意嵌套', () => {
  const cond = {
    what: 'group',
    op: 'and',
    children: [
      { what: 'contains', text: '药水' },
      {
        what: 'group',
        op: 'or',
        children: [{ what: 'contains', text: '买' }, { what: 'contains', text: '卖' }],
      },
      { what: 'var', name: '禁止交易', negate: true },
    ],
  };
  const ok = evaluateFlow(
    normalizeFlow({ nodes: [makeNode('if', { when: cond, then: [makeNode('pass')], else: [] })] }),
    { messages: [], userInput: '我想买药水', seed: 's', vars: {} },
  );
  assert.equal(ok.passed, true);

  const blocked = evaluateFlow(
    normalizeFlow({ nodes: [makeNode('if', { when: cond, then: [makeNode('pass')], else: [] })] }),
    { messages: [], userInput: '我想买药水', seed: 's', vars: { 禁止交易: true } },
  );
  assert.equal(blocked.passed, false);
});

test('条件组的摘要读得懂', () => {
  const cond = makeCondition('group');
  cond.children = [{ what: 'contains', text: '商店' }, { what: 'contains', text: '购买' }];
  cond.op = 'or';
  const text = describeCondition(cond);
  assert.match(text, /商店/);
  assert.match(text, /购买/);
  assert.match(text, /或/);
});

test('空条件组视为通过（不因为没条件就把规则挡掉）', () => {
  const result = run([makeNode('if', { when: makeCondition('group'), then: [makeNode('pass')], else: [] })]);
  assert.equal(result.passed, true);
});

// —— 变量动作 ——

test('变量动作：增加、减少、追加、清空、删除各是一步', () => {
  const flow = normalizeFlow({
    nodes: [
      makeNode('set', { name: '金币', op: 'set', value: { type: 'number', value: 10 } }),
      makeNode('set', { name: '金币', op: 'add', value: { type: 'number', value: 5 } }),
      makeNode('set', { name: '金币', op: 'sub', value: { type: 'number', value: 3 } }),
      makeNode('set', { name: '备注', op: 'append', value: { type: 'text', value: '又买了一瓶' } }),
      makeNode('set', { name: '临时', op: 'set', value: { type: 'text', value: 'x' } }),
      makeNode('set', { name: '临时', op: 'delete' }),
    ],
  });
  const result = evaluateFlow(flow, { messages: [], userInput: '', seed: 's', vars: {} });
  assert.equal(result.passed, true);
  assert.equal(result.vars.金币, 12);
  assert.equal(result.vars.备注, '又买了一瓶');
  assert.equal('临时' in result.vars, false);
  assert.equal(result.writes.临时, null); // null = 告诉落盘层"删掉它"
});

test('变量动作：clamp 与 round', () => {
  const flow = normalizeFlow({
    nodes: [
      makeNode('set', { name: '值', op: 'set', value: { type: 'number', value: 37 } }),
      makeNode('set', { name: '值', op: 'clamp', min: 0, max: 10 }),
      makeNode('set', { name: '零钱', op: 'set', value: { type: 'number', value: 3.14159 } }),
      makeNode('set', { name: '零钱', op: 'round', digits: 2 }),
    ],
  });
  const result = evaluateFlow(flow, { messages: [], userInput: '', seed: 's', vars: {} });
  assert.equal(result.vars.值, 10);
  assert.equal(result.vars.零钱, 3.14);
});

test('变量动作：模板与表达式都能当值', () => {
  const flow = normalizeFlow({
    nodes: [
      makeNode('set', { name: '金币', op: 'set', value: { type: 'number', value: 7 } }),
      makeNode('set', { name: '提示', op: 'set', value: { type: 'template', value: '你有 {{金币 * 2}} 枚' } }),
      makeNode('set', { name: '翻倍', op: 'set', value: { type: 'expr', value: '金币 * 2' } }),
    ],
  });
  const result = evaluateFlow(flow, { messages: [], userInput: '', seed: 's', vars: {} });
  assert.equal(result.vars.提示, '你有 14 枚');
  assert.equal(result.vars.翻倍, 14);
});

test('变量动作：算不出值时只记诊断，不写脏值', () => {
  const flow = normalizeFlow({
    nodes: [makeNode('set', { name: '金币', op: 'add', value: { type: 'expr', value: '不存在的变量 + 1' } })],
  });
  const result = evaluateFlow(flow, { messages: [], userInput: '', seed: 's', vars: {} });
  assert.equal('金币' in result.vars, false);
  assert.equal(result.steps.some((s) => /没有这个变量|算不出/.test(s.reason)), true);
});

// —— 随机 ——

test('随机选择：同一楼层两次结果一样，且总在候选里', () => {
  const nodes = [makeNode('choose', { candidates: ['甲', '乙', '丙'], target: '结果' })];
  const a = run(nodes);
  const b = run(nodes);
  assert.equal(a.vars.结果, b.vars.结果);
  assert.ok(['甲', '乙', '丙'].includes(a.vars.结果));
});

test('随机选择：没写目标时直接追加到正文，候选支持模板', () => {
  const result = run(
    [makeNode('choose', { candidates: ['你有 {{金币}} 枚'], target: '' })],
    { vars: { 金币: 4 } },
  );
  assert.deepEqual(result.extra, ['你有 4 枚']);
});

test('随机选择：候选为空时这一步明说没执行', () => {
  const result = run([makeNode('choose', { candidates: ['  '], target: 'x' })]);
  assert.equal(result.steps.some((s) => /一条候选都没写/.test(s.reason)), true);
});

test('概率分支：0% 一定不中，100% 一定中', () => {
  const zero = run([makeNode('chance', { percent: 0, then: [makeNode('pass')], else: [] })]);
  assert.equal(zero.passed, false);
  const hundred = run([makeNode('chance', { percent: 100, then: [makeNode('pass')], else: [] })]);
  assert.equal(hundred.passed, true);
});

test('概率分支：同一楼层结果固定', () => {
  const nodes = [makeNode('chance', { percent: 50, then: [makeNode('add', { text: '中了' })], else: [makeNode('add', { text: '没中' })] })];
  assert.deepEqual(run(nodes).extra, run(nodes).extra);
});

// —— 流程控制 ——

test('重复：按次数跑里面的步骤', () => {
  const nodes = [
    makeNode('repeat', {
      times: 3,
      body: [makeNode('set', { name: '计数', op: 'add', value: { type: 'number', value: 1 } })],
    }),
  ];
  const result = run(nodes);
  assert.equal(result.vars.计数, 3);
});

test('重复：次数有上限，写到天上也只跑上限次', () => {
  const nodes = [
    makeNode('repeat', {
      times: 9999,
      body: [makeNode('set', { name: '计数', op: 'add', value: { type: 'number', value: 1 } })],
    }),
  ];
  const result = run(nodes);
  assert.equal(result.vars.计数, MAX_REPEAT);
});

test('提前结束：当成不通过时，整条流程立刻停', () => {
  const nodes = [
    makeNode('repeat', {
      times: 5,
      body: [
        makeNode('set', { name: '计数', op: 'add', value: { type: 'number', value: 1 } }),
        makeNode('stop', { result: 'fail', reason: '够了' }),
      ],
    }),
    makeNode('add', { text: '不该出现' }),
  ];
  const result = run(nodes);
  assert.equal(result.passed, false);
  assert.equal(result.blocked, true);
  assert.equal(result.vars.计数, 1);
  assert.deepEqual(result.extra, []);
  assert.match(result.reason, /够了/);
});

// —— 未知节点 ——

test('未知节点：数据原样保留，标成不支持编辑', () => {
  const flow = normalizeFlow({
    nodes: [{ kind: 'teleport', id: 'n-1', 我自己加的: 42, then: [{ kind: 'pass' }] }],
  });
  const node = flow.nodes[0];
  assert.equal(node.kind, 'teleport');
  assert.equal(node.unknown, true);
  assert.equal(node['我自己加的'], 42);
  assert.equal(node.then.length, 1);
  assert.match(describeNode(node), /不支持编辑/);
});

test('未知节点：运行到它时明确报错，不伪装成功', () => {
  const result = run([{ kind: 'teleport', id: 'n-1' }, makeNode('pass')]);
  assert.equal(result.passed, false);
  assert.equal(result.blocked, false);
  assert.match(result.reason, /不认识/);
});

test('老数据兼容：kind 缺失但带 condition 的，按"条件"读', () => {
  const node = normalizeNode({ id: 'n-1', condition: { what: 'contains', text: '药水' }, then: [], else: [] });
  assert.equal(node.kind, 'test');
  assert.equal(node.unknown, undefined);
});

test('节点种类型号都是已知的（防止漏加中文名）', () => {
  assert.ok(FLOW_KINDS.includes('if'));
  assert.ok(FLOW_KINDS.includes('set'));
  assert.ok(FLOW_KINDS.includes('choose'));
  assert.ok(FLOW_KINDS.includes('repeat'));
  assert.ok(FLOW_KINDS.includes('stop'));
});

test('countFlowNodes 把"重复"里面的步骤也算上', () => {
  const flow = normalizeFlow({
    nodes: [makeNode('repeat', { times: 2, body: [makeNode('pass'), makeNode('pass')] })],
  });
  assert.equal(countFlowNodes(flow.nodes), 3);
});

// —— 静态验证器 ——

test('验证器：引用没赋过值的变量是提醒，不是挡住运行', () => {
  const flow = normalizeFlow({
    nodes: [makeNode('set', { name: '金币', op: 'add', value: { type: 'var', name: '银币' } })],
  });
  const result = validateFlow(flow, { vars: [] });
  assert.equal(result.problems.some((p) => p.code === 'undefined-var' && p.level === 'warn'), true);
  assert.match(summarizeProblems(result), /提醒/);
});

test('验证器：变量在流程里赋过值就不算未定义', () => {
  const flow = normalizeFlow({
    nodes: [
      makeNode('set', { name: '金币', op: 'set', value: { type: 'number', value: 1 } }),
      makeNode('set', { name: '提示', op: 'set', value: { type: 'template', value: '{{金币}}' } }),
    ],
  });
  const result = validateFlow(flow, { vars: [] });
  assert.equal(result.problems.some((p) => p.code === 'undefined-var'), false);
});

test('验证器：调用不存在的逻辑是错误', () => {
  const flow = normalizeFlow({ nodes: [makeNode('call', { logicId: 'gone' })] });
  const result = validateFlow(flow, { logics: [{ id: 'alive', name: '还在' }] });
  assert.equal(result.ok, false);
  assert.equal(result.problems.some((p) => p.code === 'missing-logic'), true);
});

test('验证器：调用成环要报出来', () => {
  const logics = [
    { id: 'a', name: '甲', flow: { nodes: [{ kind: 'call', id: 'n1', logicId: 'b' }] } },
    { id: 'b', name: '乙', flow: { nodes: [{ kind: 'call', id: 'n2', logicId: 'a' }] } },
  ];
  const result = validateFlow({ nodes: [] }, { logics });
  assert.equal(result.problems.some((p) => p.code === 'call-cycle'), true);
  assert.match(result.problems.find((p) => p.code === 'call-cycle').message, /甲.*乙|乙.*甲/);
});

test('验证器：空条件组、写错的正则、空分支', () => {
  const empty = validateFlow(normalizeFlow({ nodes: [makeNode('if', { when: { what: 'group', op: 'and', children: [] } })] }), {});
  assert.equal(empty.problems.some((p) => p.code === 'empty-group'), true);

  const badRegex = validateFlow(
    normalizeFlow({ nodes: [makeNode('test', { condition: { what: 'regex', pattern: '(', flags: 'i' } })] }),
    {},
  );
  assert.equal(badRegex.ok, false);
  assert.equal(badRegex.problems.some((p) => p.code === 'bad-regex'), true);

  const noElse = validateFlow(
    normalizeFlow({ nodes: [makeNode('if', { when: makeCondition('contains'), then: [makeNode('pass')] })] }),
    {},
  );
  assert.equal(noElse.problems.some((p) => p.code === 'no-else'), true);
});

test('验证器：未知节点是错误，且指出是哪一步', () => {
  const flow = normalizeFlow({ nodes: [{ kind: 'teleport', id: 'n-9' }] });
  const result = validateFlow(flow, {});
  const problem = result.problems.find((p) => p.code === 'unknown-node');
  assert.equal(problem.level, 'error');
  assert.equal(problem.nodeId, 'n-9');
  assert.match(problem.path, /第 1 步/);
});

test('验证器：一条健康的流程没有任何问题', () => {
  const flow = normalizeFlow({
    nodes: [
      makeNode('set', { name: '金币', op: 'set', value: { type: 'number', value: 10 } }),
      makeNode('if', {
        when: { what: 'group', op: 'and', children: [{ what: 'contains', text: '买' }] },
        then: [makeNode('set', { name: '金币', op: 'sub', value: { type: 'number', value: 1 } })],
        else: [makeNode('add', { text: '没钱' })],
      }),
    ],
  });
  const result = validateFlow(flow, { vars: [] });
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
  assert.equal(summarizeProblems(result), '没发现问题');
});
