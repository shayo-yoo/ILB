// tests/live/st-v27-check.mjs —— 真实酒馆，验 v0.27.0
//
//   1) ILB.api.ready / version / caps；worldbooks.list/get/export/import（冲突策略）/importMany；
//   2) 手机顶部折叠菜单改成浮层：展开时卡片列表的上边不动，浮层盖在上面。
//
// 用法：
//   set ST_DIR=D:\1\APP\SillyTavern
//   node tests/live/st-v27-check.mjs
import { openPage, waitForIlb, sleep, screenshot } from './cdp.mjs';

const ST_DIR = process.env.ST_DIR ?? 'D:/1/APP/SillyTavern';
const page = await openPage(ST_DIR);
await page.send('Runtime.enable');
await page.send('Page.enable');
await page.send('Emulation.setDeviceMetricsOverride', {
  width: 1360, height: 900, deviceScaleFactor: 1, mobile: false,
});
await page.send('Page.reload', { ignoreCache: true });
await sleep(9000);

if (!(await waitForIlb(page.evaluate))) {
  console.log('❌ 页面里没有 globalThis.ILB（扩展没加载起来）');
  page.close();
  process.exit(1);
}

const apiOut = await page.evaluate(`(async () => {
  const r = {};
  r.version = ILB.api.version;
  r.capsWorldbooks = Array.isArray(ILB.api.caps) && ILB.api.caps.includes('worldbooks');
  r.readyIsApi = (await ILB.api.ready) === ILB.api;

  const source = {
    book_id: 'probe-v27-src',
    name: '接口验收书',
    activation: { strategy: 'manual' },
    entries: [
      { id: 'e1', title: '一', content: '甲', trigger: { any: ['甲'] } },
      { id: 'e2', title: '二', content: '乙' },
    ],
    logic: [{ id: 'l1', name: '逻辑一', logic: { mode: 'and', nodes: [{ kind: 'text', text: 'x' }] } }],
  };

  for (const b of ILB.repository.listBooks()) {
    if (String(b.book_id).startsWith('probe-v27')) ILB.repository.deleteBook(b.book_id);
  }

  const created = await ILB.api.worldbooks.importBook({ book: source }, { onConflict: 'new' });
  r.created = { ok: created.ok, action: created.action, id: created.id };
  const createdId = created.id;

  const list = await ILB.api.worldbooks.list();
  r.listHas = list.ok && list.books.some((b) => b.id === createdId && b.entries === 2 && b.logics === 1);
  const got = await ILB.api.worldbooks.get(createdId);
  r.getOk = got.ok && got.book.entries.length === 2;
  r.hasOk = (await ILB.api.worldbooks.has(createdId)).exists === true;

  const payload = await ILB.api.worldbooks.exportBook(createdId);
  r.exported = payload.ok && payload.book.book_id === createdId && payload.book.entries.length === 2;

  const conflict = await ILB.api.worldbooks.importBook(payload);
  r.conflict = conflict.ok === false && conflict.error.code === 'CONFLICT' && conflict.error.id === createdId;

  payload.book.name = '改名后';
  const skipped = await ILB.api.worldbooks.importBook(payload, { onConflict: 'skip' });
  const afterSkip = await ILB.api.worldbooks.get(createdId);
  r.skip = skipped.ok && skipped.action === 'skipped' && afterSkip.book.name === '接口验收书';

  const overwritten = await ILB.api.worldbooks.importBook(payload, { onConflict: 'overwrite' });
  const afterOverwrite = await ILB.api.worldbooks.get(createdId);
  r.overwrite = overwritten.ok && overwritten.action === 'overwritten' && afterOverwrite.book.name === '改名后' && afterOverwrite.book.book_id === createdId;

  const many = await ILB.api.worldbooks.importMany(
    { books: [
      { book_id: 'probe-v27-a', name: '批量甲', entries: [] },
      { book_id: 'probe-v27-b', name: '批量乙', entries: [] },
    ] },
    { onConflict: 'new' },
  );
  r.many = many.ok && many.imported.length === 2 && many.failed.length === 0;

  const bad = await ILB.api.worldbooks.importBook('不是书');
  r.badPayload = bad.ok === false && bad.error.code === 'BAD_PAYLOAD';

  for (const b of ILB.repository.listBooks()) {
    if (String(b.book_id).startsWith('probe-v27')) ILB.repository.deleteBook(b.book_id);
  }
  r.clean = ILB.repository.listBooks().filter((b) => String(b.book_id).startsWith('probe-v27')).length === 0;
  return r;
})()`);

