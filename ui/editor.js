// ui/editor.js —— 规则编辑器与"试一句"（ILB-6.3 / ILB-6.10.6）
// 这里是"判定逻辑"真正露给用户看的地方：
//   什么时候出现（触发词 / 常驻 / 正则 / 条件）
//   出现多久（延迟 / 持续 / 冷却）
//   怎么出现（位置 / 深度 / 身份 / 权重 / 概率 / 连锁）

import { POSITIONS, ROLES, SECONDARY_LOGIC, DEFAULT_SETTINGS, TRIGGER_SOURCES } from '../core/settings-defaults.js';
import { defaultEntry, normalizeEntry } from '../core/model.js';
import { previewEntry } from '../core/evaluate.js';
import { el, button, checkbox, field, hint, badge, selectBox } from './widgets.js';
import { renderFlowEditor, flowSummary } from './flow-editor.js';
import { normalizeFlow } from '../core/flow.js';
import { validateFlow } from '../core/validate.js';
import * as guard from './guard.js';

const POSITION_LABEL_ = { before_char: '角色设定之前', after_char: '角色设定之后', in_chat: '聊天记录里' };
const ROLE_LABEL_ = { system: '系统', user: '用户', assistant: '角色' };
const SECONDARY_LABEL = {
  AND_ANY: '第二组：出现任意一个',
  AND_ALL: '第二组：必须全部出现',
  NOT_ANY: '第二组：一个都不能出现',
  NOT_ALL: '第二组：不能全部出现',
};
const VAR_OPS = [
  { value: 'equals', label: '等于' },
  { value: 'not_equals', label: '不等于' },
  { value: 'contains', label: '包含' },
  { value: 'exists', label: '存在' },
  { value: 'missing', label: '不存在' },
  { value: 'gt', label: '大于' },
  { value: 'lt', label: '小于' },
];

function unboxWhen(when) {
  const list = Array.isArray(when) ? when : [];
  if (list.length === 1 && (list[0]?.type === 'any' || list[0]?.type === 'all') && Array.isArray(list[0].of)) {
    return { mode: list[0].type, cards: list[0].of };
  }
  return { mode: 'all', cards: list };
}

