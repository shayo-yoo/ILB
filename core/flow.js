// core/flow.js —— 判定流程（可视化节点）的模型与执行（ILB-4.11）
//
// 一条规则默认只靠"触发词 + 注入参数"工作，跟原生世界书一样。
// 当用户给这条规则画了流程（logic.nodes 非空），流程就会**追加**在关键词之后判定。
//
// 节点从上往下一层层执行：每个判断节点都有「成立时」与「不成立时」两条分支，
// 两条分支里可以继续放节点，所以它是棵树，不是一张需要连线的画布。
// 这样做的好处：用户永远只面对"下一步做什么"，不需要理解端口和连线。

import { containsNeedle, compileRegex, safeRegexTest } from './text-match.js';
import { GOTO_ON_LIMIT } from './settings-defaults.js';

export const FLOW_KINDS = ['test', 'judge', 'compare', 'define', 'calc', 'random', 'add', 'remember', 'activate', 'goto', 'call', 'pass', 'fail'];

export const FLOW_KIND_LABEL = {
  test: '检测',
  judge: '判定',
  compare: '比较',
  define: '定义',
  calc: '计算',
  random: '随机数',
  add: '添加',
  remember: '记住',
  activate: '激活条目',
  goto: '跳转',
  call: '调用逻辑',
  pass: '通过（结束）',
  fail: '不通过（结束）',
};

export const FLOW_KIND_HINT = {
  test: '看一句话里有没有东西，或者看某条规则这轮在不在',
  judge: '把几个条件放在一起，全部满足或任一满足',
  compare: '比两个值的大小（变量、数字、文本都行）',
  define: '给一个变量起个值，后面可以拿来比较或计算',
  calc: '用两个值算出第三个值存进变量',
  add: '往这条规则的正文后面追加一段话',
  remember: '把这个值记进这张聊天的状态，下一轮还在（写 {{ILB:chat.名字}} 就能读）',
  activate: '把另一条规则也拉进这一轮，像它自己出现一样',
  goto: '跳到这个流程里的另一个节点，从那里继续往下（可以往回跳，次数有上限）',
  call: '调用另一条独立逻辑，把它的结果并进来',
  pass: '到此为止，这条规则出现',
  fail: '到此为止，这条规则不出现',
};

export const CONDITION_KINDS = ['contains', 'regex', 'active', 'messages', 'var'];

export const CONDITION_KIND_LABEL = {
  contains: '最近几条消息里有某个词',
  regex: '最近的文本匹配某个正则',
  active: '另一条规则这轮已经出现',
  messages: '已经聊了至少几条消息',
  var: '变量有值',
};

export const COMPARE_OPS = ['>', '>=', '<', '<=', '==', '!='];
export const CALC_OPS = ['+', '-', '*', '/', 'min', 'max'];
export const OPERAND_TYPES = ['var', 'number', 'text'];
export const OPERAND_TYPE_LABEL = { var: '变量', number: '数字', text: '文本' };

export const MAX_NODES = 80;
export const MAX_DEPTH = 8;
export const MAX_STEPS = 200;

let idCounter = 0;

