// ui/view-diagnostics.js —— 诊断页：这一轮哪些规则真的会被触发（ILB-6.3）
//
// 这一页只回答一个问题：**哪本书的哪条规则会 / 不会出现，卡在哪一步**。
// 书的启用清单不在这里重复列：那是书架与「酒馆联动」的职责，堆在诊断里只会把真正的结论埋掉。

import { el, hint, badge, button, emptyText, selectBox } from './widgets.js';

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
  activate: '流程激活',
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
  let view = null;
  try {
    view = renderInner(ctx);
  } catch (err) {
    // 这一页出问题也不能给用户一片空白：把原因直接画出来（面板那边只会吞掉异常）。
    return el('div', { class: 'ilb-view' }, [
      el('div', { class: 'ilb-card' }, [
        el('h5', { class: 'ilb-section-title', text: '诊断页出错了' }),
        el('p', { class: 'ilb-error', text: String(err?.message ?? err) }),
        hint('其它页还能用。把这一行报给开发者即可。'),
        button('重画一次', () => ctx.render?.(), { ghost: true }),
      ]),
    ]);
  }
  if (!view || !(view.children?.length > 0) && !String(view.textContent ?? '').trim()) {
    return el('div', { class: 'ilb-view' }, [hint('诊断暂时没有可显示的内容。发一条消息后再回来看看。')]);
  }
  return view;
}

