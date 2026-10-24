// lab/tests/narrative.test.mjs —— 叙事引擎子项目自己的测试（node:test，不依赖扩展）。
//
// 验收标准（D-0040）：下面六种"玩法"全部只用**声明**写出来，核心一行不改：
//   1. 背包 8 格           → 列表 + max 约束
//   2. 负重 20             → 目录里的 weight + sumMax 约束
//   3. 圣剑/魔剑互斥       → 两个开关 + mutex 约束
//   4. 药水冷却 3 轮       → 数值 + tick 规则
//   5. 关系表              → map + 关系事实
//   6. 任务状态机          → enum + use 事实
// 另外验证：原子拒绝、重放/编辑消息、未知标记、注入渲染与预算。

import test from 'node:test';
import assert from 'node:assert/strict';

import { createNarrative } from '../narrative/index.js';

// ---- 六种玩法的声明（这就是"用户写的东西"，没有一行代码） ----
// 与 `lab/example/spec.js` 是同一份：演示跑的就是这份，测试验的也是这份。
import { SPEC } from '../example/spec.js';

const ilb = createNarrative(SPEC);
const gain = (name, count = 1) => ({ type: 'gain', name, count });
const use = (name) => ({ type: 'use', name, count: 1 });

test('声明本身没有问题（编译期零报错）', () => {
  assert.deepEqual(ilb.problems, []);
  assert.equal(ilb.rules.length, SPEC.rules.length);
});

test('玩法 1：背包 8 格，第 9 件被拒且整条不生效', () => {
  let state = ilb.initial();
  for (let i = 0; i < 8; i += 1) {
    const r = ilb.apply(state, gain('铁钥匙'));
    assert.equal(r.ok, true, `第 ${i + 1} 件应该能放进去`);
    state = r.state;
  }
  assert.equal(ilb.derive(state).背包.满, true);
  assert.equal(ilb.derive(state).背包.剩余, 0);

  const rejected = ilb.apply(state, gain('铜钥匙'));
  assert.equal(rejected.ok, false);
  assert.match(rejected.rejected[0].reason, /上限 8/);
  // 原子：被拒之后状态必须原封不动
  assert.deepEqual(rejected.state.vars.背包, state.vars.背包);
  assert.equal(rejected.changes.length, 0);
});

test('玩法 2：负重 20，超重被拒', () => {
  let state = ilb.initial();
  // 重甲 15 + 5 把钥匙 5 = 20，正好顶到上限；再放一瓶药水（重 2）就超了
  state = ilb.apply(state, gain('重甲')).state;
  for (let i = 0; i < 5; i += 1) state = ilb.apply(state, gain('铁钥匙')).state;
  assert.equal(ilb.derive(state).背包.总重量, 20);
  const r = ilb.apply(state, gain('药水'));
  assert.equal(r.ok, false);
  assert.match(r.rejected[0].reason, /总重量 22 超过上限 20/);
});

test('玩法 3：圣剑与魔剑互斥，第二把被拒且第一把仍成立', () => {
  let state = ilb.initial();
  state = ilb.apply(state, gain('圣剑')).state;
  assert.equal(state.vars.圣剑, true);
  const r = ilb.apply(state, gain('魔剑'));
  assert.equal(r.ok, false);
  assert.match(r.rejected[0].reason, /不能同时为真/);
  assert.equal(r.state.vars.圣剑, true);
  assert.equal(r.state.vars.魔剑, false);
  assert.equal(r.state.vars.背包.includes('魔剑'), false, '被拒的事实不许半生效（东西也不该进背包）');
});

test('玩法 4：药水冷却 3 轮，靠 tick 逐轮递减', () => {
  let state = ilb.initial();
  state = ilb.apply(state, gain('药水')).state;
  const first = ilb.apply(state, use('药水'));
  assert.equal(first.ok, true);
  state = first.state;
  assert.equal(state.vars.生命, 100);
  assert.equal(state.vars.冷却, 3);
  assert.equal(state.vars.背包.includes('药水'), false);

  const during = ilb.apply(state, use('药水'));
  assert.equal(during.ok, false);
  assert.match(during.rejected[0].reason, /冷却/);

  // 三条消息（每条末尾一次 tick）之后冷却归零
  const folded = ilb.fold(['（环顾四周）', '（继续赶路）', '（坐下休息）']);
  assert.equal(folded.state.vars.冷却, 0);
  // 冷却归零后可以再喝
  const again = ilb.apply(Object.assign({}, folded.state, { vars: { ...folded.state.vars, 背包: ['药水'] } }), use('药水'));
  assert.equal(again.ok, true);
  assert.equal(again.state.vars.冷却, 3);
});

test('玩法 5：关系表按人物累加，方向可正可负', () => {
  let state = ilb.initial();
  state = ilb.apply(state, { type: 'relation', name: '艾琳', dir: '信任', sign: 1, amount: 1 }).state;
  state = ilb.apply(state, { type: 'relation', name: '艾琳', dir: '信任', sign: 1, amount: 1 }).state;
  state = ilb.apply(state, { type: 'relation', name: '艾琳', dir: '怀疑', sign: -1, amount: 1 }).state;
  assert.equal(state.vars.关系.艾琳, 1, '两次 +1 一次 -1 = 1');
  assert.match(ilb.render(state), /关系：艾琳 1/);
});

