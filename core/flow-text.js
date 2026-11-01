// core/flow-text.js —— 流程的「文本写法」（ILB-4.20）
//
// 这不是一门语言，也不是第二个事实来源。
// 表单模式（ui/flow-editor.js）与文本模式编辑的是**同一个** flow.nodes：
// 文本只是把下拉框里的「变量 / 数字 / 文本」三选项，改由排版来区分（$名字 / 12 / "文字"）。
//
// 所以这里没有求值、没有优先级、没有作用域，也没有解释器：
//   renderFlowText(flow)  —— 把节点树排成文本（给人看、给 AI 改）
//   parseFlowText(text)   —— 把文本搬回节点树，再交给 normalizeFlow 洗一遍
// 执行流程的永远是 core/flow.js 的 evaluateFlow，这一层碰都不碰。
//
// 往返契约：parseFlowText(renderFlowText(flow)).flow 与 flow 结构一致。
// 唯一的例外是节点 id：文本里写的是「位置」（@2✓.1）而不是 id，
// 所以搬回来时所有节点都会拿到新 id，跳转目标按位置重新指向。
// 这正是"只有一个事实来源"的做法——文本不保存 id，也就不可能带着过期的 id 回来。

import {
  FLOW_KIND_LABEL,
  CONDITION_KIND_LABEL,
  COMPARE_OPS,
  CALC_OPS,
  MAX_CANDIDATES,
  MAX_REPEAT,
  makeNode,
  normalizeFlow,
  checkUiNode,
  MAX_DEPTH,
} from './flow.js';

/** 文本模式里每种节点的开头词。故意和 FLOW_KIND_LABEL 不完全一样：这里要短、要好打。 */
export const FLOW_TEXT_KEYWORDS = {
  test: '检测',
  judge: '判定',
  compare: '比较',
  if: '条件组',
  chance: '按概率',
  set: '变量',
  calc: '计算',
  define: '定义',
  random: '随机数',
  choose: '随机选',
  add: '添加',
  remember: '记住',
  activate: '激活',
  repeat: '重复',
  repeatList: '按列表',
  list: '列表',
  switch: '分支选择',
  goto: '跳转',
  call: '调用',
  ui: '界面',
  stop: '结束',
  pass: '通过',
  fail: '不通过',
};

/** 「变量」节点九种动作在文本里的写法。顺序固定：解析时按前缀匹配（彼此不是前缀）。 */
export const SET_TEXT_OPS = [
  ['set', '设为'],
  ['add', '增加'],
  ['sub', '减少'],
  ['mul', '乘以'],
  ['append', '追加文字'],
  ['clear', '清空'],
  ['delete', '删除'],
  ['clamp', '限制在范围内'],
  ['round', '取整'],
];
const SET_LABEL = new Map(SET_TEXT_OPS);

const MODE_ONLY = '只看流程';
const MODE_AND = '关键词 + 流程';
const BRANCH_THEN = '成立';
const BRANCH_ELSE = '不成立';
const COND_PREFIX = '条件';
const INDENT = '  ';
const SWITCH_CASE = '等于';
const SWITCH_ELSE = '否则';
/** 分支选择的一条：等于 <值>（值是 $变量 / 数字 / "文本"）。 */
const SWITCH_CASE_RE = /^等于\s+([\s\S]+)$/;

/** 给界面与 AI 看的写法说明（和 FLOW_KIND_HINT 一样，是文案不是逻辑）。 */
export const FLOW_TEXT_HINT = [
  '一个节点一行，写在分支里的行往右缩进两格（中文输入法的全角空格也认，一个算两格）。',
  '三种值：$名字 是变量，12 是数字，"文字" 是文本（带引号）。',
  '计算分两种：计算 $变量 = $甲 - $乙 [存]（算），计算 $变量 = 0 [存]（直接赋值）。',
  '变量操作：变量 $金币 设为 100 / 增加 5 / 减少 5 / 乘以 2 / 追加文字 "…" / 清空 / 删除 / 限制在范围内 0..999 / 取整 2 位（可加 [临时]）。',
  '随机选择：随机选 $抽中的 = "SSR" "SR" "R"（不写 $变量 就追加到正文；可加 [临时]）。',
  '按概率：按概率 30%，下面缩进写「成立 / 不成立」两块。',
  '条件组：条件组 全部满足（或 任一满足），下面缩进写若干行「条件 …」；文本只支持一层，要套娃请切表单。',
  '重复：重复 3 次，下面直接缩进写要重复的步骤（有上限）。',
  '按列表循环：按列表 $清单 重复（当前项 $项），下面直接缩进写每项要做的步骤（最多 50 项；括号可省）。',
  '列表变量：列表 $清单 设为 "甲,乙,丙" / 追加 "丁" / 清空；默认按换行拆开，换分隔符请切表单。',
  '分支选择：分支选择 $等级，下面缩进写「等于 3」一块、「等于 5」一块，最后可写一块「否则」；每块体再缩进一层。',
  '提前结束：结束 当作通过 / 结束 当作不通过 "原因"。',
  '引用别的东西：激活 #条目名、调用 >逻辑名、跳转 @2✓.1（位置）。',
  '界面：界面 结果页 "SSR！" 聚焦 card-3（页面 id 直接写，没引号；提示要带引号；可加 问 "标题" "正文" "确定"）。',
  '判断节点写在上一行，它的两个分支各占一块，块头就是「成立」和「不成立」。',
  `开头可以写一行「${MODE_ONLY}」或「${MODE_AND}」；不写按后者算。`,
  '以 // 开头的行是注释；行尾写 // 后面的部分也会被忽略。',
  '看不懂的行会被列出来，不会瞎猜；能看懂的部分照常生效。',
].join('\n');

/**
 * 给 AI 的整份提示词：用户复制这段，粘给模型，再说自己的诉求就行。
 * 这里只描述格式，不描述执行——写坏了由 parseFlowText 一行行报出来。
 */
