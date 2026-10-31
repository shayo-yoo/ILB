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
import { evalExpression, interpolate, formatNumber } from './expr.js';

export const FLOW_KINDS = [
  'test',
  'judge',
  'compare',
  'if',
  'chance',
  'set',
  'calc',
  'define',
  'remember',
  'random',
  'choose',
  'add',
  'activate',
  'repeat',
  'goto',
  'call',
  'ui',
  'stop',
  'pass',
  'fail',
];

export const FLOW_KIND_LABEL = {
  test: '检测',
  judge: '判定',
  compare: '比较',
  if: '条件组',
  chance: '按概率分支',
  set: '变量操作',
  calc: '计算',
  define: '定义',
  remember: '记住',
  random: '随机数',
  choose: '随机选择',
  add: '添加',
  activate: '激活条目',
  repeat: '重复',
  goto: '跳转',
  call: '调用逻辑',
  ui: '界面',
  stop: '结束流程',
  pass: '通过（结束）',
  fail: '不通过（结束）',
};

export const FLOW_KIND_HINT = {
  test: '看一句话里有没有东西，或者看某条规则这轮在不在',
  judge: '把几个条件放在一起，全部满足或任一满足（条件里还能再套条件组）',
  compare: '比两个值的大小（变量、数字、文本都行）',
  if: '当一组条件（可以嵌套「并且 / 或者 / 不满足」）成立或不成立时分别做什么',
  chance: '掷一次骰子：按百分比走「命中」或「没中」两条路（同一楼层结果固定）',
  set: '给变量设值 / 加 / 减 / 追加文字 / 清空 / 删除 / 限制范围 / 四舍五入',
  calc: '用两个值算出第三个值存进变量；选「=」就是直接把右边的值存进去',
  define: '给一个变量起个值，后面可以拿来比较或计算',
  remember: '把这个值记进这张聊天的状态，下一轮还在（写 {{ILB:chat.名字}} 就能读）',
  random: '在最小值和最大值之间取一个数存进变量（同一楼层结果固定）',
  choose: '从几条候选里随机挑一条（可以存进变量，也可以直接追加到正文）',
  add: '往这条规则的正文后面追加一段话（可以用 {{变量名}} 插入值）',
  activate: '把另一条规则也拉进这一轮，像它自己出现一样',
  repeat: '把里面这几步重复做 N 次（有上限，永远是有限次）',
  goto: '跳到这个流程里的另一个节点，从那里继续往下（可以往回跳，次数有上限）',
  call: '调用另一条独立逻辑，把它的结果并进来',
  ui: '让界面翻页、提示、聚焦或问一句（只有「用户点了按钮去调用」时才生效；聊天里自动触发时不执行）',
  stop: '立刻结束这条流程：成功结束，或者当作不通过',
  pass: '到此为止，这条规则出现',
  fail: '到此为止，这条规则不出现',
};

/** 带「成立时 / 不成立时」两条分支的节点。其余节点都是直的。 */
export const BRANCHING_KINDS = ['test', 'judge', 'compare', 'if', 'chance'];

export const CONDITION_KINDS = ['contains', 'regex', 'active', 'messages', 'var', 'group'];

export const CONDITION_KIND_LABEL = {
  contains: '最近几条消息里有某个词',
  regex: '最近的文本匹配某个正则',
  active: '另一条规则这轮已经出现',
  messages: '已经聊了至少几条消息',
  var: '变量有值',
  group: '条件组（并且 / 或者，里面还能再放条件）',
};

export const COMPARE_OPS = ['>', '>=', '<', '<=', '==', '!='];
/** 计算能用的运算符。'=' 是「直接赋值」：不再拿左右两个值算，而是把右边的值原样存进去。 */
export const CALC_OPS = ['+', '-', '*', '/', 'min', 'max', '='];
export const OPERAND_TYPES = ['var', 'number', 'text', 'template', 'expr'];
export const OPERAND_TYPE_LABEL = { var: '变量', number: '数字', text: '文本', template: '文本模板', expr: '数值表达式' };

/** 变量节点能做哪些动作（ILB-4.12）。一个动作一个选项，不再要求用户拆三步。 */
export const SET_OPS = ['set', 'add', 'sub', 'mul', 'append', 'clear', 'delete', 'clamp', 'round'];
export const SET_OP_LABEL = {
  set: '设为',
  add: '增加',
  sub: '减少',
  mul: '乘以',
  append: '追加文字',
  clear: '清空',
  delete: '删除这个变量',
  clamp: '限制在范围内',
  round: '取整 / 四舍五入',
};
/** 每种动作要用到哪些字段，编辑器据此只显示必要输入框。 */
export const SET_OP_FIELDS = {
  set: ['value'],
  add: ['value'],
  sub: ['value'],
  mul: ['value'],
  append: ['value'],
  clear: [],
  delete: [],
  clamp: ['min', 'max'],
  round: ['digits'],
};

