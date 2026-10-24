// tests/narrative-plan.test.mjs —— 叙事引擎"接入层"的纯计算部分（不碰 DOM、不碰 SillyTavern）。
//
// narrative/adapter.js 里凡是能出错的逻辑（重放、每消息一块、注入文本、设置读取）
// 都下沉到了 narrative/plan.js 与 narrative/store.js，这里直接测它们。
// 浏览器那一侧（真 DOM、真点击、注入调用）由 tests/narrative-probe.html 负责。
//
// 验收要点：一条事实要么整条成功、要么整条被拒并给出原因；拒绝/看不懂/未认领
// 三类失败都必须出现在消息块里（失败必须出声，ILB-6.15）。

import test from 'node:test';
import assert from 'node:assert/strict';

import { createNarrative } from '../narrative/index.js';
import { PRESET } from '../narrative/preset.js';
import { composePrompt, planLedger, replay } from '../narrative/plan.js';
import { createCheckpointStore } from '../narrative/checkpoint.js';
import { NARRATIVE_DEFAULTS, describeDeclaration, readNarrativeSettings } from '../narrative/store.js';

const narrative = createNarrative(PRESET);

// 一段对话：正常获得、负重超限、未认领的事实、认不出的标记、没有标记的旁白
const ENTRIES = [
  '旁白：你们在地窖里停下。',
  '[[ILB:获得:铜钥匙]] [[ILB:获得:铁钥匙]]',
  '[[ILB:获得:重甲]]',
  '[[ILB:获得:药水]]',
  '[[ILB:获得:圣剑]]',
  '[[ILB:获得:神秘符文]]',
  '[[ILB:拿到:神秘符文]]',
  '旁白：铁门在身后合上。',
];

test('设置：默认关闭、预算 600、用内置声明', () => {
  const s = readNarrativeSettings({});
  assert.equal(s.enabled, false);
  assert.equal(s.inject, true);
  assert.equal(s.budget, NARRATIVE_DEFAULTS.narrativeBudget);
  assert.equal(s.declaration, PRESET);
  assert.equal(s.usingPreset, true);
});

test('设置：预算越界被夹住，自定义声明被采用', () => {
  assert.equal(readNarrativeSettings({ narrativeBudget: 5 }).budget, 120);
  assert.equal(readNarrativeSettings({ narrativeBudget: 99999 }).budget, 2000);
  const custom = { schema: { vars: [] }, catalog: { entities: [] }, rules: [] };
  const s = readNarrativeSettings({ narrativeDeclaration: custom });
  assert.equal(s.declaration, custom);
  assert.equal(s.usingPreset, false);
});

test('重放：每条消息之后的状态与 engine.fold 的最终状态一致', () => {
  const { state } = replay(narrative, ENTRIES);
  const folded = narrative.fold(ENTRIES);
  assert.deepEqual(state.vars, folded.state.vars);
});

test('重放：背包只收下放得下的东西（负重整条拒绝）', () => {
  const { state } = replay(narrative, ENTRIES);
  assert.deepEqual(state.vars['背包'], ['铜钥匙', '铁钥匙', '重甲', '药水']);
  const plan = planLedger(narrative, ENTRIES);
  // 铜钥匙、铁钥匙、重甲、药水、圣剑、神秘符文：六条事实里只有圣剑被拒
  assert.equal(plan.totals.facts, 6);
  assert.equal(plan.totals.rejected, 1);
});

test('消息块：每条有事的消息一块，拒绝原因与未知标记都写出来', () => {
  const plan = planLedger(narrative, ENTRIES);
  const at = (index) => plan.blocks.find((block) => block.index === index);

  assert.ok(at(1), '第 2 条消息（索引 1）应该有块');
  assert.equal(at(1).items.length, 2);
  assert.equal(at(1).items[0].kind, 'ok');

  const rejected = at(4);
  assert.ok(rejected, '负重超限的那条应该有块');
  assert.equal(rejected.items[0].kind, 'bad');
  assert.match(rejected.items[0].reason, /总重量|超过/);

  const unhandled = at(5);
  assert.equal(unhandled.items[0].kind, 'unknown');
  assert.match(unhandled.items[0].text, /未认领/);

  const unknown = at(6);
  assert.match(unknown.items[0].text, /看不懂/);
  assert.match(unknown.items[0].reason, /认不出/);

  // 纯旁白不产生块（聊天区不能每一条都多出一块）
  assert.equal(at(0), undefined);
  assert.equal(at(7), undefined);
});