export const FLOW_TEXT_AI_PROMPT = `你在帮我把「判定流程」写成一种固定的文本格式。这种格式只有下面这些词，**不要发明新语法**，也不要写代码块以外的解释。

## 一条流程长什么样
第一行（可省略）写模式：
- 关键词 + 流程   ← 默认，先按关键词判定，再跑下面这些步骤
- 只看流程       ← 不看关键词，直接跑

之后一个节点一行。写在分支里的行，**缩进两格**。

## 全部可用的词（就只有这些）
检测 包含 "词" 在最近3条        检测 不包含 "词" 在最近3条
检测 已激活 #条目名             检测 未激活 #条目名
检测 已聊至少 5 条
检测 匹配 /正则/i               检测 不匹配 /正则/i
检测 $变量 有值                 检测 $变量 没有值
判定 全部满足  /  判定 任一满足   （下面缩进写若干行「条件 …」，条件就是上面「检测」后面的那部分）
比较 $甲 >= 0                    （比较符：> >= < <= == !=）
定义 $名字 = "值"
计算 $变量 = $甲 + 1 [存]        （运算符：+ - * / min max）
计算 $变量 = 0 [存]              （没有运算符就是直接赋值）
变量 $金币 增加 5                 （动作：设为/增加/减少/乘以/追加文字/清空/删除/限制在范围内 0..999/取整 2 位；可加 [临时]）
随机数 $变量 = 1..6              （可加 [小数] 表示小数、[临时] 表示不存进聊天）
随机选 $抽中的 = "SSR" "SR" "R"  （不写 $变量 就追加到正文；可加 [临时]）
按概率 30%                       （下面缩进写「成立」「不成立」两块）
条件组 全部满足                  （下面缩进写若干「条件 …」；只支持一层，要套娃请用表单）
重复 3 次                        （下面直接缩进写要重复的步骤）
按列表 $清单 重复（当前项 $项）   （下面直接缩进写每项要做的步骤；括号可省）
列表 $清单 设为 "甲,乙,丙"       （动作：设为 / 追加 "丁" / 清空；默认按换行拆开）
分支选择 $等级                   （下面缩进写「等于 3」「等于 5」各一块，最后可写「否则」）
添加 "要追加到正文的一段话"
记住 $变量 = "值"                （记住会写进这张聊天，下一轮还在）
激活 #条目名                     （让另一条规则也出场）
调用 >逻辑名                     （把另一条独立逻辑当子步骤跑）
跳转 @2✓.1                       （跳到某个位置，可加「最多20次 超了终止」或「超了跳过继续」）
界面 结果页 "SSR！"              （让界面翻到某一页 + 提示一句；页面 id 不带引号）
界面 - "SSR！" 聚焦 card-3       （只提示不翻页：页面位置写 -；聚焦写控件 id）
界面 结果页 问 "确认抽卡？" "消耗 10 金币" "确定"   （问一句；**只提示，不会停下来等**）
结束 当作通过 "原因"              （提前收尾：当作通过 / 当作不通过；原因可省）
通过                             （到此为止，这条规则出现）
不通过                           （到此为止，这条规则不出现）

## 值的写法（只有三种）
$变量名 ／ 数字（如 12、0.5、-3）／ "带引号的文本"
不要写 true/false 以外的裸词，不要写表达式（没有 + - 之外的运算符优先级）。

## 位置怎么数
第 1 个节点是 1；它的「成立」分支里的第 1 个是 1✓.1，「不成立」分支里的是 1✗.1；再往里继续 .1。
例：2✓.1 表示「第 2 个节点 · 成立分支 · 第 1 个节点」。

## 分支怎么写
判断类节点（检测 / 判定 / 比较）下面可以有两块：
  成立
    缩进两格的步骤
  不成立
    缩进两格的步骤
块可以留空，也可以不写（等同于不成立时什么都不做）。

## 硬规定
1. 一行只写一个节点，不要合并。
2. 缩进只用空格（两格一层），不要用 Tab。中文输入法打出来的全角空格也认，一个全角空格算两格。
3. 行首或行尾可以写 // 注释，注释不执行。
4. 变量名不要带空格；中文可以。
5. 不要写「如果/否则/while」这类词；分支写在「检测 / 判定 / 比较 / 条件组 / 按概率」下面的「成立 / 不成立」，循环用「重复 N 次」，跳转用 跳转 @位置。
6. 只输出这段文本，不要输出 JSON、不要输出解释。

## 例子
比较 $升级经验 >= $所需升级经验
  成立
    计算 $升级经验 = $升级经验 - $所需升级经验 [存]
    计算 $等级 = $等级 + 1 [存]
    添加 "你升了一级。"
  不成立
    添加 "经验还不够。"
`;

/** 让用户改脚本时给 AI 的第二句话（拼在提示词后面用）。 */
export const FLOW_TEXT_AI_TAIL = '请按上面的格式，把我的诉求写成流程文本。只输出文本本身。';

// —— 值（变量 / 数字 / 文本）——

function textLiteral(value) {
  return JSON.stringify(String(value ?? ''));
}

function renderOperand(op) {
  if (!op || typeof op !== 'object') return '""';
  if (op.type === 'var') return `$${op.name ?? ''}`;
  if (op.type === 'number') return String(Number(op.value) || 0);
  return textLiteral(op.value);
}

const VAR_RE = /^\$([^\s=]+)$/;
const NUMBER_RE = /^-?\d+(\.\d+)?$/;

/** 把一段文本读成值；读不出来返回 null（由调用方记一条问题）。 */
function parseOperand(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') return { type: 'text', value: '' };
  const asVar = VAR_RE.exec(text);
  if (asVar) return { type: 'var', name: asVar[1] };
  if (text.startsWith('"')) {
    try {
      const value = JSON.parse(text);
      if (typeof value === 'string') return { type: 'text', value };
    } catch (error) {
      return null;
    }
    return null;
  }
  if (NUMBER_RE.test(text)) return { type: 'number', value: Number(text) };
  // 只放行 true / false 这两个裸词：手写时几乎一定会这么写。
  // 别的裸词一律不猜（不猜是「金」还是漏了 $ 的变量名），由调用方报错。
  if (text === 'true' || text === 'false') return { type: 'text', value: text };
  return null;
}

// —— 条件 ——

function renderCondition(cond, entries) {
  if (!cond || typeof cond !== 'object') return '（空条件）';
  if (cond.what === 'contains') {
    return `${cond.negate ? '不包含' : '包含'} ${textLiteral(cond.text)} 在最近${cond.within ?? 5}条`;
  }
  if (cond.what === 'regex') return `${cond.negate ? '不匹配' : '匹配'} /${cond.pattern ?? ''}/${cond.flags ?? 'i'}`;
  if (cond.what === 'active') return `${cond.negate ? '未激活' : '已激活'} #${refOf(cond.entryId, entries, 'title')}`;
  if (cond.what === 'messages') return `已聊至少 ${cond.count ?? 1} 条`;
  return `$${cond.name || '（未命名）'} ${cond.negate ? '没有值' : '有值'}`;
}

const REGEX_RE = /^(\/.*\/)([a-z]*)$/;

/**
 * 读一条条件。refs 负责把「#名字」换回条目 id。
 * @returns {{cond?: object, reason?: string}}
 */