export const MAX_NODES = 80;
export const MAX_DEPTH = 8;
export const MAX_STEPS = 200;
/** 重复次数上限（ILB-4.15：永远有限、可预测，没有 while）。 */
export const MAX_REPEAT = 50;
/** 「随机选择」最多几条候选。 */
export const MAX_CANDIDATES = 20;
/** 单条候选 / 追加文本的长度上限（导入的数据一律当不可信）。 */
export const MAX_TEXT = 2000;

/**
 * 「界面」步骤（ILB-4.21 / 接口 v1.2）。
 * 它只产出一条**一次性**的界面指令，交给 UI 扩展执行；不写聊天状态、不进提示词。
 * 字段就这几个，多一个都不收：这是数据，不是表达式（D-0006 红线）。
 */
export const UI_VERSION = 1;
export const UI_LIMIT = { page: 64, toast: 80, select: 64, askTitle: 40, askText: 120, askOk: 12 };
/** 页面 id / 控件 id 里不许出现的字符（它们是标识符，不是给人看的文本）。 */
const UI_ID_FORBIDDEN = /[<>"'`\\{}]/;

let idCounter = 0;

function newNodeId() {
  idCounter += 1;
  return `n-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

/** 把一段文字裁成一个界面字段：去空白、超长直接截断（不报错，界面上标出来就行）。 */
function uiText(raw, max) {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * 从一个「界面」节点拼出一条指令；全是空字段就返回 null。
 * 空字段不占位——UI 侧只认出现过的键，少一个键就少做一件事。
 */
export function uiCommandOf(node) {
  if (!node || node.kind !== 'ui') return null;
  const cmd = { v: UI_VERSION };
  const page = uiText(node.page, UI_LIMIT.page);
  const toast = uiText(node.toast, UI_LIMIT.toast);
  const select = uiText(node.select, UI_LIMIT.select);
  if (page) cmd.page = page;
  if (toast) cmd.toast = toast;
  if (select) cmd.select = select;
  const seq = Number(node.seq);
  if (Number.isFinite(seq) && seq > 0) cmd.seq = Math.trunc(seq);
  const askTitle = uiText(node.askTitle, UI_LIMIT.askTitle);
  const askText = uiText(node.askText, UI_LIMIT.askText);
  const askOk = uiText(node.askOk, UI_LIMIT.askOk);
  if (askTitle || askText) {
    cmd.ask = {};
    if (askTitle) cmd.ask.title = askTitle;
    if (askText) cmd.ask.text = askText;
    if (askOk) cmd.ask.ok = askOk;
  }
  return Object.keys(cmd).length > 1 ? cmd : null;
}

/** 一条指令的人话摘要（诊断、步骤日志用）。 */
export function describeUi(cmd) {
  if (!cmd) return '（空）';
  const bits = [];
  if (cmd.page) bits.push(`翻到「${cmd.page}」`);
  if (cmd.toast) bits.push(`提示「${cmd.toast}」`);
  if (cmd.select) bits.push(`聚焦 ${cmd.select}`);
  if (cmd.ask) bits.push(`问「${cmd.ask.title ?? cmd.ask.text ?? ''}」`);
  return bits.length > 0 ? bits.join('，') : '（空）';
}

/**
 * 保存前的检查（编辑器与文本模式共用）。返回人话问题列表；空表示可以存。
 * 注意：这里**不**检查长度（长度是自动截断的），只拦"存了也不会有任何效果/明显写错"的情况。
 */
export function checkUiNode(node) {
  const problems = [];
  if (!node || node.kind !== 'ui') return ['不是「界面」节点'];
  const page = uiText(node.page, UI_LIMIT.page);
  const select = uiText(node.select, UI_LIMIT.select);
  if (page && UI_ID_FORBIDDEN.test(page)) problems.push(`页面 id 里不能有这些字符：< > " ' \` \\ { }（现在是「${page}」）`);
  if (select && UI_ID_FORBIDDEN.test(select)) problems.push(`控件 id 里不能有这些字符：< > " ' \` \\ { }（现在是「${select}」）`);
  if (!uiCommandOf(node)) problems.push('这一步是空的：至少要写一项（翻到哪页、提示什么、聚焦谁、问一句）');
  const askTitle = uiText(node.askTitle, UI_LIMIT.askTitle);
  const askText = uiText(node.askText, UI_LIMIT.askText);
  if (askText && !askTitle) problems.push('「问一句」写了正文但没写标题：界面上会没有抬头，建议补一个');
  if (askTitle && !askText) problems.push('「问一句」写了标题但没写正文');
  return problems;
}

function operand(type = 'text', value = '') {
  if (type === 'var') return { type: 'var', name: String(value ?? '') };
  if (type === 'number') return { type: 'number', value: Number(value) || 0 };
  if (type === 'template') return { type: 'template', value: String(value ?? '') };
  if (type === 'expr') return { type: 'expr', value: String(value ?? '') };
  return { type: 'text', value: String(value ?? '') };
}

export function makeCondition(what = 'contains') {
  const base = { id: newNodeId(), what };
  if (what === 'contains') return { ...base, text: '', within: 5, negate: false };
  if (what === 'regex') return { ...base, pattern: '', flags: 'i', negate: false };
  if (what === 'active') return { ...base, entryId: '', negate: false };
  if (what === 'messages') return { ...base, count: 1 };
  // 条件组（ILB-4.8）：一组条件 + 一个「全部满足 / 任一满足」，里面可以再放条件组
  if (what === 'group') return { ...base, op: 'and', children: [makeCondition('contains')], negate: false };
  return { ...base, name: '', negate: false };
}

export function makeNode(kind = 'test', overrides = {}) {
  const base = { id: newNodeId(), kind };
  if (kind === 'test') return { ...base, condition: makeCondition('contains'), then: [], else: [], ...overrides };
  if (kind === 'judge') return { ...base, mode: 'all', conditions: [makeCondition('contains')], then: [], else: [], ...overrides };
  if (kind === 'compare') {
    return { ...base, left: operand('var', ''), op: '>', right: operand('number', 0), then: [], else: [], ...overrides };
  }
  if (kind === 'if') {
    // 条件组节点（ILB-4.8）：一个根组，里面按需嵌套「并且 / 或者 / 不满足」
    return { ...base, when: makeCondition('group'), then: [], else: [], ...overrides };
  }
  if (kind === 'chance') {
    return { ...base, percent: 50, then: [], else: [], ...overrides };
  }
  if (kind === 'set') {
    return { ...base, name: '', op: 'add', value: operand('number', 1), min: 0, max: 999, digits: 0, persist: true, ...overrides };
  }
  if (kind === 'calc') {
    return { ...base, target: '', op: '+', left: operand('var', ''), right: operand('number', 1), ...overrides };
  }
  if (kind === 'random') {
    return { ...base, target: '', min: 1, max: 6, integer: true, persist: true, ...overrides };
  }
  if (kind === 'choose') {
    return { ...base, candidates: ['', ''], target: '', persist: true, ...overrides };
  }
  if (kind === 'repeat') return { ...base, times: 3, body: [], ...overrides };
  if (kind === 'stop') return { ...base, result: 'pass', reason: '', ...overrides };
  if (kind === 'define') return { ...base, name: '', value: operand('text', ''), ...overrides };
  if (kind === 'add') return { ...base, text: '', ...overrides };
  if (kind === 'remember') return { ...base, name: '', value: operand('text', ''), ...overrides };
  if (kind === 'activate') return { ...base, entryId: '', ...overrides };
  if (kind === 'goto') return { ...base, target: '', max: 20, onLimit: 'stop', ...overrides };
  if (kind === 'call') return { ...base, logicId: '', ...overrides };
  if (kind === 'ui') return { ...base, page: '', toast: '', select: '', askTitle: '', askText: '', askOk: '', ...overrides };
  return { ...base, ...overrides };
}

function normalizeOperand(raw, fallback) {
  if (!raw || typeof raw !== 'object') return fallback;
  if (raw.type === 'var') return { type: 'var', name: String(raw.name ?? '') };
  if (raw.type === 'number') return { type: 'number', value: Number(raw.value) || 0 };
  if (raw.type === 'template') return { type: 'template', value: String(raw.value ?? '').slice(0, MAX_TEXT) };
  if (raw.type === 'expr') return { type: 'expr', value: String(raw.value ?? '').slice(0, 240) };
  return { type: 'text', value: String(raw.value ?? '').slice(0, MAX_TEXT) };
}

function normalizeCondition(raw, depth = 0) {
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
  } else if (what === 'group') {
    // 嵌套条件组：深度用 MAX_DEPTH 兜住，超过就不再往下收（保留数据但不无限套）
    cond.op = raw?.op === 'or' ? 'or' : 'and';
    cond.negate = raw?.negate === true;
    const children = Array.isArray(raw?.children) ? raw.children.slice(0, 8) : [];
    cond.children = depth >= MAX_DEPTH ? [] : children.map((c) => normalizeCondition(c, depth + 1));
  } else {
    cond.name = String(raw?.name ?? '');
    cond.negate = raw?.negate === true;
  }
  return cond;
}