test('玩法 6：任务状态机（未接 → 进行 → 完成），重复交付被拒', () => {
  assert.equal(ilb.initial().vars.任务, '未接');
  let state = ilb.apply(ilb.initial(), use('接受委托')).state;
  assert.equal(state.vars.任务, '进行');
  state = ilb.apply(state, use('完成委托')).state;
  assert.equal(state.vars.任务, '完成');
  assert.equal(state.vars.声望, 5);
  const again = ilb.apply(state, use('完成委托'));
  assert.equal(again.ok, false);
  assert.match(again.rejected[0].reason, /已经交过/);
});

test('解析：能认出八种标记，重复的只算一次，写错的进 unknowns 且带建议', () => {
  const text = '你推开门。[[ILB:获得:铜钥匙]] 桌上还有一封信。[[ILB:获得:铜钥匙]] [[ILB:拿到:铁钥匙]] [[ILB:关系:艾琳/信任+2]]';
  const parsed = ilb.parse(text);
  assert.equal(parsed.found, 4);
  assert.equal(parsed.facts.length, 2, '重复的获得只保留一条');
  assert.equal(parsed.duplicates, 1);
  assert.equal(parsed.unknowns.length, 1);
  assert.equal(parsed.unknowns[0].code, 'unknown-op');
  assert.match(parsed.unknowns[0].hint, /获得/);

  const relation = ilb.parse('[[ILB:关系:艾琳/信任+2]]').facts[0];
  assert.deepEqual(relation, { type: 'relation', name: '艾琳', dir: '信任', sign: 1, amount: 2 });
});

test('解析：剥标记不破坏正文，也不吃掉换行', () => {
  const text = '第一行 [[ILB:获得:铜钥匙]]\n第二行';
  assert.equal(ilb.strip(text), '第一行\n第二行');
});

test('重放：改一条消息的正文，之后的状态跟着变（不需要版本号）', () => {
  const before = ['[[ILB:获得:铜钥匙]]', '你继续走。', '[[ILB:获得:铁钥匙]]'];
  const after = ['[[ILB:获得:铜钥匙]]', '你继续走。', '[[ILB:获得:药水]]'];

  const a = ilb.fold(before);
  const b = ilb.fold(after);
  assert.deepEqual(a.state.vars.背包, ['铜钥匙', '铁钥匙']);
  assert.deepEqual(b.state.vars.背包, ['铜钥匙', '药水']);

  // 第 0 条之后的状态与后面无关：增删消息不会污染它
  assert.deepEqual(ilb.stateAt(before, 0).state.vars.背包, ['铜钥匙']);
  assert.deepEqual(ilb.stateAt(before, 5).state.vars.背包, ['铜钥匙', '铁钥匙']);
});

test('重放：界面补记（manual）和 AI 标记走同一条路', () => {
  const entries = [{ text: '你捡起钥匙。' }, { text: '继续。', manual: [gain('铁钥匙')] }];
  const folded = ilb.fold(entries);
  assert.deepEqual(folded.state.vars.背包, ['铁钥匙']);
});

test('重放：夹带的错标记不会静默消失，会进 unknowns 并带消息序号', () => {
  const folded = ilb.fold(['[[ILB:拿走:铜钥匙]]']);
  assert.equal(folded.unknowns.length, 1);
  assert.equal(folded.unknowns[0].index, 0);
});

test('注入渲染：带容量现状，且预算不足时明说还有多少没显示', () => {
  let state = ilb.initial();
  for (const name of ['铜钥匙', '铁钥匙', '药水']) state = ilb.apply(state, gain(name)).state;
  const prompt = ilb.render(state);
  assert.match(prompt, /背包（3\/8，重 4）：/);
  assert.match(prompt, /重 4/);
  assert.match(prompt, /生命：90/);

  const tight = ilb.render(state, { budgetChars: 6 });
  assert.match(tight, /另有 \d+ 项状态未显示/);
});

test('编译期：引用不存在的变量、写错的 op 会被提前报出来', () => {
  const broken = createNarrative({
    schema: { vars: [{ name: '背包', type: 'list' }] },
    rules: [
      { id: 'r1', on: 'gain', effects: [{ op: 'add', var: '不存在的容器', value: '$name' }] },
      { id: 'r2', on: 'gain', effects: [{ op: '喝掉', var: '背包' }] },
      { id: 'r3', on: 'teleport', effects: [{ op: 'set', var: '背包', value: [] }] },
    ],
  });
  const codes = broken.problems.map((p) => p.code);
  assert.ok(codes.includes('effect-unknown-var'));
  assert.ok(codes.includes('bad-effect-op'));
  assert.ok(codes.includes('bad-rule-on'));
});

test('没有规则认领的事实：不改变状态，但会被标出来（上层负责显示）', () => {
  const r = ilb.apply(ilb.initial(), gain('石头'));
  assert.equal(r.ok, true);
  assert.equal(r.unhandled, true);
  assert.deepEqual(r.state.vars.背包, [], '没有规则就不该动状态');
});
