// tests/gacha-demo.mjs —— "抽卡"验收场景（v0.8.1，对应 docs/开发规划-现阶段.md §2）
//
// 它不是单元测试，而是一段可以直接读的"假聊天"：不连模型、不开界面，
// 只证明三件事能连起来：
//   1. 条目声明的字段（抽卡次数）能当变量用；
//   2. 流程图能改它（计算 + 存进聊天）；
//   3. 「激活条目」能按条件带出下一层（卡池 → 金卡/普通卡）。
//
// 跑法：node tests/gacha-demo.mjs

import { evaluate } from '../core/evaluate.js';
import { normalizeBook } from '../core/model.js';

const book = normalizeBook({
  schema_version: 2,
  book_id: 'G',
  name: '抽卡示例',
  activation: { mode: 'always', characters: [], manual: true },
  pool: { share: false },
  entries: [
    {
      id: '1',
      title: '抽卡',
      content: '你抽了一次。',
      trigger: { any: ['抽卡'] },
      fields: [{ key: '抽卡次数', label: '剩余次数', type: 'number', value: 3, min: 0, max: 99 }],
      logic: {
        nodes: [
          {
            kind: 'compare',
            left: { type: 'var', name: '抽卡次数' },
            op: '>',
            right: { type: 'number', value: 0 },
            then: [
              {
                kind: 'calc',
                target: '抽卡次数',
                op: '-',
                left: { type: 'var', name: '抽卡次数' },
                right: { type: 'number', value: 1 },
                persist: true,
              },
              { kind: 'activate', entryId: 'G::2' },
            ],
            else: [{ kind: 'add', text: '次数不够了。' }],
          },
        ],
      },
    },
    {
      id: '2',
      title: '卡池',
      content: '卡池里常年两种光：金的、白的。',
      logic: {
        nodes: [
          {
            kind: 'compare',
            left: { type: 'var', name: '幸运' },
            op: '>=',
            right: { type: 'number', value: 80 },
            then: [{ kind: 'activate', entryId: 'G::3' }],
            else: [{ kind: 'activate', entryId: 'G::4' }],
          },
        ],
      },
    },
    { id: '3', title: '金卡', content: '【金光】金卡。' },
    { id: '4', title: '普通卡', content: '【白卡】普通卡。' },
  ],
});

function play(vars, input = '抽卡') {
  const result = evaluate(
    { messages: [{ role: 'user', content: input }], userInput: input, scanDepth: 3, vars },
    { books: [book], context: {}, settings: {} },
  );
  const titles = result.activated.map((a) => book.entries.find((e) => e.id === a.entryId)?.title ?? a.entryId);
  const text = result.activated.map((a) => a.content).join(' / ');
  return { titles, writes: result.varWrites, text };
}

function show(label, vars, input = '抽卡') {
  const out = play(vars, input);
  console.log(`\n== ${label}（${input}）==`);
  console.log('出现的条目：', out.titles.join(' → ') || '（无）');
  console.log('写回的变量：', JSON.stringify(out.writes));
  console.log('提示词里能看到：', out.text.replace(/\s+/g, ' ').slice(0, 80) + '…');
}

show('第一次抽，幸运 85', { 幸运: 85 });
show('第二次抽，次数只剩 1', { 幸运: 85, 抽卡次数: 1 });
show('次数用完', { 幸运: 85, 抽卡次数: 0 });
show('不幸的人', { 幸运: 10, 抽卡次数: 3 });

console.log('\n说明：字段「抽卡次数」没设置时按默认 3；「幸运」是玩家/别的条目写进去的。');
console.log('这一轮结束后，pipeline 会把 writes 里的值（抽卡次数）落盘，下一轮判定读到的就是新值。');