export function normalizeNode(raw, depth) {
  if (!raw || typeof raw !== 'object') return null;
  if (depth > MAX_DEPTH) return null;

  // 未知节点（ILB-7.16 红线）：原样保留、标出来、不许静默改成别的类型。
  // 唯一的例外是"老数据里 kind 丢了但带着 condition"——那种按检测节点读才合理。
  const rawKind = raw.kind == null ? '' : String(raw.kind);
  const known = FLOW_KINDS.includes(rawKind);
  if (!known && !(rawKind === '' && (raw.condition || raw.conditions))) {
    const kept = { ...raw };
    kept.id = String(raw.id ?? newNodeId());
    kept.kind = rawKind || 'unknown-kinded';
    kept.unknown = true;
    kept.then = normalizeNodes(raw.then, depth + 1);
    kept.else = normalizeNodes(raw.else, depth + 1);
    if (Array.isArray(raw.body)) kept.body = normalizeNodes(raw.body, depth + 1);
    return kept;
  }

  const kind = known ? rawKind : 'test';
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
  } else if (kind === 'if') {
    node.when = normalizeCondition(raw.when ?? { what: 'group' });
    if (node.when.what !== 'group') node.when = { ...makeCondition('group'), ...node.when };
  } else if (kind === 'chance') {
    node.percent = clampInt(raw.percent, 0, 100, 50);
  } else if (kind === 'set') {
    node.name = String(raw.name ?? '');
    node.op = SET_OPS.includes(raw.op) ? raw.op : 'set';
    node.value = normalizeOperand(raw.value, operand('number', 1));
    node.min = clampInt(raw.min, -999999, 999999, 0);
    node.max = clampInt(raw.max, -999999, 999999, 999);
    if (node.max < node.min) node.max = node.min;
    node.digits = clampInt(raw.digits, 0, 8, 0);
    node.persist = raw.persist !== false;
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
  } else if (kind === 'choose') {
    // 随机选择（ILB-4.19）：候选是文本，可以带 {{变量}}；空候选直接丢掉
    const list = Array.isArray(raw.candidates) ? raw.candidates.slice(0, MAX_CANDIDATES) : [];
    node.candidates = list.map((c) => String(c ?? '').slice(0, MAX_TEXT));
    if (node.candidates.length === 0) node.candidates = ['', ''];
    node.target = String(raw.target ?? '');
    node.persist = raw.persist !== false;
  } else if (kind === 'repeat') {
    node.times = clampInt(raw.times, 1, MAX_REPEAT, 3);
  } else if (kind === 'stop') {
    node.result = raw.result === 'fail' ? 'fail' : 'pass';
    node.reason = String(raw.reason ?? '').slice(0, 200);
  } else if (kind === 'define') {
    node.name = String(raw.name ?? '');
    node.value = normalizeOperand(raw.value, operand('text', ''));
  } else if (kind === 'add') {
    node.text = String(raw.text ?? '').slice(0, MAX_TEXT);
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
  } else if (kind === 'ui') {
    // 界面（ILB-4.21）：只收这五个字段，长度超了当场截断，不认识的键丢掉
    node.page = uiText(raw.page, UI_LIMIT.page);
    node.toast = uiText(raw.toast, UI_LIMIT.toast);
    node.select = uiText(raw.select, UI_LIMIT.select);
    node.askTitle = uiText(raw.askTitle, UI_LIMIT.askTitle);
    node.askText = uiText(raw.askText, UI_LIMIT.askText);
    node.askOk = uiText(raw.askOk, UI_LIMIT.askOk);
    const seq = Number(raw.seq);
    if (Number.isFinite(seq) && seq > 0) node.seq = Math.trunc(seq);
  }

  if (BRANCHING_KINDS.includes(kind)) {
    node.then = normalizeNodes(raw.then, depth + 1);
    node.else = normalizeNodes(raw.else, depth + 1);
  }
  if (kind === 'repeat') node.body = normalizeNodes(raw.body, depth + 1);
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
    if (Array.isArray(node?.body)) n += countFlowNodes(node.body);
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

