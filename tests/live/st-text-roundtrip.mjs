// tests/live/st-text-roundtrip.mjs —— 真实酒馆里验「文本模式」往返
//
// 验 C2/C3 里自动探针能做的那部分：
//   在真实编辑器里切到文本模式，写一段流程，切回表单再切回文本，内容还在；
//   写一行缩进不对/看不懂的，切回表单时能看到逐行报错，而不是悄悄丢掉。
// 仍然不是真机：输入法把中文缩进改成空格这种事只能真机验。
//
// 用法：
//   set ST_DIR=D:\1\APP\SillyTavern
//   node tests/live/st-text-roundtrip.mjs
import { openPage, waitForIlb, sleep, screenshot } from './cdp.mjs';

const ST_DIR = process.env.ST_DIR ?? 'D:/1/APP/SillyTavern';
const BOOK = 'probe-text';
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

  globalThis.ILB.repository.saveBook({
    book_id: '${BOOK}',
    name: '文本验收书',
    entries: [{ id: 'e-text', title: '文本验收规则', content: '正文', trigger: { any: ['文本'] } }],
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

  // 打开流程编辑（规则编辑里的「编辑流程」按钮）
  const flowOpen = buttons().find((b) => /编辑流程|改流程/.test((b.textContent || '').trim()) && visible(b));
  if (flowOpen) { flowOpen.click(); await wait(500); }

  if (!clickText('文本模式')) return { error: '编辑器里找不到「文本模式」按钮' };
  await wait(500);
  const area = document.querySelector('.ilb-flow-text .ilb-flow-area') || document.querySelector('.ilb-flow-area');
  if (!area) return { error: '文本模式里没有输入区' };
  const blank = area.value;

  const program = ['比较 \$a >= 1', '  成立', '    变量 \$b 设为 2'].join('\\n');
  area.value = program;
  area.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(300);
  const goodReport = textOf(document.querySelector('.ilb-flow-problems'));

  // 收下 → 切回表单 → 再切回文本：内容应原样还在
  const errors = [];
  globalThis.addEventListener('error', (e) => errors.push(String(e.message)));
  globalThis.addEventListener('unhandledrejection', (e) => errors.push('rejection: ' + String(e.reason)));
  const overlayBefore = document.querySelectorAll('.ilb-overlay').length;
  if (!clickText('收下这段文本')) return { error: '找不到「收下这段文本」' };
  await wait(500);
  // 收下之后仍停在文本视图；切回表单再切回来，验证收下的内容真的变成了节点
  if (!clickText('切回表单')) return { error: '收下之后找不到「切回表单」', errors };
  await wait(500);
  const formMode = Boolean(document.querySelector('.ilb-flow-node'));
  if (!clickText('文本模式')) return { error: '切回表单之后切不回文本模式', formMode, errors };
  await wait(500);
  const again = document.querySelector('.ilb-flow-area')?.value ?? '';
  const againBody = again.split('\\n').filter((line) => line.trim() !== '关键词 + 流程').join('\\n');

  // 列表变量 + 按列表循环 + 分支选择（v0.20/v0.21）：也走一遍真实界面的收下 → 切回表单 → 切回文本
  const listProgram = [
    '列表 \$清单 设为 "甲,乙,丙"',
    '按列表 \$清单 重复（当前项 \$项）',
    '  添加 "转"',
    '列表 \$清单 清空',
    '分支选择 \$等级',
    '  等于 3',
    '    添加 "三"',
    '  等于 "VIP"',
    '    添加 "贵宾"',
    '  否则',
    '    添加 "其他"',
  ].join('\\n');
  const areaList = document.querySelector('.ilb-flow-area');
  areaList.value = listProgram;
  areaList.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(300);
  const listReport = textOf(document.querySelector('.ilb-flow-problems'));
  const listErrors = [];
  globalThis.addEventListener('error', (e) => listErrors.push(String(e.message)));
  if (!clickText('收下这段文本')) return { error: '列表文本收不下', listErrors };
  await wait(400);
  if (!clickText('切回表单')) return { error: '列表文本收下后切不回表单', listErrors };
  await wait(400);
  if (!clickText('文本模式')) return { error: '列表文本切回不去文本模式', listErrors };
  await wait(400);
  const listAgain = (document.querySelector('.ilb-flow-area')?.value ?? '')
    .split('\\n').filter((line) => line.trim() !== '关键词 + 流程').join('\\n');

  // 全角空格缩进（中文输入法常吐出来的）：应当被当成两格，不报错（C3 的解析侧证据）
  const wideProgram = [
    '条件组 全部满足',
    '　条件 已聊至少 1 条',
    '　成立',
    '　　添加 "全角缩进"',
  ].join('\\n');
  const areaWide = document.querySelector('.ilb-flow-area');
  areaWide.value = wideProgram;
  areaWide.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(400);
  const wideReport = textOf(document.querySelector('.ilb-flow-problems'));

  // 缩进错的行要说清"缩进了几格"（v0.21.2）
  const oddArea = document.querySelector('.ilb-flow-area');
  oddArea.value = ['添加 "一"', '   添加 "二"'].join('\\n');
  oddArea.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(400);
  const oddReport = textOf(document.querySelector('.ilb-flow-problems'));

  // 写一行没归属的内容：文本模式里的报告应当逐行指出，而不是悄悄丢掉
  const bad = program + '\\n' + '  这一行缩进不对，没归属';
  const area2 = document.querySelector('.ilb-flow-area');
  area2.value = bad;
  area2.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(400);
  const problems = textOf(document.querySelector('.ilb-flow-problems'));

  return {
    blankHasHeader: blank.includes('关键词 + 流程'),
    goodReport,
    formMode,
    roundtripEqual: againBody.trim() === program.trim(),
    againLines: again.split('\\n').slice(0, 4),
    listReport: (listReport || '').slice(0, 120),
    listRoundtripEqual: listAgain.trim() === listProgram.trim(),
    listLines: listAgain.split('\\n'),
    listErrors,
    wideReport: (wideReport || '').slice(0, 120),
    oddReport: (oddReport || '').slice(0, 160),
    problems: problems.slice(0, 240),
    sheetOpen: document.querySelectorAll('.ilb-m-sheet, .ilb-overlay').length,
  };
})()`);
console.log('文本往返：', JSON.stringify(result, null, 1));

await screenshot(page.send, 'tests/live/last-text-roundtrip.png');
console.log('截图：tests/live/last-text-roundtrip.png');

// 关掉编辑器（不保存）并清掉临时书
const cleaned = await page.evaluate(`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const close = document.querySelector('.ilb-overlay-close, .ilb-m-sheet-back');
  if (close) { close.click(); await wait(300); }
  const discard = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '放弃修改');
  if (discard) { discard.click(); await wait(300); }
  const deleted = globalThis.ILB.repository.deleteBook('${BOOK}');
  globalThis.ILB.api?.ui?.close?.();
  await wait(300);
  return { deleted, booksLeft: globalThis.ILB.repository.listBooks().length, ilbOpen: Boolean(document.querySelector('.ilb-window, dialog.ilb-m[open], .ilb-overlay')) };
})()`);
console.log('清理：', JSON.stringify(cleaned));

const ok = !result.error && result.blankHasHeader && result.formMode && result.roundtripEqual
  && result.listRoundtripEqual
  && /没有看不懂的行/.test(result.wideReport || '')
  && /缩进多了（3 格/.test(result.oddReport || '')
  && !(result.listErrors ?? []).length
  && /没有看不懂的行/.test(result.goodReport || '')
  && /找不到它属于哪一步|缩进|应该是「成立」/.test(result.problems || '');
console.log(ok ? '✅ 通过' : '❌ 有项目没通过');
page.close();
process.exit(ok ? 0 : 1);
