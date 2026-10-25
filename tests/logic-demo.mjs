// tests/logic-demo.mjs —— 三期验收演示（v0.9.0）：逻辑不靠条目也能跑，AI 能调用它
//
// 跑法：node tests/logic-demo.mjs
// 它不连模型、不开界面，只证明：
//   1. 一本"只有逻辑、没有条目"的书，照样能被触发词叫起来；
//   2. 逻辑能改聊天变量（存进聊天），并出正文注入；
//   3. 设置里打开 AI 调用后，AI 正文里的 [[ILB:名字(参数)]] 会真的执行；
//   4. 没开放给 AI 的名字会被拒绝，而且在调用记录里看得见。

import { evaluate } from '../core/evaluate.js';
import { normalizeBook } from '../core/model.js';

const book = normalizeBook({
  schema_version: 2,
  book_id: 'L',
  name: '逻辑示例',
  activation: { mode: 'always', characters: [], manual: true },
  pool: { share: false },
  entries: [],
  logic: [
    {
      localId: 'counter',
      name: '记一笔',
      enabled: true,
      trigger: { any: ['记账'], source: 'both' },
      flow: {
        nodes: [
          {
            kind: 'compare',
            left: { type: 'var', name: '余额' },
            op: '>=',
            right: { type: 'number', value: 0 },
            then: [
              { kind: 'add', text: '账本上多了一笔。' },
            ],
          },
        ],
      },
      output: { text: '', position: 'in_chat', depth: 0, role: 'system', weight: 100 },
      call: { exposed: false, params: [] },
    },
    {
      localId: 'pay',
      name: '扣款',
      enabled: true,
      trigger: { any: [], source: 'both' },
      flow: {
        nodes: [
          {
            kind: 'calc',
            target: '余额',
            op: '-',
            left: { type: 'var', name: '余额' },
            right: { type: 'var', name: '数量' },
            persist: true,
          },
          { kind: 'add', text: '钱付了。' },
        ],
      },
      output: { text: '', position: 'in_chat', depth: 0, role: 'system', weight: 100 },
      call: { exposed: true, params: ['数量'] },
    },
  ],
});

function run({ label, messages, vars, settings = {} }) {
  const result = evaluate(
    {
      messages,
      userInput: messages[messages.length - 1]?.content ?? '',
      scanDepth: 5,
      vars,
    },
    {
      books: [book],
      logics: book.logic,
      context: {},
      settings: { logicEnabled: true, aiCallsEnabled: true, aiCallScan: 3, aiCallMaxPerTurn: 3, ...settings },
    },
  );
  console.log(`\n== ${label} ==`);
  console.log('注入的内容：', result.activated.map((a) => a.content).filter(Boolean).join(' / ') || '（无正文）');
  const writes = { ...result.varWrites };
  delete writes.__ilbCallsSeen; // 内部账本，演示里不占地方
  console.log('写回的变量：', JSON.stringify(writes));
  console.log('AI 调用记录：', result.aiCalls.length ? JSON.stringify(result.aiCalls) : '（无）');
  const calls = result.diagnostics.filter((d) => d.stage === 'call');
  if (calls.length) console.log('被拒绝的调用：', calls.map((d) => d.reason).join('；'));
  return result;
}

run({
  label: '只说一句话，没有条目参与',
  messages: [{ role: 'user', content: '我要记账' }],
  vars: { 余额: 10 },
});

run({
  label: 'AI 正文里调用「扣款(3)」',
  messages: [
    { role: 'user', content: '买杯咖啡' },
    { role: 'assistant', content: '好，这杯算我的。[[ILB:扣款(3)]]' },
  ],
  vars: { 余额: 10, 数量: 0 },
});

run({
  label: 'AI 想调用没开放的名字',
  messages: [{ role: 'assistant', content: '[[ILB:记一笔]]' }],
  vars: { 余额: 10 },
});

run({
  label: '设置里关掉 AI 调用（默认就是这个状态）',
  messages: [{ role: 'assistant', content: '[[ILB:扣款(3)]]' }],
  vars: { 余额: 10, 数量: 0 },
  settings: { aiCallsEnabled: false },
});

console.log('\n说明：第一段里没有条目触发（书里根本没有条目），是独立逻辑自己看触发词跑起来的。');
console.log('扣款成功后，pipeline 会把 余额 写回聊天变量；下一轮判定读到的就是新值。');

