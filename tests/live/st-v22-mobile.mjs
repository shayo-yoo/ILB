// tests/live/st-v22-mobile.mjs —— 真实酒馆 + 手机视口，验 v0.22.0 的手机界面改造
//
// 验的是这一轮用户点的几件事（都是假 DOM 覆盖不到的）：
//   1) 底栏常驻：挂在滚动区外、贴在窗口底部，内容长短都不动；
//   2) 顶部操作区：滚动时留在上方；
//   3) 「更多」是一个真的页面，不是浮层；
//   4) 排序：手动模式有权重输入框，改完顺序真的变、并且记住；
//   5) 分组：⋯ 里能设置分组。
//
// 仍是 Chrome 手机视口模拟，不是真机 WebView；键盘弹出这一项留着手测。
// 临时书 book_id = probe-v22，跑完删掉。
//
// 用法：
//   set ST_DIR=D:\1\APP\SillyTavern
//   node tests/live/st-v22-mobile.mjs
import { openPage, waitForIlb, sleep, screenshot } from './cdp.mjs';

const ST_DIR = process.env.ST_DIR ?? 'D:/1/APP/SillyTavern';
const BOOK = 'probe-v22';
const page = await openPage(ST_DIR);
await page.send('Runtime.enable');
await page.send('Page.enable');

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
  const dialog = () => document.querySelector('dialog.ilb-m');
  const navSlot = () => document.querySelector('.ilb-m-nav-slot');
  const stage = () => document.querySelector('.ilb-m-stage');
  const top = () => document.querySelector('.ilb-m-top');
  const label = (n) => (n?.textContent || '').trim();
  const entryTitles = () => [...document.querySelectorAll('.ilb-rule-card .ilb-title')].map(label);

  const seed = (count) => {
    globalThis.ILB.repository.saveBook({
      book_id: '${BOOK}',
      name: '验收书 v22',
      entries: Array.from({ length: count }, (_, i) => ({
        id: 'e-v22-' + i,
        title: '规则' + (i + 1),
        content: '验收内容 ' + (i + 1),
        trigger: { any: ['验收'] },
      })),
      logic: [],
    });
  };

  seed(1);
  globalThis.ILB.api.ui.openPanel('rules');
  await wait(1200);
  const d = dialog();
  if (!d || !d.open) return { error: '手机界面没打开' };

  const navNow = navSlot();
  const shortInfo = {
    navOutsideStage: Boolean(navNow) && !navNow.closest('.ilb-m-stage'),
    navBottom: navNow ? Math.round(navNow.getBoundingClientRect().bottom) : 0,
    viewport: window.innerHeight,
    topVisible: Boolean(top() && top().getBoundingClientRect().height > 0),
  };

  // 换成 12 条，底栏位置不能动
  seed(12);
  globalThis.ILB.panel.setTab('shelf');
  await wait(300);
  globalThis.ILB.panel.setTab('rules');
  await wait(700);
  // 手机上书籍在顶部「书籍」组里，先展开再选
  const bookChip = [...document.querySelectorAll('.ilb-m-chip')].find((c) => label(c).includes('书籍'));
  if (!bookChip) return { error: '顶部没有「书籍」组' };
  bookChip.click();
  await wait(300);
  const select = document.querySelector('.ilb-book-select');
  if (!select) return { error: '没有书籍选择器' };
  select.value = '${BOOK}';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(800);

  const longNavBottom = navNow ? Math.round(navNow.getBoundingClientRect().bottom) : 0;
  const cardCount = document.querySelectorAll('.ilb-rule-card').length;

  // 顶部操作区：滚动后还在上面
  const st = stage();
  const topBefore = top() ? Math.round(top().getBoundingClientRect().top) : null;
  if (st) st.scrollTop = 400;
  await wait(300);
  const topAfter = top() ? Math.round(top().getBoundingClientRect().top) : null;

  // 排序：展开「排序」→ 手动 → 改第一条权重
  const chip = [...document.querySelectorAll('.ilb-m-chip')].find((c) => label(c).includes('排序'));
  if (!chip) return { shortInfo, error: '没有排序展开按钮' };
  chip.click();
  await wait(400);
  const key = document.querySelector('.ilb-sort-key');
  if (!key) return { shortInfo, error: '展开后没有排序键下拉' };
  key.value = 'manual';
  key.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(600);
  const weights = [...document.querySelectorAll('.ilb-sort-weight')];
  const before = entryTitles();
  if (weights.length > 0) {
    // 把最后一条的权重抬到最高，它应该跳到最前面
    const input = weights[weights.length - 1];
    input.value = '999';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(700);
  }
  const after = entryTitles();
  const saved = globalThis.ILB.repository.getUiState().listSort?.rules ?? null;

  // 分组：⋯ → 设置分组
  const more = [...document.querySelectorAll('.ilb-icon-btn')].find((b) => label(b) === '⋯');
  if (!more) return { shortInfo, error: '卡片上没有 ⋯ 按钮' };
  more.click();
  await wait(300);
  const groupBtn = [...document.querySelectorAll('.ilb-menu button')].find((b) => label(b) === '设置分组');
  if (!groupBtn) return { shortInfo, error: '菜单里没有「设置分组」' };
  groupBtn.click();
  await wait(600);
  const input = [...document.querySelectorAll('.ilb-overlay input, .ilb-m-sheet input')].pop();
  if (!input) return { shortInfo, error: '设置分组没有输入框' };
  input.value = '验收组';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const okBtn = [...document.querySelectorAll('.ilb-overlay button, .ilb-m-sheet button')].find((b) => label(b) === '保存');
  if (!okBtn) return { shortInfo, error: '设置分组没有保存按钮' };
  okBtn.click();
  await wait(700);
  const bookNow = globalThis.ILB.repository.listBooks().find((b) => b.book_id === '${BOOK}');
  const groupSaved = bookNow?.entries?.some((e) => e.group === '验收组') ?? false;

  // 「更多」是页面
  const moreNav = [...document.querySelectorAll('.ilb-m-nav-btn')].find((b) => label(b).includes('更多'));
  if (!moreNav) return { shortInfo, error: '底栏没有「更多」' };
  moreNav.click();
  await wait(600);
  const moreText = document.querySelector('.ilb-tab-body')?.textContent || '';
  const morePage = {
    hasSnapshot: moreText.includes('快照'),
    hasDiagnostics: moreText.includes('诊断'),
    navHighlight: document.querySelector('.ilb-m-nav-btn.ilb-m-nav-active') ? label(document.querySelector('.ilb-m-nav-btn.ilb-m-nav-active')) : null,
    overlayOpen: Boolean(document.querySelector('.ilb-m-sheet')),
  };
  const settingBtn = [...document.querySelectorAll('.ilb-tab-body button')].find((b) => label(b) === '设置');
  if (settingBtn) {
    settingBtn.click();
    await wait(700);
  }
  const afterText = document.querySelector('.ilb-tab-body')?.textContent || '';
  const switched = Boolean(settingBtn) && afterText !== moreText && afterText.includes('设置');
  const morePageAfterClick = {
    switched,
    bodyHas: afterText.slice(0, 40),
    navHighlight: document.querySelector('.ilb-m-nav-btn.ilb-m-nav-active') ? label(document.querySelector('.ilb-m-nav-btn.ilb-m-nav-active')) : null,
  };

  return {
    shortInfo,
    longNavBottom,
    cardCount,
    top: { before: topBefore, after: topAfter },
    sort: { weights: weights.length, beforeFirst: before[0] ?? null, beforeLast: before[before.length - 1] ?? null, afterFirst: after[0] ?? null, saved },
    group: { saved: groupSaved },
    morePage,
    morePageAfterClick,
  };
})()`);
console.log('手机 v0.22：', JSON.stringify(result, null, 1));

await screenshot(page.send, 'tests/live/last-v22-mobile.png');
console.log('截图：tests/live/last-v22-mobile.png');

const cleaned = await page.evaluate(`(() => {
  const ok = globalThis.ILB.repository.deleteBook('${BOOK}');
  return { deleted: ok, booksLeft: globalThis.ILB.repository.listBooks().length };
})()`);
console.log('清理：', JSON.stringify(cleaned));

const ok = !result.error
  && result.shortInfo?.navOutsideStage === true
  && Math.abs(result.shortInfo.navBottom - result.shortInfo.viewport) <= 2
  && Math.abs(result.longNavBottom - result.shortInfo.viewport) <= 2
  && result.cardCount >= 10
  && Math.abs((result.top?.after ?? 0) - (result.top?.before ?? 0)) <= 3
  && result.sort?.weights >= 10
  && result.sort?.afterFirst === result.sort?.beforeLast
  && result.sort?.saved?.key === 'manual'
  && result.group?.saved === true
  && result.morePage?.hasSnapshot && result.morePage?.hasDiagnostics
  && result.morePage?.overlayOpen === false
  && result.morePageAfterClick?.switched === true;
console.log(ok ? '✅ 通过' : '❌ 有项目没通过');
page.close();
process.exit(ok ? 0 : 1);
