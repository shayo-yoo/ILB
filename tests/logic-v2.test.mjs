// tests/logic-v2.test.mjs —— 随机数节点与元触发器（ILB-4.19 / ILB-4.20）
import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateFlow, normalizeFlow } from '../core/flow.js';
import { evaluate } from '../core/evaluate.js';
import { normalizeBook, normalizeTrigger } from '../core/model.js';

function flowOf(nodes) {
  return normalizeFlow({ nodes });
}

function runFlow(flow, seed) {
  return evaluateFlow(flow, {
    text: '',
    messages: [],
    userInput: '',
    messageCount: 1,
    seed,
    vars: {},
    writes: {},
    activated: [],
    extra: [],
    activations: [],
  });
}

test('随机数：同一楼层（同种子）重放结果一样，换楼层才换', () => {
  const flow = flowOf([{ kind: 'random', target: '骰子', min: 1, max: 6 }]);
  const a = runFlow(flow, 'chat:3:node');
  const b = runFlow(flow, 'chat:3:node');
  assert.equal(a.vars['骰子'], b.vars['骰子']);
  assert.equal(a.writes['骰子'], b.writes['骰子']);
  const values = new Set();
  for (let i = 1; i <= 40; i += 1) values.add(runFlow(flow, `chat:${i}:node`).vars['骰子']);
  assert.ok(values.size > 1, '换楼层应该能掷出不同的数');
});

test('随机数：落在范围内，整数/小数两种都对', () => {
  const intFlow = flowOf([{ kind: 'random', target: 'n', min: 3, max: 5 }]);
  const floatFlow = flowOf([{ kind: 'random', target: 'f', min: 0, max: 1, integer: false }]);
  for (let i = 0; i < 30; i += 1) {
    const n = runFlow(intFlow, `s${i}`).vars.n;
    assert.ok(Number.isInteger(n) && n >= 3 && n <= 5, `整数应在 3–5：${n}`);
    const f = runFlow(floatFlow, `s${i}`).vars.f;
    assert.ok(f >= 0 && f <= 1, `小数应在 0–1：${f}`);
  }
});

test('随机数：不勾“存进聊天”就只是本轮临时值', () => {
  const flow = flowOf([{ kind: 'random', target: 'n', min: 1, max: 6, persist: false }]);
  const r = runFlow(flow, 's');
  assert.equal(r.writes.n, undefined);
  assert.ok(typeof r.vars.n === 'number');
});

test('元触发器：always 不看触发词，每轮都跑', () => {
  const book = normalizeBook({
    book_id: 'm',
    name: '书',
    entries: [],
    logic: [{ name: '初始化', trigger: { meta: 'always' }, flow: { nodes: [{ kind: 'add', text: '初始化了一次。' }] } }],
  });
  const r = evaluate({ messages: [{ is_user: true, content: '你好' }] }, { pool: book.entries, logics: book.logic });
  assert.equal(r.activated.length, 1);
  assert.match(r.activated[0].content, /初始化了一次/);
});

test('元触发器：on_ai 只在最后一条是 AI 回复时跑，on_user 在用户发言时跑', () => {
  const book = normalizeBook({
    book_id: 'm2',
    name: '书',
    entries: [],
    logic: [
      { name: 'AI 后', trigger: { meta: 'on_ai' }, flow: { nodes: [{ kind: 'add', text: 'AI 之后。' }] } },
      { name: '用户后', trigger: { meta: 'on_user' }, flow: { nodes: [{ kind: 'add', text: '用户之后。' }] } },
    ],
  });
  const userTurn = evaluate({ messages: [{ is_user: true, content: '我说话' }] }, { pool: book.entries, logics: book.logic });
  assert.ok(userTurn.activated.every((a) => !/AI 之后/.test(a.content)));

  const aiTurn = evaluate(
    { messages: [{ is_user: true, content: '我说话' }, { is_user: false, content: '角色说话' }] },
    { pool: book.entries, logics: book.logic },
  );
  assert.ok(aiTurn.activated.some((a) => /AI 之后/.test(a.content)));
  assert.ok(aiTurn.activated.every((a) => !/用户之后/.test(a.content)));

  const regen = evaluate({ messages: [{ is_user: true, content: '我说话' }], userInput: '我说话' }, { pool: book.entries, logics: book.logic });
  assert.ok(regen.activated.some((a) => /用户之后/.test(a.content)));
});

test('元触发器：写错的值回落到 none，老规则行为不变', () => {
  assert.equal(normalizeTrigger({ meta: 'nonsense' }).meta, 'none');
  assert.equal(normalizeTrigger({}).meta, 'none');
  assert.equal(normalizeTrigger({ meta: 'on_ai' }).meta, 'on_ai');
});
