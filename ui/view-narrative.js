// ui/view-narrative.js —— 「叙事」标签页（v0.7.0）。
//
// 这一页取代了原先塞在"设置"页底部的那张卡：开关、预算、检查点、账本预览、注入原文、
// 声明编辑、给 AI 的编写说明都在这里；设置页只留世界书自己的东西。
//
// 界面只读或"整份替换"，不逐条改事实——先把逻辑跑稳，可视化编辑器以后再加。

import { el, field, hint, button, checkbox, badge, downloadJson } from './widgets.js';
import { PRESET } from '../narrative/preset.js';
import { DECLARATION_GUIDE } from '../narrative/guide.js';
import { CHECKPOINT_MAX, CHECKPOINT_MIN, describeDeclaration } from '../narrative/store.js';

export function renderNarrative(ctx) {
  const { repository } = ctx;
  const narrative = ctx.narrative;
  const settings = repository.getSettings();

  let info = null;
  try {
    info = narrative && typeof narrative.describe === 'function' ? narrative.describe() : null;
  } catch {
    info = null;
  }

  function save(patch) {
    repository.saveSettings({ ...repository.getSettings(), ...patch });
    try {
      narrative?.refresh?.('settings');
    } catch {
      /* 刷新失败下一页会显示 */
    }
    ctx.toast('设置已保存');
    ctx.render();
  }

  function copyGuide() {
    const text = DECLARATION_GUIDE;
    const done = () => ctx.toast('编写说明已复制，可以直接发给 AI');
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
        return;
      }
    } catch {
      /* 掉到兜底 */
    }
    fallbackCopy(text, done);
  }

  function fallbackCopy(text, done) {
    try {
      const area = el('textarea', { style: { position: 'fixed', left: '-9999px', top: '0' } });
      area.value = text;
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand && document.execCommand('copy');
      area.remove();
      if (ok) {
        done();
        return;
      }
    } catch {
      /* ignore */
    }
    ctx.openOverlay('复制失败：请手动选中', [el('pre', { class: 'ilb-selftest', text })]);
  }

  const statusBadge = (() => {
    if (!narrative) return badge('未接入', 'warn');
    if (!info) return badge('状态读不到', 'warn');
    if (!info.enabled) return badge('已关闭', 'warn');
    if (info.declaration?.problems) return badge(`声明有 ${info.declaration.problems} 个问题`, 'warn');
    return badge(`运行中 · ${info.totals?.facts ?? 0} 条事实`, 'ok');
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
    nodes.push(el('p', {
      class: 'ilb-hint',
      text: `声明：${data.settings.usingPreset ? '内置示例' : '你自己的'} · ${declaration.variables ?? 0} 个变量 · ${declaration.rules ?? 0} 条规则${declaration.problemText ? ` · 问题：${declaration.problemText}` : ''}`,
    }));
    const plan = data.plan;
    if (plan && plan.lines.length) nodes.push(el('ul', { class: 'ilb-summary' }, plan.lines.map((line) => el('li', { text: line.text }))));
    else nodes.push(hint('还没有任何事实进来。让模型在回复里写一条 [[ILB:获得:铜钥匙]] 试试。'));
    if (plan && plan.totals) {
      const t = plan.totals;
      nodes.push(hint(`重放结果：${t.messages} 条消息 · ${t.facts} 条事实（成功 ${t.ok}、被拒 ${t.rejected}、未认领 ${t.unhandled}、看不懂 ${t.unknown}）`));
      if (plan.startIndex > 0) nodes.push(hint(`其中前 ${plan.startIndex} 条来自检查点，最新的 ${plan.totals.messages - plan.startIndex} 条是现场重算的。`));
    }
    if (plan && plan.deltaLines && plan.deltaLines.length) {
      nodes.push(el('h5', { class: 'ilb-section-title', text: '最后一条消息带来的变化' }));
      nodes.push(el('ul', { class: 'ilb-summary' }, plan.deltaLines.map((line) => el('li', { text: line }))));
    }
    if (plan && plan.prompt) {
      nodes.push(el('h5', { class: 'ilb-section-title', text: '下一轮注入给模型的文本' }));
      nodes.push(el('pre', { class: 'ilb-selftest', text: plan.prompt }));
    }
    return nodes;
  }

  function declarationEditorNodes() {
    const stored = settings.narrativeDeclaration ?? null;
    const current = stored ?? PRESET;
    const box = el('textarea', { class: 'ilb-textarea', rows: '16', spellcheck: 'false', style: { fontFamily: 'monospace', fontSize: '12px', minHeight: '320px' } });
    box.value = JSON.stringify(current, null, 2);
    const feedback = el('p', { class: 'ilb-hint', text: stored ? '这是你自己保存的声明。' : '这是内置示例声明（还没保存过自己的）。' });
    const problemsBox = el('div', { class: 'ilb-hint' });

    const parse = () => {
      try {
        return { value: JSON.parse(box.value) };
      } catch (err) {
        return { error: `不是合法的 JSON：${err?.message ?? err}` };
      }
    };

    const showInfo = (parsed) => {
      const result = describeDeclaration(parsed);
      if (!result.ok) {
        feedback.className = 'ilb-error';
        feedback.textContent = `声明不能用：${result.error}`;
        problemsBox.textContent = '';
        return null;
      }
      feedback.className = result.problems.length ? 'ilb-warn' : 'ilb-hint';
      feedback.textContent = `可以编译：${result.variables} 个变量 · ${result.rules} 条规则${result.problems.length ? ` · ${result.problems.length} 个问题` : ''}`;
      problemsBox.textContent = result.problemText ?? '';
      return result;
    };

    const check = () => {
      const parsed = parse();
      if (parsed.error) {
        feedback.className = 'ilb-error';
        feedback.textContent = parsed.error;
        problemsBox.textContent = '';
        return null;
      }
      const result = showInfo(parsed.value);
      return result && !result.problems.length ? { value: parsed.value, result } : null;
    };

    return [
      hint('这就是"记账规则"本身：状态变量、约束、规则、自定义事件都在里面。改完先点「校验」——编译不过不会保存。语法见 narrative/guide.js，或点页面上的「复制编写说明」发给 AI。'),
      el('div', { class: 'ilb-field' }, [el('label', { class: 'ilb-sub', text: '声明（JSON）' }), box]),
      feedback,
      problemsBox,
      el('div', { class: 'ilb-actions' }, [
        button('校验', () => check(), { ghost: true }),
        button('校验并保存', () => {
          const checked = check();
          if (!checked) {
            ctx.toast('声明还有问题，没有保存', 'warn');
            return;
          }
          repository.saveSettings({ ...repository.getSettings(), narrativeDeclaration: checked.value });
          try {
            narrative?.refresh?.('declaration');
          } catch {
            /* ignore */
          }
          ctx.toast('声明已保存');
          ctx.closeOverlay();
          ctx.render();
        }, { primary: true }),
        button('填入内置示例', () => {
          box.value = JSON.stringify(PRESET, null, 2);
          feedback.className = 'ilb-hint';
          feedback.textContent = '已填入内置示例（还没保存）。';
          problemsBox.textContent = '';
        }, { ghost: true }),
        button('导出当前文本', () => {
          const parsed = parse();
          if (parsed.error) {
            ctx.toast(parsed.error, 'warn');
            return;
          }
          downloadJson('ilb-declaration.json', parsed.value);
        }, { ghost: true }),
      ]),
      hint('账本状态不存盘（检查点除外）：保存声明之后会按聊天记录重新重放，不需要迁移任何存档。'),
    ];
  }

  const budgetValue = info?.budget ?? settings.narrativeBudget ?? 600;
  const checkpointValue = info?.checkpointEvery ?? settings.narrativeCheckpointEvery ?? 5;
  const checkpoint = info?.checkpoint ?? null;

  return el('div', { class: 'ilb-view' }, [
    el('div', { class: 'ilb-inline' }, [
      el('strong', { text: '叙事引擎' }),
      statusBadge,
      button('?', () => ctx.showHelp('settings'), { ghost: true, title: '这一页怎么用' }),
    ]),

    el('div', { class: 'ilb-card' }, [
      el('h5', { class: 'ilb-section-title', text: '开关与预算' }),
      el('label', { class: 'ilb-inline' }, [
        checkbox(info?.enabled === true, (on) => {
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
      field('注入正文的字数上限', el('input', {
        class: 'ilb-input',
        type: 'number',
        min: '120',
        max: '2000',
        step: '60',
        value: String(budgetValue),
        onchange: (e) => {
          const raw = Number(e.target.value);
          const value = Number.isFinite(raw) ? Math.min(2000, Math.max(120, Math.round(raw))) : 600;
          e.target.value = String(value);
          save({ narrativeBudget: value });
        },
      }), '默认 600 字。只算账本正文，不含固定前言与用法说明。'),
      field('检查点间隔（条）', el('input', {
        class: 'ilb-input',
        type: 'number',
        min: String(CHECKPOINT_MIN),
        max: String(CHECKPOINT_MAX),
        step: '1',
        value: String(checkpointValue),
        onchange: (e) => {
          const raw = Number(e.target.value);
          const value = Number.isFinite(raw) ? Math.min(CHECKPOINT_MAX, Math.max(CHECKPOINT_MIN, Math.round(raw))) : 5;
          e.target.value = String(value);
          save({ narrativeCheckpointEvery: value });
        },
      }), '0 = 不存检查点，每次都从对话开头重放。默认 5：最新的 5 条现场重算，更早的折成检查点（旧楼层被隐藏/删除也不会丢事实）。'),
      checkpoint
        ? hint(`当前检查点：已折叠到第 ${checkpoint.upto} 条；之后的 ${Math.max(0, (info?.entries ?? 0) - checkpoint.upto)} 条现场重算。`)
        : hint('还没有检查点。聊到超过间隔条数后会自动写入。'),
    ]),

    el('div', { class: 'ilb-card' }, [
      el('h5', { class: 'ilb-section-title', text: '账本' }),
      info?.lines?.length
        ? el('ul', { class: 'ilb-summary' }, info.lines.map((line) => el('li', { text: line.text })))
        : hint(info?.enabled ? '还没有任何事实。' : '账本关着。打开开关后这里会显示当前状态。'),
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
        button('重建账本', () => ctx.openOverlay('重建账本', [
          hint('会删掉这条聊天的检查点，下一次从头重放。旧楼层如果已经被别的插件隐藏/删除，那些事实会一起消失。'),
          button('确认重建', () => {
            try {
              narrative?.clearCheckpoint?.();
              narrative?.refresh?.('rebuild');
              ctx.toast('检查点已清掉，已重新重放');
            } catch (err) {
              ctx.toast(`重建失败：${err?.message ?? err}`, 'error');
            }
            ctx.closeOverlay();
            ctx.render();
          }, { primary: true }),
        ]), { ghost: true }),
      ]),
    ]),

    el('div', { class: 'ilb-card' }, [
      el('h5', { class: 'ilb-section-title', text: '声明' }),
      el('p', {
        class: 'ilb-hint',
        text: `当前：${info?.usingPreset ? '内置示例' : '你自己的'} · ${info?.declaration?.variables ?? 0} 个变量 · ${info?.declaration?.rules ?? 0} 条规则${info?.declaration?.problemText ? ` · 问题：${info.declaration.problemText}` : ''}`,
      }),
      el('div', { class: 'ilb-actions' }, [
        button('编辑声明', () => ctx.openOverlay('编辑声明（记账规则）', declarationEditorNodes()), { ghost: true }),
        button('复制编写说明', () => copyGuide(), { ghost: true }),
        button('恢复示例声明', () => {
          save({ narrativeDeclaration: null });
          try {
            narrative?.refresh?.('reset-declaration');
          } catch {
            /* ignore */
          }
        }, { ghost: true }),
      ]),
      hint('「复制编写说明」会复制一段发给 AI 的提示，里面写着声明 JSON 的完整格式与约束；想加玩法又不想手写，可以直接让它按格式生成。'),
    ]),

    hint('模型写的标记长这样：[[ILB:获得:铜钥匙]]、[[ILB:地点:王城/地窖]]、[[ILB:关系:艾琳/信任+1]]；自定义事件写成 [[ILB:突破:筑基]]（需先在声明里 events 里登记）。'),
    hint('账本不存盘（检查点除外）：滑动、删除、编辑消息之后，最新的那几条会重新算；更早的以检查点为准。'),
  ]);
}
