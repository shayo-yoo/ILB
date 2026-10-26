// tests/flow-text.test.mjs —— 流程的文本写法（ILB-4.20）
//
// 这一层最重要的一条契约：文本不是第二个事实来源。
// 所以核心断言就是往返：parse(render(flow)) 的结构必须与 flow 完全一致
// （节点 id 除外——文本里写的是位置，搬回来会换新 id，跳转按位置重新指向）。

import test from 'node:test';
import assert from 'node:assert/strict';

import { renderFlowText, parseFlowText, FLOW_TEXT_KEYWORDS, FLOW_TEXT_HINT } from '../core/flow-text.js';
import { normalizeFlow, makeNode, evaluateFlow, describeFlow } from '../core/flow.js';

const ENTRIES = [{ id: 'E1', title: '铜钥匙' }, { id: 'E2', title: '铜门钥匙' }];
const LOGICS = [{ id: 'B::L::1', name: '扣款' }, { id: 'B::L::2', name: '结算' }];

/** 去掉 id 再比结构（id 是随机生成的，不该参与比较） */
function stripIds(node) {
  if (Array.isArray(node)) return node.map(stripIds);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'id') continue;
    out[key] = stripIds(value);
  }
  return out;
}

/** 每种节点各来一份，尽量把带分支、带条件的都覆盖到 */
function kitchenSink() {
  return normalizeFlow({
    mode: 'and',
    nodes: [
      {
        ...makeNode('test'),
        condition: { id: 'c1', what: 'contains', text: '抽卡', within: 3, negate: false },
        then: [
          { ...makeNode('calc'), target: '抽卡次数', op: '-', left: { type: 'var', name: '抽卡次数' }, right: { type: 'number', value: 1 }, persist: true },
          { ...makeNode('calc'), target: '临时值', op: 'min', left: { type: 'var', name: '幸运' }, right: { type: 'number', value: 10 }, persist: false },
          { ...makeNode('activate'), entryId: 'E1' },
          { ...makeNode('call'), logicId: 'B::L::1' },
          { ...makeNode('random'), target: '点数', min: 1, max: 6, integer: true, persist: true },
          { ...makeNode('random'), target: '小数', min: 0, max: 1, integer: false, persist: false },
          { ...makeNode('define'), name: '问候', value: { type: 'text', value: '你好' } },
          { ...makeNode('remember'), name: '幸运', value: { type: 'number', value: 7 } },
          { ...makeNode('add'), text: '追加的一段话' },
          { ...makeNode('pass') },
          { ...makeNode('fail') },
        ],
        else: [{ ...makeNode('add'), text: '带引号"和\\反斜杠' }],
      },
      {
        ...makeNode('judge'),
        mode: 'any',
        conditions: [
          { id: 'c2', what: 'messages', count: 3 },
          { id: 'c3', what: 'regex', pattern: '铜钥匙', flags: 'i', negate: true },
          { id: 'c4', what: 'active', entryId: 'E2', negate: false },
          { id: 'c5', what: 'var', name: '生命', negate: true },
          { id: 'c6', what: 'contains', text: '血', within: 2, negate: true },
        ],
        then: [{ ...makeNode('remember'), name: '记过', value: { type: 'text', value: '是的' } }],
        else: [],
      },
      {
        ...makeNode('compare'),
        left: { type: 'var', name: '幸运' },
        op: '>=',
        right: { type: 'number', value: 80 },
        then: [{ ...makeNode('pass') }],
        else: [{ ...makeNode('fail') }],
      },
      { ...makeNode('compare'), left: { type: 'text', value: '金' }, op: '==', right: { type: 'text', value: '金' } },
    ],
  });
}

test('往返：render 出来的文本读回来，结构与原来一致', () => {
  const flow = kitchenSink();
  const text = renderFlowText(flow, { entries: ENTRIES, logics: LOGICS });
  const back = parseFlowText(text, { entries: ENTRIES, logics: LOGICS });
  assert.deepEqual(back.problems, []);
  assert.equal(back.flow.mode, flow.mode);
  assert.deepEqual(stripIds(back.flow.nodes), stripIds(flow.nodes));
});