/**
 * 求一个操作数的值，并把"为什么算不出来"带回来。
 * 表达式与模板**不会静默变成 0 或空串**：出错就 `ok:false`，由调用方写进诊断。
 * @returns {{ok: boolean, value: any, error?: string, missing?: string[]}}
 */
export function evalOperand(op, vars = {}) {
  const pool = vars && typeof vars === 'object' ? vars : {};
  if (!op || typeof op !== 'object') return { ok: true, value: '' };
  if (op.type === 'var') {
    const key = String(op.name ?? '');
    if (!key) return { ok: false, value: '', error: '没有填变量名' };
    return { ok: true, value: pool[key] ?? '' };
  }
  if (op.type === 'number') return { ok: true, value: Number(op.value) || 0 };
  if (op.type === 'expr') {
    const src = String(op.value ?? '').trim();
    if (!src) return { ok: false, value: 0, error: '表达式是空的' };
    const result = evalExpression(src, pool);
    if (!result.ok) return { ok: false, value: 0, error: result.error, missing: result.missing };
    return { ok: true, value: result.value };
  }
  if (op.type === 'template') {
    const result = interpolate(String(op.value ?? ''), pool);
    return { ok: result.errors.length === 0 && result.missing.length === 0, value: result.text, missing: result.missing, error: result.errors[0]?.error };
  }
  return { ok: true, value: String(op.value ?? '') };
}

