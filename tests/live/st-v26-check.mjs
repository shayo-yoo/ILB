// tests/live/st-v26-check.mjs —— 真实酒馆，验 v0.26.0 的五处修复
//
//   1) 书架「⋯」→ 重命名：改显示名、book_id 不变；
//   2) 菜单 portal 到 body：不被浮窗裁掉，点「复制一本」不会穿透到下层；
//   3) 规则「⋯」→ 复制一条：只复制，不误触启用开关；
//   4) 手动开关排到「打开规则 / 详情设置」前面；
//   5) 搜索防抖 + 重画后焦点回得来；
//   6) 逻辑编辑器保存/取消固定在浮层底部。
//
// 用法：
//   set ST_DIR=D:\1\APP\SillyTavern
//   node tests/live/st-v26-check.mjs
import { openPage, waitForIlb, sleep, screenshot } from './cdp.mjs';

const ST_DIR = process.env.ST_DIR ?? 'D:/1/APP/SillyTavern';
const BOOK = 'probe-v26';
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

const out = await page.evaluate(`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const text = (n) => (n?.textContent || '').trim();
  const visible = (n) => {
    if (!n) return false;
    const r = n.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(n).display !== 'none';
  };
  const result = {};

  ILB.repository.deleteBook('${BOOK}');
  for (let i = 1; i <= 6; i += 1) {
    ILB.repository.saveBook({
      book_id: '${BOOK}-' + i,
      name: '验收书 ' + i,
      activation: { strategy: 'manual' },
      entries: [
        { id: 'r1', title: '规则一', content: '甲', trigger: { any: ['甲'] }, enabled: true },
        { id: 'r2', title: '规则二', content: '乙', trigger: { any: ['乙'] }, enabled: true },
      ],
      logic: [{ id: 'l1', name: '逻辑一', trigger: { any: ['丙'] }, logic: { mode: 'and', nodes: [{ kind: 'text', text: 'x' }] } }],
    });
  }

  ILB.api.ui.openPanel('shelf');
  await wait(1200);
  const win = document.querySelector('.ilb-window');
  result.windowRect = win ? { top: Math.round(win.getBoundingClientRect().top), bottom: Math.round(win.getBoundingClientRect().bottom), height: Math.round(win.getBoundingClientRect().height) } : null;

  // 卡片第三行顺序：手动开关在「打开规则 / 详情设置」之前
  const firstCard = document.querySelector('.ilb-book-card');
  const foot = firstCard?.querySelector('.ilb-book-foot');
  const footChildren = foot ? [...foot.children] : [];
  result.footFirstClass = footChildren[0] ? String(footChildren[0].className) : '';
  result.footFirstText = footChildren[0] ? text(footChildren[0]) : '';
  result.footOrderOk = Boolean(footChildren[0]?.querySelector('input[type=checkbox]'))
    && footChildren.slice(1).some((n) => text(n) === '打开规则');

  // 1) 重命名：认准探针自己的「验收书 1」，别改成用户的书
  const targetCard = () => [...document.querySelectorAll('.ilb-book-card')]
    .find((c) => text(c.querySelector('.ilb-book-title')) === '验收书 1');
  const targetBook = () => (ILB.repository.listBooks() ?? []).find((b) => b.name === '验收书 1');
  const targetId = targetBook()?.book_id;
  const targetMenuBtn = targetCard()?.querySelector('.ilb-icon-btn');
  targetMenuBtn?.click();
  await wait(400);
  let menu = document.querySelector('.ilb-menu-pop');
  result.menuInBody = Boolean(menu && !win?.contains(menu));
  result.menuRect = menu ? { top: Math.round(menu.getBoundingClientRect().top), bottom: Math.round(menu.getBoundingClientRect().bottom) } : null;
  const renameItem = menu ? [...menu.querySelectorAll('button')].find((b) => text(b) === '重命名…') : null;
  result.hasRename = Boolean(renameItem);
  renameItem?.click();
  await wait(500);
  const nameInput = document.querySelector('.ilb-modal input[type=text]');
  result.renameDialog = Boolean(nameInput);
  if (nameInput) {
    nameInput.value = '改名后的验收书';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    const saveBtn = [...document.querySelectorAll('.ilb-modal button')].find((b) => text(b) === '保存');
    saveBtn?.click();
  }
  await wait(600);
  const renamed = targetId ? (ILB.repository.listBooks() ?? []).find((b) => b.book_id === targetId) : null;
  result.renamed = renamed?.name === '改名后的验收书';
  result.renameKeptId = Boolean(renamed && renamed.book_id === targetId);
  result.renameDialogClosed = !document.querySelector('.ilb-modal');

  // 2) 最后一张卡的「⋯」：菜单贴底时不被浮窗裁掉，点「复制一本」不穿透
  const cards = () => [...document.querySelectorAll('.ilb-book-card')];
  const lastCard = cards()[cards().length - 1];
  lastCard.scrollIntoView({ block: 'end' });
  await wait(400);
  const lastTitle = text(lastCard.querySelector('.ilb-book-title'));
  const lastMenuBtn = lastCard.querySelector('.ilb-icon-btn');
  const anchorBook = (ILB.repository.listBooks() ?? []).find((b) => b.name === lastTitle);
  const manualBefore = anchorBook ? ILB.repository.getManualState?.()[anchorBook.book_id] ?? null : null;
  const countBefore = cards().length;
  lastMenuBtn?.click();
  await wait(450);
  menu = document.querySelector('.ilb-menu-pop');
  result.bottomMenuOpen = Boolean(menu);
  if (menu) {
    const r = menu.getBoundingClientRect();
    result.bottomMenuInsideViewport = r.top >= 0 && r.bottom <= window.innerHeight + 1;
    // 菜单现在就应该能伸出浮窗——伸不出去反而说明又被裁了。
    result.bottomMenuOutsideWindow = win ? r.bottom > win.getBoundingClientRect().bottom + 1 : null;
    result.bottomMenuPortal = !win?.contains(menu);
    const items = [...menu.querySelectorAll('button')];
    const lastItem = items[items.length - 1];
    const hit = lastItem ? document.elementFromPoint(
      Math.round(lastItem.getBoundingClientRect().left + 10),
      Math.round(lastItem.getBoundingClientRect().top + 5),
    ) : null;
    result.lastItemHitTest = hit === lastItem || lastItem?.contains(hit);
    const copyItem = items.find((b) => text(b) === '复制一本');
    copyItem?.click();
  }
  await wait(700);
  result.copyWorked = cards().length === countBefore + 1;
  const copied = (ILB.repository.listBooks() ?? []).find((b) => b.name === (lastTitle + ' 副本'));
  result.copyName = Boolean(copied);
  // 点菜单项不能顺手点到底下的手动开关
  result.manualUntouched = anchorBook
    ? (ILB.repository.getManualState?.()[anchorBook.book_id] ?? null) === manualBefore
    : true;

  // 3) 规则页「⋯」→ 复制一条：不误触启用
  ILB.panel.setTab('rules');
  ILB.panel.state.activeBookId = copied?.book_id ?? '${BOOK}-1';
  ILB.panel.render();
  await wait(700);
  const ruleCard = document.querySelector('.ilb-rule-card');
  const ruleBookId = ILB.panel.state.activeBookId;
  const entriesBefore = (ILB.repository.getBook(ruleBookId)?.entries ?? []).map((e) => ({ id: e.id, enabled: e.enabled !== false }));
  const ruleMenuBtn = ruleCard?.querySelector('.ilb-icon-btn');
  ruleMenuBtn?.click();
  await wait(450);
  const ruleMenu = document.querySelector('.ilb-menu-pop');
  result.ruleMenuOpen = Boolean(ruleMenu);
  const dup = ruleMenu ? [...ruleMenu.querySelectorAll('button')].find((b) => text(b) === '复制一条') : null;
  dup?.click();
  await wait(700);
  const entriesAfter = ILB.repository.getBook(ruleBookId)?.entries ?? [];
  result.ruleCopyWorked = entriesAfter.length === entriesBefore.length + 1;
  result.ruleFlagsKept = entriesBefore.every((old) => {
    const now = entriesAfter.find((e) => e.id === old.id);
    return now && (now.enabled !== false) === old.enabled;
  });

  // 4) 搜索防抖 + 焦点：打一个字后 80ms 不应重画丢焦点，400ms 后才筛
  ILB.panel.setTab('shelf');
  ILB.panel.render();
  await wait(600);
  const search = document.querySelector('.ilb-search');
  result.hasSearch = Boolean(search);
  if (search) {
    const countBeforeSearch = cards().length;
    search.focus();
    search.value = '验收';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(80);
    result.focusAfter80 = document.activeElement === search;
    result.countAfter80 = cards().length;
    await wait(500);
    result.countAfterDebounce = cards().length;
    result.debounced = result.countAfterDebounce < countBeforeSearch && result.countAfterDebounce > 0;
    const searchAgain = document.querySelector('.ilb-search');
    result.focusAfterRedraw = document.activeElement === searchAgain;
  }

  // 5) 逻辑编辑器：保存/取消固定在浮层底部
  ILB.panel.setTab('logic');
  await wait(700);
  const newLogic = [...document.querySelectorAll('button')].find((b) => text(b) === '新增逻辑');
  newLogic?.click();
  await wait(800);
  const footerEl = document.querySelector('.ilb-modal-foot');
  result.logicFooter = Boolean(footerEl);
  const saveBtn = footerEl ? [...footerEl.querySelectorAll('button')].find((b) => text(b) === '保存' || text(b) === '添加') : null;
  result.logicSaveInFooter = Boolean(saveBtn);
  if (footerEl && saveBtn) {
    const before = Math.round(saveBtn.getBoundingClientRect().bottom);
    const modal = document.querySelector('.ilb-modal');
    const scroller = modal?.querySelector('.ilb-modal-body') ?? modal;
    if (scroller) scroller.scrollTop = 9999;
    await wait(400);
    const after = Math.round(saveBtn.getBoundingClientRect().bottom);
    result.footerStayed = Math.abs(after - before) <= 2;
    result.footerInViewport = after <= window.innerHeight + 1;
  }
  document.querySelector('.ilb-modal-x')?.click();
  await wait(400);

  // 清理：探针自己建的书与「副本」都删掉，别动用户原来的书
  for (const b of ILB.repository.listBooks() ?? []) {
    const id = String(b.book_id);
    const name = String(b.name ?? '');
    if (id.startsWith('${BOOK}') || name.startsWith('验收书 ') || name === '改名后的验收书') {
      ILB.repository.deleteBook(id);
    }
  }
  result.cleaned = (ILB.repository.listBooks() ?? []).every((b) => !/^(验收书 |改名后的验收书)/.test(String(b.name ?? '')))
    && (ILB.repository.listBooks() ?? []).every((b) => !String(b.book_id).startsWith('${BOOK}'));
  // 截一张干净的：书架 + 一个展开的「⋯」菜单
  ILB.panel.state.bookQuery = '';
  ILB.panel.setTab('shelf');
  ILB.panel.render();
  await wait(600);
  document.querySelector('.ilb-book-card .ilb-icon-btn')?.click();
  await wait(400);
  return result;
})()`);

