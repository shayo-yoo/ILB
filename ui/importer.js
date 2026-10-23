// ui/importer.js —— 导入的原生书界面与执行（ILB-3.3 / ILB-3.6）
// 一个对话框做三件事：搜、挑、定策略。挑完一次导完，不要求用户一本一本点。

import { convertNativeWorld, isNativeWorld, sourceHashOf } from '../core/import-native.js';
import { mergeImportedBook } from '../core/merge-book.js';
import {
  planBatchImport, applyImportPolicy, normalizeImportPolicy, describePlan,
  IMPORT_POLICY_LABEL, IMPORT_POLICIES,
} from '../core/import-plan.js';
import { el, button, checkbox, selectBox, hint, searchInput, counter } from './widgets.js';

function stem(fileName) {
  return String(fileName).replace(/\.json$/i, '');
}

/**
 * 执行一批导入。
 * @param {object} ctx 面板上下文
 * @param {Array<{file: string, bookId: string|null}>} queue
 * @param {string} policy keep / on / off
 */
export async function importMany(ctx, queue, policy) {
  const { repository, nativeWorlds } = ctx;
  const settings = repository.getSettings();
  const report = {
    imported: 0,
    failed: 0,
    added: 0,
    updated: 0,
    kept: 0,
    entries: 0,
    conflicts: [],
    warnings: [],
    lastBookId: null,
  };

  for (const item of queue) {
    let raw;
    try {
      raw = await nativeWorlds.get(item.file);
    } catch (err) {
      report.failed += 1;
      report.warnings.push(`${item.file}：读不出来（${err?.message ?? err}）`);
      continue;
    }
    if (!isNativeWorld(raw)) {
      report.failed += 1;
      report.warnings.push(`${item.file}：不是世界书格式，跳过`);
      continue;
    }

    try {
      const converted = convertNativeWorld(raw, {
        fileName: item.file,
        bookName: stem(item.file),
        importedChainDefault: settings.importedChainDefault === true,
      });
      if (!converted?.book) {
        report.failed += 1;
        report.warnings.push(`${item.file}：转换失败，跳过`);
        continue;
      }
      const policyBook = applyImportPolicy(converted.book, policy);
      const existing = repository.listBooks().find((b) => b?._source?.book_file === item.file) ?? null;
      const merged = mergeImportedBook(existing, policyBook);

      repository.saveBook(merged.book);
      repository.appendImportLog({
        at: Date.now(),
        file: item.file,
        sourceHash: converted.stats?.sourceHash ?? null,
        bookId: merged.book.book_id,
        mode: merged.stats.mode,
        entries: merged.stats.total,
        added: merged.stats.added,
        updated: merged.stats.updated,
        kept: merged.stats.kept,
        conflicts: merged.stats.conflicts,
        warnings: converted.warnings.length,
        policy,
      });

      report.imported += 1;
      report.added += merged.stats.added ?? 0;
      report.updated += merged.stats.updated ?? 0;
      report.kept += merged.stats.kept ?? 0;
      report.entries += merged.stats.total ?? 0;
      report.lastBookId = merged.book.book_id;
      for (const c of merged.conflicts ?? []) report.conflicts.push(`${stem(item.file)} / ${c.title || c.entryId}`);
      for (const w of converted.warnings ?? []) report.warnings.push(`${stem(item.file)}：${w.message}`);
    } catch (err) {
      report.failed += 1;
      report.warnings.push(`${item.file}：导入时出错（${err?.message ?? err}）`);
    }
  }

  if (report.lastBookId) ctx.state.activeBookId = report.lastBookId;
  return report;
}

export function describeReport(report) {
  const bits = [];
  bits.push(`导入 ${report.imported} 本`);
  if (report.failed) bits.push(`失败 ${report.failed} 本`);
  if (report.added) bits.push(`新增 ${report.added} 条`);
  if (report.updated) bits.push(`更新 ${report.updated} 条`);
  if (report.kept) bits.push(`保留 ${report.kept} 条`);
  return bits.join(' · ');
}

function showReport(ctx, report, skipped) {
  const blocks = [el('p', { class: 'ilb-hint', text: describeReport(report) })];
  if (skipped?.length) {
    blocks.push(
      el('p', { class: 'ilb-hint', text: `跳过 ${skipped.length} 本（已经导入过了）：` }),
      el('ul', { class: 'ilb-warn-list' }, skipped.map((s) => el('li', { text: s.file }))),
    );
  }
  if (report.conflicts.length) {
    blocks.push(
      el('p', { class: 'ilb-hint', text: `有 ${report.conflicts.length} 条你在 ILB 里改过、原件也变了，保留了你的版本：` }),
      el('ul', { class: 'ilb-warn-list' }, report.conflicts.map((t) => el('li', { text: t }))),
    );
  }
  if (report.warnings.length) {
    blocks.push(
      el('p', { class: 'ilb-hint', text: '下面这些需要你看一眼：' }),
      el('ul', { class: 'ilb-warn-list' }, report.warnings.slice(0, 40).map((t) => el('li', { text: t }))),
    );
  }
  ctx.openOverlay('导入完成', blocks);
}

/**
 * 打开导入对话框。
 * @param {object} ctx
 * @param {{preselect?: 'new'|string[], policy?: string}} options
 *   preselect='new' 表示"一键导入全部"：把所有还没导入过的都勾上。
 */
