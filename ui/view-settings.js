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

  const narrative = ctx.narrative;
  const narrativeInfo = (() => {
    try {
      return narrative && typeof narrative.describe === 'function' ? narrative.describe() : null;
    } catch {
      return null;
    }
  })();

  const narrativeBadge = (() => {
    if (!narrative) return badge('未接入', 'warn');
    if (!narrativeInfo) return badge('状态读不到', 'warn');
    if (!narrativeInfo.enabled) return badge('已关闭', 'warn');
    const problems = narrativeInfo.declaration?.problems ?? 0;
    if (problems > 0) return badge(`声明有 ${problems} 个问题`, 'warn');
    const facts = narrativeInfo.totals?.facts ?? 0;
    return badge(`运行中 · ${facts} 条事实`, 'ok');
  })();

  function ledgerNodes() {
    const nodes = [];
    let data = null;
    try {
      data = narrative && typeof narrative.ledger === 'function' ? narrative.ledger() : null;
    } catch (err) {
      nodes.push(hint(`读账本失败：${err?.message ?? err}`));
      return nodes;
    }
    if (!data) {
      nodes.push(hint('叙事引擎没接上，账本读不到。'));
      return nodes;
    }
    if (!data.settings.enabled) nodes.push(hint('账本现在关着。打开开关后，这里会显示按聊天记录重放出来的状态。'));
    const declaration = data.declaration ?? {};
    nodes.push(el('p', { class: 'ilb-hint', text: `声明：${data.settings.usingPreset ? '内置示例' : '你自己的'} · ${declaration.variables ?? 0} 个变量 · ${declaration.rules ?? 0} 条规则${declaration.problemText ? ` · 问题：${declaration.problemText}` : ''}` }));
    const plan = data.plan;
    if (plan && plan.lines.length) {
      nodes.push(el('ul', { class: 'ilb-summary' }, plan.lines.map((line) => el('li', { text: line.text }))));
    } else {
      nodes.push(hint('还没有任何事实进来。让模型在回复里写一条 [[ILB:获得:铜钥匙]] 试试。'));
    }
    if (plan && plan.totals) {
      const t = plan.totals;
      nodes.push(hint(`重放结果：${t.messages} 条消息 · ${t.facts} 条事实（成功 ${t.ok}、被拒 ${t.rejected}、未认领 ${t.unhandled}、看不懂 ${t.unknown}）`));
    }
    if (plan && plan.prompt) {
      nodes.push(el('h5', { class: 'ilb-section-title', text: '下一轮注入给模型的文本' }));
      nodes.push(el('pre', { class: 'ilb-selftest', text: plan.prompt }));
    }
    return nodes;
  }

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
      el('label', { class: 'ilb-inline' }, [
        checkbox(settings.probabilityEnabled === true, (on) => save({ probabilityEnabled: on })),
        el('span', { class: 'ilb-sub', text: '允许"按概率出现"' }),
        hint('关掉时，规则里写的概率会被忽略，结果每次都一样。'),
      ]),
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
      el('h5', { class: 'ilb-section-title', text: '叙事引擎（账本）' }),
      el('div', { class: 'ilb-inline' }, [
        narrativeBadge,
        el('span', { class: 'ilb-sub', text: narrativeInfo?.declaration?.problemText ?? '' }),
      ]),
      el('label', { class: 'ilb-inline' }, [
        checkbox(narrativeInfo?.enabled === true, (on) => {
          if (!narrative) {
            ctx.toast('叙事引擎没接上，开关用不了', 'warn');
            return;
          }
          try {
            narrative.setEnabled(on);
          } catch (err) {
            ctx.toast(`开关没生效：${err?.message ?? err}`, 'error');
          }
          ctx.render();
        }),
        el('span', { class: 'ilb-sub', text: '启用账本（默认关闭）' }),
      ]),
      hint('关着的时候扩展行为与 v0.5.0 完全一致：不注入、不在消息末尾画东西。'),
      field(
        '注入正文的字数上限',
        el('input', {
          class: 'ilb-input',
          type: 'number',
          min: '120',
          max: '2000',
          step: '60',
          value: String(narrativeInfo?.budget ?? 600),
          onchange: (e) => {
            const raw = Number(e.target.value);
            const value = Number.isFinite(raw) ? Math.min(2000, Math.max(120, Math.round(raw))) : 600;
            e.target.value = String(value);
            save({ narrativeBudget: value });
            try {
              narrative?.refresh?.('budget');
            } catch {
              /* 刷新失败下一页会显示错误 */
            }
          },
        }),
        '默认 600 字。只算账本正文，不含固定前言与用法说明。',
      ),
      el('div', { class: 'ilb-actions' }, [
        button('查看账本', () => ctx.openOverlay('账本', ledgerNodes()), { ghost: true }),
        button('重放一次', () => {
          try {
            narrative?.refresh?.('manual');
            ctx.toast('已按聊天记录重新算了一遍');
          } catch (err) {
            ctx.toast(`重放失败：${err?.message ?? err}`, 'error');
          }
          ctx.render();
        }, { ghost: true }),
        button('恢复示例声明', () => {
          save({ narrativeDeclaration: null });
          try {
            narrative?.refresh?.('reset-declaration');
          } catch {
            /* ignore */
          }
        }, { ghost: true }),
      ]),
      hint('模型写的标记长这样：[[ILB:获得:铜钥匙]]、[[ILB:地点:王城/地窖]]、[[ILB:关系:艾琳/信任+1]]。它只报"发生了什么"，数值、容量、上限、平衡全部由声明决定。'),
      hint('账本不存盘：每次都是按聊天记录重放算出来的，所以滑动、删除、编辑消息之后它会自己变对。'),
    ]),

    el('div', { class: 'ilb-card' }, [
      el('h5', { class: 'ilb-section-title', text: '出问题时' }),
      el('p', { class: 'ilb-hint', text: '如果点了按钮没有反应、或者界面看着不对劲，先点这里。它会当场检查"样式有没有加载、浮层能不能开、宿主有没有接上"，并给出可以整段复制的结论。' }),
      button('运行自检', () => showSelfTest(), { primary: true }),
    ]),

    hint('这些设置只影响"怎么判定、怎么注入"，不会改动你的书和规则本身。'),
  ]);
}