export function openEditor(ctx, book, existing) {
  const { repository } = ctx;
  const entry = existing ? JSON.parse(JSON.stringify(existing)) : defaultEntry({ title: '新规则' });
  const unboxed = unboxWhen(entry.when);
  const cards = unboxed.cards.slice();
  let combineMode = unboxed.mode;
  // 判定流程（ILB-4.11）：默认是空的，空流程 = 完全按关键词工作。
  let logic = normalizeFlow(entry.logic);
  // 有没有改过：任何 input/change 都算。- 交给 ui/guard.js 决定离开时要不要拦。
  let dirty = false;
  // 每次改动顺手刷新右侧摘要：宽屏下"边改边看结果"，不用滚回去数。
  const markDirty = () => { dirty = true; refreshSummary(); };

  const titleInput = el('input', { class: 'ilb-input', type: 'text', value: entry.title ?? '' });
  const contentInput = el('textarea', { class: 'ilb-textarea', rows: '5' }, [entry.content ?? '']);
  const enabledBox = checkbox(entry.enabled !== false, () => {});
  // 等候模式（ILB-4.14）：不自己出现，只等独立逻辑点名。
  const waitBox = checkbox(entry.wait === true, () => {});
  // 只看谁说的话（ILB-4.15）：两边 / 只看用户 / 只看 AI。
  const sourceSelect = selectBox(entry.trigger?.source ?? 'both', TRIGGER_SOURCES.map((value) => ({
    value,
    label: value === 'both' ? '用户和 AI 都看' : value === 'user' ? '只看用户说的话' : '只看 AI 说的话',
  })), () => {});

  // —— 触发 ——
  const triggerMode = selectBox(
    entry.always ? 'always' : (entry.trigger?.regex?.length ? 'regex' : 'keyword'),
    [
      { value: 'keyword', label: '出现这些词的时候' },
      { value: 'regex', label: '用正则匹配的时候' },
      { value: 'always', label: '一直出现（常驻）' },
    ],
    (value) => { redrawTrigger(); },
  );
  const anyInput = el('input', { class: 'ilb-input', type: 'text', value: (entry.trigger?.any ?? []).join(', '), placeholder: '例如：王城, 夜巡' });
  const allInput = el('input', { class: 'ilb-input', type: 'text', value: (entry.trigger?.all ?? []).join(', '), placeholder: '这些词必须同时出现' });
  const notInput = el('input', { class: 'ilb-input', type: 'text', value: (entry.trigger?.not ?? []).join(', '), placeholder: '出现这些词就不触发' });
  const regexInput = el('textarea', { class: 'ilb-textarea', rows: '3' }, [
    (entry.trigger?.regex ?? []).map((r) => (typeof r === 'string' ? r : r?.source ?? '')).filter(Boolean).join('\n'),
  ]);
  const matchCase = checkbox(entry.trigger?.matchCase === true, () => {});
  const wholeWords = checkbox(entry.trigger?.wholeWords === true, () => {});
  const secondaryLogic = selectBox(entry.trigger?.secondary?.logic ?? 'AND_ANY', SECONDARY_LOGIC.map((v) => ({ value: v, label: SECONDARY_LABEL[v] })), () => {});
  const secondaryKeys = el('input', { class: 'ilb-input', type: 'text', value: (entry.trigger?.secondary?.keys ?? []).join(', '), placeholder: '第二组触发词（可以留空）' });
  const triggerHost = el('div', { class: 'ilb-subsection' });

  function redrawTrigger() {
    triggerHost.innerHTML = '';
    const mode = triggerMode.value;
    if (mode === 'always') {
      triggerHost.appendChild(hint('常驻条目每一轮都会出现（除非被预算挤掉）。适合放"一直要遵守的写法要求"。'));
      return;
    }
    if (mode === 'regex') {
      triggerHost.appendChild(field('正则（一行一条）', regexInput, '只给会用的人。写错了不会触发，也不会报错。'));
    } else {
      triggerHost.appendChild(field('出现任意一个', anyInput, '英文逗号分隔。命中任意一个就触发。'));
      triggerHost.appendChild(field('必须同时出现', allInput, '英文逗号分隔。留空表示不要求。'));
      triggerHost.appendChild(field('排除词', notInput, '出现了这些词就不触发。留空表示不排除。'));
    }
    triggerHost.appendChild(el('div', { class: 'ilb-row' }, [
      el('label', { class: 'ilb-inline' }, [matchCase, el('span', { class: 'ilb-sub', text: '区分大小写' })]),
      el('label', { class: 'ilb-inline' }, [wholeWords, el('span', { class: 'ilb-sub', text: '只匹配完整单词（中文不适用）' })]),
    ]));
    triggerHost.appendChild(field('第二组触发词', secondaryKeys, '可留空。用于原生世界书的"选择性逻辑"。'));
    triggerHost.appendChild(field('第二组的规则', secondaryLogic));
  }

  // —— 条件 ——
  const condHost = el('div', { class: 'ilb-subsection' });
  const combineBox = selectBox(combineMode, [
    { value: 'all', label: '以下条件全部满足' },
    { value: 'any', label: '以下条件满足任意一个' },
  ], (value) => { combineMode = value; });

  function entryChoices() {
    const out = [{ value: '', label: '（选择一条规则）' }];
    for (const b of repository.listBooks()) {
      for (const e of b.entries ?? []) out.push({ value: e.id, label: `${b.name} / ${e.title || e.id}` });
    }
    return out;
  }

  function drawConds() {
    condHost.innerHTML = '';
    if (cards.length === 0) {
      condHost.appendChild(el('p', { class: 'ilb-sub', text: '没有额外条件。只看触发词就够了。' }));
    }
    cards.forEach((card, index) => {
      const remove = button('移除', () => {
        cards.splice(index, 1);
        drawConds();
      }, { ghost: true });

      if (card.type === 'contains') {
        const text = el('input', { class: 'ilb-input', type: 'text', value: card.text ?? '', oninput: (e) => { card.text = e.target.value; } });
        const negate = checkbox(card.negate === true, (on) => { card.negate = on; });
        condHost.appendChild(el('div', { class: 'ilb-cond' }, [
          el('div', { class: 'ilb-inline' }, [badge('文本包含'), el('label', { class: 'ilb-inline' }, [negate, el('span', { class: 'ilb-sub', text: '反过来（不包含才满足）' })])]),
          field('要出现的文字', text),
          remove,
        ]));
      } else if (card.type === 'activated') {
        const sel = selectBox(card.entryId ?? '', entryChoices(), (value) => { card.entryId = value; });
        condHost.appendChild(el('div', { class: 'ilb-cond' }, [
          el('div', { class: 'ilb-inline' }, [badge('另一条已出现')]),
          field('哪条规则', sel, '比如：先让"天气"出现，才让"雨夜"出现。'),
          remove,
        ]));
      } else if (card.type === 'var') {
        const name = el('input', { class: 'ilb-input', type: 'text', value: card.name ?? '', placeholder: '变量名', oninput: (e) => { card.name = e.target.value; } });
        const op = selectBox(card.op ?? 'equals', VAR_OPS, (value) => { card.op = value; });
        const value = el('input', { class: 'ilb-input', type: 'text', value: card.value ?? '', placeholder: '比较值', oninput: (e) => { card.value = e.target.value; } });
        condHost.appendChild(el('div', { class: 'ilb-cond' }, [
          el('div', { class: 'ilb-inline' }, [badge('变量')]),
          el('div', { class: 'ilb-row' }, [field('变量名', name), field('比较', op), field('值', value)]),
          remove,
        ]));
      } else {
        condHost.appendChild(el('div', { class: 'ilb-cond' }, [
          el('p', { class: 'ilb-sub', text: `不认识的条件类型：${card.type}` }),
          remove,
        ]));
      }
    });
  }

  // —— 判定流程（ILB-4.11 / ILB-6.13）——
  const flowSummaryText = el('p', { class: 'ilb-hint' });
  const flowModeSelect = selectBox(logic.mode, [
    { value: 'and', label: '关键词满足后，再走流程' },
    { value: 'only', label: '只看流程（关键词不参与）' },
  ], (value) => {
    logic = { ...logic, mode: value };
    refreshFlowSummary();
  });

  function refreshFlowSummary() {
    const tail = logic.mode === 'only' ? '；关键词不参与判定' : '';
    flowSummaryText.textContent = `${flowSummary(logic)}${tail}`;
  }

  function ruleEntries() {
    const out = [];
    for (const b of repository.listBooks()) {
      for (const e of b.entries ?? []) out.push({ id: e.id, title: `${b.name} / ${e.title || e.id}` });
    }
    return out;
  }

  const isMobile = (() => {
    try {
      return typeof ctx.layout === 'function' ? ctx.layout() === 'mobile' : false;
    } catch {
      return false;
    }
  })();

  let flowOpen = false;
  const flowHost = el('div', { class: 'ilb-flow-host' });

  function flowEditorNode() {
    return renderFlowEditor({
      flow: logic,
      entries: ruleEntries(),
      ctx,
      // 手机上流程是独立子页：默认折成一行摘要，点哪步再展开哪步（§6.5）。
      defaultCollapsed: isMobile,
      onChange: (next) => {
        logic = next;
        dirty = true;
        refreshFlowSummary();
        refreshSummary();
      },
    });
  }

  /**
   * 手机上流程是**独立子页**（§6.4/§6.5）：整屏里叠一层，树形默认折叠，
   * 画完点「完成」回到规则表单——规则本身没有保存，草稿还在。
   * 电脑上仍就地展开，宽屏时能一边看表单一边看流程。
   */
  const flowToggle = button(isMobile ? '打开流程编辑页' : '编辑流程', () => {
    if (isMobile) {
      const body = flowEditorNode();
      ctx.openOverlay({
        title: '判定流程',
        nodes: [body],
        footer: [button('完成', () => ctx.closeOverlay(), { primary: true })],
        wide: true,
        key: 'flow-editor',
      });
      return;
    }
    flowOpen = !flowOpen;
    flowToggle.textContent = flowOpen ? '收起流程' : '编辑流程';
    renderFlowHost();
  }, { ghost: true });

  function renderFlowHost() {
    flowHost.innerHTML = '';
    if (!flowOpen || isMobile) return;
    flowHost.appendChild(flowEditorNode());
  }

  // —— 时效 ——
  const delayInput = el('input', { class: 'ilb-input', type: 'number', value: String(entry.timed?.delay ?? 0) });
  const cooldownInput = el('input', { class: 'ilb-input', type: 'number', value: String(entry.timed?.cooldown ?? 0) });
  const stickyInput = el('input', { class: 'ilb-input', type: 'number', value: String(entry.timed?.sticky ?? 0) });

  // —— 注入 ——
  const positionSelect = selectBox(entry.injection?.position ?? DEFAULT_SETTINGS.defaultPosition, POSITIONS.map((p) => ({ value: p, label: POSITION_LABEL_[p] })), () => {});
  const depthInput = el('input', { class: 'ilb-input', type: 'number', value: String(entry.injection?.depth ?? DEFAULT_SETTINGS.defaultDepth) });
  const roleSelect = selectBox(entry.injection?.role ?? DEFAULT_SETTINGS.defaultRole, ROLES.map((r) => ({ value: r, label: ROLE_LABEL_[r] })), () => {});
  const weightInput = el('input', { class: 'ilb-input', type: 'number', value: String(entry.weight ?? 100) });
  const groupInput = el('input', { class: 'ilb-input', type: 'text', value: entry.group ?? '', placeholder: '同组只能出现一条，留空表示不分组' });
  const probOn = checkbox(entry.useProbability === true, () => {});
  const probValue = el('input', { class: 'ilb-input', type: 'number', value: String(entry.probability ?? 100) });
  const chainOn = checkbox(entry.chain?.participate === true, () => {});

  function splitList(input) {
    return input.value.split(',').map((x) => x.trim()).filter(Boolean);
  }

  /** 把界面上的值收成一条规则。保存和"试一句"用的是同一个函数，避免两处不一致。 */
  function buildEntry() {
    const mode = triggerMode.value;
    const trigger = {
      any: [],
      all: [],
      not: [],
      regex: [],
      matchCase: matchCase.checked,
      wholeWords: wholeWords.checked,
    };
    if (mode === 'keyword') {
      trigger.any = splitList(anyInput);
      trigger.all = splitList(allInput);
      trigger.not = splitList(notInput);
    } else if (mode === 'regex') {
      trigger.regex = regexInput.value.split('\n').map((x) => x.trim()).filter(Boolean);
    }
    const secKeys = splitList(secondaryKeys);
    if (secKeys.length) trigger.secondary = { keys: secKeys, logic: secondaryLogic.value };
    trigger.source = sourceSelect.value;

    const when = combineMode === 'any' && cards.length
      ? [{ type: 'any', of: cards.map((c) => ({ ...c })) }]
      : cards.map((c) => ({ ...c }));

    return {
      ...entry,
      title: titleInput.value.trim() || '未命名规则',
      content: contentInput.value,
      enabled: enabledBox.checked,
      wait: waitBox.checked,
      always: mode === 'always',
      trigger,
      when,
      timed: {
        delay: Math.max(0, Number(delayInput.value) || 0),
        cooldown: Math.max(0, Number(cooldownInput.value) || 0),
        sticky: Math.max(0, Number(stickyInput.value) || 0),
      },
      injection: {
        position: positionSelect.value,
        depth: Math.max(0, Number(depthInput.value) || 0),
        role: roleSelect.value,
      },
      weight: Number(weightInput.value) || 0,
      group: groupInput.value.trim() || null,
      useProbability: probOn.checked,
      probability: Math.max(0, Math.min(100, Number(probValue.value) || 0)),
      chain: { ...(entry.chain ?? {}), participate: chainOn.checked },
      logic: normalizeFlow(logic),
    };
  }

  // —— 试一句（就地出结果，不再开浮层）——
  // 为什么不再开浮层：电脑上的浮层是"替换"而不是"叠加"，从编辑器里点开就会
  // 把编辑器连同草稿一起换掉（关掉试一句后回不到表单）。就地显示既不会丢草稿，
  // 手机上也不用先关一层再回来。
  const pvText = el('textarea', { class: 'ilb-textarea', rows: '2' }, ['王城今晚开始夜巡。']);
  const pvCount = el('input', { class: 'ilb-input', type: 'number', value: '3' });
  const pvResult = el('div', { class: 'ilb-preview' });
  const previewHost = el('div', { class: 'ilb-preview-box', hidden: true }, [
    el('p', { class: 'ilb-sub', text: '只判断"这句话会不会让它出现"，不检查预算、不检查同组，也不改任何状态。' }),
    field('假设下一句是', pvText),
    field('当作第几条消息', pvCount, '影响延迟/冷却的判断'),
    button('试一下', () => runPreview(), { ghost: true }),
    pvResult,
  ]);

  function runPreview() {
    const draft = buildEntry();
    const result = previewEntry(draft, {
      text: pvText.value,
      messageCount: Number(pvCount.value) || 0,
      state: { lastActiveAt: null, activeSince: null },
    });
    pvResult.innerHTML = '';
    pvResult.appendChild(el('p', {
      class: result.passed ? 'ilb-preview-pass' : 'ilb-preview-fail',
      text: result.passed ? '会出现在这一轮' : `不会出现：${result.reason}`,
    }));
    if (result.steps?.length) {
      pvResult.appendChild(el('ul', { class: 'ilb-warn-list' }, result.steps.map((s) => el('li', {
        text: `${s.passed ? '✓' : '✗'} ${s.stage}：${s.reason}`,
      }))));
    }
    previewHost.hidden = false;
    try {
      previewHost.scrollIntoView?.({ block: 'nearest' });
    } catch {
      /* 滚动失败无所谓 */
    }
  }

  function save() {
    const draft = buildEntry();
    // 新规则还没有 id：交给 normalizeEntry 补 `<book_id>::e-xxxx`，否则会得到空 id，
    // 下次渲染时多条新规则会互相覆盖（这个 bug 只在"新增第二条"时才暴露）。
    const next = draft.id
      ? normalizeEntry(draft, book.book_id)
      : normalizeEntry({ ...draft, id: `e-${Date.now().toString(36)}` }, book.book_id);
    const list = book.entries.slice();
    const index = list.findIndex((e) => e.id === next.id);
    // 界面排序用的时间戳（v0.22.0）：创建时间只在第一次落，修改时间每次都更新。
    const prevUi = index >= 0 ? (list[index].ui ?? {}) : {};
    next.ui = { ...prevUi, createdAt: Number(prevUi.createdAt) || Date.now(), updatedAt: Date.now() };
    if (index >= 0) list[index] = next;
    else list.push(next);
    book.entries = list;
    ctx.saveEntries(book);
    // 先清掉"改过"再关：否则守卫会在关浮层时再弹一次确认。
    dirty = false;
    ctx.closeOverlay();
    ctx.render();
    ctx.toast(index >= 0 ? '规则已保存' : '规则已添加');
  }

  redrawTrigger();
  drawConds();
  refreshFlowSummary();

  // ---- 分区：基本 / 高级（默认收起）/ 试运行 ----
  // 手机上"一屏塞十几项"最容易迷路，所以常用的（标题、正文、触发词、流程）在前，
  // 条件、时效、注入、概率收进 <details>，需要时再展开。
  const sectionTitle = (text, topic) => el('div', { class: 'ilb-section-head' }, [
    el('h5', { class: 'ilb-section-title', text }),
    topic ? button('?', () => ctx.showHelp(topic), { ghost: true, title: '这几项是什么意思' }) : null,
  ]);

  // 宽屏时右侧再多一栏摘要（§5.4）：左边改，右边立刻看到"它会变成什么样"。
  // 窄窗 / 手机上不并排，摘要就不画——不然输入框会被挤成一条缝。
  const isWideEditor = (() => {
    try {
      return typeof ctx.density === 'function' && ctx.density() === 'wide';
    } catch {
      return false;
    }
  })();
  const summaryHost = el('aside', { class: 'ilb-editor-summary' });

  const formNodes = [
    sectionTitle('基本设置', 'editor'),
    el('label', { class: 'ilb-inline ilb-switch' }, [
      enabledBox,
      el('span', { class: 'ilb-sub', text: '启用这条规则' }),
    ]),
    field('标题（只给自己看）', titleInput),
    field('正文（会出现在提示词里）', contentInput),

    el('h5', { class: 'ilb-section-title', text: '什么时候出现' }),
    field('触发方式', triggerMode),
    field('谁说的话算数', sourceSelect, '默认两边都看。只看 AI 时，用户说触发词不会让它出现（也能靠独立逻辑点名）。'),
    el('label', { class: 'ilb-inline' }, [
      waitBox,
      el('span', { class: 'ilb-sub', text: '等候模式：不自己出现，只等独立逻辑点名（适合被调用的段落）' }),
    ]),
    triggerHost,

    sectionTitle('判定流程（可以不加）', 'flow'),
    hint('不画任何一步，这条规则就完全按上面的触发词和注入参数工作——和原生世界书一样。'),
    flowSummaryText,
    el('div', { class: 'ilb-inline' }, [flowModeSelect, flowToggle]),
    flowHost,

    el('details', { class: 'ilb-details' }, [
      el('summary', { class: 'ilb-details-summary', text: '高级设置：条件、时效、注入、概率（默认收起）' }),

      el('h5', { class: 'ilb-section-title', text: '还要满足的条件（可以不加）' }),
      el('div', { class: 'ilb-row' }, [
        combineBox,
        el('div', { class: 'ilb-actions' }, [
          button('+ 文本包含', () => { cards.push({ type: 'contains', within: 'text', text: '', negate: false }); markDirty(); drawConds(); }, { ghost: true }),
          button('+ 另一条已出现', () => { cards.push({ type: 'activated', entryId: '' }); markDirty(); drawConds(); }, { ghost: true }),
          button('+ 变量', () => { cards.push({ type: 'var', name: '', op: 'equals', value: '' }); markDirty(); drawConds(); }, { ghost: true }),
        ]),
      ]),
      condHost,

      el('h5', { class: 'ilb-section-title', text: '出现多久' }),
      el('div', { class: 'ilb-row' }, [
        field('延迟几条', delayInput, '先等 N 条消息才允许出现'),
        field('持续几条', stickyInput, '出现后 N 条内不用再命中触发词'),
        field('冷却几条', cooldownInput, '出现过之后 N 条内不再出现'),
      ]),

      el('h5', { class: 'ilb-section-title', text: '怎么出现' }),
      el('div', { class: 'ilb-row' }, [
        field('注入位置', positionSelect),
        field('深度', depthInput, '仅"聊天记录里"有效'),
        field('以谁的身份', roleSelect),
      ]),
      el('div', { class: 'ilb-row' }, [
        field('权重', weightInput, '大的优先占预算'),
        field('分组', groupInput, '同组只出现一条，取权重最高的'),
      ]),
      el('label', { class: 'ilb-inline' }, [probOn, el('span', { class: 'ilb-sub', text: '按概率出现' }), probValue, el('span', { class: 'ilb-sub', text: '%' })]),
      el('label', { class: 'ilb-inline' }, [chainOn, el('span', { class: 'ilb-sub', text: '允许被别的条目连锁带出' })]),
    ]),

    previewHost,
  ];

  const editorRoot = el('div', { class: isWideEditor ? 'ilb-editor ilb-editor-cols' : 'ilb-editor' }, isWideEditor
    ? [el('div', { class: 'ilb-editor-form' }, formNodes), summaryHost]
    : formNodes);

  /** 右侧摘要：触发 / 流程 / 结构检查。只读，不改任何数据。 */
  function refreshSummary() {
    if (!summaryHost || !isWideEditor) return;
    summaryHost.innerHTML = '';
    let draft;
    try {
      draft = buildEntry();
    } catch {
      return;
    }
    summaryHost.appendChild(el('div', { class: 'ilb-flow-props-title', text: '这条规则的样子' }));
    summaryHost.appendChild(el('p', { class: 'ilb-sub', text: draft.title || '未命名规则' }));

    const tags = [draft.enabled === false ? '已停用' : '已启用'];
    if (draft.wait) tags.push('等候模式');
    if (draft.always) tags.push('常驻');
    if (draft.useProbability) tags.push(`概率 ${draft.probability}%`);
    summaryHost.appendChild(el('div', { class: 'ilb-badges' }, tags.map((t) => badge(t))));

    const trigger = [];
    if (draft.trigger.any.length) trigger.push(`出现任一：${draft.trigger.any.slice(0, 6).join('、')}`);
    if (draft.trigger.all.length) trigger.push(`同时出现：${draft.trigger.all.slice(0, 6).join('、')}`);
    if (draft.trigger.not.length) trigger.push(`排除：${draft.trigger.not.slice(0, 6).join('、')}`);
    summaryHost.appendChild(el('p', {
      class: 'ilb-summary-line',
      text: trigger.length ? trigger.join('；') : '还没有设置触发词：它不会自己出现。',
    }));

    summaryHost.appendChild(el('p', { class: 'ilb-summary-line', text: `流程：${flowSummary(draft.logic ?? { nodes: [] })}` }));

    let problems = [];
    try {
      problems = validateFlow(draft.logic ?? { nodes: [] }, { entries: ruleEntries() }).problems ?? [];
    } catch {
      problems = [];
    }
    if (problems.length) {
      summaryHost.appendChild(el('p', { class: 'ilb-warn', text: `流程有 ${problems.length} 处要检查：${problems[0].message}` }));
    } else {
      summaryHost.appendChild(el('p', { class: 'ilb-hint', text: '流程没发现结构问题。' }));
    }
  }

  // 任何输入都算"改过"：离开时守卫据此决定要不要问。
  editorRoot.addEventListener('input', markDirty);
  editorRoot.addEventListener('change', markDirty);

  const unregister = guard.registerEditor({
    label: existing ? '编辑规则' : '新增规则',
    dirty: () => dirty,
    save: () => save(),
    discard: () => {
      dirty = false;
      unregister();
      ctx.closeOverlay();
    },
  });

  function removeKeys() {
    try {
      document.removeEventListener('keydown', onKey, true);
    } catch {
      /* ignore */
    }
  }

  /**
   * 快捷键（§5.6）：Ctrl/Cmd+S 保存、Ctrl/Cmd+Enter 试运行。
   * 用捕获阶段：避免宿主的全局保存/发送快捷键先把它吃掉。
   */
  function onKey(event) {
    const mod = event.ctrlKey || event.metaKey;
    if (!mod) return;
    const key = String(event.key ?? '').toLowerCase();
    if (key === 's') {
      event.preventDefault();
      event.stopPropagation();
      try {
        save();
      } catch (err) {
        ctx.toast(`保存失败：${err?.message ?? err}`, 'error');
      }
    } else if (key === 'enter') {
      event.preventDefault();
      event.stopPropagation();
      runPreview();
    }
  }
  try {
    document.addEventListener('keydown', onKey, true);
  } catch {
    /* 没有 document 也要能开（自检环境） */
  }

  // 打开时就先算一次摘要：右侧不能空着等用户先改一个字。
  refreshSummary();

  ctx.openOverlay({
    title: existing ? '编辑规则' : '新增规则',
    nodes: [editorRoot],
    // 底部操作栏交给浮层去固定（电脑固定在浮层底部，手机在安全区上方），
    // 不再跟着内容一起滚出屏幕（§5.4 / §6.4）。
    footer: [
      button('试运行', runPreview, { ghost: true, title: 'Ctrl / Cmd + Enter' }),
      button('保存', () => {
        try {
          save();
        } catch (err) {
          ctx.toast(`保存失败：${err?.message ?? err}`, 'error');
        }
      }, { primary: true, title: 'Ctrl / Cmd + S' }),
      button('取消', () => {
        // 有改动先问：保存并离开 / 放弃修改 / 继续编辑
        if (guard.allowLeave()) ctx.closeOverlay();
      }, { ghost: true }),
    ],
    wide: true,
    onBeforeClose: () => {
      // 浮层的 ×、点击背景、Esc、手机返回都会走这里
      if (guard.isDirty()) {
        guard.allowLeave(() => {
          dirty = false;
          ctx.closeOverlay();
        });
        return false;
      }
      return true;
    },
    onClose: () => {
      unregister();
      removeKeys();
    },
  });
}

