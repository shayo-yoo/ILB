// tests/live/st-phase4-check.mjs —— 真实酒馆里把 Phase 4 的逻辑真跑一遍
//
// 单测（tests/phase4-flow.test.mjs / phase4-list.test.mjs）验的是核心函数；
// 这条探针验的是「在真酒馆里、走 ILB.api.call 这条路，结果对不对」：
//   D 权重随机：权重 [0, 1] 时只可能挑第二条；
//   D 调用的参数与返回值：21 传进去、翻倍后按名字取回来；
//   D 取不到返回值：要说"没有给出返回值"，不能静默；
//   E 列表变量 + 按列表循环：甲,乙,丙 各跑一遍，拼成"甲乙丙"；
//   E 分支选择：命中第 3 条，写"三"；
//   E 列表名不存在：要明确失败，不能假装跑过。
//
// 探针会临时建一本「验收探针（可删）」（book_id = probe-phase4-live），跑完删掉；
// 用到的聊天变量也会清掉。
//
// 用法：
//   set ST_DIR=D:\1\APP\SillyTavern
//   node tests/live/st-phase4-check.mjs
import { openPage, waitForIlb, sleep, screenshot } from './cdp.mjs';

const ST_DIR = process.env.ST_DIR ?? 'D:/1/APP/SillyTavern';
const BOOK = 'probe-phase4-live';

const page = await openPage(ST_DIR);
await page.send('Runtime.enable');
await page.send('Page.enable');

if (!(await waitForIlb(page.evaluate))) {
  console.log('❌ 页面里没有 globalThis.ILB（扩展没加载起来）');
  page.close();
  process.exit(1);
}

