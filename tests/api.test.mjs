// tests/api.test.mjs —— 对外接口契约（ILB-9.1）
import test from 'node:test';
import assert from 'node:assert/strict';

import { createApi, API_VERSION, API_CAPS } from '../runtime/api.js';
import { normalizeBook } from '../core/model.js';

function buildApi({ vars = {}, specs = null } = {}) {
  let state = { ...vars };
  const books = (specs ?? [
    {
      book_id: 'b1',
      name: '测试书',
      enabled: true,
      entries: [],
      logic: [
        { name: '掷骰', trigger: { any: ['掷骰'] }, flow: { nodes: [{ kind: 'random', target: '骰子', min: 1, max: 6, persist: true }] } },
        { name: '停用的', enabled: false, flow: { nodes: [{ kind: 'add', text: '不该跑' }] } },
      ],
    },
  ]).map(normalizeBook);
  const repository = {
    listBooks: () => books,
    getVars: () => ({ ...state }),
    mergeVars: (chatId, patch) => {
      state = { ...state, ...patch };
      return { ...state };
    },
    deleteVar: (chatId, name) => {
      delete state[name];
    },
  };
  const api = createApi({
    repository,
    getContext: () => ({ chat: [1, 2, 3] }),
    getChatId: () => 'chat-1',
  });
  return { api, books, varsNow: () => state };
}

test('接口版本与说明写清楚', () => {
  const { api } = buildApi();
  assert.equal(api.version, API_VERSION);
  assert.equal(API_VERSION, '1.2');
  assert.deepEqual(api.describe().methods, ['snapshot', 'set', 'remove', 'call', 'callAsync', 'subscribe']);
  assert.ok(api.describe().caps.includes('outcome'));
  assert.ok(API_CAPS.includes('nonce'));
  assert.ok(API_CAPS.includes('ui'));
  assert.ok(API_CAPS.includes('callAsync'));
});

test('快照：只给只读信息，不含宿主对象；逻辑带参数表', () => {
  const { api } = buildApi({
    vars: { 金币: 5 },
    specs: [
      {
        book_id: 'b1',
        name: '测试书',
        enabled: true,
        entries: [],
        logic: [{ name: '扣钱', call: { exposed: true, params: ['次数', '物品'] }, flow: { nodes: [{ kind: 'pass' }] } }],
      },
    ],
  });
  const snap = api.snapshot();
  assert.equal(snap.version, API_VERSION);
  assert.equal(snap.chatId, 'chat-1');
  assert.equal(snap.tick, 3);
  assert.equal(snap.vars['金币'], 5);
  assert.equal(snap.books[0].id, 'b1');
  assert.equal(snap.books[0].logics[0].name, '扣钱');
  assert.deepEqual(snap.books[0].logics[0].params, ['次数', '物品']);
  assert.equal(JSON.stringify(snap).includes('function'), false);
});

test('改变量：数字/文字/开关都行，坏值给明确理由', () => {
  const { api, varsNow } = buildApi();
  assert.deepEqual(api.set('金币', '5'), { ok: true, name: '金币', value: 5 });
  assert.equal(varsNow()['金币'], 5);
  assert.equal(api.set('名字', '旅人').ok, true);
  assert.equal(api.set('开关', true).value, true);
  assert.equal(api.set('', 1).ok, false);
  assert.equal(api.set('', 1).outcome, 'error');
  assert.equal(api.set('坏值', { a: 1 }).ok, false);
  assert.equal(api.set('x'.repeat(41), 1).ok, false);
  // NaN / Infinity 在 normalizeVars 里本来会被写成 null，这里提前拦住（ILB-UI-07）
  assert.equal(api.set('数字', NaN).ok, false);
  assert.equal(api.set('数字', Infinity).ok, false);
  assert.equal(varsNow()['数字'], undefined);
});

test('删变量', () => {
  const { api, varsNow } = buildApi({ vars: { 金币: 5 } });
  assert.equal(api.remove('金币').ok, true);
  assert.equal(varsNow()['金币'], undefined);
});

test('调用逻辑：按名字跑流程，写回聊天变量', () => {
  const { api, varsNow } = buildApi();
  const result = api.call('掷骰');
  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'ok');
  assert.equal(result.ran, true);
  assert.ok(typeof result.writes['骰子'] === 'number');
  assert.equal(varsNow()['骰子'], result.writes['骰子']);
  assert.equal(api.call('不存在的').ok, false);
  assert.equal(api.call('不存在的').outcome, 'error');
  assert.equal(api.call('停用的').ok, false);
});