function renderInner(ctx) {
  const { pipeline, repository } = ctx;
  const state = ctx.state ?? {};
  const exitSimulation = () => {
    state.diagSimulated = false;
    ctx.render?.();
  };

  let last = pipeline?.describeLastRun ? pipeline.describeLastRun() : { ran: false };

  if (state.diagSimulated) {
    if (typeof pipeline?.simulate !== 'function') {
      return el('div', { class: 'ilb-view' }, [
        el('div', { class: 'ilb-summary' }, [badge('模拟不可用', 'warn'), el('span', { text: '当前版本的运行时没有提供模拟接口。' })]),
        button('退出模拟', exitSimulation, { ghost: true }),
      ]);
    }
    let simulated = null;
    try {
      simulated = pipeline.simulate(typeof ctx.getContext === 'function' ? ctx.getContext : ctx.getContext);
    } catch (err) {
      simulated = { ok: false, message: String(err?.message ?? err) };
    }
    if (!simulated?.ok) {
      return el('div', { class: 'ilb-view' }, [
        el('div', { class: 'ilb-summary' }, [badge('模拟失败', 'warn'), el('span', { text: simulated?.message ?? '未知原因' })]),
        button('退出模拟', exitSimulation, { ghost: true }),
      ]);
    }
    last = simulated;
  }

  const simulated = last.simulated === true;
  const counts = typeof pipeline?.getSessionCounts === 'function' ? pipeline.getSessionCounts() : new Map();
  // 规则 id → 「书名 / 规则名」：诊断要直接说出是哪本书的哪条规则
  const entryInfo = new Map();
  const bookOrder = [];
  for (const book of repository.listBooks()) {
    bookOrder.push({ id: book.book_id, name: book.name || book.book_id });
    for (const entry of book.entries ?? []) {
      entryInfo.set(String(entry.id), { bookId: book.book_id, bookName: book.name || book.book_id, entryTitle: entry.title || entry.id });
    }
  }
  const bookNameOf = new Map(bookOrder.map((book) => [book.id, book.name]));

  const root = el('div', { class: 'ilb-view' });

  if (last.skipped) {
    root.appendChild(el('div', { class: 'ilb-summary' }, [
      badge('已跳过', 'warn'),
      el('span', { text: last.skipped }),
      hint('总开关在"设置"页。关掉的时候扩展不注入任何东西，但书和规则都还在。'),
    ]));
    return root;
  }

  const rows = (last.diagnostics ?? []).map((row) => ({
    ...row,
    hits: counts.get(String(row.entryId)) ?? 0,
    info: entryInfo.get(String(row.entryId)) ?? null,
  }));
  const passedRows = rows.filter((row) => row.passed);

  if (!last.ran && rows.length === 0) {
    root.appendChild(hint(simulated ? '模拟没有产生可显示的结果（可能是所有书都没参与判定）。' : '还没有跑过。回到聊天界面发一条消息，然后再回到这里。'));
    if (last.error) root.appendChild(el('p', { class: 'ilb-error', text: `上一次出错：${last.error}` }));
    if (simulated) root.appendChild(button('退出模拟', exitSimulation, { ghost: true }));
    return root;
  }

  const onlyTriggered = state.diagOnlyInjected !== false; // 默认只看真正会触发的
  const sortByHits = state.diagSort !== 'order';
  const shown = rows
    .filter((row) => !onlyTriggered || row.passed)
    .sort((a, b) => (sortByHits ? b.hits - a.hits : 0));

  root.appendChild(el('div', { class: 'ilb-summary' }, [
    el('span', { text: `${simulated ? '模拟' : '上一轮'}：${timeText(last.at)}` }),
    simulated ? badge('模拟结果，未真的注入', 'warn') : null,
    badge(`触发 ${passedRows.length} 条规则`, passedRows.length ? 'ok' : 'warn'),
    button(simulated ? '退出模拟' : '模拟注入', () => {
      state.diagSimulated = !simulated;
      ctx.render?.();
    }, { ghost: true, primary: simulated, title: simulated ? '回到真实结果' : '按当前状态完整模拟一次判定：不注入、不写状态' }),
  ].filter(Boolean)));

  if (last.error) root.appendChild(el('p', { class: 'ilb-error', text: `这一步出了错：${last.error}` }));

  root.appendChild(el('div', { class: 'ilb-inline' }, [
    el('strong', { text: onlyTriggered ? `会被触发的规则（${shown.length}）` : `参与判定的规则（${rows.length}，触发 ${passedRows.length}）` }),
    button(onlyTriggered ? '显示没触发的' : '只看会触发的', () => {
      state.diagOnlyInjected = !onlyTriggered;
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

  if (shown.length === 0) {
    root.appendChild(emptyText(onlyTriggered
      ? '这一轮没有规则被触发。点「显示没触发的」可以看每条卡在哪一步。'
      : '这一轮没有任何规则参与判定：可能所有书都被关掉了，也可能书里还没有规则。'));
  } else {
    // 按书分组：一眼看出"这本书会带出哪几条"
    const groups = new Map();
    for (const row of shown) {
      const bookId = row.info?.bookId ?? '_';
      if (!groups.has(bookId)) groups.set(bookId, []);
      groups.get(bookId).push(row);
    }
    const orderedKeys = [
      ...bookOrder.map((book) => book.id).filter((id) => groups.has(id)),
      ...[...groups.keys()].filter((id) => !bookNameOf.has(id)),
    ];
    for (const bookId of orderedKeys) {
      const items = groups.get(bookId);
      const bookName = bookNameOf.get(bookId) ?? '（不存在的书）';
      const triggered = items.filter((row) => row.passed).length;
      root.appendChild(foldCard(ctx, `book:${bookId}`, `${bookName}（触发 ${triggered} / ${items.length} 条）`,
        [el('div', { class: 'ilb-cardlist' }, items.map((row) => ruleRow(row)))],
        [badge(triggered ? '有内容' : '没内容', triggered ? 'ok' : 'warn')]));
    }
  }

  const calls = Array.isArray(last.aiCalls) ? last.aiCalls : [];
  if (calls.length) {
    root.appendChild(foldCard(ctx, 'ai-calls', `AI 点了 ${calls.length} 次逻辑`, [
      el('ul', { class: 'ilb-warn-list' }, calls.map((call) => el('li', {
        text: `${call.name ?? '?'}：${call.ok ? '已执行' : `没执行 —— ${call.reason ?? '未说明'}`}`,
      }))),
    ]));
  }

  const warnings = last.books?.warnings ?? [];
  if (warnings.length) {
    root.appendChild(foldCard(ctx, 'warnings', `提醒（${warnings.length}）`, [
      el('ul', { class: 'ilb-warn-list' }, warnings.map((warning) => el('li', { text: String(warning) }))),
    ]));
  }

  root.appendChild(hint('这一页只是"读"，不会改变任何规则。想单独验证一条规则，去「规则」页点它的「试一句」。'));
  return root;
}

/** 一条规则一行：书名在分组标题里，这里只说规则名、结果和卡在哪一步 */
function ruleRow(row) {
  const entryTitle = row.info?.entryTitle ?? row.entryId;
  return el('div', { class: `ilb-card ilb-diag-rule ${row.passed ? '' : 'ilb-card-off'}` }, [
    el('div', { class: 'ilb-rule-head' }, [
      el('span', { class: 'ilb-rule-titles' }, [el('strong', { text: entryTitle })]),
      badge(row.passed ? '会触发' : '没触发', row.passed ? 'ok' : 'warn'),
      row.hits ? badge(`本次会话 ${row.hits} 次`) : null,
    ].filter(Boolean)),
    el('div', { class: 'ilb-meta' }, [
      el('span', { text: row.passed ? '已进入注入内容' : `卡在：${STAGE_LABEL[row.stage] ?? row.stage ?? '—'}` }),
      row.reason && !row.passed ? el('span', { text: row.reason }) : null,
      row.estimatedTokens ? el('span', { text: `约 ${row.estimatedTokens} 字` }) : null,
    ].filter(Boolean)),
  ]);
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
        ? el('ul', { class: 'ilb-warn-list' }, problems.map((problem) => el('li', { text: problem })))
        : el('p', { class: 'ilb-sub', text: '没有发现明显问题。' }),
    ]));
  }
  ctx.openOverlay('检查结果', blocks);
}