test('往返：每种模式都能保住', () => {
  for (const mode of ['and', 'only']) {
    const flow = normalizeFlow({ mode, nodes: [{ ...makeNode('add'), text: '嗨' }] });
    const back = parseFlowText(renderFlowText(flow), {});
    assert.equal(back.flow.mode, mode);
  }
});

test('文本里写的是位置，所以回来是新的 id —— 但跳转仍然指向同一个节点', () => {
  const flow = normalizeFlow({
    mode: 'and',
    nodes: [
      {
        ...makeNode('test'),
        condition: { id: 'cc', what: 'contains', text: '再抽', within: 5, negate: false },
        then: [{ ...makeNode('goto'), target: '', max: 5, onLimit: 'stop' }],
        else: [],
      },
      { ...makeNode('add'), text: '收尾' },
    ],
  });
  flow.nodes[0].then[0].target = flow.nodes[1].id;

  const text = renderFlowText(flow, {});
  assert.match(text, /跳转 @2 最多5次 超了终止/);

  const back = parseFlowText(text, {});
  assert.deepEqual(back.problems, []);
  assert.equal(back.flow.nodes[0].then[0].target, back.flow.nodes[1].id);
  assert.notEqual(back.flow.nodes[1].id, flow.nodes[1].id, '节点 id 应该换新的');
});

test('跳转的位置找不到时，报出来且不静默改指向', () => {
  const back = parseFlowText('关键词 + 流程\n跳转 @9✓.9 最多5次 超了终止\n', {});
  assert.equal(back.problems.length, 1);
  assert.match(back.problems[0].reason, /找不到这个位置/);
  assert.equal(back.flow.nodes[0].target, '');
});

test('看不懂的行全部列出来，能懂的部分照常生效', () => {
  const back = parseFlowText([
    '关键词 + 流程',
    '添加 "能懂的"',
    '积雪 什么东西',
    '计算 $生命 = $生命 @ 1',
  ].join('\n'), {});
  assert.equal(back.flow.nodes.length, 1);
  assert.equal(back.flow.nodes[0].kind, 'add');
  assert.equal(back.problems.length, 2);
  assert.deepEqual(back.problems.map((p) => p.line), [3, 4]);
});

test('引用条目/逻辑：按名字找，找不到给候选、不吃掉这一行', () => {
  const ok = parseFlowText('激活 #铜门钥匙\n调用 >结算', { entries: ENTRIES, logics: LOGICS });
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.flow.nodes[0].entryId, 'E2');
  assert.equal(ok.flow.nodes[1].logicId, 'B::L::2');

  const near = parseFlowText('激活 #铜', { entries: ENTRIES });
  assert.equal(near.problems.length, 1);
  assert.match(near.problems[0].reason, /是不是想写：铜钥匙 \/ 铜门钥匙/);
  assert.equal(near.flow.nodes.length, 0);

  const explicit = parseFlowText('激活 #id:E9', { entries: ENTRIES });
  assert.deepEqual(explicit.problems, []);
  assert.equal(explicit.flow.nodes[0].entryId, 'E9');
});

test('缩进决定分支归属；判定节点的条件写在「条件」行里', () => {
  const back = parseFlowText([
    '关键词 + 流程',
    '检测 包含 "抽卡" 在最近3条',
    '  成立',
    '    添加 "中了"',
    '  不成立',
    '    添加 "没中"',
    '判定 任一满足',
    '  条件 已聊至少 5 条',
    '  条件 $生命 没有值',
    '  成立',
    '    记住 $试过 = "true"',
  ].join('\n'), { entries: ENTRIES });
  assert.deepEqual(back.problems, []);

  const [test1, judge] = back.flow.nodes;
  assert.equal(test1.kind, 'test');
  assert.deepEqual(test1.then.map((n) => n.text), ['中了']);
  assert.deepEqual(test1.else.map((n) => n.text), ['没中']);
  assert.equal(judge.mode, 'any');
  assert.deepEqual(judge.conditions.map((c) => c.what), ['messages', 'var']);
  assert.equal(judge.then[0].name, '试过');
});

