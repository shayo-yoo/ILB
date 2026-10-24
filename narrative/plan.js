// narrative/plan.js —— 把"聊天记录 + 编译好的声明"算成一份可渲染的账本（纯函数，零 DOM）。
//
// 这是适配层与纯计算层之间的分界线：
//   - 这里只回答"现在状态是什么、每条消息记下了什么、该注入什么"；
//   - 怎么画、画在哪、调哪个宿主接口，全部在 adapter.js / block.js。
// 这样 plan 可以在 node 里用普通对象测（tests/narrative-adapter.test.mjs），
// 不需要浏览器、不需要 SillyTavern。
//
// 状态是重放出来的（D-0040 第三条）：replay() 从初始状态出发，把每条消息里的事实
// 依次应用，再补一次 tick。没有"在旧状态上改"的路径，所以滑动、删消息、编辑消息
// 之后重新算一遍就是正确答案。

export const MAX_BLOCK_ITEMS = 6;
export const MAX_FACTS_PER_TURN = 3;
export const MAX_PROMPT_CHARS = 1600;

const KIND_LABEL = {
  ok: '✓',
  bad: '✗',
  unknown: '?',
  noop: '·',
};

/** 单条事实 → 界面上的一个小格子。 */
function itemOf(row, describeFact) {
  const fact = row?.fact ?? {};
  const text = describeFact(fact);
  if (!row?.ok) {
    const reason = row?.rejected?.[0]?.reason ?? '规则拒绝了这条事实';
    return { kind: 'bad', mark: KIND_LABEL.bad, text: `未执行：${text}`, reason };
  }
  if (row?.unhandled) {
    return { kind: 'unknown', mark: KIND_LABEL.unknown, text: `未认领：${text}`, reason: '没有规则处理这类事实，状态没有变化' };
  }
  if (Array.isArray(row?.noops) && row.noops.length) {
    return { kind: 'noop', mark: KIND_LABEL.noop, text, reason: row.noops[0].reason ?? '没有实际变化' };
  }
  const changes = Array.isArray(row?.changes) ? row.changes : [];
  const detail = changes.length
    ? changes.map((c) => `${c.var}：${fmt(c.before)} → ${fmt(c.after)}`).slice(0, 2).join('；')
    : '';
  return { kind: 'ok', mark: KIND_LABEL.ok, text, reason: detail };
}

function fmt(value) {
  if (Array.isArray(value)) return `[${value.join('、')}]`;
  if (value === undefined) return '空';
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return String(value);
}

/**
 * 重放整段对话，并保留每条消息之后的状态（用于"第 N 条消息的账本块"）。
 * @param {object} narrative createNarrative(...) 的返回值
 * @param {string[]} entries 每条消息的原文（顺序就是聊天顺序，含系统消息也没关系）
 */
export function replay(narrative, entries = []) {
  let state = narrative.initial();
  const rows = [];
  entries.forEach((entry, index) => {
    const parsed = narrative.parse(typeof entry === 'string' ? entry : String(entry ?? ''));
    const applied = narrative.applyMany(state, parsed.facts);
    state = applied.state;
    // 每条消息末尾补一次 tick：给"冷却 N 轮"这类规则用（与 engine.fold 的语义一致）
    const ticked = narrative.apply(state, { type: 'tick', at: index });
    if (ticked.ok) state = ticked.state;
    rows.push({ index, parsed, log: applied.log, state });
  });
  return { rows, state };
}

/**
 * 拼注入文本：账本正文 + 固定前言与用法说明。
 * 前言必须短——每轮都要花 token 的东西。
 */
export function composePrompt({ narrative, state, messageCount = 0, budget = 600, inject = true }) {
  if (!inject) return '';
  const body = narrative.render(state, { budgetChars: budget });
  if (!body) return '';
  const head = `【账本】按已发生的 ${messageCount} 条对话重放得出；与正文冲突时以账本为准。`;
  const tail = `要改变账本时，在回复最后另起一行写事实标记（每行一条，最多 ${MAX_FACTS_PER_TURN} 条），例如 [[ILB:获得:铜钥匙]]。只写发生的事实，不要写规则、数值计算或效果说明。`;
  let text = [head, body, tail].join('\n');
  if (text.length > MAX_PROMPT_CHARS) {
    text = `${text.slice(0, MAX_PROMPT_CHARS)}\n（账本过长，已截断）`;
  }
  return text;
}

/**
 * 一次算完全部东西：最终状态、状态行、注入文本、每条消息的块、统计。
 * @param {object} narrative
 * @param {string[]} entries
 * @param {{budget?: number, inject?: boolean, maxItems?: number}} options
 */
export function planLedger(narrative, entries = [], options = {}) {
  const { budget = 600, inject = true, maxItems = MAX_BLOCK_ITEMS } = options;
  const { rows, state } = replay(narrative, entries);

  const blocks = [];
  let factCount = 0;
  let okCount = 0;
  let badCount = 0;
  let unhandledCount = 0;
  let unknownCount = 0;

  for (const row of rows) {
    const items = row.log.map((logRow) => itemOf(logRow, narrative.describeFact));
    factCount += items.length;
    okCount += items.filter((x) => x.kind === 'ok' || x.kind === 'noop').length;
    badCount += items.filter((x) => x.kind === 'bad').length;
    unhandledCount += items.filter((x) => x.kind === 'unknown').length;

    const unknowns = (row.parsed.unknowns ?? []).map((u) => ({
      kind: 'unknown',
      mark: KIND_LABEL.unknown,
      text: `看不懂：${u.raw ?? ''}`,
      reason: u.hint ?? '',
    }));
    unknownCount += unknowns.length;

    const all = [...items, ...unknowns];
    if (all.length === 0) continue;

    blocks.push({
      index: row.index,
      items: all.slice(0, maxItems),
      rest: Math.max(0, all.length - maxItems),
      summary: narrative.summary(row.state),
      duplicateNote: row.parsed.duplicates > 0 ? `同一条消息里重复写了 ${row.parsed.duplicates} 条，已忽略` : '',
    });
  }

  return {
    state,
    lines: narrative.lines(state),
    summary: narrative.summary(state),
    prompt: composePrompt({ narrative, state, messageCount: entries.length, budget, inject }),
    blocks,
    totals: { messages: entries.length, facts: factCount, ok: okCount, rejected: badCount, unhandled: unhandledCount, unknown: unknownCount },
    problems: narrative.problems ?? [],
  };
}
