// ui/logic-editor.js —— 独立逻辑的编辑器（ILB-4.14 / ILB-6.22）
//
// 独立逻辑和"规则"长得很像，但有两处不同：
//   1. 它可以不靠世界书条目出现——自己带触发词，自己冒出来；
//   2. 它可以把别的逻辑当子步骤调用（在流程里放「调用逻辑」）。
// 这里故意只露必要的东西：名字、触发词、正文、是否开放给 AI、流程。

import { TRIGGER_SOURCES, POSITIONS } from '../core/settings-defaults.js';
import { defaultLogic, normalizeLogic } from '../core/model.js';
import { el, button, checkbox, field, hint, selectBox } from './widgets.js';
import { renderFlowEditor } from './flow-editor.js';

const POSITION_LABEL_ = { before_char: '角色设定之前', after_char: '角色设定之后', in_chat: '聊天记录里' };

function splitList(input) {
  return String(input?.value ?? '')
    .split(/[,，]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * 打开独立逻辑编辑器。
 * @param {object} ctx 面板上下文（要 openOverlay/closeOverlay/toast/render/repository）
 * @param {object} book 所属世界书
 * @param {object|null} existing 已有逻辑；null = 新建
 */
export function openLogicEditor(ctx, book, existing) {
  const { repository } = ctx;
  const logic = existing ? JSON.parse(JSON.stringify(existing)) : defaultLogic({ name: '新逻辑' });
  const logics = Array.isArray(book.logic) ? book.logic : [];

  const nameInput = el('input', { class: 'ilb-input', type: 'text', value: logic.name ?? '' });
  const enabledBox = checkbox(logic.enabled !== false, () => {});
  const anyInput = el('input', { class: 'ilb-input', type: 'text', value: (logic.trigger?.any ?? []).join(', '), placeholder: '例如：抽卡, 开箱' });
  const allInput = el('input', { class: 'ilb-input', type: 'text', value: (logic.trigger?.all ?? []).join(', '), placeholder: '这些词必须同时出现' });
  const notInput = el('input', { class: 'ilb-input', type: 'text', value: (logic.trigger?.not ?? []).join(', '), placeholder: '出现这些词就不触发' });
  const sourceSelect = selectBox(logic.trigger?.source ?? 'both', TRIGGER_SOURCES.map((value) => ({
    value,
    label: value === 'both' ? '用户和 AI 都看' : value === 'user' ? '只看用户说的话' : '只看 AI 说的话',
  })), () => {});
  const textInput = el('textarea', { class: 'ilb-textarea', rows: '4' }, [logic.output?.text ?? '']);
  const positionSelect = selectBox(logic.output?.position ?? 'in_chat', POSITIONS.map((value) => ({
    value,
    label: POSITION_LABEL_[value] ?? value,
  })), () => {});
  const depthInput = el('input', { class: 'ilb-input', type: 'number', value: String(logic.output?.depth ?? 4) });
  const exposedBox = checkbox(logic.call?.exposed === true, () => {});
  const paramsInput = el('input', { class: 'ilb-input', type: 'text', value: (logic.call?.params ?? []).join(', '), placeholder: '例如：数量, 名字' });

  let flow = logic.flow ?? { nodes: [] };
  const flowHost = el('div', {});

  function drawFlow() {
    flowHost.innerHTML = '';
    flowHost.appendChild(renderFlowEditor({
      flow,
      entries: (book.entries ?? []).map((e) => ({ id: e.id, title: `${book.name} / ${e.title || e.id}` })),
      logics: logics.filter((l) => l.id !== logic.id).map((l) => ({ id: l.id, name: l.name || l.id })),
      ctx,
      onChange: (next) => { flow = next; },
    }));
  }

  function save() {
    const draft = {
      ...logic,
      name: nameInput.value.trim() || '未命名逻辑',
      enabled: enabledBox.checked,
      trigger: {
        any: splitList(anyInput),
        all: splitList(allInput),
        not: splitList(notInput),
        source: sourceSelect.value,
      },
      output: {
        ...(logic.output ?? {}),
        text: textInput.value,
        position: positionSelect.value,
        depth: Math.max(0, Number(depthInput.value) || 0),
      },
      call: {
        exposed: exposedBox.checked,
        params: splitList(paramsInput),
      },
      flow,
    };
    const next = normalizeLogic(draft.id ? draft : { ...draft, id: undefined, localId: undefined }, book.book_id);
    const list = logics.slice();
    const index = list.findIndex((l) => l.id === next.id);
    if (index >= 0) list[index] = next;
    else list.push(next);
    book.logic = list;
    repository.saveBook(book);
    ctx.closeOverlay();
    ctx.render();
    ctx.toast(index >= 0 ? '逻辑已保存' : '逻辑已添加');
  }

  drawFlow();
  ctx.openOverlay(existing ? '编辑逻辑' : '新增逻辑', [
    el('div', { class: 'ilb-editor' }, [
      hint('独立逻辑不依赖世界书条目：它自己看触发词，触发后把正文当一条内容注入。也可以被别的逻辑「调用」或被条目流程「激活」。'),
      field('名字（触发词和 AI 调用都用它）', nameInput),
      el('label', { class: 'ilb-inline' }, [enabledBox, el('span', { class: 'ilb-sub', text: '启用这条逻辑' })]),

      el('h5', { class: 'ilb-section-title', text: '什么时候运行' }),
      field('出现任意一个', anyInput, '英文逗号分隔。留空表示它只能被「调用」或「激活」，不会自己出现。'),
      field('必须同时出现', allInput),
      field('排除词', notInput),
      field('谁说的话算数', sourceSelect, '只看 AI 时，可以在 AI 说到某个词时运行——不用先命中一条世界书条目。'),

      el('h5', { class: 'ilb-section-title', text: '运行后写点什么' }),
      field('正文（会出现在提示词里）', textInput, '可以留空：有些逻辑只负责改状态、点别的条目，不需要自己说话。'),
      field('放在哪', positionSelect),
      field('插入深度', depthInput, '数字越小越靠末尾（只在「聊天记录里」时生效）。'),

      el('h5', { class: 'ilb-section-title', text: '给 AI 调用开个口' }),
      el('label', { class: 'ilb-inline' }, [exposedBox, el('span', { class: 'ilb-sub', text: '允许 AI 在正文里用 [[ILB:名字(参数)]] 调用这条逻辑' })]),
      field('参数名（按顺序）', paramsInput, 'AI 调用时按顺序把值装进这些变量，跑完就还原。默认关闭的开关在「设置 → AI 调用逻辑」。'),
      hint('默认不让 AI 调用任何逻辑：要先在设置里打开总开关，再在这里逐条开放。'),

      el('h5', { class: 'ilb-section-title', text: '做什么（可以留空）' }),
      flowHost,

      el('div', { class: 'ilb-actions' }, [
        button(existing ? '保存' : '添加', save),
        button('取消', () => ctx.closeOverlay(), { ghost: true }),
      ]),
    ]),
  ]);
}
