// tests/live/st-live-check.mjs —— 真实 SillyTavern 里"装上了、能开"的最小验证
//
// 验四件事：扩展脚本在真实宿主里加载成功（globalThis.ILB）、版本对得上、
// 对外接口在位、面板能在桌面外壳里打开且不横向溢出。
//
// 用法（先启动酒馆，再用带调试端口的 Chrome 打开它）：
//   set ST_DIR=D:\1\APP\SillyTavern
//   node tests/live/st-live-check.mjs
import { openPage, waitForIlb, sleep, screenshot } from './cdp.mjs';

const ST_DIR = process.env.ST_DIR ?? 'D:/1/APP/SillyTavern';
const page = await openPage(ST_DIR);
await page.send('Runtime.enable');
await page.send('Page.enable');

const loaded = await waitForIlb(page.evaluate);
if (!loaded) {
  console.log('❌ 页面里没有 globalThis.ILB：扩展没加载起来（看宿主控制台的报错）');
  page.close();
  process.exit(1);
}

const state = await page.evaluate(`(() => ({
  version: globalThis.ILB.version ?? null,
  api: globalThis.ILB.api?.version ?? null,
  caps: globalThis.ILB.api?.caps ?? [],
  callAsync: typeof globalThis.ILB.api?.callAsync,
  fab: Boolean(document.querySelector('.ilb-fab, #ilb-fab, .ilb-window')),
  host: Boolean(globalThis.SillyTavern),
}))()`);
console.log('加载：', JSON.stringify(state));

// 桌面外壳：面板要能打开、不横向溢出
await page.send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false });
await page.send('Page.reload', { ignoreCache: false });
await sleep(9000);
await waitForIlb(page.evaluate);

const panel = await page.evaluate(`(async () => {
  globalThis.ILB.api.ui.openPanel('rules');
  await new Promise((r) => setTimeout(r, 1200));
  const desktop = document.querySelector('.ilb-window-desktop');
  const mobile = document.querySelector('dialog.ilb-m');
  const visible = (el) => el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 100;
  const shell = visible(desktop) ? desktop : visible(mobile) ? mobile : null;
  if (!shell) return { error: '两个外壳都没显示' };
  const overflow = [...shell.querySelectorAll('*')]
    .filter((el) => el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0).length;
  return {
    shell: shell === desktop ? 'desktop' : 'mobile',
    size: Math.round(shell.getBoundingClientRect().width) + '×' + Math.round(shell.getBoundingClientRect().height),
    tabs: [...shell.querySelectorAll('.ilb-tab')].map((b) => (b.textContent || '').trim()),
    overflowNodes: overflow,
  };
})()`);
console.log('面板：', JSON.stringify(panel));

await screenshot(page.send, 'tests/live/last-panel.png');
console.log('截图：tests/live/last-panel.png');

const ok = state.api === '1.2' && state.caps.includes('ui') && state.callAsync === 'function'
  && panel.shell === 'desktop' && panel.overflowNodes === 0;
console.log(ok ? '✅ 通过' : '❌ 有项目没通过');
page.close();
process.exit(ok ? 0 : 1);
