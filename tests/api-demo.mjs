// tests/api-demo.mjs —— 模拟一个"UI 扩展"用例：只通过 window.ILB.api 做面板上的事。
//
// 运行：node tests/api-demo.mjs
// 这不是单元测试，是把 UI 扩展真正会走的路径跑一遍，让人能肉眼看输出。
// 真实环境里 api 由 index.js 装配、挂在 window.ILB.api；这里用假的 repository 顶替。
// 契约文档：docs/UI扩展接口.md

import assert from 'node:assert/strict';
import { createApi } from '../runtime/api.js';
import { normalizeBook } from '../core/model.js';

function line(title, value) {
  console.log(`\n== ${title} ==`);
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

const v = (name) => ({ type: 'var', name });
const n = (value) => ({ type: 'number', value });

const books = [
  normalizeBook({
    book_id: 'demo',
    name: '抽卡示例',
    enabled: true,
    entries: [],
    logic: [
      {
        name: '抽卡',
        call: { exposed: true, params: ['次数'] },
        flow: {
          nodes: [
            {
              id: 'n1',
              kind: 'compare',
              left: v('抽卡次数'),
              op: '>',
              right: n(0),
              then: [
                { id: 'n2', kind: 'calc', target: '抽卡次数', left: v('抽卡次数'), op: '-', right: n(1), persist: true },
                { id: 'n3', kind: 'random', target: '幸运', min: 1, max: 100, persist: true },
                {
                  id: 'n4',
                  kind: 'compare',
                  left: v('幸运'),
                  op: '>',
                  right: n(79),
                  then: [{ id: 'n5', kind: 'add', text: '你抽到了金卡。' }],
                  else: [{ id: 'n6', kind: 'add', text: '你抽到了普通卡。' }],
                },
              ],
              else: [{ id: 'n7', kind: 'add', text: '次数不够了。' }],
            },
          ],
        },
      },
      {
        name: '卖东西',
        flow: {
          nodes: [
            {
              id: 'm1',
              kind: 'compare',
              left: v('金币'),
              op: '>',
              right: n(0),
              then: [{ id: 'm2', kind: 'add', text: '成交。' }],
              // 没有「不成立时」→ 业务拒绝（outcome: blocked）
            },
          ],
        },
      },
      { name: '丢骰子', flow: { nodes: [{ id: 'd1', kind: 'random', target: '点', min: 1, max: 1000000, persist: true }] } },
    ],
  }),
];

let vars = { 抽卡次数: 2, 金币: 0 };
const repository = {
  listBooks: () => books,
  getVars: () => ({ ...vars }),
  mergeVars: (chatId, patch) => { vars = { ...vars, ...patch }; return { ...vars }; },
  deleteVar: (chatId, name) => { delete vars[name]; },
};

const api = createApi({
  repository,
  getContext: () => ({ chat: new Array(12).fill(0) }),
  getChatId: () => 'demo-chat',
});

line('接口自述（UI 扩展开工先看一眼）', {
  version: api.version,
  caps: api.caps,
  methods: api.describe().methods,
  events: api.describe().events,
});

const snap = api.snapshot();
line('快照（面板首屏只读这个）', {
  version: snap.version,
  chatId: snap.chatId,
  tick: snap.tick,
  vars: snap.vars,
  logics: snap.books[0].logics.map((l) => ({ name: l.name, exposed: l.exposed, params: l.params })),
});

line('按钮：改一个变量', api.set('抽卡次数', 2));

const first = api.call('抽卡', { 次数: 1 });
line('按钮：抽卡（参数是对象，键是参数名）', {
  ok: first.ok, outcome: first.outcome, writes: first.writes, extra: first.extra, vars: first.vars,
});

const blocked = api.call('卖东西');
line('业务拒绝（outcome=blocked，UI 画黄字而不是红字）', {
  ok: blocked.ok, outcome: blocked.outcome, ran: blocked.ran, passed: blocked.passed, reason: blocked.reason,
});

const dup = api.call('不存在的逻辑');
line('调用不存在的逻辑（outcome=error）', { ok: dup.ok, outcome: dup.outcome, reason: dup.reason });

const typo = api.call('抽卡', { 次树: 1 }, { strict: true });
line('参数拼错 + strict（直接拒绝，不静默）', {
  ok: typo.ok, reason: typo.reason, unusedArgs: typo.unusedArgs, missingParams: typo.missingParams,
});

const a = api.call('丢骰子');
const b = api.call('丢骰子');
const c = api.call('丢骰子', {}, { nonce: '再来一次' });
line('同一层重放给同一个随机数；传 nonce 才换', {
  同一次: a.writes['点'],
  再调一次: b.writes['点'],
  换个nonce: c.writes['点'],
  一致: a.writes['点'] === b.writes['点'] && a.writes['点'] !== c.writes['点'],
});

const seen = new Set();
const off = api.subscribe((evt) => seen.add(evt.reason));
api.set('说明', 'UI 里改了变量');
api.call('抽卡', { 次数: 1 }, { nonce: 'ui' });
off();
line('订阅收到的事件原因（退订后不再来）', [...seen]);

assert.equal(typeof api.version, 'string');
assert.equal(api.set('x', NaN).ok, false);
assert.equal(typeof api.subscribe('不是函数'), 'function');
console.log('\nOK：接口自检通过（上面每一步都返回对象，没有抛异常）。');