/** "试一句"：只回答这一句会不会让它出现，不改任何状态。 */
export function openPreview(ctx, book, entry) {
  const text = el('textarea', { class: 'ilb-textarea', rows: '3' }, ['王城今晚开始夜巡。']);
  const countInput = el('input', { class: 'ilb-input', type: 'number', value: '3' });
  const resultHost = el('div', { class: 'ilb-preview' });

  function run() {
    const result = previewEntry(entry, {
      text: text.value,
      messageCount: Number(countInput.value) || 0,
      state: { lastActiveAt: null, activeSince: null },
    });
    resultHost.innerHTML = '';
    resultHost.appendChild(el('p', {
      class: result.passed ? 'ilb-preview-pass' : 'ilb-preview-fail',
      text: result.passed ? '会出现在这一轮' : `不会出现：${result.reason}`,
    }));
    if (result.steps?.length) {
      resultHost.appendChild(el('ul', { class: 'ilb-warn-list' }, result.steps.map((s) => el('li', {
        text: `${s.passed ? '✓' : '✗'} ${s.stage}：${s.reason}`,
      }))));
    }
    if ((entry.trigger?.secondary?.keys ?? []).length === 0) {
      // 没设置第二组词时，说明一下"条件里的变量"需要真实数据才能测
      const hasVar = JSON.stringify(entry.when ?? []).includes('"var"');
      if (hasVar) resultHost.appendChild(hint('这条规则用了变量条件。试一句时变量都是空的，所以变量条件通常不满足。'));
    }
  }

  ctx.openOverlay('试一句', [
    hint('这里只做"这句话会不会让它出现"的判断，不会真的发消息，也不会改任何状态。'),
    field('假设下一句是', text),
    field('当作第几条消息', countInput, '影响"延迟/冷却"的判断'),
    button('试一下', run, { primary: true }),
    resultHost,
    hint('注意：这里不检查预算、不检查同组。那两步要在真实对话里由"诊断"页告诉你。'),
  ]);
  run();
}
