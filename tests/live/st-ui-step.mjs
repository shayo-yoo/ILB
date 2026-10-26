// tests/live/st-ui-step.mjs —— 真实宿主里验 v0.14.0 的「界面」步骤
//
// 验四件事：
//   1. 保存一条带「界面」步骤的逻辑，api.call 能带回顶层 ui 与 durationMs；
//   2. 没有「界面」步骤时 ui 是 null（别把空对象当指令）；
//   3. callAsync 同形，且失败也不 reject；
//   4. 界面节点在真 DOM 里画得出来（七格输入 + 保存前检查），不横向溢出。
//
// 用法（先启动酒馆，再用带调试端口的 Chrome 打开它）：
//   set ST_DIR=D:\1\APP\SillyTavern
//   node tests/live/st-ui-step.mjs
import { openPage, waitForIlb, sleep, screenshot } from './cdp.mjs';

const ST_DIR = process.env.ST_DIR ?? 'D:/1/APP/SillyTavern';
const page = await openPage(ST_DIR);
await page.send('Runtime.enable');
await page.send('Page.enable');

if (!(await waitForIlb(page.evaluate))) {
  console.log('❌ 扩展没加载起来');
  page.close();
  process.exit(1);
}

// 1) 接口层：造一本临时书，跑两条逻辑（一条带界面、一条不带）
const api = await page.evaluate(`(async () => {
  const { repository } = globalThis.ILB;
  const book = {
    book_id: 'live-ui-probe',
    name: '实测用书（可删）',
    enabled: true,
    entries: [],
    logic: [
      {
        name: '实测-有界面',
        enabled: true,
        trigger: { any: ['实测界面'], all: [], not: [], source: 'both' },
        flow: { mode: 'and', nodes: [
          { kind: 'ui', page: '结果页', toast: 'SSR！', select: 'card-3' },
          { kind: 'remember', name: '实测记号', value: { kind: 'const', value: '跑了' } },
        ] },
      },
      {
        name: '实测-没界面',
        enabled: true,
        trigger: { any: ['实测安静'], all: [], not: [], source: 'both' },
        flow: { mode: 'and', nodes: [
          { kind: 'remember', name: '实测记号', value: { kind: 'const', value: '安静' } },
        ] },
      },
    ],
  };
  await repository.saveBook(book);
  const seen = [];
  const off = globalThis.ILB.api.subscribe((p) => seen.push(p.reason));
  const withUi = globalThis.ILB.api.call('实测-有界面');
  const withoutUi = globalThis.ILB.api.call('实测-没界面');
  const asyncOut = await globalThis.ILB.api.callAsync('实测-有界面');
  const missing = await globalThis.ILB.api.callAsync('没有这条逻辑');
  off();
  return {
    ui: withUi.ui,
    durationMs: withUi.durationMs,
    quietUi: withoutUi.ui === null,
    asyncShape: asyncOut.ui?.page === '结果页' && typeof asyncOut.durationMs === 'number',
    missingOk: missing.ok === false && missing.outcome === 'error',
    events: seen,
    writes: withUi.writes,
  };
})()`);
console.log('接口：', JSON.stringify(api, null, 1));

// 2) DOM：界面节点在真实页面里画得出来
await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
const dom = await page.evaluate(`(async () => {
  const mod = await import('/scripts/extensions/third-party/ILB/ui/flow-editor.js');
  // 用 <dialog> 是为了进 top layer：宿主初始化失败时会糊一层白板，普通 div 会被盖住
  const box = document.createElement('dialog');
  box.id = 'ilb-ui-probe';
  box.style.cssText = 'position:fixed;inset:24px;width:auto;max-width:none;max-height:none;margin:0;'
    + 'background:rgba(127,127,127,0.14);color:inherit;padding:12px;overflow:auto';
  document.body.appendChild(box);
  box.showModal();
  const flow = { mode: 'and', nodes: [{ id: 'u1', kind: 'ui', page: '结果页', toast: 'SSR！', select: '', askTitle: '', askText: '', askOk: '' }] };
  box.appendChild(mod.renderFlowEditor({ flow, entries: [], logics: [], onChange: () => {} }));
  await new Promise((r) => setTimeout(r, 200));
  const rows = box.querySelectorAll('.ilb-flow-ui-row');
  const kinds = [...box.querySelectorAll('.ilb-flow-kind')].map((n) => (n.textContent || '').trim());
  const overflow = [...box.querySelectorAll('*')].filter((el) => el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0).length;
  const inputs = [...box.querySelectorAll('.ilb-flow-ui-row input')].map((i) => i.value);
  return { kinds, rows: rows.length, inputs, overflow };
})()`);
console.log('DOM：', JSON.stringify(dom));

// 截图前把宿主的"正在初始化"遮罩拿掉，否则截出来是一片灰白（README 说的那个 bot browser data 提示）
// 截图：只截探针那一块，免得宿主"正在初始化"的白板挡住（也不去动宿主的 DOM）
const rect = await page.evaluate(`(() => {
  const box = document.querySelector('#ilb-ui-probe');
  if (!box) return null;
  const r = box.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), scale: 1 };
})()`);
if (rect) await screenshot(page.send, 'tests/live/last-ui-step.png', rect);
console.log('截图：tests/live/last-ui-step.png');

const ok = api.ui?.page === '结果页'
  && api.ui?.toast === 'SSR！'
  && api.ui?.select === 'card-3'
  && typeof api.durationMs === 'number'
  && api.durationMs >= 0
  && api.quietUi === true
  && api.asyncShape === true
  && api.missingOk === true
  && api.events.join(',') === 'call,ui,call,call,ui'
  && dom.kinds.join(',') === '界面'
  && dom.rows >= 6
  && dom.overflow === 0;

console.log(ok ? '✅ 通过' : '❌ 有项目没通过');
page.close();
process.exit(ok ? 0 : 1);
