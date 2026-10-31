// ui/view-shelf.js —— 书架页（ILB-6.1）
// 一本书一张卡：卡可以长，但不横向撑出屏幕。

import { makeEmptyBook, bookTokenEstimate, strategyOf } from '../core/model.js';
import { exportNativeWorld } from '../core/export-native.js';
import { estimateTokens } from '../core/budget.js';
import { filterBooks } from '../core/search.js';
import { sourceHashOf } from '../core/import-native.js';
import {
  HOST_SOURCE_LABEL, STRATEGY_LABEL, OVERRIDE_LABEL, normalizeHostContext, describeMatch, matchBookToHost,
} from '../core/host-context.js';
import {
  el, button, checkbox, badge, toolbar, filterBar, hint, emptyText, counter,
  searchInput, selectBox, actionRow, metaLine, card, downloadJson,
} from './widgets.js';
import { openImportDialog } from './importer.js';

// 说明"这本书现在为什么开 / 为什么关"：策略 + 强制覆盖 + 宿主关联，三者合成一句话（ILB-4.6）。
// 这里只做展示用的推算；真正判定在 core/resolve-books.js，两边规则一致。
function reasonOf(book, host) {
  const strategy = strategyOf(book.activation);
  const override = book.activation?.override ?? 'auto';
  if (override === 'off') return { on: false, text: '你强制停用了它（覆盖策略）' };
  if (override === 'on') return { on: true, text: '你强制启用了它（覆盖策略）' };
  if (strategy === 'always') return { on: true, text: '策略是「始终启用」' };
  if (strategy === 'manual') return { on: null, text: '策略是「手动控制」，看下面的手动开关' };
  if (!host.contextAvailable) return { on: null, text: '还没读到酒馆上下文（状态未知），先按手动开关走' };
  const match = matchBookToHost(book, host);
  if (match.matched) return { on: true, text: describeMatch(match) };
  if (match.candidate) return { on: false, text: `酒馆里有同名书「${match.candidate}」，但只凭名字相同不会自动启用` };
  return { on: false, text: '当前角色 / 聊天没有关联这本书' };
}

function shortHash(hash) {
  const text = String(hash ?? '');
  return text ? text.slice(0, 8) : '无';
}

function formatTime(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '—';
  try {
    return new Date(n).toLocaleString();
  } catch {
    return '—';
  }
}

