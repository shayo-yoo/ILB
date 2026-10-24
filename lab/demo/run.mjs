// lab/demo/run.mjs —— 把一段带标记的对话喂给引擎，看看它怎么记账。
// 用法：node lab/demo/run.mjs
//
// 这个演示只做"事实 → 状态"，不碰 SillyTavern：没有 DOM、没有宿主、没有注入。
// 目的有两个：① 说明"用户只写声明"长什么样；② 把拒绝、看不懂、未认领都摆出来，
// 证明失败是可见的，不是静默吞掉的。

import { createNarrative } from '../narrative/index.js';
import { SPEC } from '../example/spec.js';

const ilb = createNarrative(SPEC);
const say = (line = '') => console.log(line);
const bar = (title) => say(`\n${'─'.repeat(12)} ${title} ${'─'.repeat(12)}`);

if (ilb.problems.length) {
  say('声明本身有问题，先修再来：');
  for (const p of ilb.problems) say(`  · ${p.code} ${p.rule ?? p.id ?? ''} ${p.var ?? ''} ${p.on ?? ''}`);
  process.exitCode = 1;
  process.exit();
}

// 一段模拟对话：AI 只写"发生了什么"，不写数值与机制。
const TRANSCRIPT = [
  '你推开地窖的门，霉味扑面而来。[[ILB:获得:铜钥匙]] [[ILB:地点:王城/地窖]] [[ILB:关系:艾琳/信任+1]]',
  '艾琳把一瓶药水塞进你手里："省着点用。"[[ILB:获得:药水]] [[ILB:关系:艾琳/信任+1]]',
  '你仰头喝下药水，伤口收紧了些。[[ILB:使用:药水]]',
  '你接下了老约翰的委托。[[ILB:使用:接受委托]] 角落里躺着一把剑。[[ILB:获得:圣剑]]',
  '你又捡到一把铁钥匙，还有一枚看不懂的符文。[[ILB:获得:铁钥匙]] [[ILB:拿到:神秘符文]]',
  '你回到酒馆交差。[[ILB:使用:完成委托]]',
];

bar('逐条重放');
const folded = ilb.fold(TRANSCRIPT);

for (const row of folded.log) {
  say(`第 ${row.index + 1} 条消息`);
  for (const item of row.facts) {
    const fact = item.fact;
    const printable = ilb.describeFact(fact);
    if (item.ok && item.unhandled) {
      say(`  ? ${printable} —— 没有规则认领，状态不变`);
      continue;
    }
    if (item.ok) {
      const detail = item.changes.map((c) => `${c.var}：${show(c.before)} → ${show(c.after)}`).join('；');
      say(`  ✓ ${printable}${detail ? `（${detail}）` : ''}`);
      for (const noop of item.noops ?? []) say(`    · ${noop.reason}`);
      continue;
    }
    for (const rejected of item.rejected) say(`  ✗ ${printable} —— ${rejected.reason}`);
  }
  for (const unknown of row.unknowns) say(`  ! 看不懂：${unknown.raw}（${unknown.hint}）`);
}

function show(value) {
  if (Array.isArray(value)) return value.length ? value.join('、') : '空';
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    return keys.length ? keys.map((k) => `${k} ${value[k]}`).join('、') : '空';
  }
  return String(value);
}

bar('背包现状（剩余格与总重量都是算出来的，没有存）');
const derived = ilb.derive(folded.state);
say(`格子：${derived.背包.数量}/${derived.背包.上限}（还剩 ${derived.背包.剩余} 格；${derived.背包.满 ? '已满' : '还能装'}）`);
say(`重量：${derived.背包.总重量}/${derived.背包.重量上限}（${derived.背包.超重 ? '超重' : '没超'}）`);

bar('下一次要注入给 AI 的东西');
say(ilb.render(folded.state));

bar('再把背包塞满会怎样（拒绝必须说清原因）');
let state = folded.state;
for (let i = 0; i < 12 && !ilb.derive(state).背包.满; i += 1) {
  const result = ilb.apply(state, { type: 'gain', name: '铁钥匙', count: 1 });
  if (!result.ok) say(`  ✗ 获得 铁钥匙 —— ${result.rejected.map((r) => r.reason).join('；')}`);
  state = result.state;
}
const overflow = ilb.apply(state, { type: 'gain', name: '药水', count: 1 });
say(overflow.ok ? '  ? 居然塞进去了（演示脚本有问题）' : `  ✗ 获得 药水 —— ${overflow.rejected.map((r) => r.reason).join('；')}`);
say(`  拒绝之后状态没有任何变化：背包仍然 ${ilb.derive(overflow.state).背包.数量} 件`);

bar('同一段对话重放两次，结果一样吗');
const again = ilb.fold(TRANSCRIPT);
say(JSON.stringify(again.state.vars) === JSON.stringify(folded.state.vars) ? '一样（状态是重放出来的，不是被改出来的）' : '不一样（这是 bug）');