test('空行与 // 注释不影响结果', () => {
  const back = parseFlowText('关键词 + 流程\n\n// 这一段先注释掉\n添加 "嗨"\n\n', {});
  assert.deepEqual(back.problems, []);
  assert.equal(back.flow.nodes.length, 1);
  assert.equal(back.flow.nodes[0].text, '嗨');
});

test('空流程与空文本都不会炸', () => {
  const empty = parseFlowText('', {});
  assert.deepEqual(empty.problems, []);
  assert.deepEqual(empty.flow.nodes, []);
  assert.equal(empty.flow.mode, 'and');

  const rendered = renderFlowText({ mode: 'and', nodes: [] }, {});
  assert.equal(rendered.trim(), '关键词 + 流程');
});

test('搬回来之后，执行层照样能跑（文本层不参与执行）', () => {
  const flow = normalizeFlow({
    mode: 'and',
    nodes: [
      {
        ...makeNode('test'),
        condition: { id: 'zz', what: 'contains', text: '抽卡', within: 3, negate: false },
        then: [
          { ...makeNode('calc'), target: '抽卡次数', op: '-', left: { type: 'var', name: '抽卡次数' }, right: { type: 'number', value: 1 }, persist: true },
          { ...makeNode('activate'), entryId: 'E1' },
        ],
        else: [{ ...makeNode('add'), text: '次数不够了。' }],
      },
    ],
  });
  const back = parseFlowText(renderFlowText(flow, { entries: ENTRIES }), { entries: ENTRIES });
  assert.deepEqual(back.problems, []);

  // 搬回来之后，跑出来的结果必须和原来一模一样（文本层不参与执行）
  const probe = { text: '我想抽卡', vars: { 抽卡次数: 3 }, messageCount: 2 };
  const before = evaluateFlow(flow, probe);
  const after = evaluateFlow(back.flow, probe);
  assert.deepEqual(
    { passed: after.passed, writes: after.writes, extra: after.extra, reason: after.reason, steps: after.steps },
    { passed: before.passed, writes: before.writes, extra: before.extra, reason: before.reason, steps: before.steps },
  );
  assert.equal(after.passed, true);
  assert.deepEqual(after.writes, { 抽卡次数: 2 });
  assert.deepEqual(after.activations, ['E1']);

  // 不成立那一支走「添加」：按引擎现有语义，加了正文就算通过
  const missProbe = { text: '走开', vars: { 抽卡次数: 3 }, messageCount: 2 };
  const miss = evaluateFlow(back.flow, missProbe);
  const missBefore = evaluateFlow(flow, missProbe);
  assert.equal(miss.passed, missBefore.passed);
  assert.deepEqual(miss.extra, ['次数不够了。']);
});

test('写出来的文本里带着说明与关键字表（给界面和 AI 看）', () => {
  assert.ok(FLOW_TEXT_HINT.includes('$名字'));
  assert.ok(FLOW_TEXT_HINT.includes('成立'));
  assert.deepEqual(Object.keys(FLOW_TEXT_KEYWORDS).sort(), [
    'activate', 'add', 'calc', 'call', 'compare', 'define', 'fail', 'goto', 'judge', 'pass', 'random', 'remember', 'test',
  ]);
});

test('describeFlow 与文本层互不干扰（表单那边仍读节点树）', () => {
  const flow = kitchenSink();
  assert.match(describeFlow(flow), /^关键词 \+ 流程，共 \d+ 个节点$/);
});

// —— v0.13.1：AI 真写出来的那种脚本要能认 ——

const AI_SCRIPT = `// 第一部分：初始化与判定（对应你写的第一次触发逻辑）
比较 $升级经验 == 0
  成立
    // 按照你的公式：(等级x10) x (等级x0.1) - 等级
    计算 $等级系数1 = $等级 * 10 [存]
    计算 $等级系数2 = $等级 * 0.1 [存]
    计算 $系数乘积 = $等级系数1 * $等级系数2 [存]
    计算 $所需升级经验 = $系数乘积 - $等级 [存]

    // 初始化当前经验为0，防止死循环（如果你的$升级经验就是当前经验的话）
    计算 $升级经验 = 0 [存]
  不成立
    // 如果不是第一次触发，什么都不做，继续往下走

// 第二部分：升级判定（假设此时$升级经验已经通过其他途径增加）
比较 $升级经验 >= $所需升级经验
  成立
    计算 $升级经验 = $升级经验 - $所需升级经验 [存]
    计算 $等级 = $等级 + 1 [存]
    计算 $等级系数1 = $等级 * 10 [存]
    计算 $等级系数2 = $等级 * 0.1 [存]
    计算 $系数乘积 = $等级系数1 * $等级系数2 [存]
    计算 $所需升级经验 = $系数乘积 - $等级 [存]
    // 如果只升一级，就留空，直接结束
    跳转 @2 (回到判断所需经验的前一行)
  不成立
    // 经验不足，直接结束`;

