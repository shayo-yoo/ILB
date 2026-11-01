// tests/live/st-mobile-check.mjs —— 真实酒馆里用手机视口验一遍手机壳
//
// 验的是「假 DOM 测不到、桌面视口也测不到」的那一支：
//   dialog.ilb-m 真的 showModal；底部四个入口都在；面板不横向溢出；
//   规则页能打开编辑浮层，底部固定操作栏贴在视口底部、有「保存」。
// 注意：这是 Chrome 的手机视口模拟，不是真机 WebView——结果要如实记在
// docs/真机验收记录.md，不能写成"真机已验"。
//
// 为了能点开编辑浮层，探针会临时建一本「验收测试书」（book_id = probe-mobile），
// 跑完删掉；不动用户已有数据。
//
// 用法：
//   set ST_DIR=D:\1\APP\SillyTavern
//   node tests/live/st-mobile-check.mjs
import { openPage, waitForIlb, sleep, screenshot } from './cdp.mjs';

const ST_DIR = process.env.ST_DIR ?? 'D:/1/APP/SillyTavern';
const BOOK = 'probe-mobile';
const page = await openPage(ST_DIR);
await page.send('Runtime.enable');
await page.send('Page.enable');

// iPhone 13 尺寸；mobile:true 才会让 visualViewport/触控相关分支更接近真机
await page.send('Emulation.setDeviceMetricsOverride', {
  width: 390, height: 844, deviceScaleFactor: 3, mobile: true,
});
await page.send('Page.reload', { ignoreCache: false });
await sleep(9000);

if (!(await waitForIlb(page.evaluate))) {
  console.log('❌ 页面里没有 globalThis.ILB（扩展没加载起来）');
  page.close();
  process.exit(1);
}

const result = await page.evaluate(`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => Boolean(el && el.getClientRects().length && el.getBoundingClientRect().width > 20);

  globalThis.ILB.api.ui.openPanel('rules');
  await wait(1200);
  const dialog = document.querySelector('dialog.ilb-m');
  const nav = [...document.querySelectorAll('.ilb-m-nav-btn')].map((b) => (b.textContent || '').trim());
  const overflow = (root) => [...root.querySelectorAll('*')]
    .filter((el) => el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0).length;
  const home = {
    dialogOpen: Boolean(dialog && dialog.open),
    mobileShown: Boolean(dialog && getComputedStyle(dialog).display !== 'none'),
    width: dialog ? Math.round(dialog.getBoundingClientRect().width) : 0,
    nav,
    overflowNodes: dialog ? overflow(dialog) : -1,
    bookBar: Boolean(document.querySelector('.ilb-bookbar')),
    activeTab: document.querySelector('.ilb-m-nav-btn.ilb-m-nav-active')?.textContent?.trim() ?? null,
  };

  // 临时书，让规则页有东西可编辑
  globalThis.ILB.repository.saveBook({
    book_id: '${BOOK}',
    name: '验收测试书',
    entries: [{ id: 'e-probe', title: '验收规则', content: '这是一条验收测试规则。', trigger: { any: ['验收'] } }],
    logic: [],
  });
  // 切走再切回来，强制规则页按新的书单重画（否则 select 还是旧的那一份）
  globalThis.ILB.panel.setTab('shelf');
  await wait(200);
  globalThis.ILB.panel.setTab('rules');
  await wait(600);
  const select = document.querySelector('.ilb-bookbar select');
  if (!select) return { home, error: '规则页没有书籍选择器' };
  select.value = '${BOOK}';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(600);

  const seeded = {
    note: document.querySelector('.ilb-bookbar-note')?.textContent?.trim() ?? '',
    editButtons: [...document.querySelectorAll('button')].filter((b) => (b.textContent || '').trim() === '编辑').length,
  };

  const edit = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '编辑' && visible(b));
  if (!edit) return { home, seeded, error: '规则页找不到可见的「编辑」按钮' };
  edit.click();
  await wait(900);

  const sheets = [...document.querySelectorAll('.ilb-m-sheet')];
  const sheet = sheets[sheets.length - 1];
  if (!sheet) return { home, seeded, error: '点了编辑但没弹出浮层' };
  const foot = sheet.querySelector('.ilb-m-sheet-foot');
  const footBox = foot ? foot.getBoundingClientRect() : null;
  return {
    home,
    seeded,
    editor: {
      sheetTitle: sheet.querySelector('.ilb-m-sheet-title')?.textContent?.trim() ?? '',
      footButtons: foot ? [...foot.querySelectorAll('button')].map((b) => (b.textContent || '').trim()) : [],
      footBottom: footBox ? Math.round(footBox.bottom) : 0,
      viewportHeight: window.innerHeight,
      inputs: sheet.querySelectorAll('input, textarea, select').length,
      overflowNodes: overflow(sheet),
    },
  };
})()`);
console.log('手机视口：', JSON.stringify(result, null, 1));

await screenshot(page.send, 'tests/live/last-mobile.png');
console.log('截图：tests/live/last-mobile.png');

const cleaned = await page.evaluate(`(() => {
  const ok = globalThis.ILB.repository.deleteBook('${BOOK}');
  return { deleted: ok, booksLeft: globalThis.ILB.repository.listBooks().length };
})()`);
console.log('清理：', JSON.stringify(cleaned));

const { home, editor } = result;
const navOk = home.nav.length === 4 && ['书架', '规则', '逻辑', '更多'].every((label) => home.nav.some((t) => t.includes(label)));
const ok = home.dialogOpen && home.mobileShown && home.width >= 380 && navOk && home.overflowNodes === 0
  && home.bookBar && !result.error
  && editor && editor.footButtons.some((t) => t === '保存')
  && editor.footBottom >= editor.viewportHeight - 4
  && editor.overflowNodes === 0;
console.log(ok ? '✅ 通过' : '❌ 有项目没通过');
page.close();
process.exit(ok ? 0 : 1);
