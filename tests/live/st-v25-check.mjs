// tests/live/st-v25-check.mjs —— 真实酒馆 + 手机/桌面视口，验 v0.25.0 的规则/逻辑卡片
//
//   1) 规则卡三行：默认高度压到 140px 以内（3 条规则对比）；
//   2) 手机点「详情」开底部抽屉，抽屉里是两列设置网格（启用/权重/概率/分组/注入位置/常驻）；
//   3) 抽屉里改「启用」立即写回；关抽屉后卡片高度不变；
//   4) 逻辑卡同样三行、也有详情抽屉；
//   5) 桌面点「详情 ▾」在卡内展开，高度不超过 300px。
//
// 用法：
//   set ST_DIR=D:\1\APP\SillyTavern
//   node tests/live/st-v25-check.mjs
import { openPage, waitForIlb, sleep, screenshot } from './cdp.mjs';

const ST_DIR = process.env.ST_DIR ?? 'D:/1/APP/SillyTavern';
const BOOK = 'probe-v25-cards';
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

    ILB.repository.deleteBook('${BOOK}');
    ILB.repository.saveBook({
      book_id: '${BOOK}',
      name: '验收书 v25',
      activation: { strategy: 'always' },
      entries: [
        { id: 'r1', title: '规则一：很长的标题看看会不会换行或者撑高卡片', content: '甲', trigger: { any: ['甲'] }, always: true },
        { id: 'r2', title: '规则二', content: '乙', trigger: { all: ['乙', '丙'] }, useProbability: true, probability: 40, group: '验收组', weight: 120 },
        { id: 'r3', title: '规则三', content: '丁', trigger: { any: ['丁'] }, logic: { mode: 'and', nodes: [{ kind: 'text', text: '跑一下' }, { kind: 'text', text: '再跑一下' }] } },
      ],
      logic: [
        { id: 'l1', name: '逻辑一', enabled: true, trigger: { any: ['戊'] }, output: { text: '输出' }, logic: { mode: 'and', nodes: [{ kind: 'text', text: 'a' }] } },
        { id: 'l2', name: '逻辑二：很长很长很长很长很长很长很长的名字', enabled: false, trigger: { any: ['己'] } },
      ],
    });

    // 手机规则卡
    ILB.api.ui.openPanel('rules');
    await wait(1400);
    ILB.panel.state.activeBookId = '${BOOK}';
    ILB.panel.render();
    await wait(600);
    const dialog = document.querySelector('dialog.ilb-m');
    result.mobileOpen = Boolean(dialog?.open);
    const ruleCards = () => [...document.querySelectorAll('.ilb-rule-card')];
    result.ruleCardCount = ruleCards().length;
    result.ruleHeights = ruleCards().map((c) => Math.round(c.getBoundingClientRect().height));
    result.allRulesCompact = result.ruleHeights.every((h) => h <= 140);
    const ruleCard = ruleCards()[0];
    const targetTitle = text(ruleCard.querySelector('.ilb-title'));

    const detailBtn = [...ruleCard.querySelectorAll('button')].find((b) => text(b) === '详情');
    result.hasDetailButton = Boolean(detailBtn);
    detailBtn?.click();
    await wait(700);
    const sheet = document.querySelector('.ilb-m-sheet');
    result.sheetOpen = Boolean(sheet);
    result.sheetHasGrid = Boolean(sheet?.querySelector('.ilb-set-grid'));
    const labels = sheet ? [...sheet.querySelectorAll('.ilb-set-label')].map(text) : [];
    result.sheetLabels = labels;
    result.sheetRowsAligned = sheet ? sheet.querySelectorAll('.ilb-set-row').length : 0;

    // 抽屉里改「启用」立即写回（注意第一张卡不一定是 entries[0]，按标题找那一条）
    const targetEntry = () => (ILB.repository.getBook('${BOOK}')?.entries ?? []).find((e) => e.title === targetTitle);
    const enableRow = sheet ? [...sheet.querySelectorAll('.ilb-set-row')].find((r) => text(r).includes('启用')) : null;
    const enableBox = enableRow?.querySelector('input[type=checkbox]');
    result.enabledBefore = targetEntry()?.enabled !== false;
    if (enableBox) {
      enableBox.checked = false;
      enableBox.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await wait(500);
    result.enabledAfter = targetEntry()?.enabled;
    const heightBefore = ruleCards()[0]?.getBoundingClientRect().height ?? 0;

    const xBtn = sheet?.querySelector('.ilb-m-sheet-head .ilb-m-x');
    xBtn?.click();
    await wait(500);
    result.sheetClosed = !visible(document.querySelector('.ilb-m-sheet'));
    const heightAfter = ruleCards()[0]?.getBoundingClientRect().height ?? 0;
    result.cardHeightStable = Math.abs(heightAfter - heightBefore) < 8;

    // 逻辑卡
    ILB.panel.setTab('logic');
    await wait(700);
    const logicCards = () => [...document.querySelectorAll('.ilb-logic-card')];
    result.logicCardCount = logicCards().length;
    result.logicHeights = logicCards().map((c) => Math.round(c.getBoundingClientRect().height));
    result.allLogicCompact = result.logicHeights.every((h) => h <= 140);
    const logicDetail = [...logicCards()[0].querySelectorAll('button')].find((b) => text(b) === '详情');
    logicDetail?.click();
    await wait(700);
    const logicSheet = document.querySelector('.ilb-m-sheet');
    result.logicSheetOpen = Boolean(logicSheet);
    result.logicSheetLabels = logicSheet ? [...logicSheet.querySelectorAll('.ilb-set-label')].map(text) : [];
    logicSheet?.querySelector('.ilb-m-sheet-head .ilb-m-x')?.click();
    await wait(400);

    // 截图停在规则页，方便直接看卡片密度
    ILB.panel.setTab('rules');
    await wait(500);
    return result;
  })()`);
} catch (error) {
  out = { error: error?.message ?? String(error) };
}

try {
  await screenshot(page.send, new URL('./last-v25-mobile.png', import.meta.url), undefined);
} catch (error) {
  console.log('截图失败：', error?.message ?? error);
}

// 桌面：卡内展开
let desk = {};
try {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 1360, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  await page.send('Page.reload', { ignoreCache: false });
  await sleep(9000);
  if (await waitForIlb(page.evaluate)) {
    desk = await page.evaluate(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const text = (n) => (n?.textContent || '').trim();
      ILB.api.ui.openPanel('shelf');
      await wait(1200);
      ILB.panel.state.activeBookId = '${BOOK}';
      ILB.panel.setTab('rules');
      await wait(700);
      const card = document.querySelector('.ilb-rule-card');
      const before = card?.getBoundingClientRect().height ?? 0;
      const btn = card ? [...card.querySelectorAll('button')].find((b) => text(b) === '详情 ▾') : null;
      btn?.click();
      await wait(600);
      const cardAfter = document.querySelector('.ilb-rule-card');
      const after = cardAfter?.getBoundingClientRect().height ?? 0;
      return {
        before: Math.round(before),
        after: Math.round(after),
        hasGrid: Boolean(cardAfter?.querySelector('.ilb-set-grid')),
        hasCollapse: [...(cardAfter?.querySelectorAll('button') ?? [])].some((b) => text(b) === '收起详情 ▴'),
      };
    })()`);
  }
} catch (error) {
  desk = { error: error?.message ?? String(error) };
}

try {
  await page.evaluate(`(() => {
    ILB.repository.deleteBook('${BOOK}');
    ILB.api.ui.close();
    return true;
  })()`);
} catch (error) {
  console.log('清理失败：', error?.message ?? error);
}

console.log(JSON.stringify({ mobile: out, desktop: desk }, null, 2));
const ok = out && !out.error
  && out.ruleCardCount === 3 && out.allRulesCompact
  && out.hasDetailButton && out.sheetOpen && out.sheetHasGrid && out.sheetRowsAligned >= 6
  && out.enabledAfter === false && out.cardHeightStable && out.sheetClosed
  && out.logicCardCount === 2 && out.allLogicCompact && out.logicSheetOpen
  && desk && !desk.error && desk.hasGrid && desk.hasCollapse && desk.after <= 300;
console.log(ok ? '✅ v0.25 规则/逻辑卡片检查通过' : '❌ 有项目没通过');
page.close();
process.exit(ok ? 0 : 1);