function parseCondition(raw, refs) {
  const text = String(raw ?? '').trim();
  if (text === '') return { cond: { what: 'contains', text: '', within: 5, negate: false } };

  let m = /^(不?包含)\s+(".*")\s+在最近\s*(\d+)\s*条$/.exec(text);
  if (m) {
    const op = parseOperand(m[2]);
    if (!op) return { reason: '引号里的文字没闭合' };
    return { cond: { what: 'contains', text: op.value, within: Number(m[3]), negate: m[1] === '不包含' } };
  }

  m = /^(不?匹配)\s+(\S.*)$/.exec(text);
  if (m) {
    const rx = REGEX_RE.exec(m[2].trim());
    if (!rx) return { reason: '正则要写成 /模式/标志，例如 /铜钥匙/i' };
    return { cond: { what: 'regex', pattern: rx[1].slice(1, -1), flags: rx[2] || 'i', negate: m[1] === '不匹配' } };
  }

  m = /^(已激活|未激活)\s+(#\S.*)$/.exec(text);
  if (m) {
    const found = resolveRef(m[2], refs, 'entry');
    if (found.reason) return { reason: found.reason };
    return { cond: { what: 'active', entryId: found.id, negate: m[1] === '未激活' } };
  }

  m = /^已聊至少\s*(\d+)\s*条$/.exec(text);
  if (m) return { cond: { what: 'messages', count: Number(m[1]) } };

  m = /^(\$[^\s]+)\s+(没有值|有值)$/.exec(text);
  if (m) return { cond: { what: 'var', name: m[1].slice(1), negate: m[2] === '没有值' } };

  return { reason: `看不懂这个条件：${text.slice(0, 24)}（可用：${Object.values(CONDITION_KIND_LABEL).join(' / ')}）` };
}

// —— 引用（#条目 / >逻辑 / @位置）——

function refOf(id, list, key) {
  if (!id) return '（未选）';
  const hit = (Array.isArray(list) ? list : []).find((item) => item && (item.id === id || item[key] === id));
  const name = hit ? (hit.title || hit.name || '') : '';
  return name ? name : `id:${id}`;
}

function resolveRef(raw, refs, kind) {
  const text = String(raw ?? '').trim();
  if (!text) return { reason: `这里要写一个${kind === 'entry' ? '条目' : '逻辑'}` };
  const body = text.replace(/^[#>]/, '');
  if (body.startsWith('id:')) {
    const id = body.slice(3);
    return id ? { id } : { reason: 'id: 后面什么都没写' };
  }
  const list = Array.isArray(refs) ? refs : [];
  const hit = list.find((item) => item && (item.title === body || item.name === body || item.id === body));
  if (hit) return { id: hit.id };
  const near = list
    .map((item) => (item && (item.title || item.name)) || '')
    .filter((name) => name && name.includes(body))
    .slice(0, 3);
  return {
    reason: near.length > 0
      ? `找不到「${body}」；是不是想写：${near.join(' / ')}`
      : `找不到「${body}」（清单里没有这个${kind === 'entry' ? '条目' : '逻辑'}）`,
  };
}

// —— 渲染 ——

function branchTitle(key) {
  return key === 'else' ? BRANCH_ELSE : BRANCH_THEN;
}

function isBranchKind(kind) {
  return kind === 'test' || kind === 'judge' || kind === 'compare' || kind === 'if' || kind === 'chance';
}

/**
 * 把节点树排成文本。
 * @param {object} flow 已 normalize 或未 normalize 的流程
 * @param {{entries?: Array, logics?: Array}} [refs] 用来把条目/逻辑的 id 换成名字
 * @returns {string}
 */
export function renderFlowText(flow, refs = {}) {
  const model = normalizeFlow(flow);
  const entries = refs.entries ?? [];
  const logics = refs.logics ?? [];
  const lines = [model.mode === 'only' ? MODE_ONLY : MODE_AND];

  // 「跳转」写的是目标的位置（@2✓.1），所以先把每个节点的位置算出来
  const labels = new Map();
  (function walkLabel(list, prefix) {
    (Array.isArray(list) ? list : []).forEach((node, index) => {
      const path = prefix ? `${prefix}.${index + 1}` : String(index + 1);
      labels.set(node.id, path);
      walkLabel(node.then ?? [], `${path}✓`);
      walkLabel(node.else ?? [], `${path}✗`);
    });
  })(model.nodes, '');

  const walk = (list, depth, prefix) => {
    (Array.isArray(list) ? list : []).forEach((node, index) => {
      const label = prefix ? `${prefix}.${index + 1}` : String(index + 1);
      lines.push(`${INDENT.repeat(depth)}${renderNode(node, label, entries, logics, labels)}`);
      if (node.kind === 'judge' && Array.isArray(node.conditions)) {
        node.conditions.forEach((cond) => {
          lines.push(`${INDENT.repeat(depth + 1)}${COND_PREFIX} ${renderCondition(cond, entries)}`);
        });
      }
      if (node.kind === 'if' && Array.isArray(node.when?.children)) {
        node.when.children.forEach((cond) => {
          lines.push(`${INDENT.repeat(depth + 1)}${COND_PREFIX} ${renderCondition(cond, entries)}`);
        });
      }
      if (node.kind === 'repeat' && Array.isArray(node.body) && node.body.length > 0) {
        walk(node.body, depth + 1, `${label}.body`);
      }
      // 分支选择：每条分支头写「等于 <值>」，最后可以有一块「否则」
      if (node.kind === 'switch') {
        (Array.isArray(node.cases) ? node.cases : []).forEach((item) => {
          lines.push(`${INDENT.repeat(depth + 1)}${SWITCH_CASE} ${renderOperand(item?.match)}`);
          walk(item?.body ?? [], depth + 2, `${label}.case`);
        });
        if (Array.isArray(node.else) && node.else.length > 0) {
          lines.push(`${INDENT.repeat(depth + 1)}${SWITCH_ELSE}`);
          walk(node.else, depth + 2, `${label}.else`);
        }
      }
      if (isBranchKind(node.kind)) {
        ['then', 'else'].forEach((key) => {
          const children = Array.isArray(node[key]) ? node[key] : [];
          if (children.length === 0) return;
          lines.push(`${INDENT.repeat(depth + 1)}${branchTitle(key)}`);
          walk(children, depth + 2, `${label}${key === 'then' ? '✓' : '✗'}`);
        });
      }
    });
  };

  walk(model.nodes, 0, '');
  return `${lines.join('\n')}\n`;
}

function renderNode(node, label, entries, logics, labels) {
  switch (node.kind) {
    case 'test':
      return `检测 ${renderCondition(node.condition, entries)}`;
    case 'judge':
      return `判定 ${node.mode === 'any' ? '任一满足' : '全部满足'}`;
    case 'compare':
      return `比较 ${renderOperand(node.left)} ${node.op} ${renderOperand(node.right)}`;
    case 'if':
      return `条件组 ${node.when?.op === 'or' ? '任一满足' : '全部满足'}`;
    case 'chance':
      return `按概率 ${node.percent ?? 50}%`;
    case 'define':
      return `定义 $${node.name || ''} = ${renderOperand(node.value)}`;
    case 'calc':
      return node.op === '='
        ? `计算 $${node.target || ''} = ${renderOperand(node.left)}${node.persist ? ' [存]' : ''}`
        : `计算 $${node.target || ''} = ${renderOperand(node.left)} ${node.op} ${renderOperand(node.right)}${node.persist ? ' [存]' : ''}`;
    case 'random':
      return `随机数 $${node.target || ''} = ${node.min}..${node.max}${node.integer ? '' : ' [小数]'}${node.persist ? '' : ' [临时]'}`;
    case 'choose': {
      const cands = (Array.isArray(node.candidates) ? node.candidates : []).map(textLiteral).join(' ');
      const head = node.target ? `随机选 $${node.target} =` : '随机选';
      return `${head} ${cands}${node.persist === false ? ' [临时]' : ''}`.trimEnd();
    }
    case 'set': {
      const label = SET_LABEL.get(node.op) ?? node.op;
      const bits = [`变量 $${node.name || ''}`, label];
      if (node.op === 'clamp') bits.push(`${node.min ?? 0}..${node.max ?? 999}`);
      else if (node.op === 'round') bits.push(`${node.digits ?? 0} 位`);
      else if (node.op !== 'clear' && node.op !== 'delete') bits.push(renderOperand(node.value));
      if (node.persist === false) bits.push('[临时]');
      return bits.join(' ');
    }
    case 'repeat': {
      if (node.mode === 'list') {
        const tail = node.itemName ? `（当前项 $${node.itemName}）` : '';
        return `${FLOW_TEXT_KEYWORDS.repeatList} $${node.listName || ''} ${FLOW_TEXT_KEYWORDS.repeat}${tail}`;
      }
      return `重复 ${node.times ?? 3} 次`;
    }
    case 'stop':
      return `结束 ${node.result === 'fail' ? '当作不通过' : '当作通过'}${node.reason ? ` ${textLiteral(node.reason)}` : ''}`;
    case 'add':
      return `添加 ${textLiteral(node.text)}`;
    case 'remember':
      return `记住 $${node.name || ''} = ${renderOperand(node.value)}`;
    case 'activate':
      return `激活 #${refOf(node.entryId, entries, 'title')}`;
    case 'goto': {
      const to = node.target ? (labels.get(node.target) ?? `id:${node.target}`) : '（未选）';
      return `跳转 @${to} 最多${node.max ?? 20}次 超了${node.onLimit === 'continue' ? '跳过继续' : '终止'}`;
    }
    case 'call':
      return `调用 >${refOf(node.logicId, logics, 'name')}`;
    case 'ui': {
      const bits = ['界面', node.page || '-'];
      if (node.toast) bits.push(textLiteral(node.toast));
      if (node.select) bits.push('聚焦', node.select);
      if (node.askTitle || node.askText) {
        bits.push('问', textLiteral(node.askTitle ?? ''), textLiteral(node.askText ?? ''));
        if (node.askOk) bits.push(textLiteral(node.askOk));
      }
      return bits.join(' ');
    }
    case 'pass':
      return '通过';
    case 'fail':
      return '不通过';
    case 'switch':
      return `分支选择 ${renderOperand(node.value)}`;
    case 'list': {
      if ((node.separator ?? '\n') !== '\n') {
        return `列表 $${node.name || ''}（自定义分隔符，只能在表单里编辑）`;
      }
      const label = node.op === 'append' ? '追加' : node.op === 'clear' ? '清空' : '设为';
      const tail = node.op === 'clear' ? '' : ` ${renderOperand(node.value)}`;
      return `列表 $${node.name || ''} ${label}${tail}`;
    }
    default:
      return `${FLOW_KIND_LABEL[node.kind] ?? node.kind}`;
  }
}

// —— 解析 ——

/** 把一行里的 // 注释切掉（引号里的 // 不算）。AI 经常一行写完再补一句解释。 */
function stripComment(text) {
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === '/' && text[i + 1] === '/') return text.slice(0, i);
  }
  return text;
}

/** 缩进按"显示列"算：一个全角空格（中文输入法常吐出来的）算两列，等同两个半角空格。 */
function indentWidth(text) {
  let width = 0;
  for (const ch of text) width += ch === '\u3000' ? INDENT.length : 1;
  return width;
}

/** 把文本切成带缩进的行；空行与 // 注释丢掉，行号保留原样给人报错用。 */
function toLines(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((raw, index) => {
      const expanded = stripComment(raw).replace(/\t/g, INDENT);
      const lead = expanded.slice(0, expanded.length - expanded.trimStart().length);
      const body = expanded.trim();
      return {
        no: index + 1,
        indent: indentWidth(lead),
        // 行首除了普通空格与全角空格外还混进别的空白（不间断空格等）——出问题时值得点出来
        odd: /[^\u0020\u3000]/.test(lead),
        body,
      };
    })
    .filter((line) => line.body !== '');
}

const GOTO_RE = /^跳转\s+@(\S+?)(?:\s+最多\s*(\d+)\s*次)?(?:\s*超了\s*(跳过继续|终止))?\s*(?:[（(][^）)]*[）)])?$/;
const JUDGE_RE = /^判定\s+(全部满足|任一满足)$/;
const COMPARE_RE = /^比较\s+(.+?)\s*(>=|<=|==|!=|>|<)\s*(.+)$/;
const CALC_RE = /^计算\s+(\$[^\s]+)\s*=\s*(.+?)\s*(\+|-|\*|\/|min|max)\s+(.+?)(\s*\[存\])?$/;
/** 直接赋值：计算 $变量 = 值 [存]。AI 很爱这么写，所以必须认。 */
const CALC_SET_RE = /^计算\s+(\$[^\s]+)\s*=\s*(.+?)(\s*\[存\])?$/;
const DEFINE_RE = /^定义\s+(\$[^\s]+)\s*=\s*(.*)$/;
const REMEMBER_RE = /^记住\s+(\$[^\s]+)\s*=\s*(.*)$/;
const RANDOM_RE = /^随机数\s+(\$[^\s]+)\s*=\s*(-?\d+)\s*\.\.\s*(-?\d+)(\s*\[小数\])?(\s*\[临时\])?$/;
const ADD_RE = /^添加\s+(".*")$/;
const ACTIVATE_RE = /^激活\s+(#\S.*)$/;
const CALL_RE = /^调用\s+(>\S.*)$/;
const IF_RE = /^条件组\s+(全部满足|任一满足)$/;
const CHANCE_RE = /^按概率\s*(\d{1,3})\s*%$/;
const SET_RE = /^变量\s+(\$[^\s]+)\s+(.+)$/;
const CHOOSE_RE = /^随机选\s+(?:\$([^\s=]+)\s*=\s*)?(.*)$/;
const REPEAT_RE = /^重复\s*(\d+)\s*次$/;
/** 按列表循环：按列表 $清单 重复（当前项 $项）。括号里可省，省了就不绑定当前项。 */
const REPEAT_LIST_RE = /^按列表\s+\$([^\s（]+)\s+重复(?:\s*（\s*当前项\s*\$([^\s）]+)\s*）)?$/;
/** 列表变量：列表 $清单 设为 "…" / 追加 "…" / 清空。 */
const LIST_RE = /^列表\s+\$([^\s]+)\s+(设为|追加|清空)(?:\s+([\s\S]+))?$/;
const SWITCH_RE = /^分支选择\s+([\s\S]+)$/;
const STOP_RE = /^结束\s*(当作通过|当作不通过)(?:\s+(".*"))?$/;
const VAR_RE_LINE = /^(\$[^\s]+)\s+(没有值|有值)$/;

/**
 * 把文本读回节点树。
 * @param {string} text
 * @param {{entries?: Array, logics?: Array}} [refs] 用来把条目/逻辑的名字换成 id
 * @returns {{flow: object, problems: Array<{line:number, text:string, reason:string}>}}
 */
export function parseFlowText(text, refs = {}) {
  const entries = refs.entries ?? [];
  const logics = refs.logics ?? [];
  const lines = toLines(text);
  const problems = [];
  let mode = 'and';
  let start = 0;

  if (lines.length > 0 && (lines[0].body === MODE_ONLY || lines[0].body === MODE_AND)) {
    mode = lines[0].body === MODE_ONLY ? 'only' : 'and';
    start = 1;
  }

  const note = (line, reason) => problems.push({ line: line.no, text: line.body, reason });

  /** 读一段同缩进的节点；遇到更浅的缩进就收工。 */
  function readNodes(index, indent, depth) {
    const out = [];
    let i = index;
    while (i < lines.length) {
      const line = lines[i];
      if (line.indent < indent) break;
      if (line.indent > indent) {
        note(line, `这一行缩进多了（${line.indent} 格，上一层是 ${indent} 格），它上面没有能装下它的分支${line.odd ? '；行首还混了特殊空白（比如不间断空格）' : ''}`);
        i += 1;
        continue;
      }
      if (line.body === BRANCH_THEN || line.body === BRANCH_ELSE || line.body.startsWith(`${COND_PREFIX} `)) {
        break; // 交给调用方（分支头 / 判定节点的条件）
      }
      if (depth > MAX_DEPTH) {
        note(line, `分支套得太深了（最多 ${MAX_DEPTH} 层）`);
        i += 1;
        continue;
      }
      const parsed = readNode(line, entries, logics, note);
      if (!parsed) {
        i += 1;
        continue;
      }
      const node = parsed;
      i += 1;

      // 判定 / 条件组节点的条件行（在分支之前）
      if (node.kind === 'judge' || node.kind === 'if') {
        while (i < lines.length && lines[i].indent > indent && lines[i].body.startsWith(`${COND_PREFIX} `)) {
          const bare = lines[i].body.slice(COND_PREFIX.length + 1);
          const got = parseCondition(bare, entries);
          if (got.reason) note(lines[i], got.reason);
          else if (node.kind === 'judge') node.conditions.push({ id: nextCondId(), ...got.cond });
          else node.when.children.push({ id: nextCondId(), ...got.cond });
          i += 1;
        }
      }

      // 「重复」的循环体：直接缩进写步骤，没有「成立 / 不成立」这一层
      if (node.kind === 'repeat' && i < lines.length && lines[i].indent > indent) {
        if (lines[i].body === BRANCH_THEN || lines[i].body === BRANCH_ELSE) {
          note(lines[i], '「重复」里面不用写「成立 / 不成立」，直接把要重复的步骤缩进写在它下面');
        } else {
          const got = readNodes(i, lines[i].indent, depth + 1);
          node.body.push(...got.nodes);
          i = got.index;
        }
      }

      // 分支选择：「等于 <值>」每条一块，「否则」最多一块，块体再缩进一层
      if (node.kind === 'switch') {
        while (i < lines.length && lines[i].indent > indent) {
          const head = lines[i];
          if (head.body === SWITCH_ELSE) {
            const childIndent = lines[i + 1] && lines[i + 1].indent > head.indent ? lines[i + 1].indent : head.indent + INDENT.length;
            const got = readNodes(i + 1, childIndent, depth + 1);
            node.else.push(...got.nodes);
            i = got.index;
            continue;
          }
          const m = SWITCH_CASE_RE.exec(head.body);
          if (!m) {
            note(head, head.body.startsWith(SWITCH_CASE)
              ? `「${SWITCH_CASE}」后面要跟一个值：$变量、数字或 "文本"`
              : `分支选择里只写「${SWITCH_CASE} <值>」或「${SWITCH_ELSE}」开头的一块`);
            i += 1;
            continue;
          }
          const match = parseOperand(m[1]);
          if (!match) {
            note(head, `「${SWITCH_CASE}」后面要跟一个值：$变量、数字或 "文本"`);
            i += 1;
            continue;
          }
          const childIndent = lines[i + 1] && lines[i + 1].indent > head.indent ? lines[i + 1].indent : head.indent + INDENT.length;
          const got = readNodes(i + 1, childIndent, depth + 1);
          node.cases.push({ id: nextCaseId(), match, body: got.nodes });
          i = got.index;
        }
      }

      // 分支块
      if (isBranchKind(node.kind)) {
        while (i < lines.length && lines[i].indent > indent) {
          const head = lines[i];
          if (head.body !== BRANCH_THEN && head.body !== BRANCH_ELSE) {
            note(head, `这里应该是「${BRANCH_THEN}」或「${BRANCH_ELSE}」开头的一块`);
            i += 1;
            continue;
          }
          const childIndent = lines[i + 1] && lines[i + 1].indent > head.indent ? lines[i + 1].indent : head.indent + INDENT.length;
          const got = readNodes(i + 1, childIndent, depth + 1);
          const list = head.body === BRANCH_THEN ? node.then : node.else;
          list.push(...got.nodes);
          i = got.index;
        }
      }

      out.push(node);
    }
    return { nodes: out, index: i };
  }

  const built = readNodes(start, lines.length > start ? lines[start].indent : 0, 0);

  // 剩下没读进去的行不能装作没看见：多半是缩进不对（例如「条件」没写进判定下面）
  for (let k = built.index; k < lines.length; k += 1) {
    const line = lines[k];
    const where = `这一行缩进 ${line.indent} 格${line.odd ? '，行首还混了特殊空白（比如不间断空格）' : ''}`;
    problems.push({
      line: line.no ?? 0,
      text: line.body,
      reason: line.body.startsWith(`${COND_PREFIX} `)
        ? `「${COND_PREFIX}」行要缩进写在「判定 / 条件组」下面`
        : `没找到它属于哪一步（${where}；全角空格算两格，也许多打了或少打了一格，或者上面缺「成立 / 不成立」）`,
    });
  }

  // 跳转写的是位置（@2✓.1）。要在 normalizeFlow 之前换算：洗一遍会把 wanted/lineNo 丢掉。
  const byPath = new Map();
  (function walkLabel(list, prefix) {
    (Array.isArray(list) ? list : []).forEach((node, index) => {
      const path = prefix ? `${prefix}.${index + 1}` : String(index + 1);
      byPath.set(path, node.id);
      walkLabel(node.then ?? [], `${path}✓`);
      walkLabel(node.else ?? [], `${path}✗`);
    });
  })(built.nodes, '');

  (function fixGoto(list) {
    (Array.isArray(list) ? list : []).forEach((node) => {
      if (node.kind === 'goto' && node.wanted) {
        if (node.wanted.startsWith('id:')) node.target = node.wanted.slice(3);
        else if (byPath.has(node.wanted)) node.target = byPath.get(node.wanted);
        else {
          problems.push({
            line: node.lineNo ?? 0,
            text: `跳转 @${node.wanted}`,
            reason: `找不到这个位置：${node.wanted}（位置按「2✓.1」这样数）`,
          });
          node.target = '';
        }
        delete node.wanted;
        // lineNo 留给后面的「跳转指向自己」检查用，检查完再清
      }
      fixGoto(node.then ?? []);
      fixGoto(node.else ?? []);
    });
  })(built.nodes);

  // 「跳转 @2」写在 2 号节点里 = 原地打转。这不是写错语法，是多半写错了位置，
  // 所以只当警告报出来（problems 仍然是"看不懂的行"，两者分开显示）。
  const warnings = [];
  (function checkSelfJump(list) {
    (Array.isArray(list) ? list : []).forEach((node) => {
      if (node.kind === 'goto' && node.target && node.target === node.id) {
        warnings.push({
          line: node.lineNo ?? 0,
          text: '跳转',
          reason: `这条跳转指向自己：会原地打转，最多跑到 ${node.max ?? 20} 次就停下。想回到上一步，看它上面那个节点是几号，写成 @1 这样。`,
        });
      }
      checkSelfJump(node.then ?? []);
      checkSelfJump(node.else ?? []);
    });
  })(built.nodes);

  (function dropLineNo(list) {
    (Array.isArray(list) ? list : []).forEach((node) => {
      delete node.lineNo;
      dropLineNo(node.then ?? []);
      dropLineNo(node.else ?? []);
    });
  })(built.nodes);

  const flow = normalizeFlow({ mode, nodes: built.nodes });
  return { flow, problems, warnings };
}

let condCounter = 0;
function nextCondId() {
  condCounter += 1;
  return `t-${Date.now().toString(36)}-${condCounter.toString(36)}`;
}

let caseCounter = 0;
function nextCaseId() {
  caseCounter += 1;
  return `s-${Date.now().toString(36)}-${caseCounter.toString(36)}`;
}

/**
 * 读一行节点。看不懂返回 null 并记一条问题。
 * @returns {object|null}
 */
/**
 * 把「界面」后面那段切成词：引号里的是文本（可以含空格），其余按空格切。
 * 只做切分，不做解释——解释在 readUiNode 里，看不懂就报错，不猜。
 */
function tokenizeUi(raw) {
  const tokens = [];
  const text = String(raw ?? '');
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let buf = '';
      let closed = false;
      while (j < text.length) {
        const c = text[j];
        if (c === '\\' && j + 1 < text.length) {
          buf += text[j + 1];
          j += 2;
          continue;
        }
        if (c === '"') {
          closed = true;
          j += 1;
          break;
        }
        buf += c;
        j += 1;
      }
      if (!closed) return { error: '引号没有关上' };
      tokens.push({ quoted: true, value: buf });
      i = j;
      continue;
    }
    let j = i;
    while (j < text.length && !/\s/.test(text[j])) j += 1;
    tokens.push({ quoted: false, value: text.slice(i, j) });
    i = j;
  }
  return { tokens };
}

