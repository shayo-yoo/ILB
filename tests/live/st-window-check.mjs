// tests/live/st-window-check.mjs —— 真浏览器里验「浮窗拖动 / 边缘夹住 / 最大化 / 最小化」
//
// 对应用户手测清单的 B1（断点拖动）：这些行为假 DOM 测不出来（没有真实布局与指针捕获）。
// 用法：先按 README 起酒馆与 Chrome，然后 `node tests/live/st-window-check.mjs`。
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

  const boot = await evaluate(`(async () => {
    ILB.api.ui.openPanel('rules');
    await new Promise((r) => setTimeout(r, 800));
    const win = document.querySelector('.ilb-window');
    const rect = win.getBoundingClientRect();
    return { open: win.classList.contains('ilb-window-open'), rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height }, vw: innerWidth, vh: innerHeight };
  })()`);
  check('浮窗打开且落在视口里', boot.open && boot.rect.x >= 0 && boot.rect.y >= 0 && boot.rect.x + boot.rect.w <= boot.vw + 1, boot);

  // 拖标题栏：+120 / +70（真指针事件走 makeDrag）
  const drag = await evaluate(`(async () => {
    const win = document.querySelector('.ilb-window');
    const head = document.querySelector('.ilb-window-head');
    const before = win.getBoundingClientRect();
    const sx = before.x + 60;
    const sy = before.y + 12;
    const fire = (type, x, y) => head.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y }));
    fire('pointerdown', sx, sy);
    fire('pointermove', sx + 30, sy + 18);
    await new Promise((r) => setTimeout(r, 60));
    fire('pointermove', sx + 120, sy + 70);
    await new Promise((r) => setTimeout(r, 120));
    fire('pointerup', sx + 120, sy + 70);
    await new Promise((r) => setTimeout(r, 300));
    const after = win.getBoundingClientRect();
    return { dx: Math.round(after.x - before.x), dy: Math.round(after.y - before.y), left: Math.round(after.x), top: Math.round(after.y) };
  })()`);
  check('拖标题栏能挪动窗口', Math.abs(drag.dx - 120) <= 2 && Math.abs(drag.dy - 70) <= 2, drag);

  // 往右下角猛拖：不能被拖出可见区
  const clamp = await evaluate(`(async () => {
    const win = document.querySelector('.ilb-window');
    const head = document.querySelector('.ilb-window-head');
    const before = win.getBoundingClientRect();
    const sx = before.x + 40;
    const sy = before.y + 10;
    const fire = (type, x, y) => head.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 2, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y }));
    fire('pointerdown', sx, sy);
    fire('pointermove', sx + 4000, sy + 4000);
    await new Promise((r) => setTimeout(r, 150));
    fire('pointerup', sx + 4000, sy + 4000);
    await new Promise((r) => setTimeout(r, 300));
    const r = win.getBoundingClientRect();
    return { left: Math.round(r.x), top: Math.round(r.y), right: Math.round(r.right), bottom: Math.round(r.bottom), vw: innerWidth, vh: innerHeight };
  })()`);
  check('拖到屏幕外会被夹住（右下不越界）', clamp.right <= clamp.vw && clamp.bottom <= clamp.vh && clamp.left >= 0 && clamp.top >= 0, clamp);

  // 最大化 / 最小化 / 还原
  const minmax = await evaluate(`(async () => {
    const win = document.querySelector('.ilb-window');
    const btns = [...document.querySelectorAll('.ilb-window-tools .ilb-window-btn')];
    const maxBtn = btns.find((b) => /最大/.test(b.title || '') || /⤢/.test(b.textContent || ''));
    const minBtn = btns.find((b) => /最小/.test(b.title || ''));
    const out = {};
    maxBtn.click();
    await new Promise((r) => setTimeout(r, 300));
    const mr = win.getBoundingClientRect();
    out.max = { cls: win.classList.contains('ilb-window-max'), w: Math.round(mr.width), h: Math.round(mr.height), vw: innerWidth, vh: innerHeight };
    maxBtn.click();
    await new Promise((r) => setTimeout(r, 300));
    out.restored = { cls: win.classList.contains('ilb-window-max'), w: Math.round(win.getBoundingClientRect().width) };
    minBtn.click();
    await new Promise((r) => setTimeout(r, 300));
    out.min = {
      cls: win.classList.contains('ilb-window-min'),
      display: getComputedStyle(win).display,
      fab: getComputedStyle(document.querySelector('.ilb-fab')).display !== 'none',
      minTitle: minBtn.title,
    };
    minBtn.click();
    await new Promise((r) => setTimeout(r, 300));
    out.back = {
      cls: win.classList.contains('ilb-window-min'),
      height: Math.round(win.getBoundingClientRect().height),
      fab: getComputedStyle(document.querySelector('.ilb-fab')).display !== 'none',
    };
    return out;
  })()`);
  check('最大化能铺开', minmax.max.cls && minmax.max.w >= minmax.max.vw - 40 && minmax.max.h >= minmax.max.vh - 80, minmax.max);
  check('再点一次能还原（不是关掉）', !minmax.restored.cls && minmax.restored.w > 0 && minmax.restored.w < minmax.max.w, minmax.restored);
  check('最小化收成悬浮球，再点回来还原', minmax.min.cls && minmax.min.display === 'none' && minmax.min.fab && !minmax.back.cls && minmax.back.height > 60, minmax);

  // 关掉再打开：位置要记住；刷新页面后也要记住（几何存在 ui 状态里）
  const reopen = await evaluate(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const win = document.querySelector('.ilb-window');
    const before = win.getBoundingClientRect();
    document.querySelector('.ilb-window-x').click();
    await wait(500);
    ILB.api.ui.openPanel('rules');
    await wait(800);
    const reopened = document.querySelector('.ilb-window');
    const after = reopened.getBoundingClientRect();
    return {
      before: { x: Math.round(before.x), y: Math.round(before.y) },
      after: { x: Math.round(after.x), y: Math.round(after.y) },
      open: reopened.classList.contains('ilb-window-open'),
    };
  })()`);
  check('关掉再打开，位置还在', reopen.open && reopen.before.x === reopen.after.x && reopen.before.y === reopen.after.y, reopen);

  await sleep(600);
  await send('Page.reload');
  await sleep(9000);
  if (!(await waitForIlb(evaluate))) throw new Error('刷新后页面里没有 globalThis.ILB');
  const reloaded = await evaluate(`(async () => {
    ILB.api.ui.openPanel('rules');
    await new Promise((r) => setTimeout(r, 900));
    const win = document.querySelector('.ilb-window');
    const r = win.getBoundingClientRect();
    return { open: win.classList.contains('ilb-window-open'), x: Math.round(r.x), y: Math.round(r.y) };
  })()`);
  check('刷新页面后，位置还是刚才那个', reloaded.open && reloaded.x === reopen.after.x && reloaded.y === reopen.after.y, reloaded);

  await screenshot(send, path.join(HERE, 'last-window.png'));
  console.log(problems.length ? `❌ 有 ${problems.length} 项没通过：${problems.join('、')}` : '✅ 通过');
} catch (error) {
  console.error('❌ 出错：', error.message);
  problems.push('error');
} finally {
  await evaluate('try { ILB.api.ui.close() } catch (e) {}').catch(() => {});
  page.close();
}

process.exit(problems.length ? 1 : 0);