export function renderShelf(ctx) {
  const { repository, nativeWorlds } = ctx;
  const listHost = el('div', { class: 'ilb-booklist' });
  const batchHost = el('div', { class: 'ilb-batchbar' });
  const counterLine = counter('');
  let checking = false;
  if (!(ctx.state.bookSelected instanceof Set)) ctx.state.bookSelected = new Set();
  const selected = ctx.state.bookSelected;

  function drawBatch(shown) {
    batchHost.innerHTML = '';
    batchHost.appendChild(el('span', { class: 'ilb-counter', text: selected.size ? `已选 ${selected.size} 本` : '批量操作' }));
    batchHost.appendChild(button('全选当前结果', () => {
      for (const book of shown) selected.add(book.book_id);
      draw();
    }, { ghost: true }));
    batchHost.appendChild(button('清空选择', () => {
      selected.clear();
      draw();
    }, { ghost: true }));
    if (selected.size === 0) return;
    const targets = () => repository.listBooks().filter((b) => selected.has(b.book_id));
    batchHost.appendChild(button('启用', () => {
      for (const book of targets()) repository.setManualState(book.book_id, true);
      ctx.toast(`已启用 ${targets().length} 本`);
      draw();
    }, { ghost: true }));
    batchHost.appendChild(button('停用', () => {
      for (const book of targets()) repository.setManualState(book.book_id, false);
      ctx.toast(`已停用 ${targets().length} 本`);
      draw();
    }, { ghost: true }));
    batchHost.appendChild(button('删除', () => {
      const list = targets();
      if (!window.confirm(`删除选中的 ${list.length} 本书？删了就找不回来了。`)) return;
      for (const book of list) repository.deleteBook(book.book_id);
      selected.clear();
      ctx.toast(`已删除 ${list.length} 本`);
      draw();
    }, { ghost: true }));
  }

  function readHost() {
    try {
      return typeof ctx.getHostContext === 'function' ? ctx.getHostContext() : null;
    } catch (err) {
      console.warn('[ILB] 读取宿主联动信息失败', err);
      return null;
    }
  }

  function draw() {
    const all = repository.listBooks();
    const manual = repository.getManualState();
    // 宿主上下文每次重画都重新读：切了角色就该看到新的"为什么"
    const host = normalizeHostContext(readHost());
    const shown = filterBooks(all, ctx.state.bookQuery);
    const visible = new Set(shown.map((b) => b.book_id));
    for (const id of [...selected]) if (!visible.has(id)) selected.delete(id);

    counterLine.textContent = ctx.state.bookQuery
      ? `命中 ${shown.length} / ${all.length} 本`
      : `共 ${all.length} 本`;

    listHost.innerHTML = '';
    if (all.length === 0) {
      listHost.appendChild(emptyText('还没有书。点「导入原生世界书」把现有的书搬进来，或者新建一本。'));
      return;
    }
    if (shown.length === 0) {
      listHost.appendChild(emptyText('没有匹配的书。换个关键词试试。'));
      return;
    }
    for (const book of shown) listHost.appendChild(renderBook(book, manual, host));
    drawBatch(shown);
  }

  function renderBook(book, manual, host) {
    const strategy = strategyOf(book.activation);
    const override = book.activation?.override ?? 'auto';
    const on = Object.prototype.hasOwnProperty.call(manual, book.book_id)
      ? manual[book.book_id] !== false
      : book.activation?.manual !== false;
    const source = book._source ?? {};
    const count = Number(source.import_count) || 1;
    const reason = reasonOf(book, host);
    const badges = [badge(STRATEGY_LABEL[strategy] ?? strategy), badge(`${book.entries.length} 条`)];
    if (override !== 'auto') badges.push(badge(override === 'on' ? '已强制启用' : '已强制停用'));
    if (count > 1) badges.push(badge(`导入 ${count} 次`));

    return card([
      el('div', { class: 'ilb-rule-head' }, [
        checkbox(selected.has(book.book_id), (on) => {
          if (on) selected.add(book.book_id);
          else selected.delete(book.book_id);
          draw();
        }, '选择这本书'),
        el('div', { class: 'ilb-rule-titles' }, [
          el('button', {
            class: 'ilb-link ilb-title',
            text: book.name || book.book_id,
            onclick: () => {
              ctx.state.activeBookId = book.book_id;
              ctx.setTab('rules');
            },
          }),
          el('div', { class: 'ilb-sub', text: `约 ${bookTokenEstimate(book, estimateTokens)} 词` }),
        ]),
        el('div', { class: 'ilb-badges' }, badges),
      ]),

      metaLine([
        source.book_file
          ? el('span', { class: 'ilb-sub', text: `来源：${source.book_file}` })
          : el('span', { class: 'ilb-sub', text: '来源：手动新建' }),
        source.source_hash
          ? el('span', { class: 'ilb-sub', text: `指纹：${shortHash(source.source_hash)}` })
          : null,
        source.imported_at
          ? el('span', { class: 'ilb-sub', text: `上次导入：${formatTime(source.imported_at)}` })
          : null,
      ]),

      el('div', { class: `ilb-reason ${reason.on === true ? 'ilb-reason-on' : reason.on === false ? 'ilb-reason-off' : ''}`.trim() }, [
        el('span', { class: 'ilb-sub', text: `现在：${reason.text}` }),
      ]),

      hostRow(book, host),

      el('div', { class: 'ilb-book-controls' }, [
        el('label', { class: 'ilb-inline' }, [
          el('span', { class: 'ilb-sub', text: '启用策略' }),
          selectBox(strategy, Object.entries(STRATEGY_LABEL).map(([value, label]) => ({ value, label })), (value) => {
            // mode 是 v0.14 的老字段：保留并同步，老版本读到它时行为尽量一致
            const mode = value === 'auto' ? 'character' : value;
            book.activation = { ...(book.activation ?? {}), strategy: value, mode };
            repository.saveBook(book);
            draw();
          }),
        ]),
        el('label', { class: 'ilb-inline' }, [
          el('span', { class: 'ilb-sub', text: '强制覆盖' }),
          selectBox(override, Object.entries(OVERRIDE_LABEL).map(([value, label]) => ({ value, label })), (value) => {
            book.activation = { ...(book.activation ?? {}), override: value };
            repository.saveBook(book);
            draw();
          }),
        ]),
        el('label', { class: 'ilb-inline' }, [
          checkbox(on, (checked) => {
            repository.setManualState(book.book_id, checked);
            draw();
          }),
          el('span', { class: 'ilb-sub', text: '手动开关' }),
        ]),
        el('label', { class: 'ilb-inline' }, [
          checkbox(book.pool?.share === true, (checked) => {
            book.pool = { ...(book.pool ?? {}), share: checked };
            repository.saveBook(book);
            draw();
          }),
          el('span', { class: 'ilb-sub', text: '进总条目池' }),
        ]),
      ]),

      actionRow([
        button('打开规则', () => {
          ctx.state.activeBookId = book.book_id;
          ctx.setTab('rules');
        }, { ghost: true }),
        button('导出', () => {
          const { native, warnings } = exportNativeWorld(book);
          downloadJson(`${book.name || 'ilb-book'}.json`, native);
          if (warnings.length) ctx.toast(`导出完成，但有 ${warnings.length} 处原生格式装不下`, 'warn');
          else ctx.toast('导出完成');
        }, { ghost: true }),
        source.book_file
          ? button('重新导入', () => openImportDialog(ctx, { preselect: [source.book_file], title: `重新导入 ${source.book_file}` }), { ghost: true })
          : null,
        button('删除', () => {
          if (!window.confirm(`确定删除《${book.name}》？这一行删掉就找不回来了。`)) return;
          repository.deleteBook(book.book_id);
          if (ctx.state.activeBookId === book.book_id) ctx.state.activeBookId = null;
          draw();
        }, { ghost: true }),
      ]),
    ]);
  }

  // 「酒馆关联」：只读展示 + 手动建立/解除 ILB 映射（ILB-4.7）。
  // 建立映射只写 ILB 自己的 host.nativeNames，不动酒馆的原生绑定。
  function hostRow(book, host) {
    const match = matchBookToHost(book, host);
    const nodes = [];
    if (match.matched.length > 0) {
      const labels = [...new Set(match.matched.map((m) => m.label))];
      nodes.push(el('span', { class: 'ilb-sub', text: `酒馆关联：${labels.join('、')}` }));
    } else if (!host.contextAvailable) {
      nodes.push(el('span', { class: 'ilb-sub', text: '酒馆关联：还没同步到宿主状态' }));
    } else {
      nodes.push(el('span', { class: 'ilb-sub', text: '酒馆关联：没有' }));
    }
    nodes.push(button('手动关联…', () => pickHostBook(book, host), { ghost: true }));
    if ((book.host?.nativeNames ?? []).length > 0) {
      nodes.push(button('解除映射', () => {
        book.host = { ...(book.host ?? {}), nativeNames: [], lastMatchedAt: 0 };
        repository.saveBook(book);
        ctx.toast('已解除 ILB 映射；酒馆自己的世界书绑定没有动');
        draw();
      }, { ghost: true }));
    }
    return el('div', { class: 'ilb-inline-list' }, nodes);
  }

  function pickHostBook(book, host) {
    if (!host.sources.length) {
      ctx.openOverlay('手动关联到酒馆的书', [
        hint('这一轮没读到任何原生世界书来源。先在酒馆里给角色 / 聊天关联一本书，或者确认扩展读到了宿主信息。'),
      ]);
      return;
    }
    const rows = host.sources.map((source) => el('div', { class: 'ilb-row' }, [
      el('span', { class: 'ilb-sub', text: `${describeHostSource(source)} → ${source.name}` }),
      button('就是这本', () => {
        book.host = { ...(book.host ?? {}), nativeNames: [source.name], lastMatchedAt: Date.now() };
        repository.saveBook(book);
        try {
          ctx.closeOverlay?.();
        } catch {
          /* 关不掉浮层不影响保存 */
        }
        ctx.toast(`已把《${book.name}》关联到酒馆的「${source.name}」`);
        draw();
      }, { ghost: true }),
    ]));
    ctx.openOverlay('手动关联到酒馆的书', [
      hint('建立的是 ILB 自己的映射：只记录"这本书对应酒馆的哪一本"，不会改酒馆的原生绑定。'),
      ...rows,
    ]);
  }

  function showImportLog() {
    const log = repository.getImportLog().slice().reverse();
    if (log.length === 0) {
      ctx.openOverlay('导入记录', [emptyText('还没有导入过。')]);
      return;
    }
    ctx.openOverlay('导入记录', [
      hint('最近 50 次。它回答的是"这本书当初从哪来、导过几次、哪次有冲突"。'),
      el('div', { class: 'ilb-loglist' }, log.map((item) => el('div', { class: 'ilb-logrow' }, [
        el('span', { class: 'ilb-sub', text: formatTime(item.at) }),
        el('strong', { text: item.file ?? '（未知文件）' }),
        el('span', { class: 'ilb-sub', text: `第 ${item.mode === 'first' ? 1 : '≥2'} 次 · 新增 ${item.added ?? 0} · 更新 ${item.updated ?? 0} · 保留 ${item.kept ?? 0} · 冲突 ${item.conflicts ?? 0} · 警告 ${item.warnings ?? 0}` }),
      ]))),
    ]);
  }

  async function checkSources() {
    if (checking) return;
    const books = repository.listBooks().filter((b) => b?._source?.book_file);
    if (books.length === 0) {
      ctx.toast('没有从原生世界书导入的书，无从检查', 'warn');
      return;
    }
    checking = true;
    ctx.toast('正在比对原件…', 'info');
    const lines = [];
    for (const book of books) {
      const file = book._source.book_file;
      try {
        const raw = await nativeWorlds.get(file);
        const now = sourceHashOf(raw);
        if (!book._source.source_hash) lines.push(`《${book.name}》：以前没存指纹，无法判断（重新导入一次就会记上）`);
        else if (now === book._source.source_hash) lines.push(`《${book.name}》：原件没变`);
        else lines.push(`《${book.name}》：原件变过了。点它的「重新导入」才会更新；你的改动会被保留`);
      } catch {
        lines.push(`《${book.name}》：读不到原件 ${file}（可能被删了或改名了）`);
      }
    }
    checking = false;
    ctx.openOverlay('检查原件', [el('ul', { class: 'ilb-warn-list' }, lines.map((t) => el('li', { text: t })))]);
  }

  function createBook() {
    const name = window.prompt('给新书起个名字', '新世界书');
    if (!name) return;
    const book = makeEmptyBook(name.trim());
    repository.saveBook(book);
    ctx.state.activeBookId = book.book_id;
    draw();
  }

  const view = el('div', {}, [
    toolbar([
      button('新建书', createBook),
      button('导入原生世界书', () => openImportDialog(ctx)),
      button('一键导入全部（跳过已导入）', () => openImportDialog(ctx, { preselect: 'new', title: '一键导入未导入过的书' }), { ghost: true }),
      button('导入记录', showImportLog, { ghost: true }),
      button('检查原件', checkSources, { ghost: true }),
      button('导出全部数据', () => {
        downloadJson('ilb-backup.json', repository.exportAll());
        ctx.toast('已导出全部数据');
      }, { ghost: true }),
      button('?', () => ctx.showHelp('shelf'), { ghost: true, title: '这一页怎么用' }),
    ]),
    filterBar([
      searchInput(ctx.state.bookQuery, '搜书名、来源文件、条目标题…', (value) => {
        ctx.state.bookQuery = value;
        draw();
      }),
      counterLine,
    ]),
    hint('「手动开关」决定这本书参不参与判定；「进总条目池」表示即使这本书没启用，它的条目也能被别的书的规则引用。'),
    batchHost,
    listHost,
  ]);

  draw();
  return view;
}