const UI_WORD_FOCUS = '聚焦';
const UI_WORD_ASK = '问';

function readUiNode(line, note) {
  const raw = line.body.slice(FLOW_TEXT_KEYWORDS.ui.length).trim();
  const got = tokenizeUi(raw);
  if (got.error) {
    note(line, `界面这一行${got.error}：${raw}`);
    return null;
  }
  const tokens = got.tokens;
  if (tokens.length === 0) {
    note(line, '界面要写成：界面 结果页 "提示一句"，或者 界面 - "只提示"');
    return null;
  }
  const node = makeNode('ui');
  const first = tokens[0];
  // 以引号开头 = 不翻页，直接提示一句；裸词就是页面 id；写 - 表示不翻页
  if (first.quoted) node.toast = first.value;
  else if (first.value !== '-') node.page = first.value;

  let index = 1;
  while (index < tokens.length) {
    const tk = tokens[index];
    if (!tk.quoted && tk.value === UI_WORD_FOCUS) {
      const target = tokens[index + 1];
      if (!target) {
        note(line, '「聚焦」后面要写控件 id');
        return null;
      }
      node.select = target.value;
      index += 2;
      continue;
    }
    if (!tk.quoted && tk.value === UI_WORD_ASK) {
      const title = tokens[index + 1];
      const body = tokens[index + 2];
      if (!title || !body) {
        note(line, '「问」后面要写标题和正文：问 "标题" "正文" "确定"');
        return null;
      }
      node.askTitle = title.value;
      node.askText = body.value;
      index += 3;
      const ok = tokens[index];
      if (ok && ok.quoted) {
        node.askOk = ok.value;
        index += 1;
      }
      continue;
    }
    if (tk.quoted && !node.toast) {
      node.toast = tk.value;
      index += 1;
      continue;
    }
    note(line, `界面这一行看不懂「${tk.value}」；能写的是 页面id、"提示"、聚焦 控件id、问 "标题" "正文"`);
    return null;
  }

  const problems = checkUiNode(node);
  if (problems.length > 0) {
    note(line, problems[0]);
    return null;
  }
  return node;
}

