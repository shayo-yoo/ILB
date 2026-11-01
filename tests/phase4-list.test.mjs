// tests/phase4-list.test.mjs —— Phase 4 第二批：列表变量、按列表循环、分支选择（v0.19.0）
//
// 这三件事都容易"看起来跑了、其实什么都没发生"：
// - 列表没建好，循环体一次没跑，却当作成功；
// - 分支一条都没命中，却把「否则」忘了；
// - 当前项变量跑完没有还原，污染后面的步骤。
// 所以断言重点是"出错要看得见"和"跑完不留垃圾"。

import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateFlow, normalizeFlow, countFlowNodes } from '../core/flow.js';
import { validateFlow } from '../core/validate.js';

const flowOf = (nodes) => normalizeFlow({ mode: 'flow', nodes });

test('列表：按分隔符拆开、去掉空白项，再按列表循环', () => {
  const flow = flowOf([
    { kind: 'list', id: 'l1', name: '名单', op: 'set', value: { type: 'text', value: '甲| 乙 |丙||' }, separator: '|' },
    { kind: 'repeat', id: 'r1', mode: 'list', listName: '名单', itemName: '项', body: [
      { kind: 'add', id: 'a1', text: '{{项}}' },
    ] },
  ]);
  const r = evaluateFlow(flow, {});
  assert.equal(r.passed, true);
  assert.deepEqual(r.extra, ['甲', '乙', '丙']);
  assert.equal(r.steps.some((s) => s.passed === false), false, '不该有失败步骤');
});

test('列表：当前项跑完还原，不污染外层同名变量', () => {
  const flow = flowOf([
    { kind: 'list', id: 'l1', name: '名单', op: 'set', value: { type: 'text', value: '甲\n乙' }, separator: '\n' },
    { kind: 'repeat', id: 'r1', mode: 'list', listName: '名单', itemName: '项', body: [
      { kind: 'add', id: 'a1', text: '{{项}}' },
    ] },
  ]);
  const r = evaluateFlow(flow, { vars: { 项: '原来的值' } });
  assert.equal(r.vars.项, '原来的值', '跑完应该还原成原来的值');
});

test('列表：往列表末尾追加，超出上限要写出来', () => {
  const flow = flowOf([
    { kind: 'list', id: 'l1', name: '名单', op: 'set', value: { type: 'text', value: 'a' }, separator: ',' },
    { kind: 'list', id: 'l2', name: '名单', op: 'append', value: { type: 'text', value: 'b,c' }, separator: ',' },
    { kind: 'repeat', id: 'r1', mode: 'list', listName: '名单', itemName: '项', body: [
      { kind: 'add', id: 'a1', text: '{{项}}' },
    ] },
  ]);
  const r = evaluateFlow(flow, {});
  assert.deepEqual(r.extra, ['a', 'b', 'c']);
});

test('列表：超过 50 项只留前 50 项，并且把截断说出来', () => {
  const sixty = Array.from({ length: 60 }, (_, i) => `项${i + 1}`).join(',');
  const flow = flowOf([
    { kind: 'list', id: 'l1', name: '名单', op: 'set', value: { type: 'text', value: sixty }, separator: ',' },
    { kind: 'repeat', id: 'r1', mode: 'list', listName: '名单', itemName: '项', body: [
      { kind: 'add', id: 'a1', text: '{{项}}' },
    ] },
  ]);
  const r = evaluateFlow(flow, {});
  assert.equal(r.extra.length, 50, '循环只该跑 50 次');
  const said = r.steps.map((s) => String(s.reason ?? '')).join(' | ');
  assert.match(said, /原来的 60 项只留前 50 项/, '截断要在步骤里说出来，不能悄悄丢');
});

test('列表：清空之后循环一次也不跑，并且明说是空的', () => {
  const flow = flowOf([
    { kind: 'list', id: 'l1', name: '名单', op: 'set', value: { type: 'text', value: 'a,b' }, separator: ',' },
    { kind: 'list', id: 'l2', name: '名单', op: 'clear', value: { type: 'text', value: '' } },
    { kind: 'repeat', id: 'r1', mode: 'list', listName: '名单', itemName: '项', body: [
      { kind: 'add', id: 'a1', text: '{{项}}' },
    ] },
  ]);
  const r = evaluateFlow(flow, {});
  assert.deepEqual(r.extra, []);
  assert.ok(r.steps.some((s) => /是空的/.test(s.reason)));
});

test('列表循环：变量不是列表时明确失败，不假装跑过', () => {
  const flow = flowOf([
    { kind: 'repeat', id: 'r1', mode: 'list', listName: '不存在', itemName: '项', body: [
      { kind: 'add', id: 'a1', text: '不该出现' },
    ] },
  ]);
  const r = evaluateFlow(flow, {});
  assert.deepEqual(r.extra, []);
  const bad = r.steps.find((s) => s.passed === false);
  assert.ok(bad, '应该有失败步骤');
  assert.match(bad.reason, /还不是列表/);
});

