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
          { ...makeNode('ui'), page: '结果页', toast: 'SSR！', select: 'card-3', askTitle: '', askText: '', askOk: '' },
          { ...makeNode('ui'), page: '', toast: '只提示', select: '', askTitle: '确认抽卡？', askText: '消耗 10 金币', askOk: '确定' },
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
      {
        ...makeNode('if'),
        when: {
          what: 'group',
          mode: 'any',
          negate: false,
          children: [
            { id: 'c7', what: 'contains', text: '组内', within: 4, negate: false },
            { id: 'c8', what: 'messages', count: 2 },
          ],
        },
        then: [{ ...makeNode('set'), name: '金币', op: 'add', value: { type: 'number', value: 5 } }],
        else: [],
      },
      { ...makeNode('chance'), percent: 25, then: [{ ...makeNode('add'), text: '中了' }], else: [] },
      { ...makeNode('set'), name: '金币', op: 'clamp', min: 0, max: 999, persist: false },
      { ...makeNode('set'), name: '名字', op: 'append', value: { type: 'text', value: '，勇者' } },
      { ...makeNode('set'), name: '旧名字', op: 'delete' },
      { ...makeNode('set'), name: '四舍五入', op: 'round', digits: 2 },
      { ...makeNode('choose'), target: '抽中', candidates: ['SSR', 'SR', 'R'], persist: false },
      { ...makeNode('choose'), target: '', candidates: ['只有一条'], persist: true },
      {
        ...makeNode('repeat'),
        times: 2,
        body: [
          { ...makeNode('add'), text: '循环体' },
          { ...makeNode('set'), name: '计数', op: 'add', value: { type: 'number', value: 1 } },
        ],
      },
      { ...makeNode('list'), name: '清单', op: 'set', value: { type: 'text', value: '甲\n乙' }, separator: '\n' },
      { ...makeNode('list'), name: '清单', op: 'append', value: { type: 'text', value: '丙' }, separator: '\n' },
      { ...makeNode('list'), name: '清单', op: 'clear', separator: '\n' },
      {
        ...makeNode('repeat'),
        mode: 'list',
        listName: '清单',
        itemName: '项',
        body: [{ ...makeNode('add'), text: '每项都做' }],
      },
      {
        ...makeNode('repeat'),
        mode: 'list',
        listName: '清单',
        itemName: '',
        body: [],
      },
      {
        ...makeNode('switch'),
        value: { type: 'var', name: '等级' },
        cases: [
          { id: 'k1', match: { type: 'number', value: 3 }, body: [{ ...makeNode('add'), text: '三' }] },
          { id: 'k2', match: { type: 'text', value: 'VIP' }, body: [] },
        ],
        else: [{ ...makeNode('add'), text: '其他' }],
      },
      { ...makeNode('stop'), result: 'fail', reason: '药水用完了' },
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
    'activate', 'add', 'calc', 'call', 'chance', 'choose', 'compare', 'define', 'fail', 'goto', 'if',
    'judge', 'list', 'pass', 'random', 'remember', 'repeat', 'repeatList', 'set', 'stop', 'switch', 'test', 'ui',
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

// —— v0.14.0：「界面」步骤（ILB-4.21）——

test('界面 一行写全：页面、提示、聚焦、问一句', () => {
  const got = parseFlowText(`界面 结果页 "SSR！" 聚焦 card-3
界面 - "只提示"
界面 结果页 问 "确认抽卡？" "消耗 10 金币" "确定"`, {});
  assert.deepEqual(got.problems, []);
  const [a, b, c] = got.flow.nodes;
  assert.equal(a.kind, 'ui');
  assert.deepEqual([a.page, a.toast, a.select], ['结果页', 'SSR！', 'card-3']);
  assert.equal(b.page, '');
  assert.equal(b.toast, '只提示');
  assert.deepEqual([c.askTitle, c.askText, c.askOk], ['确认抽卡？', '消耗 10 金币', '确定']);
});

test('界面 写坏了逐行说清楚，不猜', () => {
  const got = parseFlowText(`界面 结果页 "没收尾
界面 结果页 乱写
界面`, {});
  assert.equal(got.flow.nodes.length, 0);
  assert.equal(got.problems.length, 3);
  const text = got.problems.map((p) => p.reason).join('\n');
  assert.match(text, /引号没有关上/);
  assert.match(text, /看不懂「乱写」/);
  assert.match(text, /界面要写成/);
});

