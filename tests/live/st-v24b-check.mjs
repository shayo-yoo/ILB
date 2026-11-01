// tests/live/st-v24b-check.mjs —— 真实酒馆 + 手机视口，验 v0.24.1 的手机书架卡片
//
//   1) 折叠条移到标题栏后，点 chip 真的能展开它的内容（防“按钮点不开”回归）；
//   2) 默认卡片高度 ≤ 140px（3 本书并排对比）；
//   3) 手机「详情设置」打开底部抽屉，抽屉里是两列设置网格；
//   4) 打开/关闭抽屉不会改变卡片高度；改「进总池」立即写回；
//   5) 卡片上的「打开规则」仍能进规则页。
//
// 用法：
//   set ST_DIR=D:\1\APP\SillyTavern
//   node tests/live/st-v24b-check.mjs
import { openPage, waitForIlb, sleep, screenshot } from './cdp.mjs';

const ST_DIR = process.env.ST_DIR ?? 'D:/1/APP/SillyTavern';
const BOOKS = ['probe-v24b-1', 'probe-v24b-2', 'probe-v24b-3'];
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

let out;
try {
  out = await page.evaluate(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const text = (n) => (n?.textContent || '').trim();
    const visible = (n) => {
      if (!n) return false;
      const r = n.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(n).display !== 'none';
    };
    const result = {};

    for (const book of ILB.repository.listBooks()) {
      if (String(book.book_id).startsWith('probe-v24b-')) ILB.repository.deleteBook(book.book_id);
    }
    for (let i = 0; i < ${BOOKS.length}; i += 1) {
      ILB.repository.saveBook({
        book_id: '${BOOKS[0]}'.replace('-1', '-' + (i + 1)),
        name: ['验收书一', '验收书二（长一点的名字看看换行）', '验收书三'][i],
        entries: [{ id: 'e' + i, title: '规则' + (i + 1), content: 'x', trigger: { any: ['甲'] } }],
        logic: [],
      });
    }

    ILB.api.ui.openPanel('shelf');
    await wait(1400);
    const dialog = document.querySelector('dialog.ilb-m');
    result.mobileOpen = Boolean(dialog?.open);
    const cards = () => [...document.querySelectorAll('.ilb-book-card')];
    const firstCard = () => cards().find((c) => text(c).includes('验收书一'));
    result.cardCount = cards().length;
    result.cardHeights = cards().slice(0, 4).map((c) => Math.round(c.getBoundingClientRect().height));
    result.allCardsCompact = result.cardHeights.every((h) => h <= 140);

    // 1) chip 能展开内容（v0.24.1 回归点）
    const sortChip = [...document.querySelectorAll('.ilb-m-chip')].find((c) => text(c).includes('排序'));
    sortChip?.click();
    await wait(500);
    const rows = [...document.querySelectorAll('.ilb-m-top-row')];
    result.rowsVisibleAfterChip = rows.filter(visible).length;
    const sortRow = rows.find((r) => r.querySelector('.ilb-sort-key'));
    result.sortRowVisible = visible(sortRow);
    sortChip?.click();
    await wait(400);
    result.sortRowHiddenAfterSecond = !visible(sortRow);

    // 2) 详情抽屉
    const heightBefore = firstCard()?.getBoundingClientRect().height ?? 0;
    const detailBtn = [...firstCard().querySelectorAll('button')].find((b) => text(b) === '详情设置');
    result.hasDetailButton = Boolean(detailBtn);
    detailBtn?.click();
    await wait(700);
    const sheet = document.querySelector('.ilb-m-sheet');
    result.sheetOpen = Boolean(sheet);
    result.sheetHasGrid = Boolean(sheet?.querySelector('.ilb-set-grid'));
    const labels = sheet ? [...sheet.querySelectorAll('.ilb-set-label')].map(text) : [];
    result.sheetLabels = labels;
    result.sheetRowsAligned = sheet ? [...sheet.querySelectorAll('.ilb-set-row')].length : 0;

    // 3) 抽屉里改「进总池」立即写回
    const poolRow = sheet ? [...sheet.querySelectorAll('.ilb-set-row')].find((r) => text(r).includes('进总条目池')) : null;
    const poolBox = poolRow?.querySelector('input[type=checkbox]');
    result.poolBefore = Boolean(ILB.repository.getBook('${BOOKS[0]}')?.pool?.share);
    if (poolBox) {
      poolBox.checked = true;
      poolBox.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await wait(500);
    result.poolAfter = Boolean(ILB.repository.getBook('${BOOKS[0]}')?.pool?.share);

    // 4) 关抽屉后卡片高度不变
    const xBtn = sheet?.querySelector('.ilb-m-sheet-head .ilb-m-x');
    xBtn?.click();
    await wait(500);
    const heightAfter = firstCard()?.getBoundingClientRect().height ?? 0;
    result.cardHeightStable = Math.abs(heightAfter - heightBefore) < 8;
    result.sheetClosed = !visible(document.querySelector('.ilb-m-sheet'));

    // 5) 打开规则仍可用
    const openBtn = [...firstCard().querySelectorAll('button')].find((b) => text(b) === '打开规则');
    openBtn?.click();
    await wait(700);
    result.openedRules = ILB.panel.state.activeTab === 'rules';
    return result;
  })()`);
} catch (error) {
  out = { error: error?.message ?? String(error) };
}

try {
  await screenshot(page.send, new URL('./last-v24b-mobile.png', import.meta.url), undefined);
} catch (error) {
  console.log('截图失败：', error?.message ?? error);
}

try {
  await page.evaluate(`(() => {
    for (const id of ${JSON.stringify(BOOKS)}) ILB.repository.deleteBook(id);
    ILB.api.ui.close();
    return true;
  })()`);
} catch (error) {
  console.log('清理失败：', error?.message ?? error);
}

console.log(JSON.stringify(out, null, 2));
const ok = out && !out.error
  && out.cardCount >= 3 && out.allCardsCompact
  && out.sortRowVisible && out.sortRowHiddenAfterSecond
  && out.hasDetailButton && out.sheetOpen && out.sheetHasGrid && out.sheetRowsAligned >= 5
  && out.poolAfter === true && out.cardHeightStable && out.sheetClosed && out.openedRules;
console.log(ok ? '✅ v0.24.1 书架卡片检查通过' : '❌ 有项目没通过');
page.close();
process.exit(ok ? 0 : 1);
