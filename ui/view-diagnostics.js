// ui/view-diagnostics.js —— 诊断页：上一轮每条规则为什么出现 / 没出现（ILB-6.3）

import { el, hint, badge, button, card, emptyText, selectBox } from './widgets.js';
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

/** 可折叠卡片：折叠状态存 ctx.state.diagFolds（只活在这一页里，不落盘） */
function foldCard(ctx, key, title, nodes, extra = []) {
  const state = ctx.state ?? {};
  if (!(state.diagFolds instanceof Set)) state.diagFolds = new Set();
  const folded = state.diagFolds.has(key);
  const head = el('div', { class: 'ilb-rule-head' }, [
    el('h5', { class: 'ilb-section-title', text: title }),
    ...extra,
    button(folded ? '展开 ▾' : '收起 ▴', () => {
      if (folded) state.diagFolds.delete(key);
      else state.diagFolds.add(key);
      ctx.render?.();
    }, { ghost: true }),
  ]);
  return el('div', { class: 'ilb-card' }, folded ? [head] : [head, ...nodes].filter(Boolean));
}

export function renderDiagnostics(ctx) {
  const { pipeline, repository } = ctx;
  const state = ctx.state ?? {};
  let last = pipeline?.describeLastRun ? pipeline.describeLastRun() : { ran: false };
  if (state.diagSimulated && typeof pipeline?.simulate !== 'function') {
    return el('div', { class: 'ilb-view' }, [
      el('div', { class: 'ilb-summary' }, [badge('模拟不可用', 'warn'), el('span', { text: '当前版本的运行时没有提供模拟接口。' })]),
      button('退出模拟', () => { state.diagSimulated = false; ctx.render?.(); }, { ghost: true }),
    ]);
  }

  if (state.diagSimulated) {
    let simulatedResult = null;
    try {
      // 传函数而不是结果：管道内部自己决定何时取上下文，拿不到时给出人话
      simulatedResult = pipeline.simulate(typeof ctx.getContext === 'function' ? ctx.getContext : ctx.getContext);
    } catch (err) {
      simulatedResult = { ok: false, message: String(err?.message ?? err) };
    }
    if (simulatedResult?.ok) last = simulatedResult;
    else {
      return el('div', { class: 'ilb-view' }, [
        el('div', { class: 'ilb-summary' }, [badge('模拟失败', 'warn'), el('span', { text: simulatedResult?.message ?? '未知原因' })]),
        button('退出模拟', () => { state.diagSimulated = false; ctx.render?.(); }, { ghost: true }),
      ]);
    }
  }
  const simulated = last.simulated === true;
  const counts = typeof pipeline?.getSessionCounts === 'function' ? pipeline.getSessionCounts() : new Map();
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
    root.appendChild(hint(simulated ? '模拟没有产生可显示的结果（可能是所有书都没参与判定）。' : '还没有跑过。回到聊天界面发一条消息，然后再回到这里。'));
    if (last.error) root.appendChild(el('p', { class: 'ilb-error', text: `上一次出错：${last.error}` }));
    if (simulated) {
      root.appendChild(button('返回真实诊断', () => { state.diagSimulated = false; ctx.render?.(); }, { ghost: true }));
    }
      return root;
  }

  const budget = last.budget ?? { limit: 0, used: 0, dropped: 0 };
  root.appendChild(el('div', { class: 'ilb-summary' }, [
    el('span', { text: `${simulated ? '模拟运行' : '上一次运行'}：${timeText(last.at)}` }),
    simulated ? badge('模拟结果，未真的注入', 'warn') : null,
    badge(`注入 ${last.activated?.length ?? 0} 条`, (last.activated?.length ?? 0) ? 'ok' : 'warn'),
    el('span', { text: `预算 ${budget.used} / ${budget.limit} 字` }),
    el('span', { text: `在场书 ${last.books?.active?.length ?? 0} 本` }),
    button(simulated ? '退出模拟' : '模拟注入', () => {
      state.diagSimulated = !simulated;
      ctx.render?.();
    }, { ghost: true, primary: simulated, title: '按当前状态完整模拟一次判定：不注入、不写状态' }),
  ].filter(Boolean)));

  if (last.error) root.appendChild(el('p', { class: 'ilb-error', text: `这一步出了错：${last.error}` }));

  root.appendChild(renderHostCard(ctx, last));
  const booksCard = renderBooksCard(ctx, last);
  if (booksCard) root.appendChild(booksCard);
  else {
    const fallbackInactive = last.books?.inactive ?? [];
    if (fallbackInactive.length) {
      const bookNames = new Map(repository.listBooks().map((b) => [b.book_id, b.name]));
      root.appendChild(foldCard(ctx, 'inactive', `这轮没被启用的书（${fallbackInactive.length}）`,
        [el('ul', { class: 'ilb-warn-list' }, fallbackInactive.map((b) => {
          const id = typeof b === 'string' ? b : b.book_id;
          return el('li', { text: `${bookNames.get(id) ?? id}：${last.books?.reasons?.[id] ?? '未说明原因'}` });
        }))]));
    }
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
    const onlyInjected = state.diagOnlyInjected === true;
    const sortByHits = state.diagSort !== 'order';
    const shown = rows
      .map((r) => ({ ...r, hits: counts.get(String(r.entryId)) ?? 0 }))
      .filter((r) => !onlyInjected || r.passed)
      .sort((a, b) => (sortByHits ? b.hits - a.hits : 0));
    root.appendChild(el('div', { class: 'ilb-inline' }, [
      el('strong', { text: `共 ${rows.length} 条参与判定，${passed} 条出现` }),
      button(onlyInjected ? '显示全部判定' : '仅显示上一轮参与注入', () => {
        state.diagOnlyInjected = !onlyInjected;
        ctx.render?.();
      }, { ghost: true }),
      selectBox(sortByHits ? 'hits' : 'order', [
        { value: 'order', label: '按判定顺序' },
        { value: 'hits', label: '按触发次数（本次会话）' },
      ], (value) => {
        state.diagSort = value === 'hits' ? 'hits' : 'order';
        ctx.render?.();
      }),
      button('检查所有书的结构', () => runHealthCheck(ctx), { ghost: true }),
      button('?', () => ctx.showHelp('diagnostics'), { ghost: true, title: '这一页怎么看' }),
    ]));

    const list = el('div', { class: 'ilb-cardlist' });
    for (const r of shown) {
      list.appendChild(el('div', { class: `ilb-card ${r.passed ? '' : 'ilb-card-off'}` }, [
        el('div', { class: 'ilb-rule-head' }, [
          el('span', { class: 'ilb-rule-titles' }, [el('strong', { text: titles.get(r.entryId) ?? r.entryId })]),
          badge(r.passed ? '出现' : '没出现', r.passed ? 'ok' : 'warn'),
          r.hits ? badge(`本轮会话命中 ${r.hits} 次`) : null,
        ].filter(Boolean)),
        el('div', { class: 'ilb-meta' }, [
          el('span', { text: `卡在：${STAGE_LABEL[r.stage] ?? r.stage ?? '—'}` }),
          el('span', { text: r.reason ?? '' }),
          r.estimatedTokens ? el('span', { text: `约 ${r.estimatedTokens} 字` }) : null,
        ]),
      ]));
    }
    if (shown.length === 0) list.appendChild(emptyText('这一轮没有规则真的被注入。'));
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

  const nodes = [];
  const line = typeof summary === 'string' ? summary : summary?.line;
  nodes.push(el('p', { class: 'ilb-sub', text: line || '还没读到酒馆上下文（状态未知）' }));
  if (desc && !desc.moduleLoaded) {
    nodes.push(hint(`读不到酒馆的世界书模块${desc.error ? `（${desc.error}）` : ''}：全局世界书与角色额外书暂时按手动控制，其余来源仍然可用。`));
  }
  const sources = host?.sources ?? [];
  if (sources.length) {
    nodes.push(el('p', {
      class: 'ilb-sub',
      text: `读到的来源：${sources.map((s) => `${HOST_SOURCE_LABEL[s.kind] ?? s.kind}「${s.name}」`).join('、')}`,
    }));
  } else if (host) {
    nodes.push(hint('这一轮没有读到任何原生世界书来源（角色/聊天/Persona 都没有关联原生书）。'));
  }
  for (const kind of host?.unsupported ?? []) {
    nodes.push(hint(`${HOST_SOURCE_LABEL[kind] ?? kind}：当前宿主版本不支持自动识别（没有可靠的公开接口，ILB 不会去读页面 DOM 猜）。`));
  }
  for (const w of host?.warnings ?? []) nodes.push(hint(String(w)));

  if (ids.length) {
    const di = last.books?.doubleInject ?? null;
    const dupIds = Array.isArray(di?.duplicates)
      ? di.duplicates
      : ids.filter((id) => details[id].enabled && (details[id].matched?.length ?? 0) > 0);
    const skippedNames = (di?.skipped ?? []).map((id) => nameOf.get(id) ?? id);
    if (skippedNames.length) {
      nodes.push(hint(`按设置「跳过 ILB 这边的副本」，这一轮没有注入：${skippedNames.join('、')}。原生世界书仍由酒馆注入；想让两边都注入，去设置把这一项改成「照常注入」。`));
    } else if ((di?.policy ?? 'warn') === 'warn' && dupIds.length > 0) {
      nodes.push(hint(`有 ${dupIds.length} 本映射到原生世界书的书会被酒馆和 ILB 各注入一次（同源双重注入）。内容重复的话，在酒馆里关掉原生那本，或去设置改成「跳过 ILB 这边的副本」。`));
    }
  } else {
    nodes.push(hint('上一次运行没有留下每本书的启用原因（还没跑过，或者是老版本的数据）。'));
  }
  if (nodes.length === 0) nodes.push(hint('没有可显示的酒馆联动信息。'));
  return foldCard(ctx, 'host', '酒馆联动', nodes);
}

/** 参与判定的世界书：单独一张可折叠卡片，回答"这一轮到底哪些书进了判定、为什么" */
function renderBooksCard(ctx, last) {
  const details = last.books?.details ?? {};
  const ids = Object.keys(details);
  if (ids.length === 0) return null;
  const books = ctx.repository.listBooks();
  const nameOf = new Map(books.map((b) => [b.book_id, b.name]));
  const enabled = ids.filter((id) => details[id].enabled);
  const rows = ids.map((id) => el('li', {
    text: `${nameOf.get(id) ?? id}：${details[id].enabled ? '启用' : '停用'} —— ${details[id].reason ?? RULE_LABEL[details[id].rule] ?? details[id].rule}`,
  }));
  return foldCard(ctx, 'books', `参与判定的世界书（${ids.length} 本，启用 ${enabled.length}）`,
    [el('ul', { class: 'ilb-warn-list' }, rows)]);
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