test('界面的字段也会被尖括号拦住（那是 html，不是文本）', () => {
  const got = parseFlowText('界面 <script>', {});
  assert.equal(got.problems.length, 1);
  assert.match(got.problems[0].reason, /页面 id 里不能有这些字符/);
});

// —— v0.17：文本语法补齐「条件组 / 按概率 / 变量 / 随机选 / 重复 / 结束」 ——

test('条件组：一层条件行装得下，读回来结构与写出去一致', () => {
  const text = [
    '关键词 + 流程',
    '条件组 任一满足',
    '  条件 包含 "组内" 在最近4条',
    '  条件 已聊至少 2 条',
    '  成立',
    '    变量 $金币 增加 5',
  ].join('\n');
  const got = parseFlowText(text, {});
  assert.deepEqual(got.problems, []);
  const node = got.flow.nodes[0];
  assert.equal(node.kind, 'if');
  assert.equal(node.when.op, 'or');
  assert.equal(node.when.children.length, 2);
  assert.equal(node.when.children[1].what, 'messages');

  const again = parseFlowText(renderFlowText(got.flow, {}), {});
  assert.deepEqual(again.problems, []);
  assert.deepEqual(stripIds(again.flow.nodes), stripIds(got.flow.nodes));
});

test('条件组写坏了：条件行不缩进会落在组外面，且给出提示', () => {
  const got = parseFlowText(['条件组 全部满足', '条件 包含 "没缩进" 在最近3条'].join('\n'), {});
  // 没缩进的条件行不属于这个组：这是结构错误，解析层要说话，而不是悄悄丢掉
  assert.ok(got.problems.length > 0);
  assert.match(got.problems.map((p) => p.reason).join('\n'), /要缩进写在「判定 \/ 条件组」下面/);
});

test('变量：九种动作的写法与读法', () => {
  const text = [
    '变量 $金币 设为 100',
    '变量 $金币 增加 5',
    '变量 $金币 减少 2',
    '变量 $金币 乘以 3',
    '变量 $名字 追加文字 "，勇者"',
    '变量 $金币 清空',
    '变量 $旧名字 删除',
    '变量 $金币 限制在范围内 0..999 [临时]',
    '变量 $金币 取整 2 位',
  ].join('\n');
  const got = parseFlowText(text, {});
  assert.deepEqual(got.problems, []);
  const ops = got.flow.nodes.map((n) => n.op);
  assert.deepEqual(ops, ['set', 'add', 'sub', 'mul', 'append', 'clear', 'delete', 'clamp', 'round']);
  assert.equal(got.flow.nodes[7].persist, false);
  assert.equal(got.flow.nodes[7].max, 999);
  assert.equal(got.flow.nodes[8].digits, 2);

  const again = parseFlowText(renderFlowText(got.flow, {}), {});
  assert.deepEqual(again.problems, []);
  assert.deepEqual(stripIds(again.flow.nodes), stripIds(got.flow.nodes));
});

test('变量写坏了逐行说清楚：动作不认识 / 缺值 / 范围没写对', () => {
  const got = parseFlowText([
    '变量 $金币 乱写 5',
    '变量 $金币 增加',
    '变量 $金币 限制在范围内 0',
    '变量 金币',
  ].join('\n'), {});
  assert.equal(got.flow.nodes.length, 0);
  assert.equal(got.problems.length, 4);
  const text = got.problems.map((p) => p.reason).join('\n');
  assert.match(text, /不认识的变量动作/);
  assert.match(text, /要跟一个值/);
  assert.match(text, /限制在范围内/);
  assert.match(text, /变量操作要写成/);
});

test('随机选：写目标变量就存进去，不写就追加正文；[临时] 不存', () => {
  const got = parseFlowText([
    '随机选 $抽中 = "SSR" "SR" "R"',
    '随机选 "只有这一条"',
    '随机选 $抽中 = "SSR" "SR" [临时]',
  ].join('\n'), {});
  assert.deepEqual(got.problems, []);
  assert.equal(got.flow.nodes[0].target, '抽中');
  assert.deepEqual(got.flow.nodes[0].candidates, ['SSR', 'SR', 'R']);
  assert.equal(got.flow.nodes[1].target, '');
  assert.equal(got.flow.nodes[2].persist, false);
});

