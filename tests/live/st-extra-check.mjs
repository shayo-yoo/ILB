// tests/live/st-extra-check.mjs —— 真实酒馆里补两条自动能做的验收
//
// C2：条件组 / 按概率 / 重复 / 结束 四种节点在文本模式里原样往返；
// E2：列表超过上限时只做前 50 项，并且把「只做前 50 项」说出来。
//
// 用法：
//   set ST_DIR=D:\1\APP\SillyTavern
//   node tests/live/st-extra-check.mjs
import { openPage, waitForIlb, sleep, screenshot } from './cdp.mjs';

const ST_DIR = process.env.ST_DIR ?? 'D:/1/APP/SillyTavern';
const BOOK = 'probe-extra';
const E2_BOOK = 'probe-extra-e2';

const page = await openPage(ST_DIR);
await page.send('Runtime.enable');
await page.send('Page.enable');
await page.send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false });
await page.send('Page.reload', { ignoreCache: false });
await sleep(9000);

if (!(await waitForIlb(page.evaluate))) {
  console.log('❌ 页面里没有 globalThis.ILB（扩展没加载起来）');
  page.close();
  process.exit(1);
}

const PROGRAM_LINES = [
  '关键词 + 流程',
  '条件组 全部满足',
  '  条件 已聊至少 1 条',
  '  条件 $hp 有值',
  '  成立',
  '    变量 $hp 增加 5',
  '  不成立',
  '    按概率 30%',
  '      成立',
  '        重复 3 次',
  '          添加 "转三圈"',
  '      不成立',
  '        结束 当作不通过 "都不成立"',
];
const PROGRAM = PROGRAM_LINES.join('\\n');
// 比较时不算第一行模式（渲染结果总是带「关键词 + 流程」）
const PROGRAM_BODY = PROGRAM_LINES.slice(1).join('\\n');

const result = await page.evaluate(`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => Boolean(el && el.getClientRects().length && el.getBoundingClientRect().width > 20);
  const buttons = () => [...document.querySelectorAll('button')];
  const clickText = (text) => {
    const b = buttons().find((x) => (x.textContent || '').trim() === text && visible(x));
    if (!b) return false;
    b.click();
    return true;
  };
  const textOf = (node) => (node ? node.textContent || '' : '');
  const out = {};

  globalThis.ILB.repository.saveBook({
    book_id: '${BOOK}',
    name: '复杂往返验收书',
    entries: [{ id: 'e-text', title: '复杂往返规则', content: '正文', trigger: { any: ['文本'] } }],
    logic: [],
  });
  globalThis.ILB.api.ui.openPanel('rules');
  await wait(1200);
  const select = document.querySelector('.ilb-bookbar select');
  if (!select) return { error: '规则页没有书籍选择器' };
  select.value = '${BOOK}';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(500);

  if (!clickText('编辑')) return { error: '找不到可见的「编辑」按钮' };
  await wait(700);
  const flowOpen = buttons().find((b) => /编辑流程|改流程/.test((b.textContent || '').trim()) && visible(b));
  if (flowOpen) { flowOpen.click(); await wait(500); }
  if (!clickText('文本模式')) return { error: '编辑器里找不到「文本模式」按钮' };
  await wait(500);

  const area = document.querySelector('.ilb-flow-text .ilb-flow-area') || document.querySelector('.ilb-flow-area');
  if (!area) return { error: '文本模式里没有输入区' };
  area.value = '${PROGRAM}';
  area.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(400);
  const report = textOf(document.querySelector('.ilb-flow-problems'));

  if (!clickText('收下这段文本')) return { error: '找不到「收下这段文本」', report };
  await wait(600);
  // 收下后仍停在文本视图，必须先「切回表单」再切回来
  if (!clickText('切回表单')) return { error: '收下之后找不到「切回表单」', report };
  await wait(600);
  out.formMode = Boolean(document.querySelector('.ilb-flow-node'));
  if (!clickText('文本模式')) return { error: '切回表单之后切不回文本模式', formMode: out.formMode };
  await wait(600);
  const again = document.querySelector('.ilb-flow-area')?.value ?? '';
  const againBody = again.split('\\n').filter((line) => line.trim() !== '关键词 + 流程').join('\\n');
  out.report = report.slice(0, 200);
  out.roundtripEqual = againBody.trim() === '${PROGRAM_BODY}'.trim();
  out.againLines = again.split('\\n');
  out.sheetOpen = document.querySelectorAll('.ilb-m-sheet, .ilb-overlay').length;

  // 收尾：不保存，关掉编辑器并删书
  const close = document.querySelector('.ilb-overlay-close, .ilb-m-sheet-back');
  if (close) { close.click(); await wait(300); }
  const discard = buttons().find((b) => (b.textContent || '').trim() === '放弃修改');
  if (discard) { discard.click(); await wait(400); }
  return out;
})()`);
console.log('复杂往返：', JSON.stringify(result, null, 1));
await screenshot(page.send, 'tests/live/last-extra-check.png');

