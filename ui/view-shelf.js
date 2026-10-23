// ui/view-shelf.js —— 书架页（ILB-6.1）
// 一本书一张卡：卡可以长，但不横向撑出屏幕。

import { makeEmptyBook, bookTokenEstimate } from '../core/model.js';
import { exportNativeWorld } from '../core/export-native.js';
import { estimateTokens } from '../core/budget.js';
import { filterBooks } from '../core/search.js';
import { sourceHashOf } from '../core/import-native.js';
import {
  el, button, checkbox, badge, toolbar, filterBar, hint, emptyText, counter,
  searchInput, selectBox, actionRow, metaLine, card, downloadJson,
} from './widgets.js';
import { openImportDialog } from './importer.js';

const MODE_LABEL = { always: '永远启用', character: '跟随角色卡', manual: '手动开关' };

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
  const counterLine = counter('');
  let checking = false;

  function draw() {
    const all = repository.listBooks();
    const manual = repository.getManualState();
    const shown = filterBooks(all, ctx.state.bookQuery);

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
    for (const book of shown) listHost.appendChild(renderBook(book, manual));
  }

  function renderBook(book, manual) {
    const mode = book.activation?.mode ?? 'manual';
    const on = Object.prototype.hasOwnProperty.call(manual, book.book_id)
      ? manual[book.book_id] !== false
      : book.activation?.manual !== false;
    const source = book._source ?? {};
    const count = Number(source.import_count) || 1;
    const badges = [badge(MODE_LABEL[mode] ?? mode), badge(`${book.entries.length} 条`)];
    if (count > 1) badges.push(badge(`导入 ${count} 次`));

    return card([
      el('div', { class: 'ilb-rule-head' }, [
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

      el('div', { class: 'ilb-book-controls' }, [
        el('label', { class: 'ilb-inline' }, [
          el('span', { class: 'ilb-sub', text: '启用方式' }),
          selectBox(mode, Object.entries(MODE_LABEL).map(([value, label]) => ({ value, label })), (value) => {
            book.activation = { ...(book.activation ?? {}), mode: value };
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
    listHost,
  ]);

  draw();
  return view;
}