test('随机选写坏了：一条候选都没有 / 引号没闭合', () => {
  const got = parseFlowText(['随机选 $抽中 = SSR SR', '随机选 "没收尾'].join('\n'), {});
  assert.equal(got.flow.nodes.length, 0);
  assert.equal(got.problems.length, 2);
  assert.match(got.problems.map((p) => p.reason).join('\n'), /至少要写一条带引号的候选|引号没闭合|看不懂/);
});

test('重复：循环体直接缩进写在下面，执行时真的跑 N 次', () => {
  const got = parseFlowText(['重复 3 次', '  变量 $计数 增加 1'].join('\n'), {});
  assert.deepEqual(got.problems, []);
  assert.equal(got.flow.nodes[0].kind, 'repeat');
  assert.equal(got.flow.nodes[0].body.length, 1);

  const res = evaluateFlow(got.flow, { text: '', vars: {}, messageCount: 0 });
  assert.equal(res.passed, true);
  assert.equal(res.writes.计数, 3);
});

test('重复写坏了：不许写「成立 / 不成立」，次数要有上限', () => {
  const got = parseFlowText([
    '重复 2 次',
    '  成立',
    '    添加 "不对"',
    '重复 999 次',
  ].join('\n'), {});
  const text = got.problems.map((p) => p.reason).join('\n');
  assert.match(text, /不用写「成立 \/ 不成立」/);
  assert.match(text, /最多 50 次/);
});

test('结束：当作通过 / 当作不通过，原因可有可无', () => {
  const got = parseFlowText([
    '结束 当作不通过 "药水用完了"',
    '结束 当作通过',
  ].join('\n'), {});
  assert.deepEqual(got.problems, []);
  assert.deepEqual(got.flow.nodes.map((n) => [n.kind, n.result, n.reason]), [
    ['stop', 'fail', '药水用完了'],
    ['stop', 'pass', ''],
  ]);

  const res = evaluateFlow(got.flow, { text: '', vars: {}, messageCount: 0 });
  assert.equal(res.passed, false);
  assert.equal(res.blocked, true);
});

test('按概率：百分比写进节点，超范围会被洗回 0..100', () => {
  const got = parseFlowText(['按概率 30%', '  成立', '    添加 "中了"'].join('\n'), {});
  assert.deepEqual(got.problems, []);
  assert.equal(got.flow.nodes[0].kind, 'chance');
  assert.equal(got.flow.nodes[0].percent, 30);

  const wide = parseFlowText('按概率 150%', {});
  assert.equal(wide.flow.nodes[0].percent, 100);
});

test('列表变量：设为 / 追加 / 清空三种动作都能往返', () => {
  const flow = normalizeFlow({
    mode: 'and',
    nodes: [
      { ...makeNode('list'), name: '清单', op: 'set', value: { type: 'text', value: '甲,乙' }, separator: '\n' },
      { ...makeNode('list'), name: '清单', op: 'append', value: { type: 'text', value: '丙' }, separator: '\n' },
      { ...makeNode('list'), name: '清单', op: 'clear', separator: '\n' },
    ],
  });
  const text = renderFlowText(flow, {});
  assert.match(text, /列表 \$清单 设为 "甲,乙"/);
  assert.match(text, /列表 \$清单 追加 "丙"/);
  assert.match(text, /列表 \$清单 清空/);

  const back = parseFlowText(text, {});
  assert.deepEqual(back.problems, []);
  assert.deepEqual(stripIds(back.flow.nodes), stripIds(flow.nodes));
});

test('按列表循环：清单、当前项与循环体都能往返', () => {
  const flow = normalizeFlow({
    mode: 'and',
    nodes: [
      {
        ...makeNode('repeat'),
        mode: 'list',
        listName: '清单',
        itemName: '项',
        body: [{ ...makeNode('add'), text: '每项都做' }],
      },
      { ...makeNode('repeat'), mode: 'list', listName: '清单', itemName: '', body: [] },
    ],
  });
  const text = renderFlowText(flow, {});
  assert.match(text, /按列表 \$清单 重复（当前项 \$项）/);
  assert.match(text, /\n按列表 \$清单 重复\n/);

  const back = parseFlowText(text, {});
  assert.deepEqual(back.problems, []);
  assert.deepEqual(stripIds(back.flow.nodes), stripIds(flow.nodes));
});

test('列表写坏了逐行说清楚：缺值 / 动作不认识', () => {
  const got = parseFlowText([
    '列表 $清单 设为',
    '列表 $清单 变成 "甲"',
  ].join('\n'), {});
  const text = got.problems.map((p) => p.reason).join('\n');
  assert.match(text, /要跟一个值/);
  assert.match(text, /列表要写成/);
  assert.equal(got.flow.nodes.length, 0);
});

