// tests/live/st-double-inject.mjs —— 真实酒馆里验"同源双重注入"的跳过策略
//
// 要证明的事（真机证据，而不是单测里的假数据）：
//   1. 酒馆里真有一本启用的原生世界书，ILB 里有一本映射到它的书；
//   2. 策略是 warn 时：这本 ILB 书照常启用，注入内容里能看到它；
//   3. 策略是 skip 时：这本 ILB 书被摘掉（active 里没有、skipped 里点名），注入内容里看不到它；
//   4. 收尾：删掉探针书、把原生书从全局选择里摘掉、策略恢复成 warn。
//
// 用法和前置条件见同目录 README.md。
import { openPage, waitForIlb, screenshot, sleep } from './cdp.mjs';

const ST_DIR = process.env.ST_DIR ?? 'D:\\1\\APP\\SillyTavern';
const NATIVE = 'ILB-Double-Probe';
const BOOK = 'probe-double-inject';

const page = await openPage(ST_DIR);
const ready = await waitForIlb(page.evaluate);
if (!ready) {
  console.error('❌ 页面里没有 globalThis.ILB');
  process.exit(1);
}

const result = await page.evaluate(`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  const ctx = globalThis.SillyTavern?.getContext?.() ?? {};
  const wi = await import('/scripts/world-info.js');

  // 1) 造一本真的原生世界书，并加进"全局启用"
  try {
    const data = (await wi.loadWorldInfo(${JSON.stringify(NATIVE)})) ?? null;
    if (!data) await wi.createNewWorldInfo(${JSON.stringify(NATIVE)}, { interactive: false });
    const saved = (await wi.loadWorldInfo(${JSON.stringify(NATIVE)})) ?? {};
    if (!saved.entries || Object.keys(saved.entries).length === 0) {
      const entry = wi.createWorldInfoEntry(${JSON.stringify(NATIVE)}, saved);
      entry.key = ['ilbdoubleprobe'];
      entry.content = 'NATIVE-DOUBLE-PROBE';
      entry.constant = true;
      await wi.saveWorldInfo(${JSON.stringify(NATIVE)}, saved, true);
    }
    wi.selected_world_info = [...(wi.selected_world_info ?? [])];
    if (!wi.selected_world_info.includes(${JSON.stringify(NATIVE)})) {
      wi.selected_world_info.push(${JSON.stringify(NATIVE)});
    }
    out.native = { name: ${JSON.stringify(NATIVE)}, enabled: true };
  } catch (error) {
    out.nativeError = String(error?.message ?? error);
  }

  // 2) ILB 里造一本映射到它的书（auto 策略，才会产生 matched）
  try {
    globalThis.ILB.repository.saveBook({
      book_id: ${JSON.stringify(BOOK)},
      name: '双重注入探针',
      activation: { mode: 'character' },
      host: { nativeNames: [${JSON.stringify(NATIVE)}] },
      entries: [{ id: 'e-double', title: '双重探针', content: 'ILB-DOUBLE-PROBE', always: true }],
    });
    globalThis.ILB.repository.saveSettings({ enabled: true, hostLinkEnabled: true, doubleInjectPolicy: 'warn' });
    await wait(400);
  } catch (error) {
    out.bookError = String(error?.message ?? error);
  }

  const injectedText = () => {
    try {
      const prompts = globalThis.SillyTavern?.getContext?.()?.extensionPrompts ?? {};
      return Object.keys(prompts)
        .filter((k) => k.startsWith('ILB::'))
        .map((k) => String(prompts[k]?.value ?? prompts[k] ?? ''))
        .join('\\n');
    } catch {
      return '';
    }
  };
  const promptKeys = () => {
    try {
      return Object.keys(globalThis.SillyTavern?.getContext?.()?.extensionPrompts ?? {});
    } catch {
      return [];
    }
  };
  out.promptKeys = promptKeys();

  // 3) warn：照常启用，能看到注入内容
  try {
    // 刚打开的页面里宿主上下文可能还没就绪；等一等再跑，别把"还没读到"当成业务结果
    for (let i = 0; i < 20; i += 1) {
      const host = globalThis.ILB.describeLastRun?.()?.host;
      if (host?.ok) break;
      await wait(500);
    }
    let run = null;
    for (let i = 0; i < 3; i += 1) {
      globalThis.ILB.runOnce('probe-warn');
      await wait(900);
      run = globalThis.ILB.describeLastRun();
      if (run?.books) break;
      await wait(700);
    }
    out.warn = {
      policy: run?.books?.doubleInject?.policy ?? null,
      duplicates: run?.books?.doubleInject?.duplicates ?? null,
      skipped: run?.books?.doubleInject?.skipped ?? null,
      active: run?.books?.active ?? null,
      activated: run?.activated ?? null,
      hasText: injectedText().includes('ILB-DOUBLE-PROBE'),
      hostSources: (run?.books?.hostContext?.sources ?? []).map((s) => s.name),
      promptKeys: promptKeys().filter((k) => k.startsWith('ILB::')),
    };
    if (!run?.books) out.warnDebug = { keys: Object.keys(run ?? {}), error: run?.error ?? null, skipped: run?.skipped ?? null, host: run?.host ?? null };
  } catch (error) {
    out.warnError = String(error?.message ?? error);
  }

  // 4) skip：这本 ILB 书被摘掉，注入内容里没有它
  try {
    globalThis.ILB.repository.saveSettings({ doubleInjectPolicy: 'skip' });
    await wait(200);
    globalThis.ILB.runOnce('probe-skip');
    await wait(900);
    const run = globalThis.ILB.describeLastRun();
    out.skip = {
      policy: run?.books?.doubleInject?.policy ?? null,
      duplicates: run?.books?.doubleInject?.duplicates ?? null,
      skipped: run?.books?.doubleInject?.skipped ?? null,
      active: run?.books?.active ?? null,
      activated: run?.activated ?? null,
      hasText: injectedText().includes('ILB-DOUBLE-PROBE'),
      reason: run?.books?.reasons?.[${JSON.stringify(BOOK)}] ?? null,
      error: run?.error ?? null,
    };
  } catch (error) {
    out.skipError = String(error?.message ?? error);
  }

  return out;
})()`);