test('消息块的摘要是人话，且不是空串', () => {
  const plan = planLedger(narrative, ENTRIES);
  for (const block of plan.blocks) {
    assert.equal(typeof block.summary, 'string');
    assert.ok(block.summary.length > 0);
  }
});

test('注入文本：带约束现状、带用法说明；关掉开关才不注入', () => {
  const plan = planLedger(narrative, ENTRIES);
  assert.match(plan.prompt, /【账本】/);
  assert.match(plan.prompt, /背包（/);
  assert.match(plan.prompt, /\[\[ILB:获得/);
  assert.match(plan.prompt, /最多 3 条/);

  // 只有旁白：没有事实就不该有块；注入仍然要有——模型得先看见"背包 0/8"这种约束现状，
  // 才不会在第一轮就写出"掏出一把没捡过的剑"。
  const quiet = planLedger(narrative, ['旁白一', '旁白二']);
  assert.equal(quiet.blocks.length, 0);
  assert.match(quiet.prompt, /背包（0\/8）/);

  // 关掉注入开关：文本为空，但块仍然要画
  const noInject = planLedger(narrative, ENTRIES, { inject: false });
  assert.equal(noInject.prompt, '');
  assert.ok(noInject.blocks.length > 0);
});

test('注入文本受预算约束，超了会明说"另有 N 项"', () => {
  const narrow = composePrompt({
    narrative,
    state: narrative.fold(ENTRIES).state,
    messageCount: ENTRIES.length,
    budget: 40,
  });
  assert.ok(narrow.length <= 1600);
  assert.match(narrow, /另有 \d+ 项状态未显示|（账本过长，已截断）/);
});

test('声明写错时 describeDeclaration 报出来，不静默', () => {
  const bad = describeDeclaration({
    schema: { vars: [{ name: '背包', type: 'list', constraints: [{ kind: 'max', value: 3 }] }] },
    rules: [{ id: '写错的规则', on: '不存在的事实', effects: [{ op: '不存在', var: '背包' }] }],
  });
  assert.equal(bad.ok, true);
  assert.ok(bad.problems.length >= 2);
  assert.match(bad.problemText, /bad-rule-on|bad-effect-op/);
});

test('声明能导出成 JSON 再读回来（设置页的「编辑声明」靠这个）', () => {
  const parsed = JSON.parse(JSON.stringify(PRESET, null, 2));
  const info = describeDeclaration(parsed);
  assert.equal(info.ok, true);
  assert.equal(info.problems.length, 0);
  assert.ok(info.variables > 0);
  assert.ok(info.rules > 0);
});

test('重放缓存：前缀没变就复用，改了哪条就从哪条重算，删消息会剪掉尾巴', () => {
  const first = replay(narrative, ENTRIES);
  const second = replay(narrative, ENTRIES, first.cache);
  assert.equal(second.rows[0], first.rows[0], '前缀行应复用（同一个对象）');
  assert.deepEqual(second.state.vars, first.state.vars);

  const edited = [...ENTRIES];
  edited[2] = '[[ILB:获得:药水]]';
  const third = replay(narrative, edited, second.cache);
  assert.equal(third.rows[0], first.rows[0], '第 1 条没变，应复用');
  assert.notEqual(third.rows[2], first.rows[2], '第 3 条变了，必须重算');
  assert.notDeepEqual(third.state.vars['背包'], first.state.vars['背包']);

  const shorter = replay(narrative, ENTRIES.slice(0, 2), third.cache);
  assert.equal(shorter.rows.length, 2);
  assert.equal(shorter.cache.rows.length, 2, '消息变短时缓存尾巴要被剪掉');
});

test('状态摘要把空的容器略掉，但保留有上限的背包', () => {
  const summary = narrative.summary(narrative.initial());
  assert.match(summary, /背包（0\/8）/);
  assert.doesNotMatch(summary, /关系/);
});

test('自定义事件与动词别名：非 RPG 玩法不用改核心', () => {
  const custom = createNarrative({
    schema: { vars: [{ name: '灵力', type: 'number', init: 0 }] },
    events: [{ id: '突破', label: '突破境界' }],
    verbs: { 拾取: '获得' },
    rules: [
      { id: '突破成功', on: 'event', when: { event: '突破', name: '筑基' }, effects: [{ op: 'inc', var: '灵力', amount: 10 }] },
    ],
  });
  assert.deepEqual(custom.problems, []);
  const parsed = custom.parse('[[ILB:突破:筑基]] [[ILB:拾取:灵石]]');
  assert.equal(parsed.facts.length, 2);
  assert.deepEqual(parsed.facts[0], { type: 'event', event: '突破', name: '筑基', count: 1 });
  assert.equal(parsed.facts[1].type, 'gain', '别名应归一到内置动词');

  const applied = custom.apply(custom.initial(), parsed.facts[0]);
  assert.equal(applied.ok, true);
  assert.equal(applied.state.vars['灵力'], 10);

  const unknown = custom.apply(custom.initial(), { type: 'event', event: '突破', name: '金丹' });
  assert.equal(unknown.unhandled, true, '没匹配到规则的自定义事件应标为未认领');
});

test('规则引用不存在的自定义事件会在编译期报错', () => {
  const bad = createNarrative({
    schema: { vars: [{ name: '灵力', type: 'number', init: 0 }] },
    events: [],
    rules: [{ on: 'event', when: { event: '不存在' }, effects: [{ op: 'inc', var: '灵力', amount: 1 }] }],
  });
  assert.ok(bad.problems.some((p) => p.code === 'unknown-event'));
});

test('检查点：存/取/声明不匹配/清理', () => {
  const memory = {};
  const repository = {
    getSettings: () => ({ narrativeCheckpoints: memory }),
    saveSettings: (patch) => Object.assign(memory, patch.narrativeCheckpoints ?? {}),
  };
  // 上面的 saveSettings 语义与真实实现不同（真实实现是替换整个 map），这里直接模拟替换
  const store = createCheckpointStore({ repository: {
    getSettings: () => ({ narrativeCheckpoints: memory }),
    saveSettings: (patch) => {
      for (const key of Object.keys(memory)) delete memory[key];
      Object.assign(memory, patch.narrativeCheckpoints ?? {});
    },
  } });

  const rows = replay(narrative, ENTRIES).rows;
  const totals = { messages: 2, facts: 2, ok: 2, rejected: 0, unhandled: 0, unknown: 0 };
  store.save('chat:1', 'decl-a', 2, rows[1].state, totals);

  const loaded = store.load('chat:1', 'decl-a');
  assert.equal(loaded.upto, 2);
  assert.deepEqual(loaded.state.vars, rows[1].state.vars);
  assert.deepEqual(loaded.totals, totals);
  assert.equal(store.load('chat:1', 'decl-b'), null, '声明变了就不能用旧检查点');

  store.clear('chat:1');
  assert.equal(store.load('chat:1', 'decl-a'), null);
});

test('从检查点续算与全量重放结果一致，并带上"本轮变化"', () => {
  const full = planLedger(narrative, ENTRIES);
  const rows = replay(narrative, ENTRIES).rows;
  const tail = planLedger(narrative, ENTRIES, {
    initial: rows[1].state,
    startIndex: 2,
    baseTotals: { messages: 2, facts: 2, ok: 2, rejected: 0, unhandled: 0, unknown: 0 },
  });
  assert.deepEqual(tail.state.vars, full.state.vars, '检查点续算必须等于全量重放');
  assert.equal(tail.startIndex, 2);
  assert.ok(tail.blocks.every((block) => block.index >= 2), '检查点之前不再画块');

  const withChange = planLedger(narrative, ['旁白', '[[ILB:获得:铜钥匙]]']);
  assert.ok(withChange.deltaLines.some((line) => line.includes('背包')), `应给出本轮变化：${withChange.deltaLines.join(' / ')}`);
  assert.match(withChange.prompt, /本轮变化/);
});
