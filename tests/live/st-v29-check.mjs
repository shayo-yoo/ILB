// tests/live/st-v29-check.mjs —— v0.29.0：在 ILB 书架里直接给角色卡建关联
//
// 验五件事：
//   1) 书籍设置里出现「角色关联」一行，点「管理…」能打开关联面板；
//   2) 在面板里给某个角色设成「强制启用」，关联真的写进 ILB 存档；
//   3) 运行时判定立刻变成 binding-on —— 进这张卡，这本书就启用；
//   4) 同一份数据，附属扩展 ILBCC 也读得到（两边看到的是同一个 bindings）；
//   5) 清理：删关联 + 删探针书，不留垃圾。
//
// 用法（先启动酒馆，再用带调试端口的 Chrome 打开它）：
//   set ST_DIR=D:\1\APP\SillyTavern
//   node tests/live/st-v29-check.mjs
import { fileURLToPath } from 'node:url';
import { openPage, waitForIlb, sleep, screenshot } from './cdp.mjs';

const ST_DIR = process.env.ST_DIR ?? 'D:/1/APP/SillyTavern';
const PAGE = 'probe-v29-book';

const page = await openPage(ST_DIR);
await page.send('Runtime.enable');
await page.send('Page.enable');
await page.send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false });
await page.send('Page.reload', { ignoreCache: true });
await sleep(9000);

if (!(await waitForIlb(page.evaluate))) {
  console.log('❌ 页面里没有 globalThis.ILB：扩展没加载起来');
  page.close();
  process.exit(1);
}