function operandValue(op, vars) {
  const result = evalOperand(op, vars);
  return result.ok ? result.value : '';
}

/** 条件求值。返回 `{passed, reason}`，reason 是给人看的一句话。 */
export function evalCondition(cond, ctx, depth = 0) {
  const what = cond?.what ?? 'contains';
  if (what === 'group') {
    // 条件组（ILB-4.8）：全部满足 / 任一满足，可以往里再套；空组视为通过（并明说）
    const op = cond.op === 'or' ? 'or' : 'and';
    const children = Array.isArray(cond.children) ? cond.children : [];
    if (depth > MAX_DEPTH) return { passed: false, reason: '条件组套得太深了（超过上限）' };
    if (children.length === 0) return { passed: true, reason: '这个条件组是空的，视为不限制' };
    const results = children.map((child) => evalCondition(child, ctx, depth + 1));
    const ok = op === 'and' ? results.every((r) => r.passed) : results.some((r) => r.passed);
    const passed = cond.negate === true ? !ok : ok;
    const label = op === 'and' ? '全部满足' : '任一项满足';
    const detail = results
      .map((r, i) => `${op === 'and' ? (r.passed ? '✓' : '✗') : r.passed ? '✓' : '·'}${i + 1}`)
      .join('');
    return {
      passed,
      reason: `条件组（${label}）${cond.negate === true ? '取反后' : ''}${passed ? '成立' : '不成立'}：${detail}`,
    };
  }
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
  if (node.unknown === true) return `不支持编辑的节点类型「${node.kind}」（数据已原样保留）`;
  if (node.kind === 'test') return `检测：${describeCondition(node.condition)}`;
  if (node.kind === 'judge') {
    const n = Array.isArray(node.conditions) ? node.conditions.length : 0;
    return `判定：${n} 个条件${node.mode === 'any' ? '任一满足' : '全部满足'}`;
  }
  if (node.kind === 'compare') return `比较：${describeOperand(node.left)} ${node.op} ${describeOperand(node.right)}`;
  if (node.kind === 'if') return `条件组：当 ${describeCondition(node.when)}`;
  if (node.kind === 'chance') return `按概率：${node.percent}% 命中（同一楼层结果固定）`;
  if (node.kind === 'set') {
    const op = SET_OP_LABEL[node.op] ?? node.op;
    const name = node.name || '（未命名）';
    if (node.op === 'clear') return `变量：把 ${name} 清空`;
    if (node.op === 'delete') return `变量：删除 ${name}`;
    if (node.op === 'clamp') return `变量：把 ${name} 限制在 ${node.min}–${node.max}`;
    if (node.op === 'round') return `变量：把 ${name} 四舍五入到 ${node.digits} 位`;
    return `变量：${name} ${op} ${describeOperand(node.value)}`;
  }
  if (node.kind === 'define') return `定义：${node.name || '（未命名）'} = ${describeOperand(node.value)}`;
  if (node.kind === 'calc') {
    return node.op === '='
      ? `计算：${node.target || '（未命名）'} = ${describeOperand(node.left)}`
      : `计算：${node.target || '（未命名）'} = ${describeOperand(node.left)} ${node.op} ${describeOperand(node.right)}`;
  }
  if (node.kind === 'random') {
    return `随机数：${node.target || '（未命名）'} = ${node.min}–${node.max}${node.integer ? ' 的整数' : ''}（同一楼层结果固定）`;
  }
  if (node.kind === 'choose') {
    const list = Array.isArray(node.candidates) ? node.candidates.filter((c) => String(c).trim()) : [];
    const where = node.target ? `存进 ${node.target}` : '追加到正文';
    return `随机选择：从 ${list.length} 条里挑 1 条${where}`;
  }
  if (node.kind === 'repeat') {
    const n = Array.isArray(node.body) ? node.body.length : 0;
    return `重复：把里面 ${n} 步做 ${node.times} 次`;
  }
  if (node.kind === 'stop') return `结束流程：${node.result === 'fail' ? '当作不通过' : '当作通过'}${node.reason ? `（${node.reason}）` : ''}`;
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
  if (node.kind === 'ui') return `界面：${describeUi(uiCommandOf(node))}`;
  if (node.kind === 'pass') return '到此为止：这条规则出现';
  if (node.kind === 'fail') return '到此为止：这条规则不出现';
  return '未知节点';
}

