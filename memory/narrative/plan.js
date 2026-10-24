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
    return {
      kind: 'unknown',
      mark: KIND_LABEL.unknown,
      text: `未认领：${text}`,
      reason: '没有规则处理这类事实，状态没有变化（可到「设置 → 编辑声明」补规则或目录项）',
    };
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
 *
 * 性能：带一个可选的增量缓存。命中时直接复用前缀状态，只从第一条变化的消
 * 息开始重算——楼层越长，这个差别越明显（聊天记录通常几十到几百条）。
 * 缓存按"每条消息的原文指纹"判断是否还能用，所以编辑、滑动、删除之后
 * 只会重算受影响的那一段，不会把旧状态当成新状态。
 *
 * @param {object} narrative createNarrative(...) 的返回值
 * @param {string[]} entries 每条消息的原文（顺序就是聊天顺序，含系统消息也没关系）
 * @param {{rows: Array<{fp: string, row: object}>}|null} cache 上一次的返回值里的 cache
 */
export function replay(narrative, entries = [], cache = null, options = {}) {
  const list = entries.map((entry) => (typeof entry === 'string' ? entry : String(entry ?? '')));
  const prev = cache && Array.isArray(cache.rows) ? cache.rows : [];
  const startIndex = Math.max(0, Math.min(list.length, Number(options.startIndex) || 0));
  const hasInitial = Boolean(options.initial && options.initial.vars);

  // 有检查点时从它之后开始；否则靠缓存找第一条变化的消息，前面整段复用。
  let start = startIndex;
  if (!hasInitial) {
    start = 0;
    while (start < list.length) {
      const hit = prev[start];
      if (!hit || hit.fp !== fingerprint(list[start])) break;
      start += 1;
    }
  }

  let state = hasInitial
    ? options.initial
    : start > 0 && prev[start - 1] && prev[start - 1].row
      ? prev[start - 1].row.state
      : narrative.initial();
  const rows = hasInitial ? [] : prev.slice(0, start).map((entry) => entry.row);

  for (let index = start; index < list.length; index += 1) {
    const parsed = narrative.parse(list[index]);
    const applied = narrative.applyMany(state, parsed.facts);
    state = applied.state;
    // 每条消息末尾补一次 tick：给"冷却 N 轮"这类规则用（与 engine.fold 的语义一致）
    const ticked = narrative.apply(state, { type: 'tick', at: index });
    if (ticked.ok) state = ticked.state;
    const row = { index, parsed, log: applied.log, state };
    rows.push(row);
    prev[index] = { fp: fingerprint(list[index]), row };
  }
  // 消息变短（删楼层）时，把缓存尾巴也剪掉，否则下一轮会拿旧行冒充。
  prev.length = list.length;

  return { rows, state, cache: { rows: prev } };
}

/** 简单的字符串指纹（djb2）。只用来判断"这条消息变没变"，不做安全用途。 */
function fingerprint(text) {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return `${text.length}:${hash}`;
}

/**
 * 拼注入文本：账本正文 + 固定前言与用法说明。
 * 前言必须短——每轮都要花 token 的东西。
 */
export function composePrompt({ narrative, state, messageCount = 0, budget = 600, inject = true, deltaLines = [] }) {
  if (!inject) return '';
  const body = narrative.render(state, { budgetChars: budget });
  if (!body) return '';
  const head = `【账本】按已发生的 ${messageCount} 条对话重放得出；与正文冲突时以账本为准。`;
  const delta = Array.isArray(deltaLines) && deltaLines.length
    ? `本轮变化（供你润色与理解，不需要复述）：\n${deltaLines.join('\n')}`
    : '';
  const tail = `要改变账本时，在回复最后另起一行写事实标记（每行一条，最多 ${MAX_FACTS_PER_TURN} 条），例如 [[ILB:获得:铜钥匙]]。只写发生的事实，不要写规则、数值计算或效果说明。`;
  let text = [head, delta, body, tail].filter(Boolean).join('\n');
  if (text.length > MAX_PROMPT_CHARS) {
    text = `${text.slice(0, MAX_PROMPT_CHARS)}\n（账本过长，已截断）`;
  }
  return text;
}

