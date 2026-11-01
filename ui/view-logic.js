// ui/view-logic.js —— 独立逻辑页（ILB-6.24 / v0.23.0 逻辑组）
//
// 逻辑不再必须以一本书为前提：可以建「逻辑组」，组里放逻辑。
// 组可以独立启停，也可以选「某本书启用时我才跑」。
// 书里的逻辑仍然留在书里（老数据不动），页面上单列一段，可以搬进逻辑组或从组里搬回书。

import { el, button, badge, hint, actionRow, downloadJson, metaLine, selectBox, card } from './widgets.js';
import { openLogicEditor } from './logic-editor.js';
import { countFlowNodes } from '../core/flow.js';
import { normalizeLogic, META_LABEL } from '../core/model.js';

const DEFAULT_GROUP_NAME = '独立逻辑';

export function renderLogicView(ctx) {
  const { repository, state } = ctx;
  const books = repository.listBooks();
  const book = books.find((b) => b.book_id === state.activeBookId) ?? null;
  const listHost = el('div', { class: 'ilb-logic-list' });
  const mobile = ctx.layout?.() === 'mobile';

  // 组：默认帮用户建一个「独立逻辑」组，不用先点新建也能直接建逻辑。
  function groups() {
    const list = repository.listLogicGroups?.() ?? [];
    if (list.length > 0) return list;
    return [];
  }

  function ensureDefaultGroup() {
    const list = groups();
    if (list.length > 0) return list[0];
    const group = repository.saveLogicGroup({ name: DEFAULT_GROUP_NAME, enabled: true, followBookId: '' });
    return group;
  }

  function currentGroup() {
    const list = groups();
    if (list.length === 0) return null;
    return list.find((g) => g.id === state.logicGroupId) ?? list[0];
  }

  function standaloneOf(group) {
    if (!group) return [];
    return repository.listStandaloneLogics?.(group.id) ?? [];
  }

  function bookLogics() {
    return Array.isArray(book?.logic) ? book.logic : [];
  }

  function saveBook() {
    repository.saveBook(book);
    draw();
  }

  function describeLogic(logic) {
    const parts = [];
    const any = logic.trigger?.any ?? [];
    const all = logic.trigger?.all ?? [];
    const meta = logic.trigger?.meta ?? 'none';
    if (meta !== 'none') parts.push(META_LABEL[meta] ?? meta);
    if (any.length) parts.push(`出现任一：${any.slice(0, 4).join('、')}`);
    if (all.length) parts.push(`同时出现：${all.slice(0, 4).join('、')}`);
    if (logic.trigger?.source === 'user') parts.push('只看用户');
    if (logic.trigger?.source === 'ai') parts.push('只看 AI');
    if (meta === 'none' && !parts.length) parts.push('没有触发词（只能被调用或激活）');
    const nodes = countFlowNodes(logic.flow?.nodes ?? []);
    if (nodes > 0) parts.push(`${nodes} 个步骤`);
    return parts.join('；');
  }

  // ---- 组操作 ----

  function newGroup() {
    const input = el('input', { class: 'ilb-input', type: 'text', placeholder: '例如：战斗、开箱、每轮初始化' });
    ctx.openOverlay('新建逻辑组', [
      hint('逻辑组是一个可以整体启停的容器；组里的逻辑不依赖任何世界书。'),
      el('label', { class: 'ilb-field' }, [el('span', { class: 'ilb-sub', text: '组名' }), input]),
      el('div', { class: 'ilb-actions' }, [
        button('建好', () => {
          const group = repository.saveLogicGroup({ name: input.value.trim() || DEFAULT_GROUP_NAME, enabled: true, followBookId: '' });
          state.logicGroupId = group.id;
          ctx.closeOverlay();
          draw();
          ctx.toast(`已建逻辑组「${group.name}」`);
        }),
        button('取消', () => ctx.closeOverlay(), { ghost: true }),
      ]),
    ]);
  }

  function renameGroup(group) {
    const input = el('input', { class: 'ilb-input', type: 'text', value: group.name });
    ctx.openOverlay('改逻辑组名', [
      el('label', { class: 'ilb-field' }, [el('span', { class: 'ilb-sub', text: '组名' }), input]),
      el('div', { class: 'ilb-actions' }, [
        button('保存', () => {
          repository.saveLogicGroup({ ...group, name: input.value.trim() || group.name });
          ctx.closeOverlay();
          draw();
        }),
        button('取消', () => ctx.closeOverlay(), { ghost: true }),
      ]),
    ]);
  }

  function removeGroup(group) {
    const count = standaloneOf(group).length;
    const word = count > 0 ? `组里还有 ${count} 条逻辑，会一起删掉。` : '组里没有逻辑。';
    if (!window.confirm(`删除逻辑组「${group.name}」？${word}删了就找不回来了。`)) return;
    repository.deleteLogicGroup(group.id);
    state.logicGroupId = null;
    draw();
    ctx.toast(`已删除逻辑组「${group.name}」`);
  }

  function setGroupEnabled(group, enabled) {
    repository.saveLogicGroup({ ...group, enabled });
    draw();
  }

  function setFollow(group, bookId) {
    repository.saveLogicGroup({ ...group, followBookId: bookId });
    draw();
  }

  // ---- 搬运 ----

  function targetGroups(excludeId) {
    return groups().filter((g) => g.id !== excludeId);
  }

  function moveStandalone(logic) {
    const targets = targetGroups(logic.groupId);
    ctx.openOverlay('移动到哪个逻辑组', [
      hint('搬过去以后，原组里就没有这一条了。'),
      ...targets.map((group) => button(group.name, () => {
        repository.saveStandaloneLogic({ ...logic, groupId: group.id });
        ctx.closeOverlay();
        draw();
        ctx.toast(`已移动到「${group.name}」`);
      }, { ghost: true })),
      button('新建一个组…', () => { ctx.closeOverlay(); newGroup(); }, { ghost: true }),
      targets.length === 0 ? hint('现在只有这一个组。先新建一个组，才能搬过去。') : null,
    ]);
  }

  function copyStandalone(logic) {
    const targets = targetGroups(logic.groupId);
    ctx.openOverlay('复制到哪个逻辑组', [
      hint('复制一份过去：名字后面会加「副本」，两条逻辑互不影响。'),
      ...targets.map((group) => button(group.name, () => {
        const copy = normalizeLogic(
          { ...logic, id: undefined, localId: undefined, name: `${logic.name || '逻辑'} 副本` },
          '',
        );
        copy.groupId = group.id;
        copy.ui = { createdAt: Date.now(), updatedAt: Date.now(), order: 0 };
        repository.saveStandaloneLogic(copy);
        ctx.closeOverlay();
        draw();
        ctx.toast(`已复制到「${group.name}」`);
      }, { ghost: true })),
      button('新建一个组…', () => { ctx.closeOverlay(); newGroup(); }, { ghost: true }),
    ]);
  }

  function moveFromBook(logic) {
    const list = groups();
    ctx.openOverlay('从书里搬进逻辑组', [
      hint('搬出去以后，这条逻辑不再跟着这本书启用，而是跟着逻辑组启用。'),
      ...list.map((group) => button(group.name, () => {
        book.logic = bookLogics().filter((l) => l.id !== logic.id);
        repository.saveBook(book);
        repository.saveStandaloneLogic({ ...logic, groupId: group.id });
        ctx.closeOverlay();
        draw();
        ctx.toast(`已搬进「${group.name}」`);
      }, { ghost: true })),
      button('新建一个组…', () => { ctx.closeOverlay(); newGroup(); }, { ghost: true }),
      list.length === 0 ? hint('还没有逻辑组。先建一个组，再把它搬过去。') : null,
    ]);
  }

  function copyFromBook(logic) {
    const list = groups();
    ctx.openOverlay('复制进逻辑组', [
      ...list.map((group) => button(group.name, () => {
        const copy = normalizeLogic({ ...logic, id: undefined, localId: undefined, name: `${logic.name || '逻辑'} 副本` }, '');
        copy.groupId = group.id;
        copy.ui = { createdAt: Date.now(), updatedAt: Date.now(), order: 0 };
        repository.saveStandaloneLogic(copy);
        ctx.closeOverlay();
        draw();
        ctx.toast(`已复制进「${group.name}」`);
      }, { ghost: true })),
      button('新建一个组…', () => { ctx.closeOverlay(); newGroup(); }, { ghost: true }),
    ]);
  }

  // ---- 卡片 ----

  function menuFor(logic, { target, fromBook }) {
    const menu = el('div', { class: 'ilb-menu', hidden: true }, [
      button(logic.enabled === false ? '启用' : '停用', () => {
        logic.enabled = logic.enabled === false;
        logic.ui = { ...(logic.ui ?? {}), updatedAt: Date.now() };
        if (fromBook) saveBook();
        else {
          repository.saveStandaloneLogic(logic);
          draw();
        }
      }, { ghost: true }),
      fromBook ? button('搬进逻辑组…', () => moveFromBook(logic), { ghost: true }) : button('移动到组…', () => moveStandalone(logic), { ghost: true }),
      fromBook ? button('复制进逻辑组…', () => copyFromBook(logic), { ghost: true }) : button('复制到组…', () => copyStandalone(logic), { ghost: true }),
      button('导出', () => {
        downloadJson(`ilb-logic-${(logic.name || 'logic').replace(/[\\/:*?"<>|]/g, '_')}.json`, {
          kind: 'ilb-logic', version: 1, logics: [logic],
        });
      }, { ghost: true }),
      button('删除', () => removeLogic(logic, { target, fromBook }), { ghost: true }),
    ]);
    menu.hidden = true;
    menu.setAttribute('hidden', '');
    const toggle = el('button', {
      type: 'button', class: 'ilb-icon-btn', text: '⋯', title: '更多操作', 'aria-label': '更多操作',
      'aria-expanded': 'false',
      onclick: (event) => {
        event.stopPropagation();
        menu.hidden = !menu.hidden;
        toggle.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
      },
    });
    menu.addEventListener('click', () => { menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); });
    return el('div', { class: 'ilb-more' }, [toggle, menu]);
  }

  function removeLogic(logic, { target, fromBook }) {
    menuClose();
    if (!window.confirm(`删除逻辑「${logic.name || logic.id}」？`)) return;
    if (fromBook) {
      book.logic = bookLogics().filter((l) => l.id !== logic.id);
      repository.saveBook(book);
      draw();
    } else {
      repository.deleteStandaloneLogic(logic.id);
      draw();
    }
    ctx.toast('逻辑已删除');
  }

  function menuClose() {
    /* 菜单自身会收起；这里留一个空实现给删除前调用，避免以后换实现时忘掉 */
  }

  function renderCard(logic, opts) {
    const badges = [];
    if (logic.enabled === false) badges.push(badge('已停用', 'warn'));
    if (logic.call?.exposed) badges.push(badge('AI 可调用', 'ok'));
    if (logic.output?.text) badges.push(badge('有正文'));
    return el('div', { class: `ilb-card ilb-rule-card ilb-logic-card${logic.enabled === false ? ' ilb-card-off' : ''}` }, [
      el('div', { class: 'ilb-rule-head' }, [
        el('div', { class: 'ilb-rule-titles' }, [
          el('div', { class: 'ilb-title', text: logic.name || '未命名逻辑' }),
          el('div', { class: 'ilb-sub', text: describeLogic(logic) }),
        ]),
        el('div', { class: 'ilb-rule-side' }, [
          el('div', { class: 'ilb-badges' }, badges),
          menuFor(logic, opts),
        ]),
      ]),
      metaLine([
        opts.fromBook && ctx.sortOf?.('logic')?.key === 'manual'
          ? ctx.sortWeightInput(logic, () => { logic.ui = { ...(logic.ui ?? {}), updatedAt: Date.now() }; saveBook(); })
          : null,
        el('span', { class: 'ilb-sub', text: logic.enabled === false ? '已停用' : '已启用' }),
      ]),
      actionRow([
        button('编辑', () => openLogicEditor(ctx, opts.target, logic), { ghost: true }),
        button('试一句', () => {
          const previewBook = book ?? { book_id: '__standalone__', name: '独立逻辑', entries: [] };
          ctx.openPreview(previewBook, {
            ...logic,
            title: logic.name,
            content: logic.output?.text ?? '',
            trigger: logic.trigger,
            wait: false,
          });
        }, { ghost: true }),
      ]),
    ]);
  }

  // ---- 页面 ----

  function draw() {
    listHost.innerHTML = '';
    const list = groups();
    const group = currentGroup();
    if (group) state.logicGroupId = group.id;
    const standalone = standaloneOf(group);
    const fromBook = bookLogics();

    // 组工具条
    const groupBar = el('div', { class: 'ilb-plus-bar' }, [
      el('span', { class: 'ilb-sub', text: '逻辑组' }),
      list.length > 0
        ? selectBox(group?.id ?? '', list.map((g) => ({ value: g.id, label: `${g.name}${g.enabled === false ? '（已停用）' : ''}` })), (value) => {
          state.logicGroupId = value;
          draw();
        }, 'ilb-select ilb-group-select')
        : hint('还没有逻辑组。'),
      button('新建组', () => newGroup(), { ghost: true }),
      group ? button('改名', () => renameGroup(group), { ghost: true }) : null,
      group ? button('删除组', () => removeGroup(group), { ghost: true }) : null,
    ]);

    listHost.appendChild(groupBar);

    if (group) {
      const follow = [
        { value: '', label: '不跟随任何书（独立运行）' },
        ...books.map((b) => ({ value: b.book_id, label: `《${b.name}》启用时才跑` })),
      ];
      listHost.appendChild(el('div', { class: 'ilb-card ilb-logic-groupcard' }, [
        el('div', { class: 'ilb-inline-list' }, [
          el('label', { class: 'ilb-inline' }, [
            el('input', {
              type: 'checkbox',
              class: 'ilb-check',
              checked: group.enabled !== false,
              onchange: (event) => setGroupEnabled(group, event.target.checked),
            }),
            el('span', { class: 'ilb-sub', text: '这个组启用' }),
          ]),
          el('span', { class: 'ilb-sub', text: '跟着哪本书' }),
          selectBox(group.followBookId ?? '', follow, (value) => setFollow(group, value), 'ilb-select ilb-follow-book'),
        ]),
        hint('「不跟随任何书」= 不管书架里哪本书开着，这组都按自己的触发词跑；也可以选了某本书，只在它启用时跑。'),
      ]));

      listHost.appendChild(
        el('div', { class: 'ilb-logic-head' }, [
          el('h5', { class: 'ilb-section-title', text: `${group.name}（共 ${standalone.length} 条）` }),
          button('新增逻辑', () => openLogicEditor(ctx, { kind: 'group', id: group.id, name: group.name, book }, null), { ghost: true }),
          mobile ? null : button('导出这组', () => {
            if (standalone.length === 0) {
              ctx.toast('这组还没有逻辑可导出', 'warn');
              return;
            }
            downloadJson(`ilb-logic-group-${Date.now()}.json`, { kind: 'ilb-logic', version: 1, group: group.name, logics: standalone });
            ctx.toast(`已导出 ${standalone.length} 条逻辑`);
          }, { ghost: true }),
        ]),
      );

      if (standalone.length === 0) {
        listHost.appendChild(hint('这组里还没有逻辑。逻辑不依赖世界书：自己看触发词、每轮都跑，或等 AI 点名调用。'));
      } else {
        const sorted = ctx.sortedLogics?.({ logic: standalone }) ?? standalone;
        for (const logic of sorted) {
          listHost.appendChild(renderCard(logic, { target: { kind: 'group', id: group.id, name: group.name, book }, fromBook: false }));
        }
      }
    }

    // 书里的逻辑：老数据照旧放在这里，可以搬进组
    if (book) {
      listHost.appendChild(
        el('div', { class: 'ilb-logic-head' }, [
          el('h5', { class: 'ilb-section-title', text: `《${book.name}》里的逻辑（跟着这本书启停，共 ${fromBook.length} 条）` }),
          button('新增逻辑', () => openLogicEditor(ctx, book, null), { ghost: true }),
        ]),
      );
      if (fromBook.length === 0) {
        listHost.appendChild(hint('这本书里还没有逻辑。书里的逻辑只在这本书启用时运行；想让它独立运行，可以建逻辑组。'));
      } else {
        const sortedBook = ctx.sortedLogics?.(book) ?? fromBook;
        for (const logic of sortedBook) {
          listHost.appendChild(renderCard(logic, { target: book, fromBook: true }));
        }
      }
    } else if (books.length > 0) {
      listHost.appendChild(hint('没有选中世界书也能用逻辑组；想编辑某本书里的逻辑，先在「规则」页选一本书。'));
    }
  }

  // 第一次进来：没有组就顺手建一个默认组，省得用户先找「新建组」
  if (groups().length === 0) ensureDefaultGroup();

  draw();
  return el('div', {}, [
    mobile ? null : ctx.sortBar?.('logic'),
    listHost,
  ]);
}