const report = await page.evaluate(`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const repo = globalThis.ILB.repository;
  const api = globalThis.ILB.api;
  const out = { cases: [], cleanup: {} };

  const logic = (name, nodes) => ({
    name,
    enabled: true,
    trigger: { any: [], all: [], not: [], source: 'both' },
    flow: { mode: 'and', nodes },
  });

  const book = {
    book_id: '${BOOK}',
    name: '验收探针（可删）',
    enabled: true,
    activation: { mode: 'manual', strategy: 'always' },
    entries: [],
    logic: [
      logic('验收-权重', [
        { kind: 'choose', candidates: ['甲', '乙'], weights: [0, 1], target: '验收选中', persist: true },
      ]),
      logic('验收-被调', [
        { kind: 'set', name: '验收中间', op: 'set', value: { type: 'var', name: '验收输入' } },
        { kind: 'set', name: '验收中间', op: 'mul', value: { type: 'number', value: 2 } },
      ]),
      logic('验收-参数', [
        { kind: 'call', logicId: '', args: [{ name: '验收输入', value: { type: 'number', value: 21 } }],
          returns: [{ name: '验收中间', target: '验收结果' }], persist: true },
      ]),
      logic('验收-取不到', [
        { kind: 'call', logicId: '', args: [{ name: '验收输入', value: { type: 'number', value: 1 } }],
          returns: [{ name: '不存在的东西', target: '验收空' }], persist: true },
      ]),
      logic('验收-列表', [
        { kind: 'list', name: '验收名单', op: 'set', value: { type: 'text', value: '甲,乙,丙' }, separator: ',' },
        { kind: 'repeat', mode: 'list', listName: '验收名单', itemName: '验收项', body: [
          { kind: 'set', name: '验收合计', op: 'append', value: { type: 'var', name: '验收项' }, persist: true },
        ] },
      ]),
      logic('验收-列表坏名字', [
        { kind: 'repeat', mode: 'list', listName: '根本没有这个列表', itemName: '验收项', body: [
          { kind: 'set', name: '验收不该出现', op: 'set', value: { type: 'text', value: '不该' }, persist: true },
        ] },
      ]),
      logic('验收-分支', [
        { kind: 'set', name: '验收等级', op: 'set', value: { type: 'number', value: 3 } },
        { kind: 'switch', value: { type: 'var', name: '验收等级' }, cases: [
          { match: { type: 'number', value: 1 }, body: [{ kind: 'set', name: '验收分支', op: 'set', value: { type: 'text', value: '一' }, persist: true }] },
          { match: { type: 'number', value: 3 }, body: [{ kind: 'set', name: '验收分支', op: 'set', value: { type: 'text', value: '三' }, persist: true }] },
        ], else: [{ kind: 'set', name: '验收分支', op: 'set', value: { type: 'text', value: '其它' }, persist: true }] },
      ]),
    ],
  };

  await repo.saveBook(book);
  const saved = (await repo.listBooks()).find((b) => b.book_id === '${BOOK}');
  if (!saved) return { error: '书没存进去' };
  const callee = saved.logic.find((l) => l.name === '验收-被调');
  for (const name of ['验收-参数', '验收-取不到']) {
    const item = saved.logic.find((l) => l.name === name);
    item.flow.nodes[0].logicId = callee.id;
  }
  await repo.saveBook(saved);

  const stepText = (r) => (r.steps ?? []).map((s) => String(s.reason ?? '')).join(' | ');
  const record = (name, ok, detail) => out.cases.push({ name, ok, detail });

  const r1 = api.call('验收-权重');
  record('D-权重 [0,1] 只挑第二条', r1.vars['验收选中'] === '乙' && /权重/.test(stepText(r1)),
    { picked: r1.vars['验收选中'] ?? null, ok: r1.ok });

  const r2 = api.call('验收-参数');
  record('D-参数 21 传进去、翻倍后取回 42', r2.vars['验收结果'] === 42,
    { result: r2.vars['验收结果'] ?? null, ok: r2.ok, steps: stepText(r2).slice(0, 240) });

  const r3 = api.call('验收-取不到');
  // 单步失败不等于整条流程失败（流程会继续往下），这里验的是"失败要说出来、且不写空值"
  record('D-取不到返回值要报出来，且不写空值',
    /没有给出返回值/.test(stepText(r3)) && !('验收空' in r3.vars),
    { ok: r3.ok, wrote: '验收空' in r3.vars, steps: stepText(r3).slice(0, 160) });

  const r4 = api.call('验收-列表');
  record('E-列表循环拼出甲乙丙', r4.vars['验收合计'] === '甲乙丙', { total: r4.vars['验收合计'] ?? null, ok: r4.ok });

  const r5 = api.call('验收-列表坏名字');
  record('E-列表名不存在要说出来，且不写脏值',
    /还不是列表/.test(stepText(r5)) && !('验收不该出现' in r5.vars),
    { ok: r5.ok, wrote: '验收不该出现' in r5.vars, steps: stepText(r5).slice(0, 160) });

  const r6 = api.call('验收-分支');
  record('E-分支选择命中第三条', r6.vars['验收分支'] === '三', { picked: r6.vars['验收分支'] ?? null, ok: r6.ok });

  // 清理：删书，清掉这一轮写进去的聊天变量
  await repo.deleteBook('${BOOK}');
  const chatId = api.snapshot().chatId;
  for (const name of ['验收选中', '验收结果', '验收空', '验收合计', '验收分支', '验收等级', '验收中间', '验收输入', '验收不该出现']) {
    try { repo.deleteVar(chatId, name); } catch { /* 没这个变量就算了 */ }
  }
  out.cleanup = {
    bookDeleted: !(await repo.listBooks()).some((b) => b.book_id === '${BOOK}'),
    booksLeft: (await repo.listBooks()).length,
  };
  return out;
})()`);

const cases = report?.cases ?? [];
const failed = cases.filter((c) => !c.ok);
for (const c of cases) console.log(`${c.ok ? '✅' : '❌'} ${c.name} ${JSON.stringify(c.detail)}`);
if (report?.error) console.log('❌ ' + report.error);
if (report?.cleanup) console.log('清理：' + JSON.stringify(report.cleanup));
if (!cases.length || failed.length || report?.error) {
  console.log('❌ 有项目没通过');
  try { await screenshot(page, 'tests/live/last-phase4.png'); } catch { /* 截图失败不影响结论 */ }
  page.close();
  process.exit(1);
}
console.log('✅ Phase 4 逻辑在真实酒馆里全部通过（' + cases.length + ' 项）');
await sleep(200);
page.close();
