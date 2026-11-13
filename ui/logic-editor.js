// ui/logic-editor.js —— 独立逻辑的编辑器（ILB-4.14 / ILB-6.22）
//
// 独立逻辑和"规则"长得很像，但有两处不同：
//   1. 它可以不靠世界书条目出现——自己带触发词，自己冒出来；
//   2. 它可以把别的逻辑当子步骤调用（在流程里放「调用逻辑」）。
// 这里故意只露必要的东西：名字、触发词、正文、是否开放给 AI、流程。

import { TRIGGER_SOURCES, POSITIONS } from '../core/settings-defaults.js';
import { defaultLogic, normalizeLogic, META_TRIGGERS, META_LABEL } from '../core/model.js';
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
 * @param {object} target 这本书（老用法）或逻辑组：`{ kind:'group', id, name, book }`
 * @param {object|null} existing 已有逻辑；null = 新建
 */
export function openLogicEditor(ctx, target, existing) {
  const { repository } = ctx;
  const isGroup = target?.kind === 'group';
  const book = isGroup ? (target.book ?? null) : target;
  const group = isGroup ? target : null;
  const logic = existing ? JSON.parse(JSON.stringify(existing)) : defaultLogic({ name: '新逻辑' });
  const logics = isGroup
    ? (repository.listStandaloneLogics?.(group.id) ?? [])
    : (Array.isArray(book?.logic) ? book.logic : []);
  // 「调用逻辑」下拉：书里的逻辑和所有独立逻辑都能点名
  const allLogics = [
    ...(book?.logic ?? []),
    ...(repository.listStandaloneLogics?.() ?? []),
  ].filter((l) => l.id !== logic.id);

  const nameInput = el('input', { class: 'ilb-input', type: 'text', value: logic.name ?? '' });
  const enabledBox = checkbox(logic.enabled !== false, () => {});
  const anyInput = el('input', { class: 'ilb-input', type: 'text', value: (logic.trigger?.any ?? []).join(', '), placeholder: '例如：抽卡, 开箱' });
  const allInput = el('input', { class: 'ilb-input', type: 'text', value: (logic.trigger?.all ?? []).join(', '), placeholder: '这些词必须同时出现' });
  const notInput = el('input', { class: 'ilb-input', type: 'text', value: (logic.trigger?.not ?? []).join(', '), placeholder: '出现这些词就不触发' });
  const triggerEngineMode = selectBox(logic.trigger?.mode ?? 'native', [
    { value: 'native', label: '类原版模式（兼容导入）' },
    { value: 'ilb', label: 'ILB 进阶模式（多组/概率）' },
  ], () => drawTriggerSettings());
  const advancedInput = el('textarea', { class: 'ilb-textarea', rows: '3', placeholder: 'any | 100 | 关键词, 另一个词:60' }, [
    (logic.trigger?.groups ?? []).map((g) => `${g.logic ?? 'any'} | ${g.probability ?? 100} | ${(g.terms ?? []).map((t) => `${t.text}${t.probability == null ? '' : `:${t.probability}`}`).join(', ')}`).join('\n'),
  ]);
  const combineSelect = selectBox(logic.trigger?.combine ?? 'all', [
    { value: 'all', label: '所有组都满足' }, { value: 'any', label: '任一组满足' }, { value: 'not', label: '所有组都不满足' },
  ], () => {});
  const sourceSelect = selectBox(logic.trigger?.source ?? 'both', TRIGGER_SOURCES.map((value) => ({
    value,
    label: value === 'both' ? '用户和 AI 都看' : value === 'user' ? '只看用户说的话' : '只看 AI 说的话',
  })), () => {});
  const metaSelect = selectBox(logic.trigger?.meta ?? 'none', META_TRIGGERS.map((value) => ({ value, label: META_LABEL[value] })), () => drawTriggerSettings());
  const triggerSettings = el('div', { class: 'ilb-subsection' });
  const nativeSettings = el('div', { class: 'ilb-subsection' }, [
    field('出现任意一个', anyInput, '英文逗号分隔。留空表示它只能被「调用」或「激活」。'),
    field('必须同时出现', allInput),
    field('排除词', notInput),
  ]);
  const advancedSettings = el('div', { class: 'ilb-subsection' }, [
    el('div', { class: 'ilb-actions' }, [
      button('进阶触发说明', () => ctx.showHelp?.('advanced-trigger'), { ghost: true, title: '查看进阶模式怎么填写' }),
    ]),
    field('进阶触发组', advancedInput, '每行：组内逻辑 | 组概率 | 词, 词:词概率。'),
    field('组间组合', combineSelect),
  ]);
  function drawTriggerSettings() {
    triggerSettings.innerHTML = '';
    if (metaSelect.value === 'always') {
      triggerSettings.appendChild(hint('每轮都运行：不看触发词，匹配模式与关键词配置会保留，改回按词运行后继续生效。'));
    } else {
      triggerSettings.appendChild(triggerEngineMode.value === 'ilb' ? advancedSettings : nativeSettings);
    }
  }
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
  const isMobile = (() => {
    try {
      return typeof ctx.layout === 'function' && ctx.layout() === 'mobile';
    } catch {
      return false;
    }
  })();

  function drawFlow() {
    flowHost.innerHTML = '';
    flowHost.appendChild(renderFlowEditor({
      flow,
      entries: (book?.entries ?? []).map((e) => ({ id: e.id, title: `${book?.name ?? '独立逻辑'} / ${e.title || e.id}` })),
      logics: allLogics.map((l) => ({ id: l.id, name: l.name || l.id })),
      ctx,
      // 手机上默认折叠成摘要（与规则编辑器一致，§6.5）
      defaultCollapsed: isMobile,
      onChange: (next) => { flow = next; },
    }));
  }

  function save() {
    const draft = {
      ...logic,
      name: nameInput.value.trim() || '未命名逻辑',
      enabled: enabledBox.checked,
      trigger: {
        ...(logic.trigger ?? {}),
        mode: triggerEngineMode.value,
        combine: combineSelect.value,
        groups: triggerEngineMode.value === 'ilb' ? advancedInput.value.split('\n').map((line, index) => {
          const [rawLogic, rawProbability, rawTerms] = line.split('|');
          return { id: `g${index + 1}`, logic: ['any', 'all', 'not'].includes(String(rawLogic).trim()) ? String(rawLogic).trim() : 'any', probability: Math.max(0, Math.min(100, Number(rawProbability) || 0)), terms: String(rawTerms ?? '').split(',').map((part) => { const [text, chance] = part.trim().split(':'); return { text: String(text ?? '').trim(), probability: chance == null || chance === '' ? null : Math.max(0, Math.min(100, Number(chance) || 0)) }; }).filter((term) => term.text), };
        }).filter((group) => group.terms.length) : (logic.trigger?.groups ?? []),
        any: splitList(anyInput),
        all: splitList(allInput),
        not: splitList(notInput),
        source: sourceSelect.value,
        meta: metaSelect.value,
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
    const next = normalizeLogic(
      draft.id ? draft : { ...draft, id: undefined, localId: undefined },
      isGroup ? '' : book.book_id,
    );
    // 界面排序用的时间戳（v0.22.0）
    next.ui = { ...(logic.ui ?? {}), createdAt: Number(logic.ui?.createdAt) || Date.now(), updatedAt: Date.now() };
    if (isGroup) {
      next.groupId = group.id;
      const isNew = !logics.some((l) => l.id === next.id);
      repository.saveStandaloneLogic(next);
      ctx.closeOverlay();
      ctx.render();
      ctx.toast(isNew ? '逻辑已添加' : '逻辑已保存');
      return;
    }
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

  drawTriggerSettings();
  drawFlow();
  // 和规则编辑器一样：正文自己滚，保存/取消固定在浮层底部（footer），
  // 滚到流程图最下面也不用回头找按钮。
  ctx.openOverlay({
    title: existing ? '编辑逻辑' : '新增逻辑',
    nodes: [el('div', { class: 'ilb-editor' }, [
      hint('独立逻辑不依赖世界书条目：它自己看触发词，触发后把正文当一条内容注入。也可以被别的逻辑「调用」或被条目流程「激活」。'),
      field('名字（触发词和 AI 调用都用它）', nameInput),
      el('label', { class: 'ilb-inline' }, [enabledBox, el('span', { class: 'ilb-sub', text: '启用这条逻辑' })]),

      el('h5', { class: 'ilb-section-title', text: '什么时候运行' }),
      field('运行时机', metaSelect, '「每轮都跑」不看触发词，适合初始化；「每次 AI 回复后」适合在旁白之后结算。'),
      field('匹配模式', triggerEngineMode),
      triggerSettings,
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
    ])],
    footer: [
      button(existing ? '保存' : '添加', save),
      button('取消', () => ctx.closeOverlay(), { ghost: true }),
    ],
    wide: true,
  });
}
