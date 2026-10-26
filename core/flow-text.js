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
  makeNode,
  normalizeFlow,
  MAX_DEPTH,
} from './flow.js';

/** 文本模式里每种节点的开头词。故意和 FLOW_KIND_LABEL 不完全一样：这里要短、要好打。 */
export const FLOW_TEXT_KEYWORDS = {
  test: '检测',
  judge: '判定',
  compare: '比较',
  define: '定义',
  calc: '计算',
  random: '随机数',
  add: '添加',
  remember: '记住',
  activate: '激活',
  goto: '跳转',
  call: '调用',
  pass: '通过',
  fail: '不通过',
};

const MODE_ONLY = '只看流程';
const MODE_AND = '关键词 + 流程';
const BRANCH_THEN = '成立';
const BRANCH_ELSE = '不成立';
const COND_PREFIX = '条件';
const INDENT = '  ';

/** 给界面与 AI 看的写法说明（和 FLOW_KIND_HINT 一样，是文案不是逻辑）。 */
export const FLOW_TEXT_HINT = [
  '一个节点一行，写在分支里的行往右缩进两格。',
  '三种值：$名字 是变量，12 是数字，"文字" 是文本（带引号）。',
  '引用别的东西：激活 #条目名、调用 >逻辑名、跳转 @2✓.1（位置）。',
  '判断节点写在上一行，它的两个分支各占一块，块头就是「成立」和「不成立」。',
  `开头可以写一行「${MODE_ONLY}」或「${MODE_AND}」；不写按后者算。`,
  '以 // 开头的行是注释，不参与执行，切换模式后会丢掉。',
  '看不懂的行会被列出来，不会瞎猜；能看懂的部分照常生效。',
].join('\n');

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
  return kind === 'test' || kind === 'judge' || kind === 'compare';
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
      if (isBranchKind(node.kind) && Array.isArray(node.conditions)) {
        node.conditions.forEach((cond) => {
          lines.push(`${INDENT.repeat(depth + 1)}${COND_PREFIX} ${renderCondition(cond, entries)}`);
        });
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
    case 'define':
      return `定义 $${node.name || ''} = ${renderOperand(node.value)}`;
    case 'calc':
      return `计算 $${node.target || ''} = ${renderOperand(node.left)} ${node.op} ${renderOperand(node.right)}${node.persist ? ' [存]' : ''}`;
    case 'random':
      return `随机数 $${node.target || ''} = ${node.min}..${node.max}${node.integer ? '' : ' [小数]'}${node.persist ? '' : ' [临时]'}`;
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
    case 'pass':
      return '通过';
    case 'fail':
      return '不通过';
    default:
      return `${FLOW_KIND_LABEL[node.kind] ?? node.kind}`;
  }
}

// —— 解析 ——

/** 把文本切成带缩进的行；空行与 // 注释丢掉，行号保留原样给人报错用。 */
function toLines(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((raw, index) => {
      const expanded = raw.replace(/\t/g, INDENT);
      const body = expanded.trim();
      return { no: index + 1, indent: expanded.length - expanded.trimStart().length, body };
    })
    .filter((line) => line.body !== '' && !line.body.startsWith('//'));
}

const GOTO_RE = /^跳转\s+@(\S*)\s*最多\s*(\d+)\s*次\s*超了\s*(跳过继续|终止)$/;
const JUDGE_RE = /^判定\s+(全部满足|任一满足)$/;
const COMPARE_RE = /^比较\s+(.+?)\s*(>=|<=|==|!=|>|<)\s*(.+)$/;
const CALC_RE = /^计算\s+(\$[^\s]+)\s*=\s*(.+?)\s*(\+|-|\*|\/|min|max)\s+(.+?)(\s*\[存\])?$/;
const DEFINE_RE = /^定义\s+(\$[^\s]+)\s*=\s*(.*)$/;
const REMEMBER_RE = /^记住\s+(\$[^\s]+)\s*=\s*(.*)$/;
const RANDOM_RE = /^随机数\s+(\$[^\s]+)\s*=\s*(-?\d+)\s*\.\.\s*(-?\d+)(\s*\[小数\])?(\s*\[临时\])?$/;
const ADD_RE = /^添加\s+(".*")$/;
const ACTIVATE_RE = /^激活\s+(#\S.*)$/;
const CALL_RE = /^调用\s+(>\S.*)$/;
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
        note(line, '这一行缩进多了，它上面没有能装下它的分支');
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

      // 判定节点的条件行（在分支之前）
      if (node.kind === 'judge') {
        while (i < lines.length && lines[i].indent > indent && lines[i].body.startsWith(`${COND_PREFIX} `)) {
          const bare = lines[i].body.slice(COND_PREFIX.length + 1);
          const got = parseCondition(bare, entries);
          if (got.reason) note(lines[i], got.reason);
          else node.conditions.push({ id: nextCondId(), ...got.cond });
          i += 1;
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
        delete node.lineNo;
      }
      fixGoto(node.then ?? []);
      fixGoto(node.else ?? []);
    });
  })(built.nodes);

  const flow = normalizeFlow({ mode, nodes: built.nodes });
  return { flow, problems };
}

let condCounter = 0;
function nextCondId() {
  condCounter += 1;
  return `t-${Date.now().toString(36)}-${condCounter.toString(36)}`;
}

/**
 * 读一行节点。看不懂返回 null 并记一条问题。
 * @returns {object|null}
 */
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
      note(line, '比较要写成：比较 $生命 > 0');
      return null;
    }
    if (!COMPARE_OPS.includes(m[2])) {
      note(line, `不认识的比较符：${m[2]}`);
      return null;
    }
    const left = parseOperand(m[1]);
    const right = parseOperand(m[3]);
    if (!left || !right) {
      note(line, '比较的两边只能是 $变量、数字或 "文本"');
      return null;
    }
    return { ...makeNode('compare'), left, op: m[2], right };
  }

  if (body.startsWith(`${FLOW_TEXT_KEYWORDS.calc} `)) {
    const m = CALC_RE.exec(body);
    if (!m) {
      note(line, '计算要写成：计算 $生命 = $生命 - 1 [存]');
      return null;
    }
    if (!CALC_OPS.includes(m[3])) {
      note(line, `不认识的运算符：${m[3]}`);
      return null;
    }
    const left = parseOperand(m[2]);
    const right = parseOperand(m[4]);
    if (!left || !right) {
      note(line, '计算的两边只能是 $变量、数字或 "文本"');
      return null;
    }
    return { ...makeNode('calc'), target: m[1].slice(1), op: m[3], left, right, persist: Boolean(m[5]) };
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
      note(line, '随机数要写成：随机数 $点数 = 1..6 [小数] [临时]');
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

  if (body.startsWith(`${FLOW_TEXT_KEYWORDS.goto} `)) {
    const m = GOTO_RE.exec(body);
    if (!m) {
      note(line, '跳转要写成：跳转 @2✓.1 最多20次 超了终止');
      return null;
    }
    const node = { ...makeNode('goto'), target: '', max: Number(m[2]), onLimit: m[3] === '跳过继续' ? 'continue' : 'stop' };
    node.wanted = m[1];
    node.lineNo = line.no;
    return node;
  }

  if (VAR_RE_LINE.test(body)) return null; // 变量条件只能出现在「条件」行里

  if (body === '通过') return makeNode('pass');
  if (body === '不通过') return makeNode('fail');

  note(line, `看不懂这一行（开头应该是：${Object.values(FLOW_TEXT_KEYWORDS).join(' / ')}）`);
  return null;
}