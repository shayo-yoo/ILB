// tests/live/st-v23-check.mjs —— 真实酒馆 + 桌面视口，验 v0.23.0
//
// 这一轮用户点的几件事，假 DOM 覆盖不到的：
//   1) 书架卡片：默认紧凑、⋯ 菜单能开能关、详情能展开、舒适模式能切；
//   2) 排序：启用优先（停用的沉底）、主排序 + 次排序真的生效并记住；
//   3) 逻辑组：逻辑页有默认组，能新建组、能在组里新建逻辑（不依赖书籍）。
//
// 临时书 book_id = probe-v23；临时逻辑组/逻辑跑完删掉。
//
// 用法：
//   set ST_DIR=D:\1\APP\SillyTavern
//   node tests/live/st-v23-check.mjs
import { openPage, waitForIlb, sleep, screenshot } from './cdp.mjs';

const ST_DIR = process.env.ST_DIR ?? 'D:/1/APP/SillyTavern';
const BOOK = 'probe-v23';
const page = await openPage(ST_DIR);
await page.send('Runtime.enable');
await page.send('Page.enable');
await page.send('Emulation.setDeviceMetricsOverride', {
  width: 1360, height: 900, deviceScaleFactor: 1, mobile: false,
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
    const clickText = (root, want) => {
      const node = [...root.querySelectorAll('button')].find((b) => visible(b) && text(b) === want);
      if (!node) throw new Error('找不到按钮：' + want);
      node.click();
      return node;
    };
    const card = () => document.querySelector('.ilb-book-card');
    const cardMenu = () => document.querySelector('.ilb-book-menu');
    const result = {};

    // ---- 准备一本书：停用的在前、启用的在后，用来验「启用优先」 ----
    ILB.repository.saveBook({
      book_id: '${BOOK}',
      name: '验收书 v23',
      entries: [
        { id: 'e-off', title: '停用的规则', content: 'x', enabled: false, trigger: { any: ['甲'] }, injection: { position: 'after_char', depth: 4 } },
        { id: 'e-on', title: '启用的规则', content: 'y', enabled: true, trigger: { any: ['乙'] }, injection: { position: 'before_char', depth: 0 } },
      ],
      logic: [],
    });

    // ---- 书架卡片 ----
    ILB.panel.setTab('shelf');
    await wait(500);
    result.hasCard = Boolean(card());
    result.compactByDefault = Boolean(card()?.classList.contains('ilb-book-card-compact'));
    // ⋯ 菜单：默认不可见；点开可见；再点收起
    const menu = cardMenu();
    const moreBtn = [...card().querySelectorAll('button')].find((b) => text(b) === '⋯');
    result.menuHiddenAtFirst = !visible(menu);
    moreBtn.click();
    await wait(120);
    result.menuOpenAfterClick = visible(menu);
    moreBtn.click();
    await wait(120);
    result.menuClosedAfterSecondClick = !visible(menu);
    // 展开详情
    clickText(card(), '展开详情 ▾');
    await wait(300);
    result.detailOpened = [...document.querySelectorAll('.ilb-book-controls')].some(visible);
    result.detailButtonBecameCollapse = [...document.querySelectorAll('.ilb-book-foot button')].some((b) => text(b).includes('收起详情'));
    // 舒适模式
    clickText(document.querySelector('.ilb-shelf-modes'), '舒适');
    await wait(300);
    result.comfortApplied = Boolean(document.querySelector('.ilb-book-card')?.classList.contains('ilb-book-card-comfort'));
    result.modeSaved = ILB.repository.getUiState().shelfMode === 'comfort';
    clickText(document.querySelector('.ilb-shelf-modes'), '紧凑');
    await wait(200);

    // ---- 排序：启用优先 + 次排序 ----
    ILB.panel.setTab('rules');
    await wait(300);
    const bookSelect = document.querySelector('.ilb-bookbar select');
    if (bookSelect) {
      bookSelect.value = '${BOOK}';
      bookSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(400);
    }
    const titles = () => [...document.querySelectorAll('.ilb-rule-card .ilb-title')].map(text);
    result.orderEnabledFirst = titles();
    const second = document.querySelector('.ilb-sort-second');
    result.hasSecondSort = Boolean(second);
    if (second) {
      second.value = 'name';
      second.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(300);
      result.secondSaved = ILB.repository.getUiState().listSort?.rules?.secondKey === 'name';
    }
    // 切到手动排序，卡片上要有权重输入框
    const primary = document.querySelector('.ilb-sort-key');
    if (primary) {
      primary.value = 'manual';
      primary.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(300);
    }
    result.hasWeightInput = [...document.querySelectorAll('.ilb-sort-weight')].some(visible);

    // ---- 逻辑组 ----
    ILB.panel.setTab('logic');
    await wait(400);
    const groupSel = document.querySelector('.ilb-group-select');
    result.hasGroupSelect = Boolean(groupSel);
    result.groupCountAtStart = ILB.repository.listLogicGroups().length;
    // 新建一个组：点「新建组」，在浮层里填名字，点「建好」
    clickText(document.querySelector('.ilb-plus-bar'), '新建组');
    await wait(400);
    const overlay = document.querySelector('.ilb-overlay');
    const input = overlay?.querySelector('input.ilb-input');
    if (input) {
      input.value = '验收组';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      clickText(overlay, '建好');
    }
    await wait(500);
    result.groupCountAfterCreate = ILB.repository.listLogicGroups().length;
    const created = ILB.repository.listLogicGroups().find((g) => g.name === '验收组');
    result.createdGroupId = created?.id ?? null;

    // 在这个组里新建一条逻辑（不选书也能建）
    const addBtn = [...document.querySelectorAll('button')].find((b) => visible(b) && text(b) === '新增逻辑');
    if (addBtn) {
      addBtn.click();
      await wait(400);
      const ov = document.querySelector('.ilb-overlay');
      const nameInput = ov?.querySelector('input.ilb-input');
      if (nameInput) {
        nameInput.value = '验收逻辑';
        nameInput.dispatchEvent(new Event('input', { bubbles: true }));
        clickText(ov, '添加');
      }
      await wait(600);
    }
    const groupNow = created ? ILB.repository.listLogicGroups().find((g) => g.id === created.id) : null;
    const standalone = groupNow ? ILB.repository.listStandaloneLogics(groupNow.id) : [];
    result.logicCreatedInGroup = standalone.some((l) => l.name === '验收逻辑');
    result.logicGroupId = standalone[0]?.groupId ?? null;
    return result;
  })()`);
} catch (error) {
  out = { error: error?.message ?? String(error) };
}

// 截图
try {
  await screenshot(page.send, new URL('./last-v23-shelf.png', import.meta.url), undefined);
} catch (error) {
  console.log('截图失败：', error?.message ?? error);
}

// 清理
try {
  await page.evaluate(`(() => {
    ILB.repository.deleteBook('${BOOK}');
    for (const g of ILB.repository.listLogicGroups()) {
      if (g.name === '验收组') ILB.repository.deleteLogicGroup(g.id);
    }
    ILB.api.ui.close();
    return true;
  })()`);
} catch (error) {
  console.log('清理失败：', error?.message ?? error);
}

console.log(JSON.stringify(out, null, 2));
const ok = out && !out.error
  && out.hasCard && out.compactByDefault
  && out.menuHiddenAtFirst && out.menuOpenAfterClick && out.menuClosedAfterSecondClick
  && out.detailOpened && out.detailButtonBecameCollapse
  && out.comfortApplied && out.modeSaved
  && out.hasSecondSort && out.secondSaved && out.hasWeightInput
  && out.hasGroupSelect && out.groupCountAfterCreate >= out.groupCountAtStart
  && out.logicCreatedInGroup;
console.log(ok ? '✅ v0.23 界面检查通过' : '❌ 有项目没通过');
page.close();
process.exit(ok ? 0 : 1);
