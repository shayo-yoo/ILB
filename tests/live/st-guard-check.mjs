// tests/live/st-guard-check.mjs —— 真实酒馆里验「改到一半」的拦截
//
// 验的是假 DOM 测不准的那一支（真浏览器里的层级、焦点、按钮可点）：
//   B3-a 桌面：编辑规则改一个字 → 点 × → 出现三选一确认；选「继续编辑」草稿还在；
//        再点 × → 选「放弃修改」→ 浮层关掉。
//   B3-b 桌面：改一个字 → 切页（panel.setTab）→ 出现确认；选「继续编辑」不切页；
//        再切 → 选「放弃修改」→ 切到书架。
//   B3-c 手机：手机视口下打开编辑浮层改一个字 → 给 <dialog> 派发 cancel（等同返回键）
//        → 出现确认；选「继续编辑」浮层还在；再派发 → 选「放弃修改」→ 浮层关掉。
//   E4 手机：列表 / 分支表单的编辑浮层不横向溢出。
//
// 会临时建一本「守卫测试书」（book_id = probe-guard），跑完删掉；不动已有数据。
//
// 用法：
//   set ST_DIR=D:\1\APP\SillyTavern
//   node tests/live/st-guard-check.mjs
import { openPage, waitForIlb, sleep, screenshot } from './cdp.mjs';

const ST_DIR = process.env.ST_DIR ?? 'D:/1/APP/SillyTavern';
const BOOK = 'probe-guard';
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

const desktop = await page.evaluate(`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const vis = (el) => Boolean(el && el.getClientRects().length && el.getBoundingClientRect().width > 20);
  const byText = (root, text, sel = 'button') => [...root.querySelectorAll(sel)]
    .find((b) => (b.textContent || '').trim() === text && vis(b));
  const guard = () => document.querySelector('.ilb-guard');
  const guardButtons = () => guard()
    ? [...guard().querySelectorAll('button')].map((b) => (b.textContent || '').trim())
    : [];
  const editorInput = () => {
    const root = document.querySelector('.ilb-overlay');
    if (!root) return null;
    return [...root.querySelectorAll('input[type="text"], textarea')].find((el) => vis(el)) ?? null;
  };
  const typeDirty = () => {
    const input = editorInput();
    if (!input) return { error: '找不到标题输入框' };
    input.value = (input.value || '验收规则') + '（改过）';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return { value: input.value };
  };

  const books = globalThis.ILB.repository;
  books.saveBook({
    book_id: '${BOOK}',
    name: '守卫测试书',
    entries: [{ id: 'e-guard', title: '守卫规则', content: '改到一半不该丢。', trigger: { any: ['守卫'] } }],
    logic: [{ id: 'l-guard', name: '守卫逻辑', enabled: true, nodes: [
      { kind: 'list', id: 'n-list', name: '表', op: 'set', value: { type: 'text', value: '甲,乙' }, separator: ',' },
      { kind: 'repeat', id: 'n-rep', mode: 'list', listName: '表', itemName: '项', body: [
        { kind: 'set', id: 'n-set', name: '记', op: 'append', value: { type: 'var', name: '项' } },
      ] },
    ] }],
  });
  globalThis.ILB.api.ui.openPanel('rules');
  await wait(900);
  globalThis.ILB.panel.setTab('shelf');
  await wait(200);
  globalThis.ILB.panel.setTab('rules');
  await wait(700);
  const select = document.querySelector('.ilb-bookbar select');
  if (!select) return { error: '规则页没有书籍选择器' };
  select.value = '${BOOK}';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(600);

  const openEditor = async () => {
    const edit = byText(document, '编辑');
    if (!edit) return false;
    edit.click();
    await wait(800);
    return Boolean(document.querySelector('.ilb-overlay'));
  };
  const closeX = () => {
    const x = document.querySelector('.ilb-overlay .ilb-modal-x');
    if (!x) return false;
    x.click();
    return true;
  };

  // ---- B3-a 桌面 × ----
  if (!(await openEditor())) return { error: '规则页打不开编辑器' };
  typeDirty();
  closeX();
  await wait(400);
  const a1 = {
    guardShown: Boolean(guard()),
    buttons: guardButtons(),
  };
  byText(guard() ?? document, '继续编辑')?.click();
  await wait(300);
  const a2 = {
    guardGone: !guard(),
    overlayStillOpen: Boolean(document.querySelector('.ilb-overlay')),
    valueKept: (editorInput()?.value ?? '').includes('（改过）'),
  };
  closeX();
  await wait(300);
  byText(guard() ?? document, '放弃修改')?.click();
  await wait(500);
  const a3 = {
    overlayClosed: !document.querySelector('.ilb-overlay'),
    guardGone: !guard(),
  };

  // ---- B3-b 桌面切页 ----
  const reopened = await openEditor();
  if (reopened) typeDirty();
  const tabBefore = document.querySelector('.ilb-tabs .ilb-tab-active')?.textContent?.trim() ?? null;
  globalThis.ILB.panel.setTab('shelf');
  await wait(400);
  const b1 = {
    guardShown: Boolean(guard()),
    buttons: guardButtons(),
    tabBefore,
  };
  byText(guard() ?? document, '继续编辑')?.click();
  await wait(300);
  const b2 = {
    guardGone: !guard(),
    stillRules: Boolean(document.querySelector('.ilb-bookbar')),
    overlayStillOpen: Boolean(document.querySelector('.ilb-overlay')),
  };
  globalThis.ILB.panel.setTab('shelf');
  await wait(400);
  byText(guard() ?? document, '放弃修改')?.click();
  await wait(500);
  const b3 = {
    shelfShown: !document.querySelector('.ilb-bookbar'),
    overlayClosed: !document.querySelector('.ilb-overlay'),
    guardGone: !guard(),
  };
  if (document.querySelector('.ilb-overlay')) closeX();

  return { a: { a1, a2, a3 }, b: { b1, b2, b3 } };
})()`);
console.log('桌面守卫：', JSON.stringify(desktop, null, 1));