const out = await page.evaluate(`(async () => {
  const r = {};
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const api = globalThis.ILB.api;
  const buttonsOf = (root) => [...(root ? root.querySelectorAll('button') : [])];
  const byText = (root, text) => buttonsOf(root).find((b) => (b.textContent ?? '').includes(text));
  let bookId = '';
  let bindingId = '';

  try {
    // 新标签页默认停在角色列表：像用户一样点开第一张卡
    if (!api.runtime.preview().character?.avatar) {
      const node = document.querySelector('#rm_print_characters_block .character_select') || document.querySelector('.character_select');
      if (node) {
        node.click();
        await sleep(4000);
      }
    }
    const before = api.runtime.preview();
    const avatar = before.character?.avatar ?? '';
    const charName = before.character?.name ?? '';
    r.hasCharacter = !!avatar;

    // 造一本探针书（走公开接口），保证不碰用户自己的书。
    // 以前几次跑挂掉可能留下同名探针书（导入会换新 id），先按名字清干净。
    const leftovers = (await api.worldbooks.list()).books ?? [];
    for (const old of leftovers) {
      if (old.name !== '${PAGE}') continue;
      await api.worldbooks.deleteBook(old.id, { cascade: true });
    }
    await api.worldbooks.deleteBook('${PAGE}', { cascade: true });
    const made = await api.worldbooks.importBook({
      schema_version: 2,
      book: {
        schema_version: 2,
        book_id: '${PAGE}',
        name: '${PAGE}',
        activation: { strategy: 'auto', override: 'auto' },
        entries: [],
        logic: [],
      },
    }, { onConflict: 'new' });
    r.bookImported = made.ok === true;
    bookId = made.id ?? '${PAGE}';

    // 打开书架，用搜索框把探针书筛出来（列表可能很长）
    api.ui.openPanel('shelf');
    await sleep(1200);
    const search = document.querySelector('.ilb-search');
    if (search) {
      search.value = '${PAGE}';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(900);
    }
    const findCard = () => [...document.querySelectorAll('.ilb-book-card')]
      .find((c) => (c.querySelector('.ilb-book-title')?.textContent ?? '').includes('${PAGE}'));
    const card = findCard();
    r.cardVisible = !!card;
    if (!card) throw new Error('书架里找不到探针书');

    // 关联之前的运行态（用来证明后面那一行字是关联带来的）
    const statusOf = () => (findCard()?.querySelector('.ilb-book-comfort-only')?.textContent ?? '');
    const statusBefore = statusOf();
    r.cardNotRunningBefore = statusBefore !== '' && !statusBefore.startsWith('运行中');

    // 展开详情 → 找到「角色关联」一行 → 点「管理…」
    // 注意：点一下会重画整个列表，旧节点马上作废，所以每次都要按书名重新找。
    const expand = byText(card, '展开详情');
    r.expandButtonFound = !!expand;
    if (expand) {
      expand.click();
      await sleep(400);
    }
    const opened = findCard();
    const detail = opened?.querySelector('.ilb-book-detail');
    r.detailOpened = !!detail;
    const row = [...(detail ? detail.querySelectorAll('.ilb-set-row') : [])]
      .find((n) => (n.textContent ?? '').includes('角色关联'));
    r.bindingRowExists = !!row;
    const manage = byText(row, '管理');
    r.manageButtonFound = !!manage;
    if (manage) {
      manage.click();
      await sleep(400);
    }

    const overlay = document.querySelector('.ilb-overlay');
    r.overlayTitle = (overlay?.querySelector('.ilb-modal-title')?.textContent ?? '').includes('角色关联');
    const addRow = overlay?.querySelector('.ilb-bind-add');
    r.addRowExists = !!addRow;
    const selects = [...(addRow ? addRow.querySelectorAll('select') : [])];
    r.addHasTwoSelects = selects.length === 2;

    // 选当前角色 + 强制启用
    if (selects[0]) {
      const options = [...selects[0].options];
      const hit = options.find((o) => o.value === avatar) ?? options[0];
      if (hit) {
        selects[0].value = hit.value;
        selects[0].dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    if (selects[1]) {
      selects[1].value = 'on';
      selects[1].dispatchEvent(new Event('change', { bubbles: true }));
    }

    const add = byText(addRow, '关联到这本书');
    r.addButtonFound = !!add;
    if (add) {
      add.click();
      await sleep(700);
    }

    const rows = api.bindings.list({ character: avatar }).bindings ?? [];
    const mine = rows.find((b) => b.bookId === bookId);
    r.bindingSaved = !!mine && mine.policy === 'on';
    bindingId = mine?.id ?? '';

    // 判定真的跟着变
    const decided = (api.runtime.preview().books ?? []).find((b) => b.id === bookId);
    r.runtimeBindingOn = decided?.enabled === true && decided?.rule === 'binding-on';

    // 面板重开后要列得出来
    const overlay2 = document.querySelector('.ilb-overlay');
    const listText = overlay2?.querySelector('.ilb-bind-list')?.textContent ?? '';
    r.overlayListsBinding = listText.includes(charName || avatar);

    // 书架卡片上的「运行中」跟着变
    r.cardShowsRunning = statusOf().startsWith('运行中');

    // 同一份数据，ILBCC 也读得到
    const cc = globalThis.ILBCC?.app;
    if (cc && cc.bindings) {
      const listed = await cc.bindings.listForCharacter({ avatar, name: charName });
      r.companionSeesBinding = listed?.ok === true && (listed.rows ?? []).some((x) => x.bookId === bookId);
    } else {
      r.companionSeesBinding = 'no-companion';
    }

    await sleep(200);
  } catch (err) {
    r.error = String(err?.message ?? err);
  } finally {
    try {
      document.querySelector('.ilb-modal-x')?.click();
      if (bindingId) api.bindings.remove(bindingId);
      await api.worldbooks.deleteBook(bookId || '${PAGE}', { cascade: true });
      const search = document.querySelector('.ilb-search');
      if (search) {
        search.value = '';
        search.dispatchEvent(new Event('input', { bubbles: true }));
      }
      r.cleanup = true;
    } catch (err) {
      r.cleanupError = String(err?.message ?? err);
    }
  }

  return r;
})()`);

await sleep(400);
await screenshot(page.send, fileURLToPath(new URL('./last-v29-bindings.png', import.meta.url)));

const rows = Object.entries(out);
const failed = rows.filter(([key, value]) => {
  if (key === 'error' || key === 'cleanupError') return false;
  if (typeof value === 'string') return false; // no-companion 这类是信息，不是判定项
  return value !== true;
});
console.log('— ILB v0.29.0 书架内角色关联 真机检查 —');
for (const [key, value] of rows) console.log(`${value === true || typeof value === 'string' ? '✓' : '✗'} ${key}: ${String(value)}`);
if (out.error) console.log(`✗ error: ${out.error}`);
if (out.cleanupError) console.log(`! 清理失败：${out.cleanupError}`);

if (failed.length > 0 || out.error) {
  console.log(`\n❌ 失败 ${failed.length} 项：${failed.map(([key, value]) => `${key}=${String(value)}`).join('、')}`);
  page.close();
  process.exit(1);
}
console.log('\n✅ v0.29.0 书架内角色关联检查通过');
page.close();
