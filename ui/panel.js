// ui/panel.js —— 面板外壳（页面导航 + 页面切换 + 统一的书籍上下文）
//
// 导航形态由 ui/nav.js 的纯模型决定，这里只负责翻译成 DOM：
//   wide   → 左侧固定分组导航
//   standard → 顶部常显 + 「更多」下拉
//   compact → 一个下拉框
//   mobile → 底部四个入口 + 「更多」页（v0.22.0 起是正式页面，不再用浮层）
//
// v0.22.0 手机端的改动：
//   1. 顶部多了一条「常驻在顶部」的操作区（书籍/新建/排序/筛选/变量），按功能分开展开；
//      列表滚到哪都能操作，不用滚回顶端。
//   2. 底栏 nav 交给 ui/mobile.js 挂在滚动区外面——不再随着内容长短上下浮。
//   3. 排序选择记在存档 ui.listSort 里；手动排序用 ui.order 当权重。

import { el, option, button, checkbox, field, badge, toolbar, filterBar, hint, emptyText, counter, card, searchInput, selectBox, actionRow, metaLine, downloadJson } from './widgets.js';
import { openOverlay, closeOverlay, showHelp, helpButton, loadHelp } from './help.js';
import * as guard from './guard.js';
import {
  TABS,
  TAB_LABEL,
  MOBILE_TABS,
  desktopNav,
  mobileEntryOf,
  moreItems,
  navSignature,
  describeBookContext,
  bookOptionLabel,
} from './nav.js';
import { SORT_KEYS, SORT_LABEL, SORT_HINT, defaultDir, defaultSorts, normalizeSorts, normalizeSort, sortList } from '../core/sort.js';
import { makeEmptyBook, validateBook, normalizeEntry } from '../core/model.js';
import { filterEntries, listGroups, describeFilter, RULE_MODES, RULE_MODE_LABEL } from '../core/search.js';
import { renderShelf } from './view-shelf.js';
import { renderRules } from './view-rules.js';
import { renderLogicView } from './view-logic.js';
import { openEditor, openPreview } from './editor.js';
import { openLogicEditor } from './logic-editor.js';
import { openGuide } from './guide.js';
import { openImportDialog } from './importer.js';
import { renderSnapshots } from './view-snapshots.js';
import { renderState } from './view-state.js';
import { renderDiagnostics } from './view-diagnostics.js';
import { renderSettings } from './view-settings.js';

const TABS_MODEL = TABS;

const TAB_BLURB = {
  shelf: '每本书是一份独立的规则包：导入、检查、手动开关都在这一页。',
  rules: '这一页管「什么时候出现哪条规则」：触发词、条件、流程、注入位置。',
  logic: '独立逻辑不依附条目：可以有触发词、写变量、激活条目。',
  snapshots: '改动前的快照：出问题了可以整套恢复。',
  state: '当前聊天里的变量、时效状态和手动开关。',
  diagnostics: '这一轮为什么出现/没出现：逐条看判定过程。',
  settings: '全局开关、预算、宿主联动的策略。',
  more: '快照、状态、诊断、设置和使用说明都收在这里。',
};

/** 规则/逻辑两页共用「当前书籍」上下文。 */
const BOOK_TABS = new Set(['rules', 'logic']);
/** 有列表排序的三页。 */
const SORT_LISTS = { shelf: 'shelf', rules: 'rules', logic: 'logic' };

