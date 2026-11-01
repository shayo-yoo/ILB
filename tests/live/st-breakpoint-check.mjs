// tests/live/st-breakpoint-check.mjs —— 真浏览器里验「窗子宽度跨 560 / 900 断点时导航换形」
//
// 对应验收记录 B1：假 DOM 里 getLayout/getDensity 是喂进去的，只有真浏览器才能证明
// 「缩窄窗子 → ResizeObserver → 重画导航」这条链是通的。
import { openPage, waitForIlb, sleep, screenshot } from './cdp.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ST_DIR = process.env.ST_DIR ?? 'D:\\1\\APP\\SillyTavern';

const page = await openPage(ST_DIR);
const { send, evaluate } = page;
const problems = [];
const check = (name, ok, detail) => {
  console.log(`${ok ? '✅' : '❌'} ${name}`, detail === undefined ? '' : detail);
  if (!ok) problems.push(name);
};

try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.reload');
  await sleep(9000);
  if (!(await waitForIlb(evaluate))) throw new Error('页面里没有 globalThis.ILB（扩展没挂上？）');

  await evaluate(`(async () => {
    ILB.api.ui.openPanel('rules');
    await new Promise((r) => setTimeout(r, 800));
  })()`);

  const at = async (width) => evaluate(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const win = document.querySelector('.ilb-window');
    win.style.width = '${width}px';
    await wait(500);
    const nav = win.querySelector('.ilb-nav');
    const select = win.querySelector('.ilb-nav-select');
    const main = win.querySelector('.ilb-main') || win.querySelector('.ilb-window-body');
    const label = (el) => (el && el.textContent ? el.textContent.trim() : '');
    return {
      width: Math.round(win.getBoundingClientRect().width),
      density: win.dataset.density ?? '',
      nav: nav ? nav.className : '',
      hasTop: Boolean(win.querySelector('.ilb-nav-top')),
      hasSide: Boolean(win.querySelector('.ilb-nav-side')),
      hasCompact: Boolean(win.querySelector('.ilb-nav-compact')),
      selectOptions: select ? [...select.options].map((o) => o.textContent.trim()) : [],
      activeTab: select ? select.value : (win.querySelector('.ilb-nav-active')?.textContent ?? '').trim(),
      overflow: main ? main.scrollWidth - main.clientWidth : null,
      rootScroll: win.scrollWidth - win.clientWidth,
    };
  })()`);

  const wide = await at(1000);
  check('宽窗：左侧固定导航', wide.hasSide && !wide.hasTop && !wide.hasCompact && wide.density === 'wide', wide);

  const standard = await at(760);
  check('中窗：顶部导航 + 更多', standard.hasTop && !standard.hasSide && !standard.hasCompact && standard.density === 'standard', standard);

  const compact = await at(520);
  check('窄窗：导航折成一个下拉', compact.hasCompact && !compact.hasTop && !compact.hasSide && compact.density === 'compact', compact);
  check('窄窗下拉里七个页面一个不少', compact.selectOptions.length === 7, compact.selectOptions);
  check('窄窗不留横向滚动', compact.overflow !== null && compact.overflow <= 2 && compact.rootScroll <= 2, compact);

  // 下拉能换页：选到「逻辑」，页面真的换了
  const switched = await evaluate(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const win = document.querySelector('.ilb-window');
    const select = win.querySelector('.ilb-nav-select');
    select.value = 'logic';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(600);
    return {
      value: win.querySelector('.ilb-nav-select')?.value,
      blurb: (win.querySelector('.ilb-tab-blurb')?.textContent ?? '').trim().slice(0, 40),
      overflow: win.scrollWidth - win.clientWidth,
    };
  })()`);
  check('窄窗下拉切页真的切过去', switched.value === 'logic' && switched.blurb.length > 0 && switched.overflow <= 2, switched);

  await screenshot(send, path.join(HERE, 'last-breakpoint.png'));
  console.log(problems.length ? `❌ 有 ${problems.length} 项没通过：${problems.join('、')}` : '✅ 通过');
} catch (error) {
  console.error('❌ 出错：', error.message);
  problems.push('error');
} finally {
  await evaluate('try { ILB.api.ui.close() } catch (e) {}').catch(() => {});
  page.close();
}

process.exit(problems.length ? 1 : 0);