test('分支选择：命中第一条就走它，后面的不再比', () => {
  const flow = flowOf([
    { kind: 'set', id: 's1', name: '结果', op: 'set', value: { type: 'text', value: 'b' } },
    {
      kind: 'switch', id: 'sw1', value: { type: 'var', name: '结果' },
      cases: [
        { id: 'c1', match: { type: 'text', value: 'a' }, body: [{ kind: 'add', id: 'a1', text: '走了 a' }] },
        { id: 'c2', match: { type: 'text', value: 'b' }, body: [{ kind: 'add', id: 'a2', text: '走了 b' }] },
      ],
      else: [{ kind: 'add', id: 'a3', text: '走了否则' }],
    },
  ]);
  const r = evaluateFlow(flow, {});
  assert.deepEqual(r.extra, ['走了 b']);
  assert.ok(r.steps.some((s) => /命中第 2 条分支/.test(s.reason)));
});

test('分支选择：一条都不命中就走「否则」；没写「否则」就什么都不做', () => {
  const withElse = flowOf([
    { kind: 'switch', id: 'sw1', value: { type: 'text', value: 'x' }, cases: [
      { id: 'c1', match: { type: 'text', value: 'a' }, body: [{ kind: 'add', id: 'a1', text: 'a' }] },
    ], else: [{ kind: 'add', id: 'a2', text: '否则' }] },
  ]);
  assert.deepEqual(evaluateFlow(withElse, {}).extra, ['否则']);

  const withoutElse = flowOf([
    { kind: 'switch', id: 'sw1', value: { type: 'text', value: 'x' }, cases: [
      { id: 'c1', match: { type: 'text', value: 'a' }, body: [{ kind: 'add', id: 'a1', text: 'a' }] },
    ], else: [] },
  ]);
  assert.deepEqual(evaluateFlow(withoutElse, {}).extra, []);
});

test('分支选择：数字和文本都能比（两边都能当数字时按数字比）', () => {
  const flow = flowOf([
    { kind: 'set', id: 's1', name: '答案', op: 'set', value: { type: 'number', value: 3 } },
    { kind: 'switch', id: 'sw1', value: { type: 'var', name: '答案' }, cases: [
      { id: 'c1', match: { type: 'text', value: '3' }, body: [{ kind: 'add', id: 'a1', text: '命中' }] },
    ], else: [] },
  ]);
  assert.deepEqual(evaluateFlow(flow, {}).extra, ['命中']);
});

test('分支选择：要比的值算不出来时失败得看得见，不执行任何分支', () => {
  const flow = flowOf([
    { kind: 'switch', id: 'sw1', value: { type: 'expr', value: '不存在的函数(1)' }, cases: [
      { id: 'c1', match: { type: 'text', value: 'a' }, body: [{ kind: 'add', id: 'a1', text: '不该出现' }] },
    ], else: [{ kind: 'add', id: 'a2', text: '也不该出现' }] },
  ]);
  const r = evaluateFlow(flow, {});
  assert.deepEqual(r.extra, []);
  const bad = r.steps.find((s) => s.passed === false);
  assert.ok(bad, '应该有失败步骤');
  assert.match(bad.reason, /算不出来/);
});

test('老数据：重复没有 mode 时按次数；分支选择没有 cases 时补一条空的', () => {
  const flow = normalizeFlow({ mode: 'flow', nodes: [
    { kind: 'repeat', id: 'r1', times: 2, body: [] },
    { kind: 'switch', id: 'sw1', value: { type: 'text', value: 'x' } },
    { kind: 'list', id: 'l1', name: '名单' },
  ] });
  assert.equal(flow.nodes[0].mode, 'times');
  assert.equal(flow.nodes[1].cases.length, 1);
  assert.equal(flow.nodes[1].else.length, 0);
  assert.equal(flow.nodes[2].separator, '\n');
  assert.equal(countFlowNodes(flow.nodes), 3);
});

test('验证器：列表与分支选择的常见写错都能查出来', () => {
  const flow = flowOf([
    { kind: 'repeat', id: 'r1', mode: 'list', listName: '', itemName: '', body: [{ kind: 'add', id: 'a1', text: 'x' }] },
    { kind: 'repeat', id: 'r2', mode: 'list', listName: '没建过', itemName: '项', body: [{ kind: 'add', id: 'a2', text: 'x' }] },
    { kind: 'switch', id: 'sw1', value: { type: 'var', name: '结果' }, cases: [
      { id: 'c1', match: { type: 'text', value: '' }, body: [] },
    ], else: [] },
    { kind: 'list', id: 'l1', name: '', op: 'set', value: { type: 'text', value: '' }, separator: '' },
  ]);
  const codes = validateFlow(flow, {}).problems.map((p) => p.code);
  assert.ok(codes.includes('no-list'), '列表循环缺列表名');
  assert.ok(codes.includes('undefined-list'), '引用了没建过的列表');
  assert.ok(codes.includes('no-list-item'), '缺当前项变量名');
  assert.ok(codes.includes('empty-case'), '空分支');
  assert.ok(codes.includes('no-switch-else'), '没写否则');
  assert.ok(codes.includes('no-target'), '列表没有名字');
  assert.ok(codes.includes('empty-separator'), '空分隔符');
});