await screenshot(page.send, new URL('./last-v26-desktop.png', import.meta.url), undefined);
console.log(JSON.stringify(out, null, 2));

// ---- 手机：菜单要挂进对话框（top layer），别被整屏界面裁掉 ----
await page.send('Emulation.setDeviceMetricsOverride', {
  width: 390, height: 844, deviceScaleFactor: 3, mobile: true,
});
await page.send('Page.reload', { ignoreCache: false });
await sleep(9000);
const mobileOk = await waitForIlb(page.evaluate);
const mobile = mobileOk ? await page.evaluate(`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const text = (n) => (n?.textContent || '').trim();
  const result = {};

  ILB.repository.deleteBook('${BOOK}-mobile');
  ILB.repository.saveBook({
    book_id: '${BOOK}-mobile',
    name: '手机会话验收书',
    activation: { strategy: 'manual' },
    entries: [
      { id: 'm1', title: '规则A', content: '甲', trigger: { any: ['甲'] } },
      { id: 'm2', title: '规则B', content: '乙', trigger: { any: ['乙'] } },
      { id: 'm3', title: '规则C', content: '丙', trigger: { any: ['丙'] } },
    ],
    logic: [],
  });
  ILB.api.ui.openPanel('rules');
  await wait(1200);
  ILB.panel.state.activeBookId = '${BOOK}-mobile';
  ILB.panel.render();
  await wait(700);
  const dialog = document.querySelector('dialog.ilb-m');
  const cards = [...document.querySelectorAll('.ilb-rule-card')];
  result.mobileCards = cards.length;
  cards[cards.length - 1].scrollIntoView({ block: 'bottom' });
  await wait(400);
  const toggle = cards[cards.length - 1].querySelector('.ilb-icon-btn');
  toggle?.click();
  await wait(450);
  const menu = document.querySelector('.ilb-menu-pop');
  result.mobileMenuOpen = Boolean(menu);
  result.mobileMenuInDialog = Boolean(menu && dialog?.contains(menu));
  if (menu) {
    const r = menu.getBoundingClientRect();
    result.mobileMenuInViewport = r.top >= 0 && r.bottom <= window.innerHeight + 1 && r.left >= 0 && r.right <= window.innerWidth + 1;
    const items = [...menu.querySelectorAll('button')];
    const last = items[items.length - 1];
    const hit = last ? document.elementFromPoint(
      Math.round(last.getBoundingClientRect().left + 8),
      Math.round(last.getBoundingClientRect().top + 5),
    ) : null;
    result.mobileHitTest = Boolean(last && (hit === last || last.contains(hit)));
    items.find((b) => text(b) === '复制一条')?.click();
  }
  await wait(700);
  result.mobileCopyWorked = (ILB.repository.getBook('${BOOK}-mobile')?.entries ?? []).length === 4;

  // 书架卡片的「⋯ → 重命名…」在手机上走底部抽屉
  ILB.panel.setTab('shelf');
  await wait(600);
  const bookCard = document.querySelector('.ilb-book-card');
  bookCard?.querySelector('.ilb-icon-btn')?.click();
  await wait(400);
  const shelfMenu = document.querySelector('.ilb-menu-pop');
  result.mobileShelfMenu = Boolean(shelfMenu && dialog?.contains(shelfMenu));
  [...(shelfMenu?.querySelectorAll('button') ?? [])].find((b) => text(b) === '重命名…')?.click();
  await wait(700);
  const sheet = document.querySelector('.ilb-m-sheet');
  result.mobileRenameSheet = Boolean(sheet);
  result.mobileRenameHasInput = Boolean(sheet?.querySelector('input[type=text]'));
  result.mobileRenameHasSave = Boolean([...(sheet?.querySelectorAll('button') ?? [])].some((b) => text(b) === '保存'));
  sheet?.querySelector('.ilb-m-sheet-head .ilb-m-x')?.click();
  await wait(400);

  ILB.repository.deleteBook('${BOOK}-mobile');
  result.mobileCleaned = !ILB.repository.getBook('${BOOK}-mobile');
  return result;
})()`) : { skipped: true };

