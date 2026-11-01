// ui/view-logic.js —— 独立逻辑页（ILB-6.24 / v0.23.0 逻辑组）
//
// 逻辑不再必须以一本书为前提：可以建「逻辑组」，组里放逻辑。
// 组可以独立启停，也可以选「某本书启用时我才跑」。
// 书里的逻辑仍然留在书里（老数据不动），页面上单列一段，可以搬进逻辑组或从组里搬回书。

import { el, button, badge, hint, actionRow, downloadJson, metaLine, selectBox, card, checkbox } from './widgets.js';
import { settingsGrid, metaLineText, inlineSwitch } from './card-kit.js';

// 桌面卡片内展开的详情；手机一律走底部抽屉。
const expandedLogic = new Set();
import { pickerButton } from './picker.js';
import { describeBookContext } from './nav.js';
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
    const isMobile = ctx.layout?.() === 'mobile';
    const expanded = expandedLogic.has(logic.id);
    const badges = [];
    if (logic.enabled === false) badges.push(badge('已停用', 'warn'));
    if (logic.call?.exposed) badges.push(badge('AI 可调用', 'ok'));
    if (logic.output?.text) badges.push(badge('有正文'));
    return el('div', { class: `ilb-card ilb-rule-card ilb-logic-card${logic.enabled === false ? ' ilb-card-off' : ''}` }, [
      el('div', { class: 'ilb-rule-head' }, [
        el('div', { class: 'ilb-rule-titles' }, [
          el('div', { class: 'ilb-title', text: logic.name || '未命名逻辑' }),
        ]),
        inlineSwitch(logic.enabled !== false, (on) => {
          logic.enabled = on;
          logic.ui = { ...(logic.ui ?? {}), updatedAt: Date.now() };
          saveBook();
          draw();
        }, '启用这条逻辑'),
        menuFor(logic, opts),
      ]),
      el('div', { class: 'ilb-rule-meta' }, [
        el('span', { class: 'ilb-sub ilb-rule-trigger', text: describeLogic(logic), title: describeLogic(logic) }),
        badges.length ? el('div', { class: 'ilb-badges' }, badges) : null,
      ].filter(Boolean)),
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
        isMobile
          ? button('详情', () => openLogicSettings(logic, opts), { ghost: true })
          : button(expanded ? '收起详情 ▴' : '详情 ▾', () => {
            if (expanded) expandedLogic.delete(logic.id);
            else expandedLogic.add(logic.id);
            draw();
          }, { ghost: true }),
      ]),
      !isMobile && expanded ? logicSettingsGrid(logic, opts) : null,
    ].filter(Boolean));
  }

  /** 逻辑详情里的快捷设置：改完立即保存；复杂项仍然进编辑器。 */
  function logicSettingsGrid(logic, opts) {
    // 和规则抽屉一样：每次从存档里找"当前那一条"，别改闭包里的旧对象。
    const persist = (mutate) => {
      let target = null;
      if (opts.fromBook) {
        const fresh = repository.listBooks().find((b) => b.book_id === book.book_id);
        target = fresh?.logic?.find((l) => l.id === logic.id) ?? null;
        if (target) {
          mutate(target);
          target.ui = { ...(target.ui ?? {}), updatedAt: Date.now() };
          repository.saveBook(fresh);
        }
      } else {
        target = repository.listStandaloneLogics().find((l) => l.id === logic.id) ?? null;
        if (target) {
          mutate(target);
          target.ui = { ...(target.ui ?? {}), updatedAt: Date.now() };
          repository.saveStandaloneLogic(target);
        }
      }
      draw();
    };
    const nodes = Array.isArray(logic.logic?.nodes) ? logic.logic.nodes.length : 0;
    const params = Array.isArray(logic.call?.params) ? logic.call.params.length : 0;
    return settingsGrid([
      ['启用', inlineSwitch(logic.enabled !== false, (on) => persist((l) => { l.enabled = on; }), '启用这条逻辑')],
      ['AI 可调用', checkbox(logic.call?.exposed === true, (on) => {
        persist((l) => { l.call = { ...(l.call ?? {}), exposed: on }; });
      }, '允许按钮调用')],
      ['参数', el('span', { class: 'ilb-sub', text: params ? `${params} 个` : '没有参数' })],
      ['流程', el('span', { class: 'ilb-sub', text: nodes ? `${nodes} 步` : '没有流程（只输出正文）' })],
      ['排序权重', opts.fromBook && ctx.sortWeightInput
        ? ctx.sortWeightInput(logic, () => persist(() => {}))
        : el('span', { class: 'ilb-sub', text: '只在书内逻辑里可调' })],
    ]);
  }

  function openLogicSettings(logic, opts) {
    ctx.openOverlay({
      title: `逻辑设置 · ${logic.name || '未命名逻辑'}`,
      nodes: [
        hint('点一下就保存；参数和流程请进「编辑」。'),
        logicSettingsGrid(logic, opts),
        metaLineText(describeLogic(logic)),
      ],
      onClose: () => draw(),
    });
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
        ? pickerButton(group?.name ?? '', () => ctx.openPicker?.({
          title: '选择逻辑组',
          value: group?.id ?? '',
          hint: '组多的时候直接搜名字；括号里是这个组有几条逻辑。',
          items: list.map((g) => ({
            value: g.id,
            label: `${g.name}${g.enabled === false ? '（已停用）' : ''}`,
            detail: `${standaloneOf(g).length} 条逻辑`,
          })),
          onPick: (value) => {
            state.logicGroupId = value;
            draw();
          },
        }), { className: 'ilb-group-select', placeholder: '选择组' })
        : hint('还没有逻辑组。'),
      button('新建组', () => newGroup(), { ghost: true }),
      group ? button('改名', () => renameGroup(group), { ghost: true }) : null,
      group ? button('删除组', () => removeGroup(group), { ghost: true }) : null,
    ]);

    listHost.appendChild(groupBar);

    if (group) {
      const followLabel = group.followBookId
        ? `《${books.find((b) => b.book_id === group.followBookId)?.name ?? group.followBookId}》启用时才跑`
        : '不跟随任何书（独立运行）';
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
          pickerButton(followLabel, () => ctx.openPicker?.({
            title: '这组跟着哪本书',
            value: group.followBookId ?? '',
            hint: '书多时可搜书名；选「不跟随」= 这组不管书开没开都按自己的触发词跑。',
            items: [
              { value: '', label: '不跟随任何书（独立运行）' },
              ...books.map((b) => ({ value: b.book_id, label: `《${b.name}》启用时才跑`, detail: describeBookContext(b) })),
            ],
            onPick: (value) => setFollow(group, value),
          }), { className: 'ilb-follow-book', placeholder: '选择书' }),
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