await screenshot(page.send, 'tests/live/last-double-inject.png');

const cleanup = await page.evaluate(`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  try {
    out.bookDeleted = globalThis.ILB.repository.deleteBook(${JSON.stringify(BOOK)});
  } catch (error) {
    out.bookDeleted = String(error?.message ?? error);
  }
  try {
    globalThis.ILB.repository.saveSettings({ doubleInjectPolicy: 'warn' });
    const wi = await import('/scripts/world-info.js');
    wi.selected_world_info = (wi.selected_world_info ?? []).filter((n) => n !== ${JSON.stringify(NATIVE)});
    await wi.deleteWorldInfo(${JSON.stringify(NATIVE)});
    out.nativeDeleted = true;
  } catch (error) {
    out.nativeDeleted = String(error?.message ?? error);
  }
  try {
    globalThis.ILB.pipeline.reset?.();
    globalThis.ILB.api?.ui?.close?.();
  } catch {
    /* 收尾失败不影响结论 */
  }
  await wait(300);
  out.booksLeft = globalThis.ILB.repository.listBooks().length;
  return out;
})()`);

console.log('双重注入：', JSON.stringify(result, null, 1));
console.log('收尾：', JSON.stringify(cleanup));

const warn = result.warn ?? {};
const skip = result.skip ?? {};
const ok =
  !result.error &&
  Array.isArray(warn.duplicates) && warn.duplicates.includes(BOOK) &&
  Array.isArray(warn.active) && warn.active.includes(BOOK) &&
  warn.hasText === true &&
  warn.policy === 'warn' &&
  Array.isArray(skip.skipped) && skip.skipped.includes(BOOK) &&
  Array.isArray(skip.active) && !skip.active.includes(BOOK) &&
  skip.hasText === false &&
  skip.policy === 'skip';

console.log(ok ? '✅ 通过' : '❌ 有项目没通过');
page.close();
process.exit(ok ? 0 : 1);
