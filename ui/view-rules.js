// ui/view-rules.js —— 规则页（ILB-6.2）
// 一条规则一张卡：卡可以上下变长，不许左右变宽。手机上不需要左右滑。

import {
  POSITIONS, ROLES,
} from '../core/settings-defaults.js';
import { validateBook, defaultEntry, normalizeEntry } from '../core/model.js';
import { filterEntries, listGroups, describeFilter, RULE_MODES, RULE_MODE_LABEL } from '../core/search.js';
import {
  el, option, button, checkbox, badge, toolbar, filterBar, hint, emptyText, counter,
  searchInput, selectBox, actionRow, metaLine, card,
} from './widgets.js';

export const POSITION_LABEL = { before_char: '角色设定之前', after_char: '角色设定之后', in_chat: '聊天记录里' };
export const ROLE_LABEL = { system: '系统', user: '用户', assistant: '角色' };

export function describeTrigger(entry) {
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

export function renderRules(ctx) {
  const { repository, state } = ctx;
  const books = repository.listBooks();
  if (books.length === 0) return emptyText('先去书架导入或新建一本书。');

  const book = books.find((b) => b.book_id === state.activeBookId) ?? books[0];
  if (state.activeBookId !== book.book_id) {
    state.activeBookId = book.book_id;
    state.selected = new Set();
  }

  const listHost = el('div', { class: 'ilb-rule-list' });
  const batchHost = el('div', { class: 'ilb-batchbar' });
  const counterLine = counter('');
  let selectAllBox = null;

  const filtered = () => filterEntries(book.entries, {
    q: state.ruleQuery,
    group: state.ruleGroup,
    mode: state.ruleMode,
  });

  function save() {
    book.entries = book.entries.map((e, i) => ({ ...e, ui: { ...(e.ui ?? {}), order: i } }));
    repository.saveBook(book);
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
    for (const entry of targets) mutate(entry);
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

  function renderCard(entry) {
    const checked = state.selected.has(entry.id);
    const badges = [];
    if (entry.always) badges.push(badge('常驻', 'ok'));
    if (entry.useProbability) badges.push(badge(`${entry.probability}%`, 'warn'));
    if (entry.chain?.participate) badges.push(badge('可连锁'));
    if (entry.enabled === false) badges.push(badge('已停用', 'warn'));
    const flowNodes = Array.isArray(entry.logic?.nodes) ? entry.logic.nodes.length : 0;
    if (flowNodes > 0) badges.push(badge(entry.logic?.mode === 'only' ? '只看流程' : '有流程', 'ok'));

    const weightInput = el('input', {
      type: 'number',
      class: 'ilb-num',
      value: String(entry.weight ?? 100),
      onchange: (event) => {
        entry.weight = Number(event.target.value) || 0;
        save();
      },
    });

    return card([
      el('div', { class: 'ilb-rule-head' }, [
        checkbox(checked, (on) => {
          if (on) state.selected.add(entry.id);
          else state.selected.delete(entry.id);
          draw();
        }, '选择这条'),
        el('div', { class: 'ilb-rule-titles' }, [
          el('div', { class: 'ilb-title', text: entry.title || '未命名规则' }),
          el('div', { class: 'ilb-sub', text: describeTrigger(entry) }),
        ]),
        el('div', { class: 'ilb-badges' }, badges),
      ]),
      metaLine([
        el('label', { class: 'ilb-inline' }, [el('span', { class: 'ilb-sub', text: '权重' }), weightInput]),
        el('span', { class: 'ilb-sub', text: entry.group ? `同组 ${entry.group}` : '不分组' }),
        el('span', { class: 'ilb-sub' , text: `${POSITION_LABEL[entry.injection?.position] ?? '?'} · 深度 ${entry.injection?.depth ?? 4} · ${ROLE_LABEL[entry.injection?.role] ?? '?'}` }),
        el('label', { class: 'ilb-inline' }, [
          checkbox(entry.enabled !== false, (on) => {
            entry.enabled = on;
            save();
            draw();
          }, '启用这条'),
          el('span', { class: 'ilb-sub', text: '启用' }),
        ]),
      ]),
      actionRow([
        button('编辑', () => ctx.openEditor(book, entry), { ghost: true }),
        button('↑', () => move(entry, -1), { ghost: true, title: '往前排' }),
        button('↓', () => move(entry, 1), { ghost: true, title: '往后排' }),
        button('复制', () => duplicate(entry), { ghost: true }),
        button('试一句', () => ctx.openPreview(book, entry), { ghost: true, title: '看看哪句话会让它出现' }),
        button('删除', () => remove(entry), { ghost: true }),
      ]),
    ], entry.enabled === false ? 'ilb-card-off' : '');
  }

  function drawBatch(rows) {
    batchHost.innerHTML = '';
    const count = state.selected.size;
    batchHost.appendChild(el('span', {
      class: 'ilb-counter',
      text: count ? `已选 ${count} 条` : '批量操作',
    }));
    batchHost.appendChild(button('全选当前结果', () => {
      for (const entry of rows) state.selected.add(entry.id);
      draw();
    }, { ghost: true }));
    batchHost.appendChild(button('清空选择', () => {
      state.selected.clear();
      draw();
    }, { ghost: true }));
    if (count === 0) return;
    batchHost.appendChild(button('启用', () => applyBatch((e) => { e.enabled = true; }, '启用'), { ghost: true }));
    batchHost.appendChild(button('停用', () => applyBatch((e) => { e.enabled = false; }, '停用'), { ghost: true }));
    batchHost.appendChild(button('设为常驻', () => applyBatch((e) => { e.always = true; }, '设为常驻'), { ghost: true }));
    batchHost.appendChild(button('取消常驻', () => applyBatch((e) => { e.always = false; }, '取消常驻'), { ghost: true }));
    batchHost.appendChild(button('删除', batchDelete, { ghost: true }));
  }

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

    if (selectAllBox) {
      const all = rows.length > 0 && rows.every((e) => state.selected.has(e.id));
      selectAllBox.checked = all;
      selectAllBox.indeterminate = !all && rows.some((e) => state.selected.has(e.id));
    }
    drawBatch(rows);
  }

  const groups = listGroups(book.entries);
  const problems = validateBook(book);

  selectAllBox = checkbox(false, (on) => {
    const rows = filtered();
    if (on) for (const entry of rows) state.selected.add(entry.id);
    else state.selected.clear();
    draw();
  }, '全选当前结果');

  const view = el('div', {}, [
    toolbar([
      selectBox(book.book_id, books.map((b) => ({ value: b.book_id, label: b.name })), (value) => {
        state.activeBookId = value;
        state.selected = new Set();
        ctx.render();
      }),
      button('新增规则', () => ctx.openEditor(book, null)),
      problems.length
        ? badge(`${problems.length} 处需要检查`, 'warn')
        : badge('结构正常', 'ok'),
      button('?', () => ctx.showHelp('rules'), { ghost: true, title: '这一页怎么用' }),
    ]),
    filterBar([
      searchInput(state.ruleQuery, '搜标题、正文、触发词…', (value) => {
        state.ruleQuery = value;
        draw();
      }),
      selectBox(state.ruleGroup, [
        { value: '', label: '全部分组' },
        ...groups.map((g) => ({ value: g, label: `同组 ${g}` })),
      ], (value) => {
        state.ruleGroup = value;
        draw();
      }),
      selectBox(state.ruleMode, RULE_MODES.map((m) => ({ value: m, label: RULE_MODE_LABEL[m] })), (value) => {
        state.ruleMode = value;
        draw();
      }),
      el('label', { class: 'ilb-inline' }, [selectAllBox, el('span', { class: 'ilb-sub', text: '全选' })]),
      counterLine,
    ]),
    batchHost,
    hint('「全选当前结果」只选搜索/筛选之后看得到的那些；批量操作也一样，不会波及被筛掉的规则。'),
    listHost,
  ]);

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