export function describeCondition(cond, depth = 0) {
  if (!cond) return '（未设置）';
  if (cond.what === 'contains') return `最近 ${cond.within ?? 5} 条里${cond.negate ? '没有' : '有'}「${cond.text || '（空）'}」`;
  if (cond.what === 'regex') return `匹配正则 /${cond.pattern || '（空）'}/`;
  if (cond.what === 'active') return `${cond.negate ? '没有' : '有'}另一条规则出现`;
  if (cond.what === 'messages') return `已经聊了至少 ${cond.count ?? 1} 条`;
  if (cond.what === 'group') {
    const children = Array.isArray(cond.children) ? cond.children : [];
    if (depth > MAX_DEPTH) return '（条件组太深）';
    const inner = children.map((c) => describeCondition(c, depth + 1)).join(cond.op === 'or' ? ' 或 ' : ' 且 ');
    return `${cond.negate ? '不满足（' : '（'}${inner || '空'}${cond.negate ? '）' : '）'}`;
  }
  return `变量 ${cond.name || '（未命名）'} ${cond.negate ? '没有值' : '有值'}`;
}

export function describeOperand(op) {
  if (!op) return '（空）';
  if (op.type === 'var') return op.name || '（未选变量）';
  if (op.type === 'number') return formatNumber(op.value ?? 0);
  if (op.type === 'expr') return `表达式 ${String(op.value ?? '').slice(0, 20) || '（空）'}`;
  if (op.type === 'template') {
    const text = String(op.value ?? '');
    return `模板「${text.slice(0, 16)}${text.length > 16 ? '…' : ''}」`;
  }
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
 *            vars: object, extra: string[], ui: object|null, uiSkipped: object[]}}
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
    // 「界面」步骤：只有调用方明确允许（用户点了按钮去调用逻辑）才会产出指令。
    // 聊天里自动触发的激活一律不允许——否则别人导入的一本书就能翻页、弹框。
    uiAllowed: ctx.uiAllowed === true,
    ui: null,
    uiSkipped: [],
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
    ui: state.ui ?? null,
    uiSkipped: state.uiSkipped ?? [],
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

  // 未知节点（ILB-7.16）：数据留着，但**不假装执行成功**——整条流程按出错处理。
  if (node.unknown === true) {
    const reason = `这一步的节点类型「${node.kind}」当前版本不认识，已保留数据但没有执行`;
    steps.push({ stage: 'logic', passed: false, reason });
    return { status: 'fail', blocked: false, reason };
  }

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
  if (node.kind === 'stop') {
    const fail = node.result === 'fail';
    const reason = node.reason ? `提前结束：${node.reason}` : fail ? '提前结束：当作不通过' : '提前结束：当作通过';
    steps.push({ stage: 'logic', passed: !fail, reason });
    return { status: fail ? 'fail' : 'pass', blocked: fail, reason };
  }

  if (node.kind === 'define') {
    const value = operandValue(node.value, ctx.vars);
    if (node.name) ctx.vars[node.name] = value;
    steps.push({ stage: 'logic', passed: true, reason: `定义 ${node.name || '（未命名）'} = ${JSON.stringify(value)}` });
    return null;
  }

  if (node.kind === 'set') {
    // 变量动作（ILB-4.12）：一个节点干一件事，不再要求"先算再写回"。
    const name = String(node.name ?? '');
    if (!name) {
      steps.push({ stage: 'logic', passed: false, reason: '「变量操作」没有写变量名，这一步没执行' });
      return null;
    }
    const current = ctx.vars[name];
    const evaluated = evalOperand(node.value, ctx.vars);
    const value = evaluated.ok ? evaluated.value : undefined;
    if (!evaluated.ok && ['set', 'add', 'sub', 'mul', 'append'].includes(node.op)) {
      // 算不出来就明说，绝不把空值悄悄写进去
      steps.push({ stage: 'logic', passed: false, reason: `变量 ${name}：${evaluated.error ?? '取值失败'}，这一步没执行` });
      return null;
    }
    let next = current;
    if (node.op === 'set') next = value;
    else if (node.op === 'add') next = (numOrNull(current) ?? 0) + (numOrNull(value) ?? 0);
    else if (node.op === 'sub') next = (numOrNull(current) ?? 0) - (numOrNull(value) ?? 0);
    else if (node.op === 'mul') next = (numOrNull(current) ?? 0) * (numOrNull(value) ?? 0);
    else if (node.op === 'append') next = `${current ?? ''}${value ?? ''}`;
    else if (node.op === 'clear') next = '';
    else if (node.op === 'delete') next = undefined;
    else if (node.op === 'clamp') {
      const n = numOrNull(current);
      next = n === null ? current : Math.min(node.max, Math.max(node.min, n));
    } else if (node.op === 'round') {
      const n = numOrNull(current);
      const digits = Math.min(8, Math.max(0, Math.trunc(Number(node.digits) || 0)));
      const factor = 10 ** digits;
      next = n === null ? current : Math.round(n * factor) / factor;
    }
    if (node.op === 'delete' || next === undefined) {
      delete ctx.vars[name];
      if (node.persist) ctx.writes[name] = null; // null = 删除；落盘层看到 null 就删
      steps.push({ stage: 'logic', passed: true, reason: `删除变量 ${name}` });
      return null;
    }
    ctx.vars[name] = next;
    if (node.persist) ctx.writes[name] = next;
    steps.push({
      stage: 'logic',
      passed: true,
      reason: `变量 ${name} ${SET_OP_LABEL[node.op] ?? node.op}：${JSON.stringify(current ?? null)} → ${JSON.stringify(next)}`,
    });
    return null;
  }

  if (node.kind === 'calc') {
    // '=' 是直接赋值：把右边的值原样存进去（数字、文本都行），不参与算术。
    const value = node.op === '='
      ? operandValue(node.left, ctx.vars)
      : calcValue(operandValue(node.left, ctx.vars), operandValue(node.right, ctx.vars), node.op);
    if (node.target) {
      ctx.vars[node.target] = value;
      if (node.persist) ctx.writes[node.target] = value;
    }
    steps.push({ stage: 'logic', passed: true, reason: `计算 ${node.target || '（未命名）'} = ${JSON.stringify(value)}` });
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

  if (node.kind === 'choose') {
    // 随机选择（ILB-4.19）：候选是文本，可以带 {{变量}}；同样是同一楼层结果固定
    const list = (Array.isArray(node.candidates) ? node.candidates : []).map((c) => String(c ?? '')).filter((c) => c.trim());
    if (list.length === 0) {
      steps.push({ stage: 'logic', passed: false, reason: '「随机选择」一条候选都没写，这一步没执行' });
      return null;
    }
    const unit = seededUnit(`${ctx.seed ?? ''}:${node.id}`);
    const index = Math.min(list.length - 1, Math.floor(unit * list.length));
    const expanded = interpolate(list[index], ctx.vars);
    const picked = expanded.text;
    if (node.target) {
      ctx.vars[node.target] = picked;
      if (node.persist) ctx.writes[node.target] = picked;
      steps.push({ stage: 'logic', passed: true, reason: `随机选择：第 ${index + 1} 条（共 ${list.length} 条）→ ${node.target}` });
    } else {
      ctx.extra.push(picked);
      steps.push({ stage: 'logic', passed: true, reason: `随机选择：第 ${index + 1} 条（共 ${list.length} 条），已追加到正文` });
    }
    for (const name of expanded.missing) {
      steps.push({ stage: 'logic', passed: false, reason: `挑中的那条里，变量 ${name} 还没有值` });
    }
    return null;
  }

  if (node.kind === 'repeat') {
    // 重复（ILB-4.15）：次数有上限，里面只能放普通步骤，没有 while
    const times = clampInt(node.times, 1, MAX_REPEAT, 1);
    const body = Array.isArray(node.body) ? node.body : [];
    if (body.length === 0) {
      steps.push({ stage: 'logic', passed: true, reason: '「重复」里面没有步骤，跳过' });
      return null;
    }
    for (let round = 1; round <= times; round += 1) {
      if (steps.length > MAX_STEPS) return { status: 'fail', blocked: false, reason: '流程太长，停止执行' };
      steps.push({ stage: 'logic', passed: true, reason: `重复 第 ${round}/${times} 次` });
      const stop = runList(body, ctx, steps, depth + 1);
      if (stop) return stop;
    }
    return null;
  }

  if (node.kind === 'add') {
    // 文本插值（ILB-4.9）：{{金币}} 在这里就换成值，缺失时留 ⟨未定义:金币⟩ 并记一笔
    const raw = String(node.text ?? '');
    const expanded = interpolate(raw, ctx.vars);
    const text = expanded.text;
    if (text) ctx.extra.push(text);
    steps.push({ stage: 'logic', passed: true, reason: text ? '添加了一段正文' : '「添加」是空的，跳过' });
    for (const name of expanded.missing) {
      steps.push({ stage: 'logic', passed: false, reason: `「添加」里的变量 ${name} 还没有值，已留下醒目标记` });
    }
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

  if (node.kind === 'ui') {
    const cmd = uiCommandOf(node);
    if (!cmd) {
      steps.push({ stage: 'logic', passed: true, reason: '「界面」是空的，跳过' });
      return null;
    }
    if (!ctx.uiAllowed) {
      // 这条路是"聊天里自动触发"：记一笔，不执行，让用户在诊断里看得见
      ctx.uiSkipped.push(cmd);
      steps.push({ stage: 'logic', passed: true, reason: `「界面」被忽略（${describeUi(cmd)}）：只有用户点按钮调用时才执行` });
      return null;
    }
    if (ctx.ui) {
      steps.push({ stage: 'logic', passed: true, reason: `已经发过一条界面指令，这条不再发（${describeUi(cmd)}）` });
      return null;
    }
    ctx.ui = cmd;
    steps.push({ stage: 'logic', passed: true, reason: `界面：${describeUi(cmd)}` });
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
    // 被调用的逻辑里也有「界面」步骤时，指令往外层冒（还是只留第一条）
    if (res.ui && ctx.uiAllowed && !ctx.ui) ctx.ui = res.ui;
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
  if (node.kind === 'if') {
    const result = evalCondition(node.when, ctx);
    return { passed: result.passed, reason: result.reason };
  }
  if (node.kind === 'chance') {
    // 概率分支（ILB-4.19）：种子同随机数，同一楼层重画不会变
    const percent = clampInt(node.percent, 0, 100, 50);
    const unit = seededUnit(`${ctx.seed ?? ''}:${node.id}`);
    const passed = percent >= 100 ? true : percent <= 0 ? false : unit * 100 < percent;
    return { passed, reason: `按概率 ${percent}% 掷一次：${passed ? '命中' : '没中'}` };
  }
  if (node.kind === 'judge') {
    const list = Array.isArray(node.conditions) ? node.conditions : [];
    if (list.length === 0) return { passed: true, reason: '没有条件，视为成立' };
    const results = list.map((c) => evalCondition(c, ctx));
    const passed = node.mode === 'any' ? results.some((r) => r.passed) : results.every((r) => r.passed);
    return { passed, reason: results.map((r) => `${r.passed ? '✓' : '✗'} ${r.reason}`).join('；') };
  }
  // 比较：两边都可能算不出来（变量没了、表达式写错）。算不出来就不算通过，并把原因说出来。
  const left = evalOperand(node.left, ctx.vars);
  const right = evalOperand(node.right, ctx.vars);
  if (!left.ok || !right.ok) {
    const why = !left.ok ? left.error : right.error;
    return { passed: false, reason: `算不出要比的值：${why ?? '未知原因'}` };
  }
  const passed = compareValues(left.value, right.value, node.op);
  return { passed, reason: `${JSON.stringify(left.value)} ${node.op} ${JSON.stringify(right.value)}` };
}