// ---- 手机：返回键（dialog cancel） ----
await page.send('Emulation.setDeviceMetricsOverride', {
  width: 390, height: 844, deviceScaleFactor: 3, mobile: true,
});
await page.send('Page.reload', { ignoreCache: false });
await sleep(9000);
if (!(await waitForIlb(page.evaluate))) {
  console.log('❌ 手机视口里没有 globalThis.ILB');
  page.close();
  process.exit(1);
}

const mobile = await page.evaluate(`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const vis = (el) => Boolean(el && el.getClientRects().length && el.getBoundingClientRect().width > 20);
  const byText = (root, text, sel = 'button') => [...root.querySelectorAll(sel)]
    .find((b) => (b.textContent || '').trim() === text && vis(b));
  const guard = () => document.querySelector('.ilb-guard');
  const guardButtons = () => guard()
    ? [...guard().querySelectorAll('button')].map((b) => (b.textContent || '').trim())
    : [];
  const sheet = () => {
    const all = [...document.querySelectorAll('.ilb-m-sheet')];
    return all[all.length - 1] ?? null;
  };
  const overflow = (root) => [...root.querySelectorAll('*')]
    .filter((el) => el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0).length;

  globalThis.ILB.api.ui.openPanel('rules');
  await wait(1000);
  globalThis.ILB.panel.setTab('shelf');
  await wait(200);
  globalThis.ILB.panel.setTab('rules');
  await wait(700);
  const select = document.querySelector('.ilb-bookbar select');
  if (!select) return { error: '手机规则页没有书籍选择器' };
  select.value = '${BOOK}';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(600);
  const edit = byText(document, '编辑');
  if (!edit) return { error: '手机规则页找不到编辑' };
  edit.click();
  await wait(900);
  if (!sheet()) return { error: '手机编辑器浮层没打开' };

  const input = [...sheet().querySelectorAll('input[type="text"], textarea')].find(vis);
  if (!input) return { error: '手机编辑器找不到输入框' };
  input.value = (input.value || '守卫规则') + '（改过）';
  input.dispatchEvent(new Event('input', { bubbles: true }));

  const dialog = document.querySelector('dialog.ilb-m');
  const cancel = () => dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
  cancel();
  await wait(400);
  const m1 = { guardShown: Boolean(guard()), buttons: guardButtons(), sheetStill: Boolean(sheet()) };
  byText(guard() ?? document, '继续编辑')?.click();
  await wait(300);
  const m2 = { guardGone: !guard(), sheetStill: Boolean(sheet()) };
  cancel();
  await wait(400);
  byText(guard() ?? document, '放弃修改')?.click();
  await wait(600);
  const m3 = { guardGone: !guard(), sheetGone: !sheet() };

  // ---- E4 列表/分支表单不横向溢出 ----
  const logicNav = [...document.querySelectorAll('.ilb-m-nav-btn')].find((b) => (b.textContent || '').includes('逻辑'));
  if (logicNav) {
    logicNav.click();
    await wait(700);
    const logicSelect = document.querySelector('.ilb-bookbar select');
    if (logicSelect) {
      logicSelect.value = '${BOOK}';
      logicSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(600);
    }
    const logicEdit = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '编辑' && vis(b));
    if (logicEdit) {
      logicEdit.click();
      await wait(1200);
      const s2 = sheet();
      if (!s2) return { m: { m1, m2, m3 }, e4: { error: '手机逻辑编辑器浮层没打开' } };
      // 逻辑编辑器里流程是直接铺开的，不需要再点「编辑流程」。
      const expand = byText(s2, '全部展开');
      if (expand) {
        expand.click();
        await wait(600);
      }
      const e4 = {
        sheet: true,
        overflowNodes: overflow(s2),
        hasExpand: Boolean(expand),
        hasList: (s2.textContent || '').includes('列表'),
        hasSwitch: (s2.textContent || '').includes('分支'),
      };
      const save = byText(s2, '保存');
      if (save) save.click();
      return { m: { m1, m2, m3 }, e4 };
    }
    return { m: { m1, m2, m3 }, e4: { error: '逻辑页找不到「编辑」' } };
  }
  return { m: { m1, m2, m3 }, e4: { error: '底部找不到「逻辑」入口' } };
})()`);
console.log('手机守卫：', JSON.stringify(mobile, null, 1));

