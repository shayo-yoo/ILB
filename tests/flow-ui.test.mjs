// tests/flow-ui.test.mjs —— 「界面」步骤（ILB-4.21）
//
// 这一层的契约很短，但每条都要能挡住"别人导入一本书就能翻你的页"：
//   1. 只有调用方明确允许（用户点按钮 → api.call）才产出指令；
//   2. 聊天里自动触发的激活一律不发，只在诊断里记一笔；
//   3. 一次调用只发第一条，多的丢在步骤日志里；
//   4. 指令就是几个字符串字段，多一个键都不收（D-0006：没有表达式语言）。

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeFlow,
  makeNode,
  evaluateFlow,
  uiCommandOf,
  describeUi,
  describeNode,
  checkUiNode,
  UI_VERSION,
  UI_LIMIT,
} from '../core/flow.js';

function one(node) {
  return normalizeFlow({ nodes: [node] });
}

test('指令只带写过的键，空字段不占位', () => {
  const flow = one({ kind: 'ui', page: '结果页', toast: 'SSR！' });
  const res = evaluateFlow(flow, { uiAllowed: true });
  assert.deepEqual(res.ui, { v: UI_VERSION, page: '结果页', toast: 'SSR！' });
  assert.equal(res.ui.select, undefined);
  assert.equal(res.ui.ask, undefined);
});

test('什么都不写时没有指令，不算错', () => {
  const flow = one({ kind: 'ui', page: '', toast: '', select: '' });
  const res = evaluateFlow(flow, { uiAllowed: true });
  assert.equal(res.ui, null);
  assert.equal(res.passed, true);
});

test('聊天里自动触发时不发指令，只记一笔', () => {
  const flow = one({ kind: 'ui', page: '结果页', toast: 'SSR！' });
  const res = evaluateFlow(flow, {}); // 没有 uiAllowed
  assert.equal(res.ui, null);
  assert.equal(res.uiSkipped.length, 1);
  assert.equal(res.uiSkipped[0].page, '结果页');
  assert.equal(res.passed, true);
  assert.match(res.steps.map((s) => s.reason).join('\n'), /只有用户点按钮调用时才执行/);
});

test('一次调用只发第一条，后面的记在步骤里', () => {
  const flow = normalizeFlow({
    nodes: [
      { kind: 'ui', page: '第一页', toast: 'A' },
      { kind: 'ui', page: '第二页', toast: 'B' },
    ],
  });
  const res = evaluateFlow(flow, { uiAllowed: true });
  assert.equal(res.ui.page, '第一页');
  assert.match(res.steps.map((s) => s.reason).join('\n'), /已经发过一条界面指令/);
});

test('被调用的逻辑里也能发指令，并且往外层冒', () => {
  const inner = one({ kind: 'ui', page: '结果页', toast: '由子逻辑发' });
  const outer = normalizeFlow({
    nodes: [
      { kind: 'call', logicId: 'B::L::9' },
      { kind: 'add', text: '外层也跑了' },
    ],
  });
  const res = evaluateFlow(outer, {
    uiAllowed: true,
    callLogic: () => evaluateFlow(inner, { uiAllowed: true }),
  });
  assert.equal(res.ui.page, '结果页');
  assert.deepEqual(res.extra, ['外层也跑了']);
});

test('外层没允许时，子逻辑也不能发', () => {
  const inner = one({ kind: 'ui', page: '结果页' });
  const outer = normalizeFlow({ nodes: [{ kind: 'call', logicId: 'B::L::9' }] });
  const res = evaluateFlow(outer, {
    uiAllowed: false,
    callLogic: () => evaluateFlow(inner, { uiAllowed: false }),
  });
  assert.equal(res.ui, null);
});

test('字段超长当场截断，不认识的键丢掉', () => {
  const flow = one({
    kind: 'ui',
    页面: '不该出现',
    page: '很长的页面名'.repeat(20),
    toast: '提示'.repeat(100),
  });
  const res = evaluateFlow(flow, { uiAllowed: true });
  assert.equal(res.ui.page.length, UI_LIMIT.page);
  assert.equal(res.ui.toast.length, UI_LIMIT.toast);
  assert.equal(res.ui['页面'], undefined);
  assert.equal(res.ui.eval, undefined);
});

test('顺序号可选：写了才带，乱写就不要', () => {
  assert.equal(evaluateFlow(one({ kind: 'ui', toast: 'x', seq: 3 }), { uiAllowed: true }).ui.seq, 3);
  assert.equal(evaluateFlow(one({ kind: 'ui', toast: 'x', seq: -5 }), { uiAllowed: true }).ui.seq, undefined);
  assert.equal(evaluateFlow(one({ kind: 'ui', toast: 'x', seq: 'abc' }), { uiAllowed: true }).ui.seq, undefined);
});

test('「问一句」包成 ask，标题正文按钮都进来了', () => {
  const cmd = uiCommandOf(normalizeFlow({ nodes: [{ kind: 'ui', askTitle: '确认抽卡？', askText: '消耗 10 金币', askOk: '确定' }] }).nodes[0]);
  assert.deepEqual(cmd, { v: UI_VERSION, ask: { title: '确认抽卡？', text: '消耗 10 金币', ok: '确定' } });
  assert.equal(describeUi(cmd), '问「确认抽卡？」');
});

test('人话摘要与节点描述', () => {
  const node = normalizeFlow({ nodes: [{ kind: 'ui', page: '结果页', toast: 'SSR！', select: 'card-3' }] }).nodes[0];
  assert.equal(describeUi(uiCommandOf(node)), '翻到「结果页」，提示「SSR！」，聚焦 card-3');
  assert.match(describeNode(node), /^界面：/);
});

test('保存前的检查：空步、<尖括号>、只有正文没问题但会提示', () => {
  assert.match(checkUiNode(makeNode('ui')).join('；'), /这一步是空的/);
  assert.match(checkUiNode({ kind: 'ui', page: '<script>' }).join('；'), /页面 id 里不能有这些字符/);
  assert.match(checkUiNode({ kind: 'ui', select: 'a"b' }).join('；'), /控件 id 里不能有这些字符/);
  const onlyText = checkUiNode({ kind: 'ui', toast: '只有提示' });
  assert.deepEqual(onlyText, []);
  assert.match(checkUiNode({ kind: 'ui', askText: '没有标题' }).join('；'), /没写标题/);
});

test('不改流程的其他部分：不通过时前面的指令也不发', () => {
  const flow = normalizeFlow({
    nodes: [
      { kind: 'compare', left: { type: 'var', name: '次数' }, op: '>', right: { type: 'number', value: 0 }, then: [{ kind: 'ui', toast: '可以抽' }], else: [{ kind: 'fail' }] },
    ],
  });
  const okRes = evaluateFlow(flow, { uiAllowed: true, vars: { 次数: 1 } });
  assert.equal(okRes.ui.toast, '可以抽');
  const noRes = evaluateFlow(flow, { uiAllowed: true, vars: { 次数: 0 } });
  assert.equal(noRes.ui, null);
  assert.equal(noRes.outcome, undefined);
  assert.equal(noRes.passed, false);
  assert.equal(noRes.blocked, true);
});