// E2：60 项列表只做前 50 项
const e2 = await page.evaluate(`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const repo = globalThis.ILB.repository;
  const api = globalThis.ILB.api;
  const items = Array.from({ length: 60 }, (_, i) => '项' + (i + 1));
  const book = {
    book_id: '${E2_BOOK}',
    name: '六十项验收书',
    enabled: true,
    activation: { mode: 'manual', strategy: 'always' },
    entries: [],
    logic: [{
      name: '验收-六十项',
      enabled: true,
      trigger: { any: [], all: [], not: [], source: 'both' },
      flow: { mode: 'and', nodes: [
        { kind: 'list', name: '清单', op: 'set', value: { type: 'text', value: items.join(',') }, separator: ',' },
        { kind: 'repeat', mode: 'list', listName: '清单', itemName: '项', body: [
          { kind: 'set', name: '计数', op: 'add', value: { type: 'number', value: 1 }, persist: true },
        ] },
      ] },
    }],
  };
  await repo.saveBook(book);
  const r = api.call('验收-六十项');
  const steps = (r.steps ?? []).map((s) => String(s.reason ?? '')).join(' | ');
  const out = {
    count: r.vars['计数'] ?? null,
    stepSaysCap: /只留前 50 项|只做前 50 项/.test(steps),
    ok: r.ok,
    steps: steps.slice(0, 200),
  };
  repo.deleteBook('${E2_BOOK}');
  try { globalThis.ILB.vars?.remove?.('计数'); } catch { /* 变量删不掉不影响验收 */ }
  globalThis.ILB.api?.ui?.close?.();
  return out;
})()`);
console.log('六十项上限：', JSON.stringify(e2, null, 1));

// 规则卡「⋯」菜单：默认收起，点一个只开一个（v0.19.5）
// 前面的 C2 会留下编辑器/守卫状态，切页可能被拦，这里重新加载页面再验菜单。
await page.send('Page.reload', { ignoreCache: false });
await sleep(9000);
if (!(await waitForIlb(page.evaluate))) { console.log('重新加载后没等到 ILB'); page.close(); process.exit(1); }
const menus = await page.evaluate(`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const repo = globalThis.ILB.repository;
  repo.saveBook({
    book_id: 'probe-menu',
    name: '菜单验收书',
    entries: [
      { id: 'e1', title: '第一条', content: '正文一', trigger: { any: ['甲'] } },
      { id: 'e2', title: '第二条', content: '正文二', trigger: { any: ['乙'] } },
    ],
    logic: [],
  });
  globalThis.ILB.api.ui.openPanel('shelf');
  await wait(400);
  // 书架→规则 各开一次：只开一次规则页时，刚存进去的书还不在下拉里（面板已经画过了）
  globalThis.ILB.api.ui.openPanel('rules');
  await wait(1000);
  const select = document.querySelector('.ilb-bookbar select');
  if (!select) return { error: '规则页没有书籍选择器' };
  select.value = 'probe-menu';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(700);

  const all = () => [...document.querySelectorAll('.ilb-menu')];
  const shown = (node) => getComputedStyle(node).display !== 'none';
  const icons = () => [...document.querySelectorAll('.ilb-more .ilb-icon-btn')];
  const out = {
    menuCount: all().length,
    beforeShown: all().filter(shown).length,
    opts: [...select.options].map((o) => o.value),
    selectValue: select.value,
    tiles: [...document.querySelectorAll('.ilb-title')].map((n) => n.textContent),
  };
  if (icons().length < 2) return { ...out, error: '规则卡上没有两个「⋯」按钮' };

  icons()[0].click();
  await wait(250);
  out.afterFirst = all().filter(shown).length;

  icons()[1].click();
  await wait(250);
  const visible = all().filter(shown);
  out.afterSecond = visible.length;
  out.secondOnly = visible.length === 1 && all().indexOf(visible[0]) === 1;

  const navMenu = document.querySelector('.ilb-nav-menu');
  out.navMenuHidden = !navMenu || getComputedStyle(navMenu).display === 'none';

  document.querySelector('.ilb-tab-blurb')?.click();
  await wait(200);
  out.afterOutside = all().filter(shown).length;

  repo.deleteBook('probe-menu');
  return out;
})()`);
console.log('更多菜单：', JSON.stringify(menus, null, 1));

const deleted = await page.evaluate(`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const repo = globalThis.ILB.repository;
  repo.deleteBook('${BOOK}');
  repo.deleteBook('${E2_BOOK}');
  repo.deleteBook('probe-menu');
  await wait(200);
  globalThis.ILB.api?.ui?.close?.();
  return { booksLeft: repo.listBooks().length };
})()`);
console.log('清理：', JSON.stringify(deleted));

const ok = !result.error
  && result.formMode
  && result.roundtripEqual
  && /没有看不懂的行/.test(result.report || '')
  && !e2.error
  && e2.count === 50
  && e2.stepSaysCap === true
  && !menus.error
  && menus.menuCount >= 2
  && menus.beforeShown === 0
  && menus.afterFirst === 1
  && menus.secondOnly === true
  && menus.navMenuHidden === true
  && menus.afterOutside === 0;
console.log(ok ? '✅ 通过' : '❌ 有项目没通过');
page.close();
process.exit(ok ? 0 : 1);