function readNode(line, entries, logics, note) {
  const body = line.body;

  if (body.startsWith(`${FLOW_TEXT_KEYWORDS.test} `) || body === FLOW_TEXT_KEYWORDS.test) {
    const raw = body.slice(FLOW_TEXT_KEYWORDS.test.length).trim();
    const got = parseCondition(raw, entries);
    if (got.reason) {
      note(line, got.reason);
      return null;
    }
    return { ...makeNode('test'), condition: { id: nextCondId(), ...got.cond } };
  }

  if (JUDGE_RE.test(body)) {
    const any = body.endsWith('任一满足');
    return { ...makeNode('judge'), mode: any ? 'any' : 'all', conditions: [] };
  }

  if (body.startsWith(`${FLOW_TEXT_KEYWORDS.compare} `)) {
    const m = COMPARE_RE.exec(body);
    if (!m) {
      note(line, `比较看不懂：「${body}」；要写成 比较 $变量 > 0（比较符可用 ${COMPARE_OPS.join(' ')}）`);
      return null;
    }
    if (!COMPARE_OPS.includes(m[2])) {
      note(line, `不认识的比较符「${m[2]}」；能用的是 ${COMPARE_OPS.join(' ')}`);
      return null;
    }
    const left = parseOperand(m[1]);
    const right = parseOperand(m[3]);
    if (!left || !right) {
      note(line, `「${body}」两边看不懂；只能是 $变量、数字或 "文本"`);
      return null;
    }
    return { ...makeNode('compare'), left, op: m[2], right };
  }

  if (body.startsWith(`${FLOW_TEXT_KEYWORDS.calc} `)) {
    const m = CALC_RE.exec(body);
    if (m) {
      if (!CALC_OPS.includes(m[3])) {
        note(line, `不认识的运算符「${m[3]}」；能用的是 ${CALC_OPS.filter((op) => op !== '=').join(' ')}`);
        return null;
      }
      const left = parseOperand(m[2]);
      const right = parseOperand(m[4]);
      if (!left || !right) {
        note(line, `「${body}」里算子看不懂；两边的值只能是 $变量、数字或 "文本"`);
        return null;
      }
      return { ...makeNode('calc'), target: m[1].slice(1), op: m[3], left, right, persist: Boolean(m[5]) };
    }

    // 没有运算符 → 当成直接赋值（计算 $变量 = 值）。AI 写初始化时几乎都是这种。
    const set = CALC_SET_RE.exec(body);
    if (set) {
      const value = parseOperand(set[2]);
      if (!value) {
        note(line, `「${body}」右边看不懂：${String(set[2]).slice(0, 20)}；只能写 $变量、数字或 "文本"`);
        return null;
      }
      return {
        ...makeNode('calc'),
        target: set[1].slice(1),
        op: '=',
        left: value,
        right: { type: 'number', value: 0 },
        persist: Boolean(set[3]),
      };
    }

    if (!body.includes('=')) {
      note(line, `计算少了一个等号：「${body}」；要写成 计算 $变量 = 值 [存]`);
    } else {
      note(line, `「${body}」看不懂；要写成 计算 $变量 = 值 [存]，或者 计算 $变量 = $甲 - $乙 [存]`);
    }
    return null;
  }

  if (body.startsWith(`${FLOW_TEXT_KEYWORDS.define} `)) {
    const m = DEFINE_RE.exec(body);
    if (!m) {
      note(line, '定义要写成：定义 $名字 = "值"');
      return null;
    }
    const value = parseOperand(m[2]);
    if (!value) {
      note(line, '等号右边只能是 $变量、数字或 "文本"');
      return null;
    }
    return { ...makeNode('define'), name: m[1].slice(1), value };
  }

  if (body.startsWith(`${FLOW_TEXT_KEYWORDS.remember} `)) {
    const m = REMEMBER_RE.exec(body);
    if (!m) {
      note(line, '记住要写成：记住 $名字 = "值"');
      return null;
    }
    const value = parseOperand(m[2]);
    if (!value) {
      note(line, '等号右边只能是 $变量、数字或 "文本"');
      return null;
    }
    return { ...makeNode('remember'), name: m[1].slice(1), value };
  }

  if (body.startsWith(`${FLOW_TEXT_KEYWORDS.random} `)) {
    const m = RANDOM_RE.exec(body);
    if (!m) {
      note(line, `随机数看不懂：「${body}」；要写成 随机数 $点数 = 1..6（可加 [小数] [临时]）`);
      return null;
    }
    const min = Number(m[2]);
    const max = Number(m[3]);
    return {
      ...makeNode('random'),
      target: m[1].slice(1),
      min,
      max: max < min ? min : max,
      integer: !m[4],
      persist: !m[5],
    };
  }

  if (body.startsWith(`${FLOW_TEXT_KEYWORDS.add} `)) {
    const m = ADD_RE.exec(body);
    if (!m) {
      note(line, '添加要写成：添加 "要追加的一段话"');
      return null;
    }
    const text = parseOperand(m[1]);
    return { ...makeNode('add'), text: text ? text.value : '' };
  }

  if (body.startsWith(`${FLOW_TEXT_KEYWORDS.activate} `)) {
    const m = ACTIVATE_RE.exec(body);
    if (!m) {
      note(line, '激活要写成：激活 #条目名');
      return null;
    }
    const got = resolveRef(m[1], entries, 'entry');
    if (got.reason) {
      note(line, got.reason);
      return null;
    }
    return { ...makeNode('activate'), entryId: got.id };
  }

  if (body.startsWith(`${FLOW_TEXT_KEYWORDS.call} `)) {
    const m = CALL_RE.exec(body);
    if (!m) {
      note(line, '调用要写成：调用 >逻辑名');
      return null;
    }
    const got = resolveRef(m[1], logics, 'logic');
    if (got.reason) {
      note(line, got.reason);
      return null;
    }
    return { ...makeNode('call'), logicId: got.id };
  }

  if (body === FLOW_TEXT_KEYWORDS.ui || body.startsWith(`${FLOW_TEXT_KEYWORDS.ui} `)) {
    return readUiNode(line, note);
  }

  if (body.startsWith(`${FLOW_TEXT_KEYWORDS.goto} `)) {
    const m = GOTO_RE.exec(body);
    if (!m) {
      note(line, `跳转看不懂：「${body}」；要写成 跳转 @2✓.1（后面可以加 最多20次 超了终止）`);
      return null;
    }
    const node = {
      ...makeNode('goto'),
      target: '',
      max: m[2] ? Number(m[2]) : 20,
      onLimit: m[3] === '跳过继续' ? 'continue' : 'stop',
    };
    node.wanted = m[1];
    node.lineNo = line.no;
    return node;
  }

  if (VAR_RE_LINE.test(body)) return null; // 变量条件只能出现在「条件」行里

  if (IF_RE.test(body)) {
    const any = body.endsWith('任一满足');
    return { ...makeNode('if'), when: { what: 'group', op: any ? 'or' : 'and', negate: false, children: [] } };
  }

  if (CHANCE_RE.test(body)) {
    const m = CHANCE_RE.exec(body);
    const percent = Math.max(0, Math.min(100, Number(m[1])));
    return { ...makeNode('chance'), percent };
  }

  if (body.startsWith('变量 ')) {
    const m = SET_RE.exec(body);
    if (!m) {
      note(line, '变量操作要写成：变量 $名字 增加 5（动作可用：' + SET_TEXT_OPS.map(([, label]) => label).join(' / ') + '）');
      return null;
    }
    const name = m[1].slice(1);
    let rest = m[2].trim();
    let persist = true;
    if (/\s*\[临时\]\s*$/.test(rest)) {
      persist = false;
      rest = rest.replace(/\s*\[临时\]\s*$/, '').trim();
    }
    const hit = SET_TEXT_OPS.find(([, label]) => rest.startsWith(label));
    if (!hit) {
      note(line, `不认识的变量动作「${rest.slice(0, 12)}」；能用的有：${SET_TEXT_OPS.map(([, label]) => label).join(' / ')}`);
      return null;
    }
    const [op, label] = hit;
    const tail = rest.slice(label.length).trim();
    const base = { ...makeNode('set'), name, op, persist };
    if (op === 'clamp') {
      const got = /^(-?[\d.]+)\s*\.\.\s*(-?[\d.]+)$/.exec(tail);
      if (!got) {
        note(line, '「限制在范围内」要写成：变量 $名字 限制在范围内 0..999');
        return null;
      }
      return { ...base, min: Number(got[1]), max: Number(got[2]) };
    }
    if (op === 'round') {
      const got = /^(-?\d+)\s*位$/.exec(tail);
      if (!got) {
        note(line, '「取整」要写成：变量 $名字 取整 2 位（0 表示取整到个位）');
        return null;
      }
      return { ...base, digits: Number(got[1]) };
    }
    if (op === 'clear' || op === 'delete') {
      if (tail !== '') note(line, `「${label}」后面不用再写值`);
      return base;
    }
    if (tail === '') {
      note(line, `「${label}」要跟一个值：$变量、数字或 "文本"`);
      return null;
    }
    const value = parseOperand(tail);
    if (!value) {
      note(line, `「${label}」要跟一个值：$变量、数字或 "文本"`);
      return null;
    }
    return { ...base, value };
  }

  if (body.startsWith('随机选 ')) {
    const m = CHOOSE_RE.exec(body);
    if (!m) {
      note(line, '随机选要写成：随机选 $抽中的 = "SSR" "SR" "R"（不写 $变量 就追加到正文）');
      return null;
    }
    let rest = String(m[2] ?? '').trim();
    let persist = true;
    if (/\s*\[临时\]\s*$/.test(rest)) {
      persist = false;
      rest = rest.replace(/\s*\[临时\]\s*$/, '').trim();
    }
    const candidates = [];
    const re = /"((?:[^"\\]|\\.)*)"/g;
    let mm;
    while ((mm = re.exec(rest))) {
      try {
        candidates.push(JSON.parse(`"${mm[1]}"`));
      } catch {
        note(line, '候选里的引号没闭合');
        return null;
      }
    }
    if (candidates.length === 0) {
      note(line, '随机选至少要写一条带引号的候选，例如 "SSR" "SR"');
      return null;
    }
    if (candidates.length > MAX_CANDIDATES) {
      note(line, `候选太多了（最多 ${MAX_CANDIDATES} 条）`);
      return null;
    }
    return { ...makeNode('choose'), target: m[1] ? m[1] : '', candidates, persist };
  }

  if (REPEAT_LIST_RE.test(body)) {
    const m = REPEAT_LIST_RE.exec(body);
    return { ...makeNode('repeat'), mode: 'list', listName: m[1], itemName: m[2] ?? '', body: [] };
  }

  if (body.startsWith('列表 ')) {
    const m = LIST_RE.exec(body);
    if (!m) {
      note(line, '列表要写成：列表 $清单 设为 "甲,乙,丙"（或 追加 "丁" / 清空）');
      return null;
    }
    const [, name, label, rawValue] = m;
    const op = label === '追加' ? 'append' : label === '清空' ? 'clear' : 'set';
    const base = { ...makeNode('list'), name, op };
    if (op === 'clear') {
      if (String(rawValue ?? '').trim()) note(line, '「列表 … 清空」后面不用再写值');
      return base;
    }
    if (!String(rawValue ?? '').trim()) {
      note(line, `「列表 … ${label}」要跟一个值：$变量、数字或 "文本"`);
      return null;
    }
    const value = parseOperand(rawValue);
    if (!value) {
      note(line, `「列表 … ${label}」要跟一个值：$变量、数字或 "文本"`);
      return null;
    }
    return { ...base, value };
  }

  if (body.startsWith('分支选择 ')) {
    const m = SWITCH_RE.exec(body);
    if (!m) {
      note(line, '分支选择要写成：分支选择 $变量（下面缩进写「等于 3」和「否则」）');
      return null;
    }
    const value = parseOperand(m[1]);
    if (!value) {
      note(line, '「分支选择」后面要跟一个值：$变量、数字或 "文本"');
      return null;
    }
    return { ...makeNode('switch'), value, cases: [], else: [] };
  }

  if (REPEAT_RE.test(body)) {
    const m = REPEAT_RE.exec(body);
    const times = Number(m[1]);
    if (times < 1) {
      note(line, '「重复」的次数至少要 1');
      return null;
    }
    if (times > MAX_REPEAT) {
      note(line, `「重复」最多 ${MAX_REPEAT} 次（永远有限，不会有 while）`);
      return null;
    }
    return { ...makeNode('repeat'), times, body: [] };
  }

  if (STOP_RE.test(body)) {
    const m = STOP_RE.exec(body);
    let reason = '';
    if (m[2]) {
      const op = parseOperand(m[2]);
      if (!op) {
        note(line, '「结束」后面的原因要带引号，例如 "药水用完了"');
        return null;
      }
      reason = op.value;
    }
    return { ...makeNode('stop'), result: m[1] === '当作不通过' ? 'fail' : 'pass', reason };
  }

  if (body === '通过') return makeNode('pass');
  if (body === '不通过') return makeNode('fail');

  note(line, `看不懂这一行（开头应该是：${Object.values(FLOW_TEXT_KEYWORDS).join(' / ')}）`);
  return null;
}