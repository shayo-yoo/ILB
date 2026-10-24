// ui/view-diagnostics.js —— 诊断页：上一轮每条规则为什么出现 / 没出现（ILB-6.3）

import { el, hint, badge, button, card, emptyText } from './widgets.js';

const STAGE_LABEL = {
  trigger: '触发词',
  when: '附加条件',
  timed: '时效',
  probability: '概率',
  group: '同组择一',
  budget: '预算',
  chain: '连锁',
  logic: '判定流程',
  book: '书没启用',
  disabled: '规则被关掉',
};

function timeText(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

/** 叙事引擎那一块：账本开关、声明、重放统计、注入字数。只读，不做任何修改。 */
function narrativeCard(ctx) {
  const narrative = ctx.narrative;
  let info = null;
  try {
    info = narrative && typeof narrative.describe === 'function' ? narrative.describe() : null;
  } catch {
    info = null;
  }
  if (!info) {
    return el('div', { class: 'ilb-card' }, [
      el('h5', { class: 'ilb-section-title', text: '叙事引擎（账本）' }),
      hint('叙事引擎没接上（启动时可能出错了，看控制台里的 [ILB] 行）。世界书功能不受影响。'),
    ]);
  }

  const t = info.totals ?? {};
  const nodes = [
    el('h5', { class: 'ilb-section-title', text: '叙事引擎（账本）' }),
    el('div', { class: 'ilb-inline' }, [
      info.enabled ? badge('运行中', 'ok') : badge('已关闭', 'warn'),
      el('span', {
        class: 'ilb-sub',
        text: `${info.version} · 声明${info.usingPreset ? '（内置示例）' : '（你自己的）'}：${info.declaration.variables} 个变量 / ${info.declaration.rules} 条规则`,
      }),
    ]),
  ];

  if (!info.declaration.ok) {
    nodes.push(el('p', { class: 'ilb-error', text: `声明编译失败：${info.declaration.problemText}` }));
  } else if (info.declaration.problems) {
    nodes.push(el('p', { class: 'ilb-warn', text: `声明有 ${info.declaration.problems} 个问题：${info.declaration.problemText}` }));
  }

  if (!info.enabled) {
    nodes.push(hint('账本关着：不注入、不在消息末尾画块。到「设置 → 叙事引擎（账本）」打开。'));
  } else if (!t.facts) {
    nodes.push(hint('还没记到任何事实。让模型在回复里写一条 [[ILB:获得:铜钥匙]] 试试。'));
  } else {
    nodes.push(el('div', { class: 'ilb-summary' }, [
      el('span', { text: `${t.messages} 条消息` }),
      el('span', { text: `${t.facts} 条事实` }),
      badge(`被拒 ${t.rejected}`, t.rejected ? 'warn' : 'ok'),
      el('span', { text: `未认领 ${t.unhandled} · 看不懂 ${t.unknown}` }),
      el('span', { text: `注入 ${info.promptChars} 字 · ${info.blocks} 块` }),
    ]));
  }

  nodes.push(el('div', { class: 'ilb-actions' }, [
    button('查看注入原文', () => {
      let prompt = '';
      try {
        prompt = narrative.ledger()?.plan?.prompt ?? '';
      } catch (err) {
        ctx.toast(`读注入文本失败：${err?.message ?? err}`, 'error');
        return;
      }
      ctx.openOverlay('下一轮注入的文本', [
        prompt
          ? el('pre', { class: 'ilb-selftest', text: prompt })
          : hint('现在没有注入内容（账本关着，或者还没有任何事实）。'),
        hint('这段文字会以 setExtensionPrompt("ILB_NARRATIVE", …, IN_CHAT, 深度 1, system) 进入下一次请求。'),
      ]);
    }, { ghost: true }),
    button('重放一次', () => {
      try {
        narrative.refresh('diagnostics');
        ctx.toast('已按聊天记录重新算了一遍');
      } catch (err) {
        ctx.toast(`重放失败：${err?.message ?? err}`, 'error');
      }
      ctx.render();
    }, { ghost: true }),
  ]));
  nodes.push(hint('账本不存盘：这一页的数字都是按聊天记录重算出来的。'));
  return el('div', { class: 'ilb-card' }, nodes);
}

export function renderDiagnostics(ctx) {
  const { pipeline, repository } = ctx;
  const last = pipeline?.describeLastRun ? pipeline.describeLastRun() : { ran: false };
  const titles = new Map();
  for (const b of repository.listBooks()) {
    for (const e of b.entries ?? []) titles.set(e.id, `${b.name} / ${e.title || e.id}`);
  }

  const root = el('div', { class: 'ilb-view' });

  if (last.skipped) {
    root.appendChild(el('div', { class: 'ilb-summary' }, [
      badge('已跳过', 'warn'),
      el('span', { text: last.skipped }),
      hint('总开关在"设置"页。关掉的时候扩展不注入任何东西，但书和规则都还在。'),
    ]));
    root.appendChild(narrativeCard(ctx));
    return root;
  }

  if (!last.ran) {
    root.appendChild(hint('还没有跑过。回到聊天界面发一条消息，然后再回到这里。'));
    if (last.error) root.appendChild(el('p', { class: 'ilb-error', text: `上一次出错：${last.error}` }));
    root.appendChild(narrativeCard(ctx));
    return root;
  }

  const budget = last.budget ?? { limit: 0, used: 0, dropped: 0 };
  root.appendChild(el('div', { class: 'ilb-summary' }, [
    el('span', { text: `上一次运行：${timeText(last.at)}` }),
    badge(`注入 ${last.activated?.length ?? 0} 条`, (last.activated?.length ?? 0) ? 'ok' : 'warn'),
    el('span', { text: `预算 ${budget.used} / ${budget.limit} 字` }),
    el('span', { text: `在场书 ${last.books?.active?.length ?? 0} 本` }),
  ]));

  if (last.error) root.appendChild(el('p', { class: 'ilb-error', text: `这一步出了错：${last.error}` }));

  const inactive = last.books?.inactive ?? [];
  if (inactive.length) {
    root.appendChild(el('div', { class: 'ilb-card' }, [
      el('h5', { class: 'ilb-section-title', text: '这轮没被启用的书' }),
      el('ul', { class: 'ilb-warn-list' }, inactive.map((b) => el('li', {
        text: `${b.name ?? b.book_id}：${last.books?.reasons?.[b.book_id] ?? '未说明原因'}`,
      }))),
    ]));
  }

  const rows = (last.diagnostics ?? []).slice();
  if (rows.length === 0) {
    root.appendChild(hint('这一轮没有任何规则参与判定。可能是所有书都被关掉了，也可能书里还没有规则。'));
  } else {
    const passed = rows.filter((r) => r.passed).length;
    root.appendChild(el('div', { class: 'ilb-inline' }, [
      el('strong', { text: `共 ${rows.length} 条参与判定，${passed} 条出现` }),
      button('检查所有书的结构', () => runHealthCheck(ctx), { ghost: true }),
      button('?', () => ctx.showHelp('diagnostics'), { ghost: true, title: '这一页怎么看' }),
    ]));

    const list = el('div', { class: 'ilb-cardlist' });
    for (const r of rows) {
      list.appendChild(el('div', { class: `ilb-card ${r.passed ? '' : 'ilb-card-off'}` }, [
        el('div', { class: 'ilb-rule-head' }, [
          el('span', { class: 'ilb-rule-titles' }, [el('strong', { text: titles.get(r.entryId) ?? r.entryId })]),
          badge(r.passed ? '出现' : '没出现', r.passed ? 'ok' : 'warn'),
        ]),
        el('div', { class: 'ilb-meta' }, [
          el('span', { text: `卡在：${STAGE_LABEL[r.stage] ?? r.stage ?? '—'}` }),
          el('span', { text: r.reason ?? '' }),
          r.estimatedTokens ? el('span', { text: `约 ${r.estimatedTokens} 字` }) : null,
        ]),
      ]));
    }
    root.appendChild(list);
  }

  const warnings = last.books?.warnings ?? [];
  if (warnings.length) {
    root.appendChild(el('div', { class: 'ilb-card' }, [
      el('h5', { class: 'ilb-section-title', text: '提醒' }),
      el('ul', { class: 'ilb-warn-list' }, warnings.map((w) => el('li', { text: String(w) }))),
    ]));
  }

  root.appendChild(narrativeCard(ctx));
  root.appendChild(hint('这一页只是"读"，不会改变任何规则。想验证单条规则，去"规则"页点它的"试一句"。'));
  return root;
}

function runHealthCheck(ctx) {
  const blocks = [];
  const books = ctx.repository.listBooks();
  if (!books.length) blocks.push(emptyText('还没有书。先去"书架"导入一本原生世界书。'));
  for (const book of books) {
    const problems = ctx.validateBook ? ctx.validateBook(book) : [];
    blocks.push(el('div', { class: 'ilb-card' }, [
      el('div', { class: 'ilb-rule-head' }, [
        el('strong', { text: book.name }),
        badge(problems.length ? `${problems.length} 处需要检查` : '结构正常', problems.length ? 'warn' : 'ok'),
      ]),
      problems.length
        ? el('ul', { class: 'ilb-warn-list' }, problems.map((p) => el('li', { text: p })))
        : el('p', { class: 'ilb-sub', text: '没有发现明显问题。' }),
    ]));
  }
  ctx.openOverlay('检查结果', blocks);
}