test('自定义分隔符的列表渲染成只读说明，不假装能往返', () => {
  const flow = normalizeFlow({
    mode: 'and',
    nodes: [{ ...makeNode('list'), name: '清单', op: 'set', value: { type: 'text', value: '甲,乙' }, separator: ',' }],
  });
  const text = renderFlowText(flow, {});
  assert.match(text, /列表 \$清单（自定义分隔符，只能在表单里编辑）/);
});

test('分支选择：等于几条与否则都能往返', () => {
  const flow = normalizeFlow({
    mode: 'and',
    nodes: [{
      ...makeNode('switch'),
      value: { type: 'var', name: '等级' },
      cases: [
        { id: 'k1', match: { type: 'number', value: 3 }, body: [{ ...makeNode('add'), text: '三' }] },
        { id: 'k2', match: { type: 'text', value: 'VIP' }, body: [] },
      ],
      else: [{ ...makeNode('add'), text: '其他' }],
    }],
  });
  const text = renderFlowText(flow, {});
  assert.match(text, /分支选择 \$等级/);
  assert.match(text, /等于 3/);
  assert.match(text, /等于 "VIP"/);
  assert.match(text, /否则/);

  const back = parseFlowText(text, {});
  assert.deepEqual(back.problems, []);
  assert.deepEqual(stripIds(back.flow.nodes), stripIds(flow.nodes));
});

test('分支选择写坏了：块头不认识 / 缺值都逐行报', () => {
  const got = parseFlowText([
    '分支选择 $等级',
    '  如果 3',
    '    添加 "三"',
    '  等于',
  ].join('\n'), {});
  const text = got.problems.map((p) => p.reason).join('\n');
  assert.match(text, /只写「等于 <值>」或「否则」/);
  assert.match(text, /要跟一个值/);
});

test('分支选择：文本读回来的流程照样能跑', () => {
  const got = parseFlowText([
    '分支选择 $等级',
    '  等于 3',
    '    添加 "三"',
    '  等于 "VIP"',
    '    添加 "贵宾"',
    '  否则',
    '    添加 "其他"',
  ].join('\n'), {});
  assert.deepEqual(got.problems, []);

  const hit = evaluateFlow(got.flow, { text: '', vars: { 等级: 3 }, messageCount: 0 });
  assert.deepEqual(hit.extra, ['三']);
  const vip = evaluateFlow(got.flow, { text: '', vars: { 等级: 'VIP' }, messageCount: 0 });
  assert.deepEqual(vip.extra, ['贵宾']);
  const miss = evaluateFlow(got.flow, { text: '', vars: { 等级: 9 }, messageCount: 0 });
  assert.deepEqual(miss.extra, ['其他']);
});

test('全角空格缩进也能读：一个全角空格算两个半角空格', () => {
  const got = parseFlowText([
    '条件组 全部满足',
    '　条件 已聊至少 1 条',
    '　成立',
    '　　添加 "全角缩进"',
  ].join('\n'), {});
  assert.deepEqual(got.problems, []);
  const first = got.flow.nodes[0];
  assert.equal(first.kind, 'if');
  assert.equal(first.then.length, 1);
  assert.equal(first.then[0].kind, 'add');
});

test('全角空格与半角空格混着写，层级照样分得清', () => {
  const got = parseFlowText([
    '分支选择 $等级',
    '  等于 3',
    '　　添加 "三"',
  ].join('\n'), {});
  assert.deepEqual(got.problems, []);
  assert.equal(got.flow.nodes[0].cases[0].body.length, 1);
  assert.equal(got.flow.nodes[0].cases[0].body[0].text, '三');
});

test('缩进错的行会说清"缩进了几格"，不是只说"缩进不对"', () => {
  const got = parseFlowText([
    '添加 "一"',
    '   添加 "二"',
  ].join('\n'), {});
  const text = got.problems.map((p) => p.reason).join('\n');
  assert.match(text, /缩进多了（3 格/);
});

test('行首混了不间断空格时说清是"特殊空白"', () => {
  const got = parseFlowText([
    '添加 "一"',
    '\u00a0添加 "二"',
  ].join('\n'), {});
  const text = got.problems.map((p) => p.reason).join('\n');
  assert.match(text, /特殊空白/);
});