test('调用逻辑：也可以直接传 id，跨书同名时要用 id', () => {
  const { api, books } = buildApi({
    specs: [
      { book_id: 'a', name: '书甲', enabled: true, entries: [], logic: [{ name: '同名', flow: { nodes: [{ kind: 'remember', name: '谁', value: { kind: 'const', value: '甲' } }] } }] },
      { book_id: 'b', name: '书乙', enabled: true, entries: [], logic: [{ name: '同名', flow: { nodes: [{ kind: 'remember', name: '谁', value: { kind: 'const', value: '乙' } }] } }] },
    ],
  });
  const dup = api.call('同名');
  assert.equal(dup.ok, false);
  assert.equal(dup.outcome, 'error');
  assert.equal(dup.candidates.length, 2);
  assert.match(dup.reason, /请改传 id/);
  const idA = books[0].logic[0].id;
  const byId = api.call(idA);
  assert.equal(byId.ok, true);
  // 界面要分组记账（比如 seq）就得知道是谁，重名时只能靠 id（v0.14.1）
  assert.equal(byId.id, idA);
  assert.equal(byId.name, '同名');
});

test('业务拒绝是 blocked，流程写错是 error（ILB-UI-01）', () => {
  const { api } = buildApi({
    specs: [
      {
        book_id: 'b1',
        name: '测试书',
        enabled: true,
        entries: [],
        logic: [
          { name: '次数不够', flow: { nodes: [{ kind: 'fail' }] } },
          { name: '跳错地方', flow: { nodes: [{ kind: 'goto', target: '不存在的节点' }] } },
        ],
      },
    ],
  });
  const blocked = api.call('次数不够');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.outcome, 'blocked');
  assert.equal(blocked.ran, true);
  assert.equal(blocked.passed, false);
  const broken = api.call('跳错地方');
  assert.equal(broken.ok, false);
  assert.equal(broken.outcome, 'error');
});

test('同一层重复调用给同一随机数；传 nonce 才换（ILB-UI-02）', () => {
  const { api } = buildApi({
    specs: [
      { book_id: 'b1', name: '书', enabled: true, entries: [], logic: [{ name: '大骰', flow: { nodes: [{ kind: 'random', target: '点', min: 1, max: 1000000, persist: true }] } }] },
    ],
  });
  const first = api.call('大骰');
  const again = api.call('大骰');
  assert.equal(first.writes['点'], again.writes['点']);
  const other = api.call('大骰', {}, { nonce: '再来一次' });
  assert.notEqual(other.writes['点'], first.writes['点']);
});

test('opts.text 让带文本条件的逻辑从 UI 也能跑（ILB-UI-04）', () => {
  const { api } = buildApi({
    specs: [
      {
        book_id: 'b1',
        name: '书',
        enabled: true,
        entries: [],
        logic: [
          {
            name: '看国王',
            flow: { nodes: [{ kind: 'test', condition: { type: 'contains', text: '国王' }, then: [{ kind: 'pass' }], else: [{ kind: 'fail' }] }] },
          },
        ],
      },
    ],
  });
  assert.equal(api.call('看国王').outcome, 'blocked'); // 默认无上下文
  assert.equal(api.call('看国王', {}, { text: '陛下，国王来了' }).outcome, 'ok');
});

test('参数：按名字绑定，多余的/缺的都说出来（ILB-UI-05）', () => {
  const { api } = buildApi({
    specs: [
      {
        book_id: 'b1',
        name: '书',
        enabled: true,
        entries: [],
        logic: [
          {
            name: '扣钱',
            call: { exposed: true, params: ['次数'] },
            flow: { nodes: [{ kind: 'test', condition: { type: 'var', name: '次数', op: 'equals', value: '2' }, then: [{ kind: 'pass' }], else: [{ kind: 'fail' }] }] },
          },
        ],
      },
    ],
  });
  const ok = api.call('扣钱', { 次数: 2 });
  assert.equal(ok.outcome, 'ok');
  const loose = api.call('扣钱', { 次数: 1, 错字: 9 });
  assert.deepEqual(loose.unusedArgs, ['错字']);
  assert.deepEqual(loose.missingParams, []);
  const strict = api.call('扣钱', { 错字: 9 }, { strict: true });
  assert.equal(strict.ok, false);
  assert.deepEqual(strict.unusedArgs, ['错字']);
  assert.deepEqual(strict.missingParams, ['次数']);
  assert.match(strict.reason, /参数不对/);
  const missing = api.call('扣钱', {});
  assert.deepEqual(missing.missingParams, ['次数']);
});

