// tests/live/st-v24-check.mjs —— 真实酒馆 + 手机视口，验 v0.24.0
//
//   1) 顶部折叠条已经是标题栏的附属（在 head 里，不在滚动区），高度接近按钮本身；
//      标题栏最右侧的折叠按钮能把整条收起/展开；
//   2) 书籍选择器可以搜索（输入过滤后点一条，当前书籍跟着变），不再依赖原生下拉；
//   3) 搜索范围可选「只搜标题」，正文命中的词在标题范围下搜不到；
//   4) 紧凑/舒适不只是高度差：紧凑隐藏「酒馆关联」行，舒适显示。
//
// 用法：
//   set ST_DIR=D:\1\APP\SillyTavern
//   node tests/live/st-v24-check.mjs
import { openPage, waitForIlb, sleep, screenshot } from './cdp.mjs';

const ST_DIR = process.env.ST_DIR ?? 'D:/1/APP/SillyTavern';
const BOOK_A = 'probe-v24-a';
const BOOK_B = 'probe-v24-b';
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

    ILB.repository.saveBook({ book_id: '${BOOK_A}', name: '验收书阿尔法', entries: [
      { id: 'a1', title: '只搜标题能搜到', content: '正文里的独特词', trigger: { any: ['触发词'] } },
    ], logic: [] });
    ILB.repository.saveBook({ book_id: '${BOOK_B}', name: '验收书贝塔', entries: [], logic: [] });

    ILB.api.ui.openPanel('rules');
    await wait(1200);
    const dialog = document.querySelector('dialog.ilb-m');
    if (!dialog || !dialog.open) return { error: '手机界面没打开' };

    // 1) 折叠条属于标题栏
    const head = dialog.querySelector('.ilb-m-head');
    const slot = dialog.querySelector('.ilb-m-head-slot');
    const chips = dialog.querySelector('.ilb-m-chips');
    const fold = dialog.querySelector('.ilb-m-fold');
    result.chipsInHead = Boolean(head && slot && chips && head.contains(slot) && slot.contains(chips));
    result.chipsOutsideStage = !dialog.querySelector('.ilb-m-stage')?.contains(chips);
    result.chipsHeight = chips ? Math.round(chips.getBoundingClientRect().height) : 0;
    result.chipButtonHeight = chips ? Math.round(chips.querySelector('.ilb-m-chip').getBoundingClientRect().height) : 0;
    result.foldButtonExists = Boolean(fold);
    fold?.click();
    await wait(400);
    result.foldedHidesChips = !visible(dialog.querySelector('.ilb-m-chips'));
    document.querySelector('.ilb-m-fold')?.click();
    await wait(400);
    result.unfoldShowsChips = visible(dialog.querySelector('.ilb-m-chips'));

    // 2) 书籍选择器可搜索
    const pickerBtn = dialog.querySelector('.ilb-book-picker');
    result.bookPickerExists = Boolean(pickerBtn);
    pickerBtn?.click();
    await wait(400);
    const search = document.querySelector('.ilb-picker-search');
    result.pickerSearchExists = Boolean(search);
    const before = document.querySelectorAll('.ilb-picker-item').length;
    if (search) {
      search.value = '贝塔';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(250);
    }
    result.pickerItemsAfterFilter = document.querySelectorAll('.ilb-picker-item').length;
    result.pickerFiltered = before >= 2 && result.pickerItemsAfterFilter === 1;
    document.querySelector('.ilb-picker-item')?.click();
    await wait(500);
    result.bookChanged = ILB.panel.currentBook()?.book_id === '${BOOK_B}';

    // 3) 搜索范围
    const scope = document.querySelector('.ilb-search-scope');
    result.scopeSelectExists = Boolean(scope);
    // 没有数据时先切回有内容的书
    ILB.panel.state.activeBookId = '${BOOK_A}';
    ILB.panel.render();
    await wait(400);
    const searchInput = dialog.querySelector('.ilb-m-filter .ilb-search') ?? document.querySelector('.ilb-m-filter .ilb-search');
    // 手机上搜索在「筛选」组里：先展开
    if (!searchInput) {
      const chip = [...document.querySelectorAll('.ilb-m-chip')].find((c) => text(c).includes('筛选'));
      chip?.click();
      await wait(300);
    }
    const input = document.querySelector('.ilb-m-filter .ilb-search');
    const scopeNow = document.querySelector('.ilb-m-filter .ilb-search-scope');
    const countCards = () => document.querySelectorAll('.ilb-rule-card').length;
    if (input && scopeNow) {
      scopeNow.value = 'all';
      scopeNow.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(300);
      const contentInput = document.querySelector('.ilb-m-filter .ilb-search');
      contentInput.value = '独特词';
      contentInput.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(400);
      result.contentMatchAll = countCards();
      const scope2 = document.querySelector('.ilb-m-filter .ilb-search-scope');
      scope2.value = 'title';
      scope2.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(400);
      const input2 = document.querySelector('.ilb-m-filter .ilb-search');
      input2.value = '独特词';
      input2.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(400);
      result.contentMatchTitle = countCards();
      result.scopeWorks = result.contentMatchAll === 1 && result.contentMatchTitle === 0;
      result.scopeSaved = ILB.repository.getUiState().searchScope?.rules === 'title';
    }

    // 4) 紧凑/舒适差异
    ILB.panel.setTab('shelf');
    await wait(500);
    const card = () => document.querySelector('.ilb-book-card');
    const hostline = () => document.querySelector('.ilb-book-hostline');
    result.compactHidesHostline = Boolean(card()?.classList.contains('ilb-book-card-compact')) && !visible(hostline());
    const comfortBtn = [...document.querySelectorAll('.ilb-shelf-modes button')].find((b) => text(b) === '舒适');
    comfortBtn?.click();
    await wait(500);
    result.comfortShowsHostline = Boolean(card()?.classList.contains('ilb-book-card-comfort')) && visible(hostline());
    const compactBtn = [...document.querySelectorAll('.ilb-shelf-modes button')].find((b) => text(b) === '紧凑');
    compactBtn?.click();
    await wait(300);
    return result;
  })()`);
} catch (error) {
  out = { error: error?.message ?? String(error) };
}

try {
  await screenshot(page.send, new URL('./last-v24-mobile.png', import.meta.url), undefined);
} catch (error) {
  console.log('截图失败：', error?.message ?? error);
}

try {
  await page.evaluate(`(() => {
    ILB.repository.deleteBook('${BOOK_A}');
    ILB.repository.deleteBook('${BOOK_B}');
    ILB.api.ui.close();
    return true;
  })()`);
} catch (error) {
  console.log('清理失败：', error?.message ?? error);
}

console.log(JSON.stringify(out, null, 2));
const ok = out && !out.error
  && out.chipsInHead && out.chipsOutsideStage
  && out.chipsHeight <= 36 && out.foldButtonExists
  && out.foldedHidesChips && out.unfoldShowsChips
  && out.bookPickerExists && out.pickerSearchExists && out.pickerFiltered && out.bookChanged
  && out.scopeSelectExists && out.scopeWorks && out.scopeSaved
  && out.compactHidesHostline && out.comfortShowsHostline;
console.log(ok ? '✅ v0.24 界面检查通过' : '❌ 有项目没通过');
page.close();
process.exit(ok ? 0 : 1);