await screenshot(page.send, 'tests/live/last-guard.png');
console.log('截图：tests/live/last-guard.png');

const cleaned = await page.evaluate(`(() => {
  const ok = globalThis.ILB.repository.deleteBook('${BOOK}');
  return { deleted: ok, booksLeft: globalThis.ILB.repository.listBooks().length };
})()`);
console.log('清理：', JSON.stringify(cleaned));

const d = desktop ?? {};
const a = d.a ?? {};
const b = d.b ?? {};
const m = mobile?.m ?? {};
const e4 = mobile?.e4 ?? {};
const three = ['保存并离开', '放弃修改', '继续编辑'];
const guardOk = (x) => x && x.guardShown && three.every((t) => x.buttons.includes(t));
const ok = guardOk(a.a1) && a.a2?.overlayStillOpen && a.a2?.valueKept && a.a3?.overlayClosed
  && guardOk(b.b1) && b.b2?.stillRules && b.b2?.overlayStillOpen && b.b3?.shelfShown && b.b3?.overlayClosed
  && guardOk(m.m1) && m.m2?.sheetStill && m.m3?.sheetGone
  && e4?.sheet === true && e4?.overflowNodes === 0;
console.log(ok ? '✅ 通过' : '❌ 有项目没通过');
page.close();
process.exit(ok ? 0 : 1);
