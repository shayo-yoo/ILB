// tests/expr.test.mjs —— 表达式与文本模板（ILB-4.22）
// 这里只测纯函数：不读宿主、不碰 DOM。真酒馆里的观感要另外做人工验收。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  EXPR_LIMIT,
  evalExpression,
  expressionVars,
  formatNumber,
  interpolate,
  parseExpression,
  templateVars,
  tokenize,
} from '../core/expr.js';

test('四则运算按优先级算', () => {
  assert.equal(evalExpression('1+2*3').value, 7);
  assert.equal(evalExpression('(1+2)*3').value, 9);
  assert.equal(evalExpression('10 - 4 / 2').value, 8);
  assert.equal(evalExpression('7 % 4').value, 3);
});

test('正负号与括号', () => {
  assert.equal(evalExpression('-3 + 10').value, 7);
  assert.equal(evalExpression('--3').value, 3);
  assert.equal(evalExpression('2 * (3 + (4 - 1))').value, 12);
});

test('白名单函数', () => {
  assert.equal(evalExpression('min(5, 3, 9)').value, 3);
  assert.equal(evalExpression('max(5, 3)').value, 5);
  assert.equal(evalExpression('round(3.14159, 2)').value, 3.14);
  assert.equal(evalExpression('floor(3.9)').value, 3);
  assert.equal(evalExpression('ceil(3.1)').value, 4);
  assert.equal(evalExpression('abs(-4)').value, 4);
  assert.equal(evalExpression('clamp(20, 0, 10)').value, 10);
});

test('变量参与计算，中文变量名也认', () => {
  const vars = { 金币: 5, 等级: 2 };
  assert.equal(evalExpression('金币 + 10', vars).value, 15);
  assert.equal(evalExpression('min(金币, 99)', vars).value, 5);
  assert.equal(evalExpression('金币 * 等级', vars).value, 10);
});

test('变量不存在时如实报错，不悄悄变成 0', () => {
  const result = evalExpression('金币 + 10', {});
  assert.equal(result.ok, false);
  assert.match(result.error, /没有这个变量：金币/);
  assert.deepEqual(result.missing, ['金币']);
});

test('变量不是数字时也如实报错', () => {
  const result = evalExpression('金币 + 1', { 金币: '很多' });
  assert.equal(result.ok, false);
  assert.match(result.error, /不是数字/);
});

test('除以 0 报错而不是给 Infinity', () => {
  const result = evalExpression('1 / 0');
  assert.equal(result.ok, false);
  assert.match(result.error, /除数是 0/);
});

test('写错的表达式给一句人话，不抛异常', () => {
  assert.match(evalExpression('1 +').error, /没写完|不该出现/);
  assert.match(evalExpression('(1 + 2').error, /括号没关/);
  assert.match(evalExpression('1 + 2)').error, /多余/);
  assert.match(evalExpression('foo(1)').error, /没有这个函数/);
  assert.match(evalExpression('1 @ 2').error, /看不懂的字符/);
  assert.match(evalExpression('abs(1, 2)').error, /参数/);
});

test('太长的表达式被挡住（防止把整段正文粘进来）', () => {
  const long = '1+'.repeat(EXPR_LIMIT.length);
  const result = tokenize(long);
  assert.equal(result.ok, false);
  assert.match(result.error, /太长/);
});

test('expressionVars 列出用到的变量，去重且保持顺序', () => {
  assert.deepEqual(expressionVars('金币 + 金币 * 等级'), ['金币', '等级']);
  assert.deepEqual(expressionVars('1 + 2'), []);
});

test('嵌套太深被挡住', () => {
  const deep = `${'('.repeat(EXPR_LIMIT.depth + 2)}1${')'.repeat(EXPR_LIMIT.depth + 2)}`;
  const result = parseExpression(deep);
  assert.equal(result.ok, false);
  assert.match(result.error, /太深/);
});

test('文本模板把 {{表达式}} 换成值', () => {
  const out = interpolate('你当前有 {{金币}} 枚金币，等级为 {{等级 + 1}}。', { 金币: 12, 等级: 2 });
  assert.equal(out.text, '你当前有 12 枚金币，等级为 3。');
  assert.deepEqual(out.missing, []);
});

test('模板里缺变量时留醒目标记，并说出缺了谁', () => {
  const out = interpolate('你还有 {{金币}} 枚', {});
  assert.equal(out.text, '你还有 ⟨未定义:金币⟩ 枚');
  assert.deepEqual(out.missing, ['金币']);
});

test('模板里写错的表达式也留标记，并记下错误', () => {
  const out = interpolate('结果：{{1 +}}', {});
  assert.match(out.text, /⟨未定义:1 \+⟩/);
  assert.equal(out.errors.length, 1);
});

test('兼容老写法 {{ILB:chat.金币}}', () => {
  const out = interpolate('{{ILB:chat.金币}} 枚', { 金币: 3 });
  assert.equal(out.text, '3 枚');
  const empty = interpolate('{{ILB:chat.金币}}', {});
  assert.equal(empty.text, '⟨未定义:chat.金币⟩');
});

test('模板里的开关与小数显示成人话', () => {
  assert.equal(interpolate('{{开关}}', { 开关: true }).text, '开');
  assert.equal(interpolate('{{比率}}', { 比率: 0.5 }).text, '0.5');
});

test('空模板与没有宏的文本原样返回', () => {
  assert.equal(interpolate('', {}).text, '');
  assert.equal(interpolate('普通一句话', {}).text, '普通一句话');
  assert.equal(interpolate('{{}}', {}).text, '{{}}');
});

test('formatNumber 不显示多余的小数位', () => {
  assert.equal(formatNumber(3), '3');
  assert.equal(formatNumber(3.14159265), '3.1416');
  assert.equal(formatNumber('x'), '');
});

test('templateVars 列出模板里用到的变量', () => {
  assert.deepEqual(templateVars('{{金币}} 与 {{等级 + 1}}'), ['金币', '等级']);
  assert.deepEqual(templateVars('{{ILB:chat.金币}}'), ['金币']);
});

test('这个文件里没有 eval / new Function（硬性约束）', () => {
  const source = readFileSync(new URL('../core/expr.js', import.meta.url), 'utf8');
  assert.equal(/[^.\w]eval\s*\(/.test(source), false);
  assert.equal(/new\s+Function\s*\(/.test(source), false);
});
