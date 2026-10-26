// tests/live/st-flow-text.mjs —— 真实宿主里点一遍流程的文本模式
//
// 验三件事：文本模式能把流程渲染成文字、有「复制给 AI 的说明」按钮、
// 手机视口下编辑框至少半屏（这是 v0.13.1 修的手机问题）。
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

// 1) 桌面：渲染 + 文本模式
await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
const desktop = await page.evaluate(`(async () => {
  const mod = await import('/scripts/extensions/third-party/ILB/ui/flow-editor.js');
  const box = document.createElement('div');
  box.id = 'ilb-probe-host';
  box.style.cssText = 'position:fixed;inset:40px;background:rgba(127,127,127,0.14);color:inherit;padding:12px;z-index:99999;overflow:auto';
  document.body.appendChild(box);
  const flow = { mode: 'and', nodes: [
    { id: 'n1', kind: 'compare', left: { type: 'var', name: '升级经验' }, op: '>=', right: { type: 'var', name: '所需升级经验' },
      then: [{ id: 'n2', kind: 'calc', target: '等级', op: '+', left: { type: 'var', name: '等级' }, right: { type: 'number', value: 1 }, persist: true }],
      else: [] },
  ] };
  box.appendChild(mod.renderFlowEditor({ flow, entries: [], logics: [], onChange: () => {} }));
  const btn = [...box.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '文本模式');
  if (!btn) return { error: '没有「文本模式」按钮' };
  btn.click();
  await new Promise((r) => setTimeout(r, 300));
  const area = box.querySelector('.ilb-flow-area');
  const copy = [...box.querySelectorAll('button')].find((b) => /复制给 AI/.test(b.textContent || ''));
  // 点一下「复制给 AI 的说明」：v0.13.1 真机上这里报过 "ctx is not defined"，
  // 复制虽然成功，但控制台一片红。现在要求点了之后一条错误都不许有。
  const errors = [];
  const onError = (e) => errors.push(String(e.reason?.message || e.message || e));
  window.addEventListener('unhandledrejection', onError);
  window.addEventListener('error', onError);
  if (copy) copy.click();
  await new Promise((r) => setTimeout(r, 700));
  window.removeEventListener('unhandledrejection', onError);
  window.removeEventListener('error', onError);
  return {
    area: Boolean(area),
    firstLines: area ? area.value.split('\\n').slice(0, 3) : null,
    copyButton: Boolean(copy),
    copyErrors: errors,
    problems: box.querySelector('.ilb-flow-problems')?.textContent?.slice(0, 60) ?? null,
  };
})()`);
console.log('文本模式：', JSON.stringify(desktop, null, 1));

// 2) 手机：编辑框高度
await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(500);
const mobile = await page.evaluate(`(() => {
  const area = document.querySelector('#ilb-probe-host .ilb-flow-area');
  if (!area) return { error: '没有文本框' };
  const rect = area.getBoundingClientRect();
  return {
    height: Math.round(rect.height),
    halfScreen: Math.round(window.innerHeight / 2),
    pass: rect.height >= window.innerHeight / 2 - 2,
  };
})()`);
console.log('手机高度：', JSON.stringify(mobile));
await screenshot(page.send, 'tests/live/last-flow-mobile.png');

const ok = desktop.area && desktop.copyButton && desktop.copyErrors.length === 0 && mobile.pass;
console.log(ok ? '✅ 通过' : '❌ 有项目没通过');
page.close();
process.exit(ok ? 0 : 1);