export function createPanel(deps) {
  const { repository, nativeWorlds, pipeline, notify, getChatId, getLayout, getDensity, getNavRoot } = deps;
  const { getHostContext, describeHost } = deps;

  const VIEWS = {
    shelf: renderShelf,
    rules: renderRules,
    logic: renderLogicView,
    snapshots: renderSnapshots,
    state: renderState,
    diagnostics: renderDiagnostics,
    settings: renderSettings,
    more: renderMorePage,
  };

  let uiState = {};
  try {
    uiState = repository.getUiState() ?? {};
  } catch {
    uiState = {};
  }

  const state = {
    activeTab: 'shelf',
    activeBookId: null,
    bookQuery: '',
    ruleQuery: '',
    ruleGroup: '',
    ruleMode: 'all',
    selected: new Set(),
    ruleSelectMode: false,
    rulesFilterOpen: false,
    // 排序（v0.22.0）：每页各记一份选择；hitsScope 决定触发次数按聊天还是全局看
    listSort: normalizeSorts(uiState.listSort),
    hitsScope: uiState.hitsScope === 'global' ? 'global' : 'chat',
    // 手机顶部操作区当前展开的是哪一组（null = 全收起）
    topOpen: null,
  };

  const root = el('div', { class: 'ilb-root' });
  let lastNav = '';

  function layout() {
    try {
      return typeof getLayout === 'function' ? getLayout() : 'desktop';
    } catch {
      return 'desktop';
    }
  }

  function density() {
    try {
      return typeof getDensity === 'function' ? getDensity() : 'standard';
    } catch {
      return 'standard';
    }
  }

  function toast(message, kind = 'info') {
    if (typeof notify === 'function') {
      try {
        notify(message, kind);
        return;
      } catch {
        /* 提示失败不影响功能 */
      }
    }
    console.log(`[ILB] ${message}`);
  }

  function setTab(tab) {
    if (!VIEWS[tab] || state.activeTab === tab) return;
    const go = () => {
      state.activeTab = tab;
      state.selected = new Set();
      state.ruleSelectMode = false;
      state.topOpen = null;
      render();
    };
    if (guard.allowLeave(go)) go();
  }

  /**
   * 保存条目列表。**不重排 ui.order**：手动排序的权重是用户填的，不能被一次保存抹掉。
   * 只有还没有 order 的新条目才补一个（按当前位置）。
   */
  function saveEntries(book) {
    book.entries = (book.entries ?? []).map((entry, index) => {
      const ui = entry.ui ?? {};
      const hasOrder = Number.isFinite(Number(ui.order)) && ui.order !== 0;
      return { ...entry, ui: { ...ui, order: hasOrder ? Number(ui.order) : index } };
    });
    repository.saveBook(book);
  }

  function currentBook() {
    const books = repository.listBooks();
    if (state.activeBookId && !books.some((b) => b.book_id === state.activeBookId)) {
      state.activeBookId = null;
    }
    return books.find((b) => b.book_id === state.activeBookId) ?? null;
  }

  // ---- 排序 ----

  function sortOf(list) {
    return state.listSort[list] ?? defaultSorts()[list];
  }

  function persistSort() {
    try {
      repository.saveUiState({ listSort: state.listSort, hitsScope: state.hitsScope });
    } catch {
      /* 存不下就只在这次会话里生效 */
    }
  }

  function setSort(list, patch) {
    state.listSort[list] = normalizeSort({ ...sortOf(list), ...patch }, list);
    persistSort();
    render();
  }

  function statsSnapshot() {
    try {
      return repository.getTriggerStats?.() ?? { entries: {}, logics: {} };
    } catch {
      return { entries: {}, logics: {} };
    }
  }

  function hitsOf(kind) {
    const stats = statsSnapshot();
    const table = stats?.[kind] ?? {};
    const chatId = String(getChatId?.() ?? '');
    const global = state.hitsScope === 'global';
    return (item) => {
      const rec = table[String(item?.id ?? '')];
      if (!rec) return 0;
      if (global) return Number(rec.total) || 0;
      return Number(rec.chats?.[chatId]) || 0;
    };
  }

  function sortedEntries(book) {
    return sortList(book?.entries ?? [], sortOf('rules'), hitsOf('entries'));
  }

  function sortedLogics(book) {
    return sortList(book?.logic ?? [], sortOf('logic'), hitsOf('logics'));
  }

  function sortedBooks(books) {
    return sortList(books, sortOf('shelf'));
  }

  /** 排序条：桌面放进页面工具栏，手机放进顶部「排序」展开组。 */
  function sortBar(list) {
    const spec = sortOf(list);
    const scopeBtn = list !== 'shelf' && spec.key === 'hits'
      ? button(state.hitsScope === 'chat' ? '统计：当前聊天' : '统计：全部聊天', () => {
        state.hitsScope = state.hitsScope === 'chat' ? 'global' : 'chat';
        persistSort();
        render();
      }, { ghost: true, title: '触发次数按哪个范围算' })
      : null;
    return el('div', { class: 'ilb-sortbar' }, [
      el('span', { class: 'ilb-sub', text: '排序' }),
      selectBox(spec.key, SORT_KEYS[list].map((key) => ({ value: key, label: SORT_LABEL[key] })), (value) => {
        setSort(list, { key: value, dir: defaultDir(value) });
      }, 'ilb-select ilb-sort-key'),
      button(spec.dir === 'asc' ? '正序 ↑' : '倒序 ↓', () => {
        setSort(list, { dir: spec.dir === 'asc' ? 'desc' : 'asc' });
      }, { ghost: true, title: '切换正序/倒序' }),
      scopeBtn,
      el('span', { class: 'ilb-sub ilb-sort-hint', text: SORT_HINT[spec.key] ?? '' }),
    ]);
  }

  /** 手动排序权重输入框（只有排序键是「手动权重」时才出现）。 */
  function sortWeightInput(entry, save) {
    const input = el('input', {
      class: 'ilb-input ilb-sort-weight',
      type: 'number',
      value: String(Number(entry.ui?.order) || 0),
      title: '排序权重：数字越大越靠前（和注入权重无关）',
      'aria-label': '排序权重',
      onchange: () => {
        const n = Number(input.value);
        entry.ui = { ...(entry.ui ?? {}), order: Number.isFinite(n) ? Math.trunc(n) : 0 };
        save?.();
      },
    });
    return el('label', { class: 'ilb-inline ilb-weight-inline' }, [
      el('span', { class: 'ilb-sub', text: '排序权重' }),
      input,
    ]);
  }

  // ---- 常用动作（手机顶部与桌面工具栏共用同一套实现） ----

  function createBookFlow() {
    const nameInput = el('input', { class: 'ilb-input', type: 'text', value: '新世界书', 'aria-label': '书名' });
    const submit = () => {
      const name = String(nameInput.value ?? '').trim() || '新世界书';
      const book = makeEmptyBook(name);
      book.ui = { createdAt: Date.now(), updatedAt: Date.now() };
      repository.saveBook(book);
      state.activeBookId = book.book_id;
      closeOverlay();
      if (state.activeTab !== 'shelf') setTab('shelf');
      else render();
      toast(`已新建「${name}」`);
    };
    nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submit();
    });
    openOverlay({
      title: '新建世界书',
      nodes: [field('书名', nameInput, '建好后会切到「书架」，并自动选中这本。')],
      footer: [button('创建', submit, { primary: true }), button('取消', () => closeOverlay(), { ghost: true })],
    });
  }

  function newRuleFlow() {
    const book = currentBook();
    if (!book) {
      toast('先在「书籍」里选一本', 'warn');
      state.topOpen = 'book';
      render();
      return;
    }
    openEditor(ctx, book, null);
  }

  function newLogicFlow() {
    const book = currentBook();
    if (!book) {
      toast('先在「书籍」里选一本', 'warn');
      state.topOpen = 'book';
      render();
      return;
    }
    openLogicEditor(ctx, book, null);
  }

  const ctx = {
    repository,
    nativeWorlds,
    pipeline,
    getChatId,
    notify,
    getHostContext: typeof getHostContext === 'function' ? getHostContext : () => null,
    describeHost: typeof describeHost === 'function' ? describeHost : () => ({ moduleLoaded: false, via: '', error: '', supported: [] }),
    state,
    toast,
    render,
    setTab,
    saveEntries,
    validateBook,
    openOverlay: (options, nodes) => openOverlay(
      typeof options === 'string' || options === undefined || options === null
        ? { title: options ?? '', nodes: nodes ?? [] }
        : options,
    ),
    closeOverlay,
    showHelp,
    helpButton,
    currentBook,
    layout,
    density,
    openEditor: (book, entry) => openEditor(ctx, book, entry),
    openPreview: (book, entry) => openPreview(ctx, book, entry),
    // v0.22.0：排序与统计
    sortOf,
    setSort,
    sortBar,
    sortWeightInput,
    sortedEntries,
    sortedLogics,
    sortedBooks,
    // 手机顶部操作区要用的动作
    newRule: newRuleFlow,
    newLogic: newLogicFlow,
    newBook: createBookFlow,
    importNative: () => openImportDialog(ctx),
    importAllNew: () => openImportDialog(ctx, { preselect: 'new', title: '一键导入未导入过的书' }),
  };

  // ---- 导航零件（桌面） ----

  function navButton(tab, extraClass = '') {
    const active = state.activeTab === tab.id;
    return el('button', {
      type: 'button',
      class: `ilb-nav-btn ${active ? 'ilb-nav-active' : ''} ${extraClass}`.trim(),
      text: tab.label,
      'aria-current': active ? 'page' : null,
      onclick: () => setTab(tab.id),
    });
  }

  function guideButton() {
    return el('button', {
      type: 'button',
      class: 'ilb-nav-btn ilb-nav-guide',
      text: '使用说明',
      title: '从零开始的完整说明：能做什么、怎么开始、每个功能在哪',
      onclick: () => {
        openGuide(ctx).catch((err) => {
          console.warn('[ILB] 使用说明打不开', err);
          ctx.notify?.('使用说明没打开：' + (err?.message ?? err), 'error');
        });
      },
    });
  }

  function navTools(extra = []) {
    return el('div', { class: 'ilb-nav-tools' }, [...extra, guideButton(), helpButton(state.activeTab)]);
  }

  function topNav(model) {
    const overflow = el('div', { class: 'ilb-nav-menu', hidden: true }, model.overflow.map((tab) => navButton(tab)));
    const moreBtn = el('button', {
      type: 'button',
      class: 'ilb-nav-btn ilb-nav-more',
      text: '更多 ▾',
      'aria-expanded': 'false',
      onclick: () => {
        const next = overflow.hidden;
        overflow.hidden = !next;
        moreBtn.setAttribute('aria-expanded', next ? 'true' : 'false');
      },
    });
    overflow.addEventListener('click', (event) => {
      if (event.target?.closest?.('.ilb-nav-btn') && event.target !== moreBtn) {
        overflow.hidden = true;
        moreBtn.setAttribute('aria-expanded', 'false');
      }
    });
    return el('div', { class: 'ilb-nav ilb-nav-top' }, [
      el('div', { class: 'ilb-nav-main' }, [...model.primary.map((tab) => navButton(tab)), moreBtn]),
      overflow,
      navTools(),
    ]);
  }

  function compactNav(model) {
    // nav.js 的模型统一用 { id, label }；selectBox 要的是 { value, label }，这里翻译一下。
    // （翻译漏掉会让 <option> 的 value 退化成文字，选了也切不动页面——真浏览器里才看得出来。）
    const select = selectBox(
      state.activeTab,
      model.items.map((item) => ({ value: item.id, label: item.label })),
      (value) => setTab(value),
      'ilb-select ilb-nav-select',
    );
    select.setAttribute('aria-label', '切换页面');
    return el('div', { class: 'ilb-nav ilb-nav-compact' }, [select, navTools()]);
  }

  function sideNav(model) {
    return el('aside', { class: 'ilb-nav ilb-nav-side' }, [
      el('div', { class: 'ilb-nav-brand', text: '世界书 · ILB' }),
      ...model.groups.map((group) => el('div', { class: 'ilb-nav-group' }, [
        el('div', { class: 'ilb-nav-group-label', text: group.label }),
        ...group.items.map((tab) => navButton(tab, 'ilb-nav-side-btn')),
      ])),
      el('div', { class: 'ilb-nav-side-foot' }, [guideButton(), helpButton(state.activeTab)]),
    ]);
  }

  // ---- 手机：底部四入口 ----

  function mobileNav() {
    const entry = mobileEntryOf(state.activeTab);
    return el('nav', { class: 'ilb-m-nav', 'aria-label': '主导航' }, MOBILE_TABS.map((tab) => {
        const active = entry === tab.id;
        return el('button', {
          type: 'button',
          class: `ilb-m-nav-btn ${active ? 'ilb-m-nav-active' : ''}`.trim(),
          'aria-current': active ? 'page' : null,
          onclick: () => setTab(tab.id),
        }, [
          el('span', { class: 'ilb-m-nav-glyph', 'aria-hidden': 'true', text: tab.glyph }),
          el('span', { class: 'ilb-m-nav-label', text: tab.label }),
        ]);
      }));
  }

  // ---- 手机：顶部常驻操作区 ----

  /** 顶部操作区：按功能分开的展开按钮；列表滚到哪都在。 */
  function mobileTop() {
    const canBook = BOOK_TABS.has(state.activeTab);
    const list = SORT_LISTS[state.activeTab] ?? null;
    const groups = [
      canBook ? ['book', '书籍'] : null,
      ['new', '新建'],
      list ? ['sort', '排序'] : null,
      canFilter() ? ['filter', '筛选'] : null,
      ['vars', '变量'],
    ].filter(Boolean);

    const rows = {};
    const chips = el('div', { class: 'ilb-m-chips' }, groups.map(([id, label]) => {
      const on = state.topOpen === id;
      return el('button', {
        type: 'button',
        class: `ilb-m-chip ${on ? 'ilb-m-chip-on' : ''}`.trim(),
        'aria-expanded': on ? 'true' : 'false',
        onclick: () => {
          const next = state.topOpen === id ? null : id;
          state.topOpen = next;
          for (const [key, node] of Object.entries(rows)) applyHidden(node, key !== next);
        },
      }, [el('span', { text: label }), el('span', { class: 'ilb-m-chip-caret', text: on ? '▴' : '▾' })]);
    }));

    // hidden 既写属性也写 property：真浏览器里两者联动，测试用的假 DOM 不联动。
    const applyHidden = (node, hidden) => {
      node.hidden = hidden;
      if (hidden) node.setAttribute('hidden', '');
      else node.removeAttribute('hidden');
    };

    const body = el('div', { class: 'ilb-m-top-body' });
    for (const [id, label] of groups) {
      const row = el('div', { class: 'ilb-m-top-row' }, [topRowContent(id)]);
      applyHidden(row, state.topOpen !== id);
      if (!row) continue;
      rows[id] = row;
      body.appendChild(row);
    }

    // 点按钮时把 aria 与高亮一次性弄对（上面内联事件里拿不到 eventTarget，这里统一处理）
    chips.addEventListener('click', (event) => {
      const btn = event.target?.closest?.('.ilb-m-chip');
      if (!btn) return;
      const label = btn.textContent ?? '';
      const id = groups.find(([, text]) => label.startsWith(text))?.[0];
      if (!id) return;
      for (const [key, node] of Object.entries(rows)) applyHidden(node, key !== id);
      chips.querySelectorAll?.('.ilb-m-chip').forEach((node) => {
        const isOn = node === btn;
        node.classList?.toggle?.('ilb-m-chip-on', isOn);
        node.setAttribute('aria-expanded', isOn ? 'true' : 'false');
        const caret = node.querySelector?.('.ilb-m-chip-caret');
        if (caret) caret.textContent = isOn ? '▴' : '▾';
      });
    });

    return el('div', { class: 'ilb-m-top' }, [chips, body]);
  }

  function canFilter() {
    return state.activeTab === 'rules' || state.activeTab === 'shelf';
  }

  function topRowContent(id) {
    if (id === 'book') {
      const books = repository.listBooks();
      if (books.length === 0) return hint('还没有书籍：去「新建」里建一本，或从书架导入。');
      const book = currentBook();
      const select = selectBox(
        book ? book.book_id : '',
        [{ value: '', label: '选择一本书…' }, ...books.map((b) => ({ value: b.book_id, label: bookOptionLabel(b) }))],
        (value) => {
          const apply = () => {
            state.activeBookId = value || null;
            state.selected = new Set();
            state.ruleQuery = '';
            render();
          };
          if (guard.allowLeave(apply)) apply();
        },
        'ilb-select ilb-book-select',
      );
      select.setAttribute('aria-label', '当前书籍');
      return el('div', {}, [
        select,
        el('div', { class: 'ilb-sub', text: book ? describeBookContext(book) : '还没选书' }),
      ]);
    }
    if (id === 'new') {
      if (state.activeTab === 'shelf') {
        return actionRow([
          button('新建世界书', createBookFlow, { ghost: true }),
          button('导入原生世界书', () => openImportDialog(ctx), { ghost: true }),
          button('一键导入未导入的', () => openImportDialog(ctx, { preselect: 'new', title: '一键导入未导入过的书' }), { ghost: true }),
        ]);
      }
      if (state.activeTab === 'rules') {
        return actionRow([button('新增规则', newRuleFlow, { ghost: true })]);
      }
      if (state.activeTab === 'logic') {
        return actionRow([button('新建逻辑', newLogicFlow, { ghost: true })]);
      }
      return hint('这一页没有新建操作。');
    }
    if (id === 'sort') return sortBar(SORT_LISTS[state.activeTab]);
    if (id === 'filter') {
      if (state.activeTab === 'rules') {
        const groups = listGroups(currentBook()?.entries ?? []);
        return el('div', { class: 'ilb-m-filter' }, [
          searchInput(state.ruleQuery, '搜标题、正文、触发词…', (value) => {
            state.ruleQuery = value;
            render();
          }),
          selectBox(state.ruleGroup, [{ value: '', label: '全部分组' }, ...groups.map((g) => ({ value: g, label: `同组 ${g}` }))], (value) => {
            state.ruleGroup = value;
            render();
          }),
          selectBox(state.ruleMode, RULE_MODES.map((m) => ({ value: m, label: RULE_MODE_LABEL[m] })), (value) => {
            state.ruleMode = value;
            render();
          }),
          button('清空筛选', () => {
            state.ruleGroup = '';
            state.ruleMode = 'all';
            state.ruleQuery = '';
            render();
          }, { ghost: true }),
        ]);
      }
      return searchInput(state.bookQuery, '搜书名、来源文件、条目标题…', (value) => {
        state.bookQuery = value;
        render();
      });
    }
    if (id === 'vars') return varsRow();
    return null;
  }

  function varsRow() {
    let vars = {};
    try {
      vars = repository.getVars(getChatId?.()) ?? {};
    } catch {
      vars = {};
    }
    const keys = Object.keys(vars);
    if (keys.length === 0) return hint('这个聊天还没有变量。');
    const items = keys.slice(0, 12).map((key) => el('div', { class: 'ilb-var-line' }, [
      el('span', { class: 'ilb-var-key', text: key }),
      el('span', { class: 'ilb-var-value', text: String(vars[key] ?? '') }),
    ]));
    return el('div', { class: 'ilb-m-vars' }, [
      ...items,
      keys.length > 12 ? el('div', { class: 'ilb-sub', text: `还有 ${keys.length - 12} 个，去「状态」页看全部` }) : null,
      actionRow([button('打开状态页', () => setTab('state'), { ghost: true })]),
    ]);
  }

  // ---- 手机「更多」页 ----

  function renderMorePage() {
    const nodes = moreItems().map((tab) => button(tab.label, () => setTab(tab.id), { ghost: true }));
    return el('div', { class: 'ilb-card' }, [
      hint('快照、状态、诊断、设置都在这里；命名与电脑上一致。'),
      actionRow(nodes),
      actionRow([
        button('使用说明', () => {
          openGuide(ctx).catch((err) => console.warn('[ILB] 使用说明打不开', err));
        }, { ghost: true }),
        button(`「${TAB_LABEL[state.activeTab] ?? '当前页'}」的说明`, () => showHelp(state.activeTab), { ghost: true }),
      ]),
    ]);
  }

  // ---- 桌面：当前书籍栏 ----

  function bookBar() {
    if (!BOOK_TABS.has(state.activeTab)) return null;
    const books = repository.listBooks();
    if (books.length === 0) {
      return el('div', { class: 'ilb-bookbar' }, [
        el('span', { class: 'ilb-bookbar-label', text: '当前书籍' }),
        hint('还没有书籍：先去「书架」导入或新建一本。'),
      ]);
    }
    const book = currentBook();
    const select = selectBox(
      book ? book.book_id : '',
      [{ value: '', label: '选择一本书…' }, ...books.map((b) => ({ value: b.book_id, label: bookOptionLabel(b) }))],
      (value) => {
        const apply = () => {
          state.activeBookId = value || null;
          state.selected = new Set();
          state.ruleQuery = '';
          render();
        };
        if (guard.allowLeave(apply)) apply();
      },
      'ilb-select ilb-book-select',
    );
    select.setAttribute('aria-label', '当前书籍');
    return el('div', { class: 'ilb-bookbar' }, [
      el('span', { class: 'ilb-bookbar-label', text: '当前书籍' }),
      select,
      el('span', { class: 'ilb-bookbar-note', text: book ? describeBookContext(book) : '还没选书' }),
    ]);
  }

  function drawView() {
    const body = el('div', { class: 'ilb-tab-body' });
    const blurb = TAB_BLURB[state.activeTab];
    if (blurb && layout() !== 'mobile') body.appendChild(el('p', { class: 'ilb-tab-blurb', text: blurb }));
    const view = VIEWS[state.activeTab] ?? renderShelf;
    try {
      body.appendChild(view(ctx));
    } catch (err) {
      console.error('[ILB] 这一页画不出来', err);
      body.appendChild(el('div', { class: 'ilb-card' }, [
        el('p', { class: 'ilb-error', text: `这一页出错了：${err?.message ?? err}` }),
        hint('其它页还能用。把这一行报给开发者即可。'),
        button('重新画一次', () => render(), { ghost: true }),
      ]));
    }
    return body;
  }

  function mountMobileNav() {
    const host = typeof getNavRoot === 'function' ? getNavRoot() : null;
    if (!host) return false;
    host.innerHTML = '';
    host.appendChild(mobileNav());
    return true;
  }

  function render() {
    try {
      root.innerHTML = '';
      const currentLayout = layout();
      const currentDensity = density();
      lastNav = navSignature(currentDensity, state.activeTab);
      root.setAttribute('data-layout', currentLayout);
      root.setAttribute('data-density', currentDensity);
      root.className = `ilb-root ilb-root-${currentLayout} ilb-density-${currentDensity}`;

      const main = el('div', { class: 'ilb-main' });

      if (currentLayout === 'mobile') {
        root.appendChild(mobileTop());
        main.appendChild(drawView());
        root.appendChild(main);
        // 底栏由 ui/mobile.js 挂在滚动区外面；拿不到挂载点时退回旧行为（画在面板里）
        if (!mountMobileNav()) root.appendChild(mobileNav());
        return;
      }

      // 桌面：手机底栏槽位要清掉，避免切到桌面后还留一块
      const navHost = typeof getNavRoot === 'function' ? getNavRoot() : null;
      if (navHost) navHost.innerHTML = '';

      const bar = bookBar();
      if (bar) main.appendChild(bar);
      main.appendChild(drawView());

      const model = desktopNav(currentDensity);
      if (model.mode === 'sidenav') {
        root.appendChild(el('div', { class: 'ilb-shell' }, [sideNav(model), main]));
        return;
      }
      root.appendChild(model.mode === 'select' ? compactNav(model) : topNav(model));
      root.appendChild(main);
    } catch (err) {
      console.error('[ILB] 面板渲染失败', err);
    }
  }

  function onLayoutChange() {
    if (guard.isAsking()) return;
    const sig = navSignature(density(), state.activeTab);
    if (sig === lastNav && layout() !== 'mobile') return;
    render();
  }

  async function mount(container) {
    try {
      await loadHelp();
    } catch {
      /* 帮助文案读不到也要能开 */
    }
    const host = typeof container === 'string' ? document.querySelector(container) : container;
    if (!host) {
      console.warn('[ILB] 面板没找到挂载点');
      return false;
    }
    host.appendChild(root);
    render();
    return true;
  }

  return {
    mount,
    render,
    toast,
    element: root,
    setTab,
    state,
    onLayoutChange,
    currentBook,
    openEditor: (book, entry) => openEditor(ctx, book, entry),
    openPreview: (book, entry) => openPreview(ctx, book, entry),
  };
}

export const TAB_COUNT = TABS.length;
