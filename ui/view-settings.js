// ui/view-settings.js —— 设置页（ILB-6.5 默认值表 / ILB-6.3）

import { DEFAULT_SETTINGS } from '../core/settings-defaults.js';
import { IMPORT_POLICIES, IMPORT_POLICY_LABEL } from '../core/import-plan.js';
import { el, field, hint, button, checkbox, selectBox, badge } from './widgets.js';
import { showSelfTest } from './selftest.js';

const POLICY_HINT = {
  ask: '每次导入都先问你（默认）',
  keep: '照原样保留原生世界书里的开/关',
  on: '不管原件怎么写，导入后一律打开',
  off: '不管原件怎么写，导入后一律关闭',
};

export function renderSettings(ctx) {
  const { repository } = ctx;
  const settings = repository.getSettings();

  const numberField = (label, key, min, max, step, text) => {
    const input = el('input', {
      class: 'ilb-input',
      type: 'number',
      min: String(min),
      max: String(max),
      step: String(step),
      value: String(settings[key] ?? DEFAULT_SETTINGS[key]),
      onchange: (e) => {
        const raw = Number(e.target.value);
        const value = Number.isFinite(raw) ? Math.min(max, Math.max(min, raw)) : DEFAULT_SETTINGS[key];
        e.target.value = String(value);
        save({ [key]: value });
      },
    });
    return field(label, input, text);
  };

  const toggle = (label, key, text) => el('label', { class: 'ilb-inline' }, [
    checkbox(settings[key] === true, (on) => save({ [key]: on })),
    el('span', { class: 'ilb-sub', text: label }),
    text ? el('small', { class: 'ilb-sub', text }) : null,
  ]);

  function save(patch) {
    const next = { ...repository.getSettings(), ...patch };
    repository.saveSettings(next);
    ctx.toast('设置已保存');
    ctx.render();
  }

  const policySelect = selectBox(
    settings.importEnabledPolicy ?? DEFAULT_SETTINGS.importEnabledPolicy,
    IMPORT_POLICIES.map((p) => ({ value: p, label: IMPORT_POLICY_LABEL[p] })),
    (value) => save({ importEnabledPolicy: value }),
  );

  return el('div', { class: 'ilb-view' }, [
    el('div', { class: 'ilb-inline' }, [
      el('strong', { text: '设置' }),
      badge(settings.enabled === false ? '已停用' : '运行中', settings.enabled === false ? 'warn' : 'ok'),
      button('?', () => ctx.showHelp('settings'), { ghost: true, title: '这些选项都是什么' }),
      button('恢复默认值', () => ctx.openOverlay('恢复默认值', [
        hint('只会改设置，不会动你的书、规则和快照。'),
        button('确认恢复', () => {
          repository.saveSettings({ ...DEFAULT_SETTINGS });
          ctx.closeOverlay();
          ctx.toast('已恢复默认设置');
          ctx.render();
        }, { primary: true }),
      ]), { ghost: true }),
    ]),

    el('div', { class: 'ilb-card' }, [
      el('h5', { class: 'ilb-section-title', text: '总开关' }),
      toggle('启用世界书扩展', 'enabled', '关掉之后这一轮什么都不注入，但数据都还在。'),
    ]),

    el('div', { class: 'ilb-card' }, [
      el('h5', { class: 'ilb-section-title', text: '判定范围' }),
      numberField('往前看几条消息', 'scanDepth', 0, 50, 1, '只看最近这几条消息里有没有触发词。默认 3。'),
      numberField('最多连锁几层', 'maxChainDepth', 0, 8, 1, '一条规则被触发后，它的正文还能带出别的规则。默认 3。'),
      numberField('激活条目最多连几层', 'maxActivateDepth', 0, 5, 1, '流程里的「激活条目」还能再激活别的条目。默认 2；0 = 只认直接点名。'),
      el('label', { class: 'ilb-inline' }, [
        checkbox(settings.probabilityEnabled === true, (on) => save({ probabilityEnabled: on })),
        el('span', { class: 'ilb-sub', text: '允许"按概率出现"' }),
        hint('关掉时，规则里写的概率会被忽略，结果每次都一样。'),
      ]),
    ]),

    el('div', { class: 'ilb-card' }, [
      el('h5', { class: 'ilb-section-title', text: '独立逻辑' }),
      toggle('启用独立逻辑', 'logicEnabled', '关掉之后，规则页里的独立逻辑一条都不跑，条目照常工作。'),
      numberField('一轮最多跑几条逻辑', 'logicMaxPerTurn', 1, 200, 1, '防止逻辑互相调用绕圈。超出上限的会写进诊断。默认 20。'),
      hint('独立逻辑在「规则」页最下面维护：它自己带触发词，不需要先命中一条世界书条目。'),
    ]),

    el('div', { class: 'ilb-card' }, [
      el('h5', { class: 'ilb-section-title', text: 'AI 调用逻辑' }),
      toggle('允许 AI 在正文里调用逻辑', 'aiCallsEnabled', '默认关闭。打开后，AI 正文里的 [[ILB:名字(参数)]] 会真的去跑那条逻辑；没开放给 AI 的名字会被拒绝并写进诊断。'),
      numberField('一轮最多调用几次', 'aiCallMaxPerTurn', 0, 10, 1, '默认 3。0 = 一条都不执行。'),
      numberField('往回看几条 AI 消息', 'aiCallScan', 1, 10, 1, '只扫最近这几条 AI 的回复，避免翻旧账。默认 3。'),
      hint('AI 只能通过这个口改"聊天变量"（数字、文本），不能改 SillyTavern 或扩展本身的设置。每次调用都会在诊断里留下记录。'),
    ]),

    el('div', { class: 'ilb-card' }, [
      el('h5', { class: 'ilb-section-title', text: '预算' }),
      numberField('占上下文的比例', 'budgetRatio', 0.02, 0.6, 0.01, '默认 15%。这是上限的一部分。'),
      numberField('最多多少字', 'budgetCap', 200, 8000, 100, '默认 2000 字。最终取两者里更小的那个。'),
      hint('预算按"整条规则"算，不会把一条规则从中间截断。放不下的整条跳过。'),
    ]),

    el('div', { class: 'ilb-card' }, [
      el('h5', { class: 'ilb-section-title', text: '导入原生世界书' }),
      field('原件里的开/关怎么处理', policySelect),
      hint(POLICY_HINT[settings.importEnabledPolicy ?? 'ask'] ?? ''),
      el('label', { class: 'ilb-inline' }, [
        checkbox(settings.batchImportIncludeExisting === true, (on) => save({ batchImportIncludeExisting: on })),
        el('span', { class: 'ilb-sub', text: '一键导入时也包含已经导入过的书' }),
      ]),
      hint('默认只导入新的。已经导入过的会在列表里标成"已导入"，跳过去可以避免出现两份一样的书。'),
    ]),

    el('div', { class: 'ilb-card' }, [
      el('h5', { class: 'ilb-section-title', text: '注入' }),
      el('label', { class: 'ilb-inline' }, [
        checkbox(settings.injectSeparator === true, (on) => save({ injectSeparator: on })),
        el('span', { class: 'ilb-sub', text: '在注入内容之间加分隔线' }),
      ]),
      hint('有些模型对分隔线比较敏感。默认不加。'),
    ]),

    el('div', { class: 'ilb-card' }, [
      el('h5', { class: 'ilb-section-title', text: '出问题时' }),
      el('p', { class: 'ilb-hint', text: '如果点了按钮没有反应、或者界面看着不对劲，先点这里。它会当场检查"样式有没有加载、浮层能不能开、宿主有没有接上"，并给出可以整段复制的结论。' }),
      button('运行自检', () => showSelfTest(), { primary: true }),
    ]),

    hint('这些设置只影响"怎么判定、怎么注入"，不会改动你的书和规则本身。'),
  ]);
}