const apiOk =
  apiOut.version === '1.3' &&
  apiOut.capsWorldbooks &&
  apiOut.readyIsApi &&
  apiOut.created?.action === 'created' &&
  apiOut.created?.id?.startsWith('book-') &&
  apiOut.listHas &&
  apiOut.getOk &&
  apiOut.hasOk &&
  apiOut.exported &&
  apiOut.conflict &&
  apiOut.skip &&
  apiOut.overwrite &&
  apiOut.many &&
  apiOut.badPayload &&
  apiOut.clean;

// ---- 手机：顶部折叠菜单是浮层 ----
await page.send('Emulation.setDeviceMetricsOverride', {
  width: 390, height: 844, deviceScaleFactor: 3, mobile: true,
});
await page.send('Page.reload', { ignoreCache: true });
await sleep(9000);
if (!(await waitForIlb(page.evaluate))) {
  console.log('❌ 手机视口下没有 globalThis.ILB');
  page.close();
  process.exit(1);
}

const mobileOut = await page.evaluate(`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const r = {};
  ILB.repository.saveBook({
    book_id: 'probe-v27-overlay', name: '浮层验收书',
    activation: { strategy: 'manual' },
    entries: [{ id: 'x1', title: '规则一', content: '甲', trigger: { any: ['甲'] } }],
  });
  ILB.api.ui.openPanel('shelf');
  await wait(1200);

  const card = document.querySelector('.ilb-book-card');
  r.cardTopBefore = card ? Math.round(card.getBoundingClientRect().top) : null;

  const chip = [...document.querySelectorAll('.ilb-m-chip')].find((n) => n.textContent.includes('排序'));
  r.hasChip = !!chip;
  chip?.click();
  await wait(300);

  const body = document.querySelector('.ilb-m-top-body');
  const shown = [...document.querySelectorAll('.ilb-m-top-row')].filter((n) => !n.hidden);
  r.rowsShown = shown.length;
  r.bodyClassOn = !!body && body.classList.contains('ilb-m-top-body-on');
  const br = body ? body.getBoundingClientRect() : null;
  r.bodyRect = br ? { top: Math.round(br.top), bottom: Math.round(br.bottom), height: Math.round(br.height) } : null;
  const cardAfter = document.querySelector('.ilb-book-card');
  r.cardTopAfter = cardAfter ? Math.round(cardAfter.getBoundingClientRect().top) : null;
  r.cardTopUnchanged = r.cardTopBefore !== null && r.cardTopBefore === r.cardTopAfter;
  r.overlayAboveCard = !!(br && cardAfter && br.bottom > cardAfter.getBoundingClientRect().top);
  r.overlayInsideViewport = !!(br && br.top >= 0 && br.bottom <= window.innerHeight);
  return r;
})()`);

await screenshot(page.send, new URL('./last-v27-mobile.png', import.meta.url), undefined);

const mobileOut2 = await page.evaluate(`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const chip = [...document.querySelectorAll('.ilb-m-chip')].find((n) => n.textContent.includes('排序'));
  chip?.click();
  await wait(300);
  const body2 = document.querySelector('.ilb-m-top-body');
  const closed = !!body2 && !body2.classList.contains('ilb-m-top-body-on');
  ILB.repository.deleteBook('probe-v27-overlay');
  ILB.api.ui.openPanel('shelf');
  await wait(400);
  return { closedOnSecondTap: closed };
})()`);

const mobileOk =
  mobileOut.hasChip &&
  mobileOut.rowsShown === 1 &&
  mobileOut.bodyClassOn &&
  mobileOut.cardTopUnchanged &&
  mobileOut.overlayAboveCard &&
  mobileOut.overlayInsideViewport &&
  mobileOut2.closedOnSecondTap;

console.log('接口：', JSON.stringify(apiOut));
console.log('手机浮层：', JSON.stringify(mobileOut));
console.log(apiOk && mobileOk ? '✅ v0.27 接口与浮层检查通过' : '❌ 有项目没通过');

page.close();
process.exit(apiOk && mobileOk ? 0 : 1);