test('AI 写的那种脚本能整份读进来（直接赋值、行内注释、跳转后带括号说明）', () => {
  const got = parseFlowText(AI_SCRIPT, {});
  assert.deepEqual(got.problems, []);
  assert.equal(got.flow.nodes.length, 2);

  const [first, second] = got.flow.nodes;
  assert.equal(first.kind, 'compare');
  // 「计算 $升级经验 = 0」不是算术，是直接赋值
  const init = first.then.find((n) => n.target === '升级经验');
  assert.equal(init.kind, 'calc');
  assert.equal(init.op, '=');
  assert.deepEqual(init.left, { type: 'number', value: 0 });
  assert.equal(init.persist, true);

  // 「跳转 @2 (回到…)」里括号那段是说明，不该影响解析
  const jump = second.then.find((n) => n.kind === 'goto');
  assert.ok(jump);
  assert.equal(jump.target, second.id);
  assert.equal(jump.max, 20);
});

test('直接赋值认数字、文本与变量；写回文本再读回来还是赋值不是算术', () => {
  const flow = normalizeFlow({
    mode: 'only',
    nodes: [
      { ...makeNode('calc'), target: '人数', op: '=', left: { type: 'number', value: 3 }, right: { type: 'number', value: 0 }, persist: true },
      { ...makeNode('calc'), target: '称号', op: '=', left: { type: 'text', value: '勇者' }, right: { type: 'number', value: 0 }, persist: false },
      { ...makeNode('calc'), target: '副本', op: '=', left: { type: 'var', name: '原值' }, right: { type: 'number', value: 0 }, persist: true },
    ],
  });
  const text = renderFlowText(flow, {});
  assert.match(text, /计算 \$人数 = 3 \[存\]/);
  assert.match(text, /计算 \$称号 = "勇者"\n/);
  const back = parseFlowText(text, {});
  assert.deepEqual(back.problems, []);
  assert.deepEqual(stripIds(back.flow.nodes), stripIds(flow.nodes));
});

test('直接赋值在执行层就是"存进去"，不参与加法', () => {
  const flow = normalizeFlow({
    mode: 'only',
    nodes: [
      { ...makeNode('calc'), target: '称号', op: '=', left: { type: 'text', value: '勇者' }, right: { type: 'number', value: 0 }, persist: true },
    ],
  });
  const result = evaluateFlow(flow, { text: '', vars: {}, messageCount: 1 });
  assert.deepEqual(result.writes, { 称号: '勇者' });
});

test('看不懂时把这一行原样念出来，不拿别处的例子糊弄人', () => {
  const got = parseFlowText('计算 这个东西\n计算 $甲 = \n比较 $甲 >=', {});
  assert.equal(got.problems.length, 3);
  for (const p of got.problems) assert.ok(p.reason.includes('「') || p.reason.includes('这一行'));
  assert.ok(got.problems.some((p) => p.reason.includes('计算 这个东西')));
  assert.ok(!got.problems.some((p) => p.reason.includes('$生命')));
});

test('跳转指向自己时报警告（不是错误），不影响保存', () => {
  // 第 2 个节点写「跳转 @2」，就是它自己 —— 会原地打转
  const got = parseFlowText(`添加 "开始"
跳转 @2 最多5次 超了终止`, {});
  assert.deepEqual(got.problems, []);
  assert.equal(got.warnings.length, 1);
  assert.ok(got.warnings[0].reason.includes('原地打转'));
  assert.equal(got.warnings[0].line, 2);
});