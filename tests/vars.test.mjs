// tests/vars.test.mjs —— 聊天变量与条目宏（v0.8.0）。
// 这些测试只碰纯计算，不碰 DOM、不碰宿主。

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeVars,
  coerceValue,
  readPath,
  displayValue,
  expandMacros,
  macroNames,
  missingMacros,
  resolveChatId,
} from '../core/vars.js';

test('normalizeVars 只收标量，并把 chat 命名空间展开一层', () => {
  const vars = normalizeVars({
    幸运: 3,
    名字: '小明',
    开关: true,
    chat: { 金币: 20, 备注: '别丢' },
    对象: { 深: 1 },
    空: null,
  });
  assert.equal(vars.幸运, 3);
  assert.equal(vars.名字, '小明');
  assert.equal(vars.开关, true);
  assert.equal(vars.金币, 20);
  assert.equal(vars.备注, '别丢');
  assert.equal(vars.对象, undefined);
  assert.equal(vars.空, undefined);
});

test('coerceValue 区分数字、开关与文本', () => {
  assert.equal(coerceValue('3'), 3);
  assert.equal(coerceValue('-1.5'), -1.5);
  assert.equal(coerceValue('true'), true);
  assert.equal(coerceValue('false'), false);
  assert.equal(coerceValue('  '), '');
  assert.equal(coerceValue('三'), '三');
  assert.equal(coerceValue(7), 7);
});

test('readPath 兼容带不带 chat. 前缀', () => {
  const vars = { 幸运: 3 };
  assert.equal(readPath(vars, '幸运'), 3);
  assert.equal(readPath(vars, 'chat.幸运'), 3);
  assert.equal(readPath(vars, '不存在'), undefined);
  assert.equal(readPath(vars, ''), undefined);
});

test('displayValue 把开关显示成人话', () => {
  assert.equal(displayValue(true), '开');
  assert.equal(displayValue(false), '关');
  assert.equal(displayValue(0), '0');
  assert.equal(displayValue('文本'), '文本');
});

test('expandMacros 替换已知值，未知值留下醒目标记', () => {
  const text = '你有 {{ILB:chat.金币}} 金币，{{ILB:幸运}} 点幸运，还欠 {{ILB:欠款}}。';
  const out = expandMacros(text, { vars: { 金币: 20, 幸运: 3 } });
  assert.equal(out, '你有 20 金币，3 点幸运，还欠 ⟨未定义:欠款⟩。');
});

test('expandMacros 对没有宏的文本原样返回', () => {
  const text = '普通正文，没有宏。';
  assert.equal(expandMacros(text, { vars: {} }), text);
});

test('expandMacros 的 onMissing 会收到缺失的名字', () => {
  const seen = [];
  expandMacros('{{ILB:甲}} {{ILB:乙}}', { vars: { 甲: 1 }, onMissing: (name) => seen.push(name) });
  assert.deepEqual(seen, ['乙']);
});

test('macroNames 去重并保持出现顺序', () => {
  assert.deepEqual(macroNames('{{ILB:甲}} {{ILB:乙}} {{ILB:甲}}'), ['甲', '乙']);
});

test('missingMacros 只报真正缺的', () => {
  assert.deepEqual(missingMacros('{{ILB:甲}} {{ILB:乙}}', { 甲: 1 }), ['乙']);
});

test('resolveChatId 从上下文里取聊天标识，取不到就用 default', () => {
  assert.equal(resolveChatId({ chatId: 12 }), '12');
  assert.equal(resolveChatId({ chat_metadata: { chat_id: 'abc' } }), 'abc');
  assert.equal(resolveChatId({}), 'default');
  assert.equal(resolveChatId(null), 'default');
});