export async function openImportDialog(ctx, options = {}) {
  const { repository, nativeWorlds } = ctx;
  const settings = repository.getSettings();
  let files;
  try {
    files = await nativeWorlds.list();
  } catch (err) {
    ctx.toast(`读不到原生世界书列表：${err?.message ?? err}`, 'error');
    return;
  }
  if (!files.length) {
    ctx.toast('原生世界书目录里没有文件', 'warn');
    return;
  }

  const importedNames = new Set(
    repository.listBooks().map((b) => b?._source?.book_file).filter(Boolean).map(String),
  );

  const configured = normalizeImportPolicy(settings.importEnabledPolicy);
  // ILB-3.6.2：配置成 ask 时必须让用户当场选一次，不能替他挑一个默认值。
  const forced = options.policy ? normalizeImportPolicy(options.policy) : 'ask';
  const initialPolicy = forced !== 'ask' ? forced : (configured === 'ask' ? '' : configured);
  const view = {
    query: '',
    policy: initialPolicy,
    includeExisting: settings.batchImportIncludeExisting === true,
    selected: new Set(),
  };

  if (options.preselect === 'new') {
    for (const f of files) if (!importedNames.has(String(f.name))) view.selected.add(String(f.name));
  } else if (Array.isArray(options.preselect)) {
    for (const name of options.preselect) view.selected.add(String(name));
  }

  const listHost = el('div', { class: 'ilb-file-list' });
  const counterLine = counter('');
  const runButton = button('导入选中的 0 本', () => run(), { primary: true });

  function visibleFiles() {
    const q = view.query.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => String(f.name).toLowerCase().includes(q));
  }

  function draw() {
    const shown = visibleFiles();
    listHost.innerHTML = '';
    if (shown.length === 0) {
      listHost.appendChild(el('p', { class: 'ilb-empty', text: '没有匹配的文件名。' }));
    }
    for (const file of shown) {
      const name = String(file.name);
      const done = importedNames.has(name);
      listHost.appendChild(el('label', { class: 'ilb-file-row' }, [
        checkbox(view.selected.has(name), (on) => {
          if (on) view.selected.add(name);
          else view.selected.delete(name);
          draw();
        }),
        el('span', { class: 'ilb-file-name', text: name }),
        done ? el('span', { class: 'ilb-badge ilb-badge-warn', text: '已导入' }) : el('span', { class: 'ilb-badge ilb-badge-ok', text: '新' }),
      ]));
    }
    counterLine.textContent = `选中 ${view.selected.size} 本 / 共 ${files.length} 本`;
    if (!view.policy) {
      runButton.textContent = '先选择「条目开关」的处理方式';
      runButton.disabled = true;
      return;
    }
    runButton.textContent = `导入选中的 ${view.selected.size} 本`;
    runButton.disabled = view.selected.size === 0;
  }

  async function run() {
    const chosen = files.filter((f) => view.selected.has(String(f.name)));
    if (chosen.length === 0) return;
    if (!view.policy) {
      ctx.toast('请先选择「条目开关」：保留原件、全部开启，还是全部停用', 'warn');
      return;
    }
    const plan = planBatchImport(chosen, repository.listBooks(), { includeExisting: view.includeExisting });
    if (plan.queue.length === 0) {
      ctx.toast(describePlan(plan), 'warn');
      return;
    }
    ctx.closeOverlay();
    runButton.disabled = true;
    const report = await importMany(ctx, plan.queue, view.policy);
    ctx.render();
    showReport(ctx, report, plan.skipped);
  }

  const nodes = [
    hint('导入是复制，不会改动原件。同一份原件再导一次是「合并更新」，不会变成两本书。'),
    filterRow(),
    listHost,
    el('div', { class: 'ilb-toolbar' }, [
      button('全选新文件', () => {
        for (const f of files) if (!importedNames.has(String(f.name))) view.selected.add(String(f.name));
        draw();
      }, { ghost: true }),
      button('全选当前结果', () => {
        for (const f of visibleFiles()) view.selected.add(String(f.name));
        draw();
      }, { ghost: true }),
      button('清空', () => {
        view.selected.clear();
        draw();
      }, { ghost: true }),
      counterLine,
    ]),
    el('div', { class: 'ilb-toolbar' }, [
      el('label', { class: 'ilb-inline' }, [
        el('span', { class: 'ilb-sub', text: '条目开关' }),
        selectBox(view.policy, [
          ...(view.policy ? [] : [{ value: '', label: '请选择…' }]),
          ...IMPORT_POLICIES.filter((p) => p !== 'ask').map((p) => ({ value: p, label: IMPORT_POLICY_LABEL[p] })),
        ], (value) => {
          view.policy = value;
          draw();
        }),
      ]),
      el('label', { class: 'ilb-inline' }, [
        checkbox(view.includeExisting, (on) => {
          view.includeExisting = on;
        }),
        el('span', { class: 'ilb-sub', text: '包含已导入的（会合并更新）' }),
      ]),
    ]),
    hint('「一律全开/全关」会在每次导入时把开关重置成统一的，选了它就别指望保留你后来手动改的开关。'),
    el('div', { class: 'ilb-modal-foot' }, [
      runButton,
      button('取消', () => ctx.closeOverlay(), { ghost: true }),
    ]),
  ];

  function filterRow() {
    return searchInput('', '搜文件名…', (value) => {
      view.query = value;
      draw();
    });
  }

  ctx.openOverlay(options.title ?? '导入原生世界书', nodes);
  draw();
}