/**
 * 一次算完全部东西：最终状态、状态行、注入文本、每条消息的块、统计。
 * @param {object} narrative
 * @param {string[]} entries
 * @param {{
 *   budget?: number, inject?: boolean, maxItems?: number,
 *   cache?: object, initial?: object, startIndex?: number,
 *   baseTotals?: object, withDelta?: boolean
 * }} options
 */
export function planLedger(narrative, entries = [], options = {}) {
  const {
    budget = 600,
    inject = true,
    maxItems = MAX_BLOCK_ITEMS,
    cache = null,
    initial = null,
    startIndex = 0,
    baseTotals = null,
    withDelta = true,
  } = options;
  const { rows, state, cache: nextCache } = replay(narrative, entries, cache, { initial, startIndex });

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

  // 最后一条消息带来的变化：给模型一段"改前 → 改后"，让它按事实润色而不是自己算。
  const beforeLast = rows.length >= 2
    ? rows[rows.length - 2].state
    : (initial && initial.vars ? initial : narrative.initial());
  const deltaLines = withDelta ? diffLines(narrative, beforeLast, state) : [];

  const base = baseTotals ?? {};
  const totals = {
    messages: entries.length,
    facts: (base.facts ?? 0) + factCount,
    ok: (base.ok ?? 0) + okCount,
    rejected: (base.rejected ?? 0) + badCount,
    unhandled: (base.unhandled ?? 0) + unhandledCount,
    unknown: (base.unknown ?? 0) + unknownCount,
    windowFacts: factCount,
  };

  return {
    state,
    lines: narrative.lines(state),
    summary: narrative.summary(state),
    deltaLines,
    prompt: composePrompt({ narrative, state, messageCount: entries.length, budget, inject, deltaLines }),
    blocks,
    totals,
    problems: narrative.problems ?? [],
    cache: nextCache,
    rows,
    startIndex,
  };
}

/** 前后两份状态的差异，最多 max 行；只列真正变了的变量。 */
export function diffLines(narrative, before, after, max = 4) {
  const lines = [];
  const schema = narrative.schema;
  if (!schema || !before || !after) return lines;
  for (const name of schema.order) {
    const decl = schema.vars.get(name);
    if (decl.private) continue;
    const a = before.vars[name];
    const b = after.vars[name];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    lines.push(`${decl.label ?? name}：${short(a)} → ${short(b)}`);
    if (lines.length >= max) break;
  }
  return lines;
}

function short(value) {
  if (Array.isArray(value)) return value.length ? value.join('、') : '空';
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    return keys.length ? keys.map((k) => `${k} ${value[k]}`).join('、') : '空';
  }
  if (value === '') return '空';
  return String(value);
}

/** 统计一段行窗口里的事实/拒绝/未认领/看不懂，叠加到已有累计值上（检查点用）。 */
export function totalsFromRows(narrative, rows, base = {}) {
  let facts = 0;
  let ok = 0;
  let rejected = 0;
  let unhandled = 0;
  let unknown = 0;
  for (const row of rows) {
    for (const logRow of row.log ?? []) {
      const item = itemOf(logRow, narrative.describeFact);
      facts += 1;
      if (item.kind === 'ok' || item.kind === 'noop') ok += 1;
      else if (item.kind === 'bad') rejected += 1;
      else if (item.kind === 'unknown') unhandled += 1;
    }
    unknown += (row.parsed?.unknowns ?? []).length;
  }
  return {
    messages: (base.messages ?? 0) + rows.length,
    facts: (base.facts ?? 0) + facts,
    ok: (base.ok ?? 0) + ok,
    rejected: (base.rejected ?? 0) + rejected,
    unhandled: (base.unhandled ?? 0) + unhandled,
    unknown: (base.unknown ?? 0) + unknown,
  };
}
