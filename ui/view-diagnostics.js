// ui/view-diagnostics.js —— 诊断页：上一轮每条规则为什么出现 / 没出现（ILB-6.3）

import { el, hint, badge, button, card, emptyText } from './widgets.js';
import { HOST_SOURCE_LABEL, summarizeHostContext } from '../core/host-context.js';

const STAGE_LABEL = {
  trigger: '触发词',
  when: '附加条件',
  timed: '时效',
  probability: '概率',
  group: '同组择一',
  budget: '预算',
  chain: '连锁',
  logic: '判定流程',
  call: 'AI 调用',
  book: '书没启用',
  disabled: '规则被关掉',
};

// 和 core/resolve-books.js 里的 rule 一一对应：这里只负责翻译给人看。
const RULE_LABEL = {
  provider: '由扩展点决定',
  'force-off': '强制停用覆盖',
  'force-on': '强制启用覆盖',
  always: '始终启用',
  auto: '自动跟随酒馆',
  'auto-candidate': '只找到同名书，没有自动启用',
  'auto-unknown': '读不到宿主状态，先按手动',
  manual: '手动控制',
  'legacy-character': '老行为：按角色卡绑定的书名',
  'legacy-unknown': '读不到角色卡绑定，按手动',
};

function timeText(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
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
      return root;
  }

  if (!last.ran) {
    root.appendChild(hint('还没有跑过。回到聊天界面发一条消息，然后再回到这里。'));
    if (last.error) root.appendChild(el('p', { class: 'ilb-error', text: `上一次出错：${last.error}` }));
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

  root.appendChild(renderHostCard(ctx, last));

  const inactive = last.books?.inactive ?? [];
  const bookNames = new Map(repository.listBooks().map((b) => [b.book_id, b.name]));
  if (inactive.length) {
    root.appendChild(el('div', { class: 'ilb-card' }, [
      el('h5', { class: 'ilb-section-title', text: '这轮没被启用的书' }),
      el('ul', { class: 'ilb-warn-list' }, inactive.map((b) => {
        const id = typeof b === 'string' ? b : b.book_id;
        return el('li', { text: `${bookNames.get(id) ?? id}：${last.books?.reasons?.[id] ?? '未说明原因'}` });
      })),
    ]));
  }

  const calls = Array.isArray(last.aiCalls) ? last.aiCalls : [];
  if (calls.length) {
    root.appendChild(el('div', { class: 'ilb-card' }, [
      el('h5', { class: 'ilb-section-title', text: `AI 在正文里点了 ${calls.length} 次逻辑` }),
      el('ul', { class: 'ilb-warn-list' }, calls.map((c) => el('li', {
        text: `${c.name ?? '?'}：${c.ok ? '已执行' : `没执行 —— ${c.reason ?? '未说明'}`}`,
      }))),
      hint('AI 只能通过这里改聊天变量，改不了 SillyTavern 或扩展的设置。不想让它调用就去设置页关掉。'),
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

  root.appendChild(hint('这一页只是"读"，不会改变任何规则。想验证单条规则，去"规则"页点它的"试一句"。'));
  return root;
}

function renderHostCard(ctx, last) {
  const books = ctx.repository.listBooks();
  const nameOf = new Map(books.map((b) => [b.book_id, b.name]));
  const host = last.books?.hostContext ?? null;
  const summary = last.host
    ?? (typeof ctx.getHostContext === 'function' ? summarizeHostContext(ctx.getHostContext()) : null);
  const details = last.books?.details ?? {};
  const ids = Object.keys(details);
  let desc = null;
  try {
    desc = typeof ctx.describeHost === 'function' ? ctx.describeHost() : null;
  } catch {
    desc = null;
  }

  const nodes = [el('h5', { class: 'ilb-section-title', text: '酒馆联动' })];
  nodes.push(el('p', { class: 'ilb-sub', text: summary?.line ?? '还没读到酒馆上下文（状态未知）' }));
  if (desc && !desc.moduleLoaded) {
    nodes.push(hint(`读不到酒馆的世界书模块${desc.error ? `（${desc.error}）` : ''}：全局世界书与角色额外书暂时按手动控制，其余来源仍然可用。`));
  }
  const sources = host?.sources ?? [];
  if (sources.length) {
    nodes.push(el('p', {
      class: 'ilb-sub',
      text: `读到的来源：${sources.map((s) => `${HOST_SOURCE_LABEL[s.kind] ?? s.kind}「${s.name}」`).join('、')}`,
    }));
  }
  for (const kind of host?.unsupported ?? []) {
    nodes.push(hint(`${HOST_SOURCE_LABEL[kind] ?? kind}：当前宿主版本不支持自动识别（没有可靠的公开接口，ILB 不会去读页面 DOM 猜）。`));
  }
  for (const w of host?.warnings ?? []) nodes.push(hint(String(w)));

  if (ids.length) {
    nodes.push(el('ul', { class: 'ilb-warn-list' }, ids.map((id) => el('li', {
      text: `${nameOf.get(id) ?? id}：${details[id].enabled ? '启用' : '停用'} —— ${details[id].reason ?? RULE_LABEL[details[id].rule] ?? details[id].rule}`,
    }))));
    const doubleCount = ids.filter((id) => details[id].enabled && (details[id].matched?.length ?? 0) > 0).length;
    if (doubleCount > 0) {
      nodes.push(hint(`有 ${doubleCount} 本映射到原生世界书的书会被酒馆和 ILB 各注入一次（同源双重注入）。内容重复的话，在酒馆里关掉原生那本，或把这里改成手动控制。`));
    }
  } else {
    nodes.push(hint('上一次运行没有留下每本书的启用原因（还没跑过，或者是老版本的数据）。'));
  }
  return el('div', { class: 'ilb-card' }, nodes);
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