test('UI 调起的逻辑里也能「调用逻辑」（ILB-UI-15）', () => {
  const { api, books } = buildApi({
    specs: [
      {
        book_id: 'b1',
        name: '书',
        enabled: true,
        entries: [],
        logic: [
          { name: '子逻辑', flow: { nodes: [{ kind: 'remember', name: '子', value: { kind: 'const', value: '跑了' } }] } },
          { name: '父逻辑', flow: { nodes: [{ kind: 'call', logicId: 'PLACEHOLDER' }, { kind: 'remember', name: '父', value: { kind: 'const', value: '也跑了' } }] } },
        ],
      },
    ],
  });
  const parent = books[0].logic.find((l) => l.name === '父逻辑');
  parent.flow.nodes[0].logicId = books[0].logic.find((l) => l.name === '子逻辑').id;
  const out = api.call('父逻辑');
  assert.equal(out.ok, true);
  assert.equal(out.vars['子'], '跑了');
  assert.equal(out.vars['父'], '也跑了');
});

test('订阅：set/remove/call 都会通知，退订之后不再来；传错参数不抛异常', () => {
  const { api } = buildApi();
  const events = [];
  const off = api.subscribe((payload) => events.push(payload.reason));
  api.set('金币', 1);
  api.remove('金币');
  api.call('掷骰');
  assert.deepEqual(events, ['set', 'remove', 'call']);
  off();
  api.set('金币', 2);
  assert.deepEqual(events, ['set', 'remove', 'call']);
  // 1.0 里这里抛 TypeError；1.1 改成警告 + 空退订（ILB-UI-08）
  const noop = api.subscribe('不是函数');
  assert.equal(typeof noop, 'function');
  assert.doesNotThrow(() => noop());
});

// —— v0.14.0：调用可以带回一条界面指令（ILB-4.21）——

function uiApi() {
  return buildApi({
    specs: [
      {
        book_id: 'b1',
        name: '书',
        enabled: true,
        entries: [],
        logic: [
          {
            name: '抽卡',
            call: { exposed: true, params: ['次数'] },
            flow: {
              nodes: [
                {
                  kind: 'compare',
                  left: { type: 'var', name: '次数' },
                  op: '>',
                  right: { type: 'number', value: 0 },
                  then: [
                    { kind: 'ui', page: '结果页', toast: 'SSR！', select: 'card-3' },
                    { kind: 'calc', target: '次数', op: '-', left: { type: 'var', name: '次数' }, right: { type: 'number', value: 1 }, persist: true },
                  ],
                  else: [{ kind: 'fail' }],
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

test('call 带回顶层 ui 与 durationMs；界面不自带状态，失败时没有 ui', () => {
  const { api } = uiApi();
  const out = api.call('抽卡', { 次数: 1 });
  assert.equal(out.ok, true);
  assert.equal(out.outcome, 'ok');
  assert.deepEqual(out.ui, { v: 1, page: '结果页', toast: 'SSR！', select: 'card-3' });
  assert.equal(typeof out.durationMs, 'number');
  assert.ok(out.durationMs >= 0);
  assert.equal(out.writes['次数'], 0);
  // 界面指令不进变量表，下一轮读不到
  assert.equal(Object.keys(out.vars).includes('ui'), false);

  const blocked = api.call('抽卡', { 次数: 0 });
  assert.equal(blocked.outcome, 'blocked');
  assert.equal(blocked.ui, null);
});

test('callAsync 先让出一帧，失败也 resolve 出来，返回值与 call 同形', async () => {
  const { api } = uiApi();
  const out = await api.callAsync('抽卡', { 次数: 2 });
  assert.equal(out.ok, true);
  assert.equal(out.ui.page, '结果页');
  assert.equal(typeof out.durationMs, 'number');

  const missing = await api.callAsync('不存在的逻辑');
  assert.equal(missing.ok, false);
  assert.equal(missing.outcome, 'error');
  assert.match(missing.reason, /没有叫/);
});

test('界面指令会以 ilb:change 的 ui 事件通知出去（UI 可只挂一处）', () => {
  const { api } = uiApi();
  const seen = [];
  api.subscribe((payload) => seen.push(payload.reason));
  api.call('抽卡', { 次数: 1 });
  assert.deepEqual(seen, ['call', 'ui']);
});