await screenshot(page.send, new URL('./last-v26-mobile.png', import.meta.url), undefined);
console.log('MOBILE', JSON.stringify(mobile, null, 2));

const checks = [
  ['卡片第三行第一个是手动开关', out.footOrderOk === true],
  ['菜单挂在 body 里（不在浮窗内）', out.menuInBody === true],
  ['菜单里有「重命名…」', out.hasRename === true],
  ['重命名生效且 book_id 不变', out.renamed === true && out.renameKeptId === true],
  ['重命名弹层关掉了', out.renameDialogClosed === true],
  ['贴底菜单在视口内、且能伸出浮窗', out.bottomMenuInsideViewport === true && out.bottomMenuPortal === true && out.bottomMenuOutsideWindow === true],
  ['菜单最后一项能被点中（没被裁掉）', out.lastItemHitTest === true],
  ['点「复制一本」真的复制了', out.copyWorked === true && out.copyName === true],
  ['点菜单没有顺手改手动开关', out.manualUntouched === true],
  ['规则「⋯」能弹出', out.ruleMenuOpen === true],
  ['点「复制一条」只复制', out.ruleCopyWorked === true && out.ruleFlagsKept === true],
  ['搜索 80ms 内没丢焦点', out.focusAfter80 === true],
  ['搜索停下来才筛', out.debounced === true],
  ['重画后焦点还在搜索框', out.focusAfterRedraw === true],
  ['逻辑保存按钮在底栏', out.logicSaveInFooter === true],
  ['滚动后底栏不动且在视口内', out.footerStayed === true && out.footerInViewport === true],
  ['探针数据清理干净', out.cleaned === true],
  ['手机：规则卡「⋯」菜单挂在对话框里且在视口内', mobile.mobileMenuInDialog === true && mobile.mobileMenuInViewport === true],
  ['手机：菜单最后一项能点中', mobile.mobileHitTest === true],
  ['手机：点「复制一条」生效', mobile.mobileCopyWorked === true],
  ['手机：书架「⋯」菜单也挂在对话框里', mobile.mobileShelfMenu === true],
  ['手机：重命名走底部抽屉', mobile.mobileRenameSheet === true && mobile.mobileRenameHasInput === true],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? '✅' : '❌'} ${name}`);
  if (!ok) failed += 1;
}
page.close();
if (failed > 0) {
  console.log(`\n❌ ${failed} 项没通过`);
  process.exit(1);
}
console.log('\n✅ v0.26 修复检查通过');
