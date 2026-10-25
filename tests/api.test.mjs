// tests/api.test.mjs —— 对外接口契约（ILB-9.1）
import test from 'node:test';
import assert from 'node:assert/strict';

import { createApi, API_VERSION } from '../runtime/api.js';
import { normalizeBook } from '../core/model.js';

function makeApi(varsInit = {}) {
  let vars = { ...varsInit };
  const books = [
    normalizeBook({
      book_id: 'b1',
      name: '测试书',
      enabled: true,
      entries: [],
      logic: [
        { name: '掷骰', trigger: { any: ['掷骰'] }, flow: { nodes: [{ kind: 'random', target: '骰子', min: 1, max: 6, persist: true }] } },
        { name: '停用的', enabled: false, flow: { nodes: [{ kind: 'add', text: '不该跑' }] } },
      ],
    }),
  ];
  const repository = {
    listBooks: () => books,
    getVars: () => ({ ...vars }),
    mergeVars: (chatId, patch) => {
      vars = { ...vars, ...patch };
      return { ...vars };
    },
    deleteVar: (chatId, name) => {
      delete vars[name];
    },
  };
  const api = createApi({
    repository,
    getContext: () => ({ chat: [1, 2, 3] }),
    getChatId: () => 'chat-1',
  });
  return { api, books, varsNow: () => vars };
}

test('接口版本与说明写清楚', () => {
  const { api } = makeApi();
  assert.equal(api.version, API_VERSION);
  assert.deepEqual(api.describe().methods, ['snapshot', 'set', 'remove', 'call', 'subscribe']);
});

test('快照：只给只读信息，不含宿主对象', () => {
  const { api } = makeApi({ 金币: 5 });
  const snap = api.snapshot();
  assert.equal(snap.version, API_VERSION);
  assert.equal(snap.chatId, 'chat-1');
  assert.equal(snap.tick, 3);
  assert.equal(snap.vars['金币'], 5);
  assert.equal(snap.books[0].id, 'b1');
  assert.equal(snap.books[0].logics[0].name, '掷骰');
  assert.equal(JSON.stringify(snap).includes('function'), false);
});

test('改变量：数字/文字/开关都行，坏值给明确理由', () => {
  const { api, varsNow } = makeApi();
  assert.deepEqual(api.set('金币', '5'), { ok: true, name: '金币', value: 5 });
  assert.equal(varsNow()['金币'], 5);
  assert.equal(api.set('名字', '旅人').ok, true);
  assert.equal(api.set('开关', true).value, true);
  assert.deepEqual(api.set('', 1), { ok: false, reason: '变量名不能为空' });
  assert.equal(api.set('坏值', { a: 1 }).ok, false);
  assert.equal(api.set('x'.repeat(41), 1).ok, false);
});

test('删变量', () => {
  const { api, varsNow } = makeApi({ 金币: 5 });
  assert.equal(api.remove('金币').ok, true);
  assert.equal(varsNow()['金币'], undefined);
});

test('调用逻辑：按名字跑流程，写回聊天变量', () => {
  const { api, varsNow } = makeApi();
  const result = api.call('掷骰');
  assert.equal(result.ok, true);
  assert.ok(typeof result.writes['骰子'] === 'number');
  assert.equal(varsNow()['骰子'], result.writes['骰子']);
  assert.equal(api.call('不存在的').ok, false);
  assert.equal(api.call('停用的').ok, false);
});

test('订阅：set/remove/call 都会通知，退订之后不再来', () => {
  const { api } = makeApi();
  const events = [];
  const off = api.subscribe((payload) => events.push(payload.reason));
  api.set('金币', 1);
  api.remove('金币');
  api.call('掷骰');
  assert.deepEqual(events, ['set', 'remove', 'call']);
  off();
  api.set('金币', 2);
  assert.deepEqual(events, ['set', 'remove', 'call']);
  assert.throws(() => api.subscribe('不是函数'), TypeError);
});
