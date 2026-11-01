// ui/view-rules.js —— 规则页（ILB-6.2 / Phase 3 §5.4 §6.3）
// 一条规则一张卡：卡可以上下变长，不许左右变宽。手机上不需要左右滑。
//
// v0.16.0 的界面取舍：
//  - 默认卡上只留"名称 / 启用 / 触发摘要 / 少量标签"，复制、排序、删除、试一句收进「⋯」；
//  - 勾选框只在「选择模式」出现，批量栏也跟着只在选择模式出现（不再常驻一条按钮带）；
//  - 分组/模式这类不常改的筛选收进「筛选」抽屉，搜索始终可见。

import {
  POSITIONS, ROLES,
} from '../core/settings-defaults.js';
import { validateBook, defaultEntry, normalizeEntry } from '../core/model.js';
import { filterEntries, listGroups, describeFilter, RULE_MODES, RULE_MODE_LABEL } from '../core/search.js';
import {
  el, option, button, checkbox, badge, toolbar, filterBar, hint, emptyText, counter,
  searchInput, selectBox, actionRow, metaLine, card, field,
} from './widgets.js';
import { pickerButton } from './picker.js';

export const POSITION_LABEL = { before_char: '角色设定之前', after_char: '角色设定之后', in_chat: '聊天记录里' };
export const ROLE_LABEL = { system: '系统', user: '用户', assistant: '角色' };

export function describeTrigger(entry) {
  if (entry.wait) return '等候模式（不自己出现，只等逻辑点名）';
  if (entry.always) return '常驻（一直在）';
  const any = entry.trigger?.any ?? [];
  const all = entry.trigger?.all ?? [];
  const parts = [];
  if (any.length) parts.push(`出现任一：${any.slice(0, 4).join('、')}`);
  if (all.length) parts.push(`同时出现：${all.slice(0, 4).join('、')}`);
  if (entry.trigger?.regex?.length) parts.push('含正则');
  if (entry.when?.length) parts.push(`+${entry.when.length} 个条件`);
  const timed = entry.timed ?? {};
  if (timed.sticky) parts.push(`持续 ${timed.sticky} 条`);
  if (timed.cooldown) parts.push(`冷却 ${timed.cooldown} 条`);
  if (timed.delay) parts.push(`延迟 ${timed.delay} 条`);
  return parts.length ? parts.join('；') : '没有设置触发词（不会出现）';
}

/** 点页面别处也收菜单：整个模块只登记一次，避免每次重画都加一个监听。 */
let outsideBound = false;
function bindOutsideClose() {
  if (outsideBound) return;
  const doc = globalThis.document;
  if (!doc?.addEventListener) return;
  outsideBound = true;
  doc.addEventListener('click', (event) => {
    if (event?.target?.closest?.('.ilb-more')) return;
    doc.querySelectorAll('.ilb-menu').forEach((node) => {
      node.hidden = true;
    });
  });
}