function newNodeId() {
  idCounter += 1;
  return `n-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

function operand(type = 'text', value = '') {
  if (type === 'var') return { type: 'var', name: String(value ?? '') };
  if (type === 'number') return { type: 'number', value: Number(value) || 0 };
  return { type: 'text', value: String(value ?? '') };
}

export function makeCondition(what = 'contains') {
  const base = { id: newNodeId(), what };
  if (what === 'contains') return { ...base, text: '', within: 5, negate: false };
  if (what === 'regex') return { ...base, pattern: '', flags: 'i', negate: false };
  if (what === 'active') return { ...base, entryId: '', negate: false };
  if (what === 'messages') return { ...base, count: 1 };
  return { ...base, name: '', negate: false };
}

export function makeNode(kind = 'test', overrides = {}) {
  const base = { id: newNodeId(), kind };
  if (kind === 'test') return { ...base, condition: makeCondition('contains'), then: [], else: [], ...overrides };
  if (kind === 'judge') return { ...base, mode: 'all', conditions: [makeCondition('contains')], then: [], else: [], ...overrides };
  if (kind === 'compare') {
    return { ...base, left: operand('var', ''), op: '>', right: operand('number', 0), then: [], else: [], ...overrides };
  }
  if (kind === 'calc') {
    return { ...base, target: '', op: '+', left: operand('var', ''), right: operand('number', 1), ...overrides };
  }
  if (kind === 'random') {
    return { ...base, target: '', min: 1, max: 6, integer: true, persist: true, ...overrides };
  }
  if (kind === 'define') return { ...base, name: '', value: operand('text', ''), ...overrides };
  if (kind === 'add') return { ...base, text: '', ...overrides };
  if (kind === 'remember') return { ...base, name: '', value: operand('text', ''), ...overrides };
  if (kind === 'activate') return { ...base, entryId: '', ...overrides };
  if (kind === 'goto') return { ...base, target: '', max: 20, onLimit: 'stop', ...overrides };
  if (kind === 'call') return { ...base, logicId: '', ...overrides };
  return { ...base, ...overrides };
}

function normalizeOperand(raw, fallback) {
  if (!raw || typeof raw !== 'object') return fallback;
  if (raw.type === 'var') return { type: 'var', name: String(raw.name ?? '') };
  if (raw.type === 'number') return { type: 'number', value: Number(raw.value) || 0 };
  return { type: 'text', value: String(raw.value ?? '') };
}

function normalizeCondition(raw) {
  const what = CONDITION_KINDS.includes(raw?.what) ? raw.what : 'contains';
  const cond = { id: String(raw?.id ?? newNodeId()), what };
  if (what === 'contains') {
    cond.text = String(raw?.text ?? '');
    cond.within = clampInt(raw?.within, 1, 50, 5);
    cond.negate = raw?.negate === true;
  } else if (what === 'regex') {
    cond.pattern = String(raw?.pattern ?? '');
    cond.flags = String(raw?.flags ?? 'i').slice(0, 4);
    cond.negate = raw?.negate === true;
  } else if (what === 'active') {
    cond.entryId = String(raw?.entryId ?? '');
    cond.negate = raw?.negate === true;
  } else if (what === 'messages') {
    cond.count = clampInt(raw?.count, 0, 10000, 1);
  } else {
    cond.name = String(raw?.name ?? '');
    cond.negate = raw?.negate === true;
  }
  return cond;
}

function normalizeNode(raw, depth) {
  if (!raw || typeof raw !== 'object') return null;
  if (depth > MAX_DEPTH) return null;
  const kind = FLOW_KINDS.includes(raw.kind) ? raw.kind : 'test';
  const node = { id: String(raw.id ?? newNodeId()), kind };
  if (kind === 'test') node.condition = normalizeCondition(raw.condition ?? {});
  else if (kind === 'judge') {
    node.mode = raw.mode === 'any' ? 'any' : 'all';
    const list = Array.isArray(raw.conditions) ? raw.conditions.slice(0, 8) : [];
    node.conditions = list.map((c) => normalizeCondition(c));
    if (node.conditions.length === 0) node.conditions.push(normalizeCondition({ what: 'contains' }));
  } else if (kind === 'compare') {
    node.left = normalizeOperand(raw.left, operand('var', ''));
    node.op = COMPARE_OPS.includes(raw.op) ? raw.op : '>';
    node.right = normalizeOperand(raw.right, operand('number', 0));
  } else if (kind === 'calc') {
    node.target = String(raw.target ?? '');
    node.op = CALC_OPS.includes(raw.op) ? raw.op : '+';
    node.left = normalizeOperand(raw.left, operand('var', ''));
    node.right = normalizeOperand(raw.right, operand('number', 1));
    node.persist = raw.persist === true;
  } else if (kind === 'random') {
    // 范围内随机（ILB-4.19）：同一楼层重放必须得到同一个数，种子来自「聊天 + 消息数 + 节点」
    node.target = String(raw.target ?? '');
    node.min = clampInt(raw.min, -999999, 999999, 1);
    node.max = clampInt(raw.max, -999999, 999999, 6);
    if (node.max < node.min) node.max = node.min;
    node.integer = raw.integer !== false;
    node.persist = raw.persist !== false;
  } else if (kind === 'define') {
    node.name = String(raw.name ?? '');
    node.value = normalizeOperand(raw.value, operand('text', ''));
  } else if (kind === 'add') {
    node.text = String(raw.text ?? '');
  } else if (kind === 'remember') {
    node.name = String(raw.name ?? '');
    node.value = normalizeOperand(raw.value, operand('text', ''));
  } else if (kind === 'activate') {
    node.entryId = String(raw.entryId ?? '');
  } else if (kind === 'goto') {
    // 跳转（ILB-4.17）：目标节点 id 在同一条流程里；循环上限与到限后的做法都由用户设
    node.target = String(raw.target ?? '');
    node.max = clampInt(raw.max, 1, 1000, 20);
    node.onLimit = GOTO_ON_LIMIT.includes(raw.onLimit) ? raw.onLimit : 'stop';
  } else if (kind === 'call') {
    // 调用逻辑（ILB-4.18）：把另一条独立逻辑当成一个子步骤跑
    node.logicId = String(raw.logicId ?? '');
  }

  if (kind === 'test' || kind === 'judge' || kind === 'compare') {
    node.then = normalizeNodes(raw.then, depth + 1);
    node.else = normalizeNodes(raw.else, depth + 1);
  }
  return node;
}

function normalizeNodes(list, depth) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const raw of list) {
    if (out.length >= MAX_NODES) break;
    const node = normalizeNode(raw, depth);
    if (node) out.push(node);
  }
  return out;
}

/** 把存储里的流程洗成安全、可执行的形状。空流程返回 `{ mode:'and', nodes:[] }`。 */
export function normalizeFlow(raw) {
  const mode = raw?.mode === 'only' ? 'only' : 'and';
  return { mode, nodes: normalizeNodes(raw?.nodes, 0) };
}

/** 这条规则是否真的画了流程。空流程 = 完全按原生那套工作。 */
export function hasFlow(entry) {
  return Array.isArray(entry?.logic?.nodes) && entry.logic.nodes.length > 0;
}

export function countFlowNodes(nodes) {
  let n = 0;
  for (const node of Array.isArray(nodes) ? nodes : []) {
    n += 1;
    if (Array.isArray(node?.then)) n += countFlowNodes(node.then);
    if (Array.isArray(node?.else)) n += countFlowNodes(node.else);
  }
  return n;
}

function clampInt(value, min, max, fallback) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function numOrNull(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const s = String(value ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function operandValue(op, vars) {
  if (!op || typeof op !== 'object') return '';
  if (op.type === 'var') {
    const key = String(op.name ?? '');
    return vars[key] ?? '';
  }
  if (op.type === 'number') return Number(op.value) || 0;
  return String(op.value ?? '');
}

/** 条件求值。返回 `{passed, reason}`，reason 是给人看的一句话。 */
export function evalCondition(cond, ctx) {
  const what = cond?.what ?? 'contains';
  if (what === 'contains') {
    const text = String(cond.text ?? '');
    if (!text) return { passed: true, reason: '没有填写要检测的词，视为通过' };
    const within = clampInt(cond.within, 1, 50, 5);
    const hay = recentText(ctx, within);
    const hit = containsNeedle(hay, text, { caseSensitive: false, wholeWords: false });
    const passed = cond.negate === true ? !hit : hit;
    return {
      passed,
      reason: `${cond.negate === true ? '不应出现' : '应出现'}「${text}」：${hit ? '出现了' : '没出现'}（最近 ${within} 条）`,
    };
  }
  if (what === 'regex') {
    const pattern = String(cond.pattern ?? '');
    if (!pattern) return { passed: true, reason: '没有填写正则，视为通过' };
    const re = compileRegex({ source: pattern, flags: cond.flags ?? 'i' });
    if (!re) return { passed: false, reason: `正则写错了：「${pattern}」` };
    const hit = safeRegexTest(re, recentText(ctx, 5));
    const passed = cond.negate === true ? !hit : hit;
    return { passed, reason: `正则 /${pattern}/：${hit ? '匹配' : '不匹配'}` };
  }
  if (what === 'active') {
    const id = String(cond.entryId ?? '');
    if (!id) return { passed: true, reason: '没有选择要引用的规则，视为通过' };
    const hit = ctx.activated instanceof Set ? ctx.activated.has(id) : false;
    const passed = cond.negate === true ? !hit : hit;
    return { passed, reason: `另一条规则${hit ? '已经' : '还没有'}出现` };
  }
  if (what === 'messages') {
    const need = clampInt(cond.count, 0, 10000, 1);
    const count = Math.max(0, Math.trunc(Number(ctx.messageCount) || 0));
    return { passed: count >= need, reason: `现在第 ${count} 条消息，要求至少 ${need} 条` };
  }
  const key = String(cond.name ?? '');
  const value = ctx.vars?.[key];
  const has = value !== undefined && value !== null && value !== '' && value !== false && value !== 0;
  const passed = cond.negate === true ? !has : has;
  return { passed, reason: `变量 ${key || '（未命名）'} ${has ? '有值' : '没有值'}` };
}

function recentText(ctx, within) {
  const parts = [];
  const messages = Array.isArray(ctx.messages) ? ctx.messages : [];
  const n = Math.max(1, Math.trunc(within) || 1);
  for (const msg of messages.slice(-n)) {
    parts.push(String(msg?.content ?? ''));
  }
  if (ctx.userInput) parts.push(String(ctx.userInput));
  if (parts.length === 0 && ctx.text) parts.push(String(ctx.text));
  return parts.join('\n');
}

/** 比较两个值。两个都能当数字看就按数字比，否则按文本比。 */
export function compareValues(left, right, op) {
  const a = numOrNull(left);
  const b = numOrNull(right);
  let cmp;
  if (a !== null && b !== null) cmp = a === b ? 0 : a > b ? 1 : -1;
  else cmp = String(left) === String(right) ? 0 : String(left) > String(right) ? 1 : -1;
  switch (op) {
    case '>': return cmp > 0;
    case '>=': return cmp >= 0;
    case '<': return cmp < 0;
    case '<=': return cmp <= 0;
    case '!=': return cmp !== 0;
    default: return cmp === 0;
  }
}

function calcValue(a, b, op) {
  const x = Number(numOrNull(a) ?? 0);
  const y = Number(numOrNull(b) ?? 0);
  switch (op) {
    case '-': return x - y;
    case '*': return x * y;
    case '/': return y === 0 ? 0 : x / y;
    case 'min': return Math.min(x, y);
    case 'max': return Math.max(x, y);
    default: return x + y;
  }
}

/** 一个节点对人说的话（规则列表与诊断都用它）。 */
export function describeNode(node) {
  if (!node || typeof node !== 'object') return '（空节点）';
  if (node.kind === 'test') return `检测：${describeCondition(node.condition)}`;
  if (node.kind === 'judge') {
    const n = Array.isArray(node.conditions) ? node.conditions.length : 0;
    return `判定：${n} 个条件${node.mode === 'any' ? '任一满足' : '全部满足'}`;
  }
  if (node.kind === 'compare') return `比较：${describeOperand(node.left)} ${node.op} ${describeOperand(node.right)}`;
  if (node.kind === 'define') return `定义：${node.name || '（未命名）'} = ${describeOperand(node.value)}`;
  if (node.kind === 'calc') return `计算：${node.target || '（未命名）'} = ${describeOperand(node.left)} ${node.op} ${describeOperand(node.right)}`;
  if (node.kind === 'random') {
    return `随机数：${node.target || '（未命名）'} = ${node.min}–${node.max}${node.integer ? ' 的整数' : ''}（同一楼层结果固定）`;
  }
  if (node.kind === 'add') {
    const text = String(node.text ?? '');
    return `添加：${text ? `「${text.slice(0, 16)}${text.length > 16 ? '…' : ''}」` : '（空）'}`;
  }
  if (node.kind === 'remember') return `记住：${node.name || '（未命名）'} = ${describeOperand(node.value)}`;
  if (node.kind === 'activate') return `激活条目：${node.entryId || '（未选）'}`;
  if (node.kind === 'goto') {
    return `跳转：→ ${node.target || '（未选）'}（最多 ${node.max} 次，超了${node.onLimit === 'continue' ? '跳过继续' : '终止'}）`;
  }
  if (node.kind === 'call') return `调用逻辑：${node.logicId || '（未选）'}`;
  if (node.kind === 'pass') return '到此为止：这条规则出现';
  if (node.kind === 'fail') return '到此为止：这条规则不出现';
  return '未知节点';
}

export function describeCondition(cond) {
  if (!cond) return '（未设置）';
  if (cond.what === 'contains') return `最近 ${cond.within ?? 5} 条里${cond.negate ? '没有' : '有'}「${cond.text || '（空）'}」`;
  if (cond.what === 'regex') return `匹配正则 /${cond.pattern || '（空）'}/`;
  if (cond.what === 'active') return `${cond.negate ? '没有' : '有'}另一条规则出现`;
  if (cond.what === 'messages') return `已经聊了至少 ${cond.count ?? 1} 条`;
  return `变量 ${cond.name || '（未命名）'} ${cond.negate ? '没有值' : '有值'}`;
}

function describeOperand(op) {
  if (!op) return '（空）';
  if (op.type === 'var') return op.name || '（未选变量）';
  if (op.type === 'number') return String(op.value ?? 0);
  return `「${String(op.value ?? '').slice(0, 12)}」`;
}

/** 整条流程的一句话摘要（书架、规则卡片用）。 */
export function describeFlow(flow) {
  const nodes = Array.isArray(flow?.nodes) ? flow.nodes : [];
  if (nodes.length === 0) return '没有流程（按关键词判定）';
  const total = countFlowNodes(nodes);
  return `${flow.mode === 'only' ? '只用' : '关键词 + '}流程，共 ${total} 个节点`;
}

/**
 * 执行流程。
 * @param {object} flow 已 normalize 的流程
 * @param {{messages?: Array, text?: string, userInput?: string, messageCount?: number,
 *          vars?: object, activated?: Set<string>}} ctx
 * @returns {{active: boolean, passed: boolean, reason: string,
 *            steps: Array<{stage: string, passed: boolean, reason: string}>,
 *            vars: object, extra: string[]}}
 */
export function evaluateFlow(flow, ctx = {}) {
  const nodes = Array.isArray(flow?.nodes) ? flow.nodes : [];
  const vars = { ...(ctx.vars && typeof ctx.vars === 'object' ? ctx.vars : {}) };
  const extra = [];
  const steps = [];
  if (nodes.length === 0) {
    return { active: false, passed: true, reason: '没有流程', steps, vars, extra };
  }

  const state = {
    messages: Array.isArray(ctx.messages) ? ctx.messages : [],
    text: String(ctx.text ?? ''),
    userInput: String(ctx.userInput ?? ''),
    messageCount: Math.max(0, Math.trunc(Number(ctx.messageCount) || 0)),
    seed: String(ctx.seed ?? ''),
    vars,
    activated: ctx.activated instanceof Set ? ctx.activated : new Set(),
    extra,
    // 本轮流过程中要"记进聊天状态"的值；调用方负责落盘（core 不碰存档）。
    writes: {},
    // 本轮被流程点名、要求一起出现的条目 id。
    activations: [],
    // 「跳转」用：节点 id → {list, index}，以及每个跳转节点已经跳了几次。
    index: buildNodeIndex(nodes),
    gotoCounts: new Map(),
    callLogic: typeof ctx.callLogic === 'function' ? ctx.callLogic : null,
  };

  let list = nodes;
  let start = 0;
  let result = null;
  let jumps = 0;
  for (;;) {
    try {
      result = runList(list, state, steps, 0, start);
      break;
    } catch (jump) {
      if (!jump || jump.__ilbJump !== true) throw jump;
      jumps += 1;
      if (jumps > MAX_STEPS) {
        result = { status: 'fail', reason: '跳转太多次，停止执行' };
        steps.push({ stage: 'logic', passed: false, reason: result.reason });
        break;
      }
      const node = jump.node;
      const count = (state.gotoCounts.get(node.id) ?? 0) + 1;
      state.gotoCounts.set(node.id, count);
      if (count > node.max) {
        if (node.onLimit === 'continue') {
          steps.push({ stage: 'logic', passed: true, reason: `「跳转」第 ${count} 次超过上限 ${node.max}，按设置跳过这次跳转、继续往下` });
          list = jump.list;
          start = jump.index + 1;
          continue;
        }
        result = { status: 'fail', reason: `「跳转」第 ${count} 次超过上限 ${node.max}，按设置终止` };
        steps.push({ stage: 'logic', passed: false, reason: result.reason });
        break;
      }
      const target = state.index.get(jump.target);
      if (!target) {
        result = { status: 'fail', reason: `跳转目标不存在：${jump.target}（可能已被删掉）` };
        steps.push({ stage: 'logic', passed: false, reason: result.reason });
        break;
      }
      steps.push({ stage: 'logic', passed: true, reason: `跳到另一个节点（第 ${count} 次）` });
      list = target.list;
      start = target.index;
    }
  }
  const passed = result?.status !== 'fail';
  return {
    active: true,
    passed,
    blocked: result?.blocked === true,
    reason: result?.reason ?? (passed ? '流程走完了，没有拦下这条规则' : '流程不通过'),
    steps,
    vars,
    extra,
    writes: state.writes,
    activations: state.activations,
  };
}

function buildNodeIndex(nodes, map = new Map()) {
  const list = Array.isArray(nodes) ? nodes : [];
  for (let i = 0; i < list.length; i += 1) {
    const node = list[i];
    if (!node || typeof node !== 'object') continue;
    if (node.id && !map.has(node.id)) map.set(node.id, { list, index: i });
    if (Array.isArray(node.then)) buildNodeIndex(node.then, map);
    if (Array.isArray(node.else)) buildNodeIndex(node.else, map);
  }
  return map;
}

function runList(nodes, ctx, steps, depth, startIndex = 0) {
  const list = Array.isArray(nodes) ? nodes : [];
  if (depth > MAX_DEPTH) return { status: 'fail', reason: '流程嵌套太深，停止执行' };
  for (let i = Math.max(0, startIndex); i < list.length; i += 1) {
    if (steps.length > MAX_STEPS) return { status: 'fail', reason: '流程太长，停止执行' };
    try {
      const stop = runNode(list[i], ctx, steps, depth);
      if (stop) return stop;
    } catch (jump) {
      if (jump && jump.__ilbJump === true) {
        jump.list = list;
        jump.index = i;
      }
      throw jump;
    }
  }
  return null;
}

function seededUnit(text) {
  const s = String(text ?? '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

function runNode(node, ctx, steps, depth) {
  if (!node || typeof node !== 'object') return null;

  if (node.kind === 'pass') {
    steps.push({ stage: 'logic', passed: true, reason: '走到「通过」节点，这条规则出现' });
    return { status: 'pass', reason: '走到「通过」节点' };
  }
  if (node.kind === 'fail') {
    steps.push({ stage: 'logic', passed: false, reason: '走到「不通过」节点，这条规则不出现' });
    // blocked = 业务上的"正常拒绝"（次数不够、药水为 0），不是流程写错了。
    // 给 runtime/api.js 区分 blocked 与 error 用；字符串状态仍是 'fail'，旧代码不受影响。
    return { status: 'fail', blocked: true, reason: '走到「不通过」节点' };
  }

  if (node.kind === 'define') {
    const value = operandValue(node.value, ctx.vars);
    if (node.name) ctx.vars[node.name] = value;
    steps.push({ stage: 'logic', passed: true, reason: `定义 ${node.name || '（未命名）'} = ${JSON.stringify(value)}` });
    return null;
  }

  if (node.kind === 'calc') {
    const value = calcValue(operandValue(node.left, ctx.vars), operandValue(node.right, ctx.vars), node.op);
    if (node.target) {
      ctx.vars[node.target] = value;
      if (node.persist) ctx.writes[node.target] = value;
    }
    steps.push({ stage: 'logic', passed: true, reason: `计算 ${node.target || '（未命名）'} = ${value}` });
    return null;
  }

  if (node.kind === 'random') {
    // 种子 = 聊天 + 消息数 + 节点 id：同一楼层重画多少次都是同一个数（ILB-4.19）
    const unit = seededUnit(`${ctx.seed ?? ''}:${node.id}`);
    let value = node.integer === false
      ? node.min + unit * (node.max - node.min)
      : node.min + Math.floor(unit * (node.max - node.min + 1));
    if (value > node.max) value = node.max;
    if (node.target) {
      ctx.vars[node.target] = value;
      if (node.persist) ctx.writes[node.target] = value;
    }
    steps.push({ stage: 'logic', passed: true, reason: `随机数 ${node.target || '（未命名）'} = ${node.integer === false ? Number(value.toFixed(2)) : value}` });
    return null;
  }

  if (node.kind === 'add') {
    const text = String(node.text ?? '');
    if (text) ctx.extra.push(text);
    steps.push({ stage: 'logic', passed: true, reason: text ? '添加了一段正文' : '「添加」是空的，跳过' });
    return null;
  }

  if (node.kind === 'remember') {
    const value = operandValue(node.value, ctx.vars);
    if (node.name) {
      ctx.vars[node.name] = value;
      ctx.writes[node.name] = value;
      steps.push({ stage: 'logic', passed: true, reason: `记住 ${node.name} = ${JSON.stringify(value)}` });
    } else {
      steps.push({ stage: 'logic', passed: true, reason: '「记住」没有写名字，跳过' });
    }
    return null;
  }

  if (node.kind === 'activate') {
    const id = String(node.entryId ?? '').trim();
    if (id && !ctx.activations.includes(id)) ctx.activations.push(id);
    steps.push({ stage: 'logic', passed: true, reason: id ? `要求条目 ${id} 一起出现` : '「激活条目」没选条目，跳过' });
    return null;
  }

  if (node.kind === 'goto') {
    const target = String(node.target ?? '').trim();
    if (!target) {
      steps.push({ stage: 'logic', passed: true, reason: '「跳转」没选目标，跳过' });
      return null;
    }
    steps.push({ stage: 'logic', passed: true, reason: `跳转到 ${target}` });
    throw { __ilbJump: true, target, node };
  }

  if (node.kind === 'call') {
    const id = String(node.logicId ?? '').trim();
    if (!id) {
      steps.push({ stage: 'logic', passed: true, reason: '「调用逻辑」没选逻辑，跳过' });
      return null;
    }
    if (typeof ctx.callLogic !== 'function') {
      steps.push({ stage: 'logic', passed: false, reason: `这里不能调用逻辑（${id}），跳过` });
      return null;
    }
    const res = ctx.callLogic(id, ctx);
    if (!res) {
      steps.push({ stage: 'logic', passed: false, reason: `找不到被调用的逻辑（${id}）` });
      return null;
    }
    for (const [key, value] of Object.entries(res.writes ?? {})) {
      ctx.vars[key] = value;
      ctx.writes[key] = value;
    }
    for (const text of res.extra ?? []) ctx.extra.push(text);
    for (const entryId of res.activations ?? []) {
      if (!ctx.activations.includes(entryId)) ctx.activations.push(entryId);
    }
    steps.push({ stage: 'logic', passed: res.passed !== false, reason: res.reason || `调用了 ${id}` });
    if (res.passed === false) {
      return { status: 'fail', blocked: res.blocked === true, reason: '被调用的逻辑不通过' };
    }
    return null;
  }

  // 剩下的都是"判断 + 分支"
  const ok = judgeNode(node, ctx);
  steps.push({ stage: 'logic', passed: ok.passed, reason: `${describeNode(node)} → ${ok.passed ? '成立' : '不成立'}` });

  const branch = ok.passed ? node.then : node.else;
  if (!Array.isArray(branch) || branch.length === 0) {
    if (ok.passed) return null; // 成立但没有写后续：继续往下
    return { status: 'fail', blocked: true, reason: `${describeNode(node)} 不成立，且没有写"不成立时"要做什么` };
  }
  return runList(branch, ctx, steps, depth + 1);
}

function judgeNode(node, ctx) {
  if (node.kind === 'test') return evalCondition(node.condition, ctx);
  if (node.kind === 'judge') {
    const list = Array.isArray(node.conditions) ? node.conditions : [];
    if (list.length === 0) return { passed: true, reason: '没有条件，视为成立' };
    const results = list.map((c) => evalCondition(c, ctx));
    const passed = node.mode === 'any' ? results.some((r) => r.passed) : results.every((r) => r.passed);
    return { passed, reason: results.map((r) => `${r.passed ? '✓' : '✗'} ${r.reason}`).join('；') };
  }
  const left = operandValue(node.left, ctx.vars);
  const right = operandValue(node.right, ctx.vars);
  const passed = compareValues(left, right, node.op);
  return { passed, reason: `${JSON.stringify(left)} ${node.op} ${JSON.stringify(right)}` };
}