export function renderRules(ctx) {
  const { repository, state } = ctx;
  bindOutsideClose();
  const books = repository.listBooks();
  if (books.length === 0) return emptyText('先去书架导入或新建一本书。');

  // 统一书籍上下文（§6.2）：没有当前书籍时**不**偷偷选第一本。
  // 选错书再改规则，比多点一下选书危险得多。
  const book = books.find((b) => b.book_id === state.activeBookId) ?? null;
  if (!book) {
    return el('div', { class: 'ilb-card' }, [
      el('p', { class: 'ilb-empty-title', text: '还没有选择书籍' }),
      hint('在上面的「当前书籍」里选一本。每本书的规则是分开的，选错了会改到别的书上。'),
      actionRow([button('去书架', () => ctx.setTab('shelf'), { ghost: true })]),
    ]);
  }

  const listHost = el('div', { class: 'ilb-rule-list' });
  // 选择模式随时可能被「取消选择」关掉；一律现读 state，别在闭包里存一份旧的。
  const selectMode = () => state.ruleSelectMode === true;

  const filtered = () => filterEntries(ctx.sortedEntries(book), {
    q: state.ruleQuery,
    group: state.ruleGroup,
    mode: state.ruleMode,
    scope: ctx.state.searchScope?.rules === 'title' ? 'title' : 'all',
  });

  function save() {
    // 不重排 ui.order：它是「手动排序」的权重。只有还没填过的条目按当前位置补一个。
    book.entries = book.entries.map((e, i) => {
      const ui = e.ui ?? {};
      const has = Number.isFinite(Number(ui.order)) && Number(ui.order) !== 0;
      return { ...e, ui: { ...ui, order: has ? Number(ui.order) : i } };
    });
    repository.saveBook(book);
  }

  function touch(entry) {
    entry.ui = { ...(entry.ui ?? {}), updatedAt: Date.now() };
  }

  /** 「⋯」里的「设置分组」：列表页直接改，不用翻到编辑器高级设置里。 */
  function setGroup(entry) {
    const groups = listGroups(book.entries);
    const input = el('input', { class: 'ilb-input', type: 'text', value: String(entry.group ?? ''), 'aria-label': '分组名' });
    const apply = () => {
      const value = String(input.value ?? '').trim();
      entry.group = value || null;
      touch(entry);
      save();
      ctx.closeOverlay();
      draw();
      ctx.toast(value ? `已放进「${value}」` : '已取消分组');
    };
    ctx.openOverlay({
      title: '设置分组',
      nodes: [field('分组', input, `留空 = 不分组。已有的分组：${groups.length ? groups.join('、') : '（还没有）'}`)],
      footer: [button('保存', apply, { primary: true }), button('取消', () => ctx.closeOverlay(), { ghost: true })],
    });
  }

  function indexOf(entry) {
    return book.entries.findIndex((e) => e.id === entry.id);
  }

  function move(entry, delta) {
    const from = indexOf(entry);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= book.entries.length) return;
    const list = book.entries.slice();
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
    book.entries = list;
    save();
    draw();
  }

  function duplicate(entry) {
    const raw = { ...entry, id: undefined, localId: undefined, title: `${entry.title}（副本）` };
    const copy = normalizeEntry(raw, book.book_id);
    copy.ui = { ...(copy.ui ?? {}), createdAt: Date.now(), updatedAt: Date.now(), order: 0 };
    const at = indexOf(entry);
    book.entries = [...book.entries.slice(0, at + 1), copy, ...book.entries.slice(at + 1)];
    save();
    draw();
  }

  function remove(entry) {
    if (!window.confirm(`删除规则「${entry.title}」？删了就找不回来了。`)) return;
    book.entries = book.entries.filter((e) => e.id !== entry.id);
    state.selected.delete(entry.id);
    save();
    draw();
  }

  function applyBatch(mutate, label) {
    const targets = book.entries.filter((e) => state.selected.has(e.id));
    if (targets.length === 0) {
      ctx.toast('先勾选几条规则', 'warn');
      return;
    }
    for (const entry of targets) {
      mutate(entry);
      touch(entry);
    }
    save();
    ctx.toast(`已对 ${targets.length} 条执行：${label}`);
    draw();
  }

  function batchDelete() {
    const targets = book.entries.filter((e) => state.selected.has(e.id));
    if (targets.length === 0) return;
    if (!window.confirm(`删除选中的 ${targets.length} 条规则？`)) return;
    book.entries = book.entries.filter((e) => !state.selected.has(e.id));
    state.selected.clear();
    save();
    ctx.toast(`已删除 ${targets.length} 条`);
    draw();
  }

  /** 打开一个「⋯」菜单前先把别的收起来：不然两张卡的菜单会同时摊在那儿互相压。 */
  function hideOtherMenus(keep) {
    const scope = keep?.ownerDocument ?? globalThis.document;
    if (!scope?.querySelectorAll) return;
    scope.querySelectorAll('.ilb-menu').forEach((node) => {
      if (node !== keep) node.hidden = true;
    });
  }

  /** 卡片右上角的「⋯」：低频操作都收在这里，危险操作（删除）排最后。 */
  function moreMenu(entry) {
    const menu = el('div', { class: 'ilb-menu', hidden: true }, [
      button('设置分组', () => setGroup(entry), { ghost: true }),
      button('往前排', () => move(entry, -1), { ghost: true }),
      button('往后排', () => move(entry, 1), { ghost: true }),
      button('复制一条', () => duplicate(entry), { ghost: true }),
      button('删除', () => remove(entry), { ghost: true }),
    ]);
    const toggle = el('button', {
      type: 'button',
      class: 'ilb-icon-btn',
      text: '⋯',
      title: '更多操作',
      'aria-label': '更多操作',
      'aria-expanded': 'false',
      onclick: (event) => {
        event.stopPropagation();
        const opening = menu.hidden;
        if (opening) hideOtherMenus(menu);
        menu.hidden = !menu.hidden;
        toggle.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
      },
    });
    menu.addEventListener('click', () => {
      menu.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    });
    return el('div', { class: 'ilb-more' }, [toggle, menu]);
  }

  function renderCard(entry) {
    const checked = state.selected.has(entry.id);
    const badges = [];
    if (entry.always) badges.push(badge('常驻', 'ok'));
    if (entry.wait) badges.push(badge('等候模式', 'warn'));
    if (entry.useProbability) badges.push(badge(`${entry.probability}%`, 'warn'));
    if (entry.chain?.participate) badges.push(badge('可连锁'));
    if (entry.group) badges.push(badge(`同组 ${entry.group}`));
    const flowNodes = Array.isArray(entry.logic?.nodes) ? entry.logic.nodes.length : 0;
    if (flowNodes > 0) badges.push(badge(entry.logic?.mode === 'only' ? '只看流程' : '有流程', 'ok'));

    const head = el('div', { class: 'ilb-rule-head' }, [
      selectMode()
        ? checkbox(checked, (on) => {
          if (on) state.selected.add(entry.id);
          else state.selected.delete(entry.id);
          draw();
        }, '选择这条')
        : null,
      el('div', { class: 'ilb-rule-titles' }, [
        el('div', { class: 'ilb-title', text: entry.title || '未命名规则' }),
        el('div', { class: 'ilb-sub', text: describeTrigger(entry) }),
      ]),
      el('div', { class: 'ilb-rule-side' }, [
        el('div', { class: 'ilb-badges' }, badges),
        moreMenu(entry),
      ]),
    ]);

    const manual = ctx.sortOf('rules')?.key === 'manual';
    return card([
      head,
      metaLine([
        manual ? ctx.sortWeightInput(entry, () => { touch(entry); save(); draw(); }) : null,
        el('label', { class: 'ilb-inline ilb-switch' }, [
          checkbox(entry.enabled !== false, (on) => {
            entry.enabled = on;
            touch(entry);
            save();
            draw();
          }, '启用这条'),
          el('span', { class: 'ilb-sub', text: entry.enabled === false ? '已停用' : '已启用' }),
        ]),
        el('span', { class: 'ilb-sub', text: `权重 ${entry.weight ?? 100}` }),
        el('span', { class: 'ilb-sub ilb-meta-pos', text: `${POSITION_LABEL[entry.injection?.position] ?? '?'} · 深度 ${entry.injection?.depth ?? 4}` }),
      ]),
      actionRow([
        button('编辑', () => ctx.openEditor(book, entry), { ghost: true }),
        button('试一句', () => ctx.openPreview(book, entry), { ghost: true }),
      ]),
    ], `ilb-rule-card ${entry.enabled === false ? 'ilb-card-off' : ''} ${selectMode() && checked ? 'ilb-card-selected' : ''}`.trim());
  }

  function drawBatchBar(rows) {
    if (!selectMode()) return null;
    const count = state.selected.size;
    return el('div', { class: 'ilb-batchbar' }, [
      el('span', { class: 'ilb-counter', text: count ? `已选 ${count} 条` : '选择模式' }),
      button('全选当前结果', () => {
        for (const entry of rows) state.selected.add(entry.id);
        draw();
      }, { ghost: true }),
      button('取消选择', () => {
        state.ruleSelectMode = false;
        state.selected.clear();
        ctx.render();
      }, { ghost: true }),
      button('启用', () => applyBatch((e) => { e.enabled = true; }, '启用'), { ghost: true }),
      button('停用', () => applyBatch((e) => { e.enabled = false; }, '停用'), { ghost: true }),
      button('设为常驻', () => applyBatch((e) => { e.always = true; }, '设为常驻'), { ghost: true }),
      button('取消常驻', () => applyBatch((e) => { e.always = false; }, '取消常驻'), { ghost: true }),
      button('删除', batchDelete, { ghost: true }),
    ]);
  }

  // 页面骨架只建一次；draw() 之后只重画列表区和批量栏，输入焦点/滚动不会被整页重建打断。
  const batchHost = el('div', { class: 'ilb-batch-host' });
  const counterLine = counter('');
  const filterExtra = el('div', { class: 'ilb-filter-extra', hidden: state.rulesFilterOpen !== true });

  function draw() {
    const rows = filtered();
    // 选了又被筛掉的不算：批量只作用在"当前看得到的"结果上（ILB-6.12.3）
    const visible = new Set(rows.map((e) => e.id));
    for (const id of [...state.selected]) if (!visible.has(id)) state.selected.delete(id);

    listHost.innerHTML = '';
    if (rows.length === 0) {
      listHost.appendChild(emptyText(book.entries.length
        ? '没有命中。换个关键词，或者清空筛选。'
        : '这本书里还没有规则。点「新增规则」写第一条。'));
    } else {
      for (const entry of rows) listHost.appendChild(renderCard(entry));
    }

    counterLine.textContent = describeFilter(
      { q: state.ruleQuery, group: state.ruleGroup, mode: state.ruleMode },
      rows.length,
      book.entries.length,
    );

    batchHost.innerHTML = '';
    const bar = drawBatchBar(rows);
    if (bar) batchHost.appendChild(bar);
  }

  const groups = listGroups(book.entries);
  const problems = validateBook(book);

  const mobile = ctx.layout?.() === 'mobile';
  const view = el('div', {}, [
    mobile ? null : toolbar([
      button('新增规则', () => ctx.openEditor(book, null)),
      button(selectMode() ? '退出选择' : '选择', () => {
        state.ruleSelectMode = !selectMode();
        if (!state.ruleSelectMode) state.selected.clear();
        ctx.render();
      }, { ghost: true, title: '进入选择模式后可以批量启用/停用/删除' }),
      problems.length
        ? badge(`${problems.length} 处需要检查`, 'warn')
        : badge('结构正常', 'ok'),
      button('?', () => ctx.showHelp('rules'), { ghost: true, title: '这一页怎么用' }),
    ]),
    mobile ? null : filterBar([
      searchInput(state.ruleQuery, '搜标题、正文、触发词…', (value) => {
        state.ruleQuery = value;
        draw();
      }),
      ctx.searchScopeSelect?.('rules'),
      button(state.rulesFilterOpen ? '筛选 ▴' : '筛选 ▾', () => {
        state.rulesFilterOpen = !state.rulesFilterOpen;
        ctx.render();
      }, { ghost: true }),
      counterLine,
    ]),
    mobile ? null : el('div', { class: 'ilb-filter-extra-wrap' }, [filterExtra]),
    mobile ? null : ctx.sortBar?.('rules'),
    batchHost,
    mobile ? counterLine : hint('搜索/筛选只影响看得到的列表；「全选当前结果」也只选这些，不会波及被筛掉的规则。'),
    listHost,
    mobile ? null : hint('独立逻辑在「逻辑」页——在那边新建、编辑、导入导出。'),
  ]);

  filterExtra.appendChild(pickerButton(state.ruleGroup ? `同组 ${state.ruleGroup}` : '全部分组', () => ctx.openPicker?.({
    title: '按分组筛选',
    value: state.ruleGroup,
    hint: '分组多的时候直接搜名字；选「全部分组」清掉这一项。',
    placeholder: '搜分组名…',
    items: [
      { value: '', label: '全部分组' },
      ...groups.map((g) => ({ value: g, label: `同组 ${g}` })),
    ],
    onPick: (value) => {
      state.ruleGroup = value;
      draw();
    },
  }), { placeholder: '全部分组', title: '选择分组（可搜索）' }));
  filterExtra.appendChild(selectBox(state.ruleMode, RULE_MODES.map((m) => ({ value: m, label: RULE_MODE_LABEL[m] })), (value) => {
    state.ruleMode = value;
    draw();
  }));
  filterExtra.appendChild(button('清空筛选', () => {
    state.ruleGroup = '';
    state.ruleMode = 'all';
    state.ruleQuery = '';
    ctx.render();
  }, { ghost: true }));

  draw();
  return view;
}

export function positionOptions(selected) {
  return POSITIONS.map((p) => option(p, POSITION_LABEL[p], selected === p));
}

export function roleOptions(selected) {
  return ROLES.map((r) => option(r, ROLE_LABEL[r], selected === r));
}

export { defaultEntry };
