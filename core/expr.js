// core/expr.js —— 纯函数（ILB-4.22）
// 一个"小到可以看懂"的表达式与文本模板求值器。
// 只允许白名单运算符和白名单函数；**没有 eval、没有 new Function、不读任何全局**。
// 目的是让「金币 + 10」「min(金币, 99)」这种日常需求不必拆成一堆底层节点。

export const EXPR_LIMIT = {
  // 一条表达式最长多少字符（防止有人把整段正文粘进来）
  length: 240,
  // 括号/函数最多套多少层
  depth: 12,
  // 一条表达式最多几个记号
  tokens: 400,
};

/** 白名单函数：名字 → {min, max, label, apply}。参数个数不在范围内就报错。 */
export const EXPR_FUNCTIONS = {
  min: { min: 1, max: 8, label: '取较小的', apply: (args) => Math.min(...args) },
  max: { min: 1, max: 8, label: '取较大的', apply: (args) => Math.max(...args) },
  round: { min: 1, max: 2, label: '四舍五入', apply: (args) => roundTo(args[0], args[1] ?? 0) },
  floor: { min: 1, max: 2, label: '向下取整', apply: (args) => floorTo(args[0], args[1] ?? 0) },
  ceil: { min: 1, max: 2, label: '向上取整', apply: (args) => ceilTo(args[0], args[1] ?? 0) },
  abs: { min: 1, max: 1, label: '绝对值', apply: (args) => Math.abs(args[0]) },
  clamp: { min: 3, max: 3, label: '限制在范围内', apply: (args) => Math.min(Math.max(args[0], args[1]), args[2]) },
};

export const EXPR_FUNCTION_NAMES = Object.keys(EXPR_FUNCTIONS);

/** 给界面用：一行说明这个表达式引擎会什么。 */
export const EXPR_HINT = [
  '可以用：数字、变量名、+ - * / % 和括号。',
  `可以用这些函数：${EXPR_FUNCTION_NAMES.map((n) => `${n}()`).join('、')}。`,
  '变量的值不是数字时，这一项会当场报错，不会悄悄变成 0。',
];

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const s = String(value ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function roundTo(value, digits) {
  const d = Math.min(8, Math.max(0, Math.trunc(Number(digits) || 0)));
  const factor = 10 ** d;
  return Math.round(value * factor) / factor;
}

function floorTo(value, digits) {
  const d = Math.min(8, Math.max(0, Math.trunc(Number(digits) || 0)));
  const factor = 10 ** d;
  return Math.floor(value * factor) / factor;
}

function ceilTo(value, digits) {
  const d = Math.min(8, Math.max(0, Math.trunc(Number(digits) || 0)));
  const factor = 10 ** d;
  return Math.ceil(value * factor) / factor;
}

const IDENT_START = /[\p{L}_]/u;
const IDENT_PART = /[\p{L}\p{N}_]/u;

/**
 * 把表达式切成记号。写错了返回 `{ok:false, error}`，不抛异常。
 * 记号只有五种：number / name / op / paren / comma。
 */
export function tokenize(src) {
  const text = String(src ?? '');
  if (text.length > EXPR_LIMIT.length) {
    return { ok: false, error: `表达式太长（超过 ${EXPR_LIMIT.length} 个字符）` };
  }
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      let dots = 0;
      while (j < text.length && /[0-9.]/.test(text[j])) {
        if (text[j] === '.') dots += 1;
        j += 1;
      }
      const raw = text.slice(i, j);
      if (dots > 1 || raw === '.') return { ok: false, error: `数字写错了：「${raw}」` };
      tokens.push({ type: 'number', value: Number(raw), at: i });
      i = j;
      continue;
    }
    if (IDENT_START.test(ch)) {
      let j = i + 1;
      while (j < text.length && IDENT_PART.test(text[j])) j += 1;
      tokens.push({ type: 'name', value: text.slice(i, j), at: i });
      i = j;
      continue;
    }
    if ('+-*/%'.includes(ch)) {
      tokens.push({ type: 'op', value: ch, at: i });
      i += 1;
      continue;
    }
    if (ch === '(' || ch === ')') {
      tokens.push({ type: 'paren', value: ch, at: i });
      i += 1;
      continue;
    }
    if (ch === ',') {
      tokens.push({ type: 'comma', value: ch, at: i });
      i += 1;
      continue;
    }
    return { ok: false, error: `这里有个看不懂的字符：「${ch}」` };
  }
  if (tokens.length > EXPR_LIMIT.tokens) {
    return { ok: false, error: `表达式太复杂（超过 ${EXPR_LIMIT.tokens} 个记号）` };
  }
  return { ok: true, tokens };
}

/**
 * 解析成语法树。只做递归下降，不用第三方库。
 * 优先级：括号 / 函数 > 正负号 > 乘除取余 > 加减。
 */
export function parseExpression(src) {
  const lexed = tokenize(src);
  if (!lexed.ok) return lexed;
  const tokens = lexed.tokens;
  if (tokens.length === 0) return { ok: false, error: '表达式是空的' };

  let pos = 0;
  let depth = 0;

  function peek() {
    return tokens[pos] ?? null;
  }

  function take(type, value) {
    const token = tokens[pos];
    if (!token) return null;
    if (token.type !== type) return null;
    if (value !== undefined && token.value !== value) return null;
    pos += 1;
    return token;
  }

  function parseExpr() {
    const left = parseTerm();
    if (!left.ok) return left;
    while (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = take('op').value;
      const right = parseTerm();
      if (!right.ok) return right;
      left.node = { kind: 'binary', op, left: left.node, right: right.node };
      left.const = null;
    }
    return left;
  }

  function parseTerm() {
    const left = parseUnary();
    if (!left.ok) return left;
    while (peek() && peek().type === 'op' && ('*/%'.includes(peek().value))) {
      const op = take('op').value;
      const right = parseUnary();
      if (!right.ok) return right;
      left.node = { kind: 'binary', op, left: left.node, right: right.node };
      left.const = null;
    }
    return left;
  }

  function parseUnary() {
    const token = peek();
    if (token && token.type === 'op' && (token.value === '-' || token.value === '+')) {
      pos += 1;
      const inner = parseUnary();
      if (!inner.ok) return inner;
      if (token.value === '-') {
        return {
          ok: true,
          node: { kind: 'unary', op: '-', value: inner.node },
          const: inner.const === null ? null : -inner.const,
        };
      }
      return inner;
    }
    return parsePrimary();
  }

  function parsePrimary() {
    depth += 1;
    if (depth > EXPR_LIMIT.depth) {
      return { ok: false, error: `括号套得太深（超过 ${EXPR_LIMIT.depth} 层）` };
    }
    try {
      const token = peek();
      if (!token) return { ok: false, error: '式子没写完' };
      if (token.type === 'number') {
        pos += 1;
        return { ok: true, node: { kind: 'number', value: token.value }, const: token.value };
      }
      if (token.type === 'name') {
        pos += 1;
        const name = token.value;
        if (peek() && peek().type === 'paren' && peek().value === '(') {
          const fn = EXPR_FUNCTIONS[name];
          if (!fn) {
            return { ok: false, error: `没有这个函数：${name}（能用的是 ${EXPR_FUNCTION_NAMES.join('、')}）` };
          }
          pos += 1; // (
          const args = [];
          if (peek() && peek().type === 'paren' && peek().value === ')') {
            pos += 1;
          } else {
            for (;;) {
              const arg = parseExpr();
              if (!arg.ok) return arg;
              args.push(arg.node);
              const comma = take('comma');
              if (comma) continue;
              const close = take('paren', ')');
              if (!close) return { ok: false, error: `${name}(...) 的括号没关` };
              break;
            }
          }
          if (args.length < fn.min || args.length > fn.max) {
            return { ok: false, error: `${name}() 要 ${fn.min === fn.max ? fn.min : `${fn.min}–${fn.max}`} 个参数，现在给了 ${args.length} 个` };
          }
          return { ok: true, node: { kind: 'call', name, args }, const: null };
        }
        return { ok: true, node: { kind: 'var', name }, const: null };
      }
      if (token.type === 'paren' && token.value === '(') {
        pos += 1;
        const inner = parseExpr();
        if (!inner.ok) return inner;
        if (!take('paren', ')')) return { ok: false, error: '括号没关' };
        return inner;
      }
      return { ok: false, error: `这里不该出现「${token.value}」` };
    } finally {
      depth -= 1;
    }
  }

  const parsed = parseExpr();
  if (!parsed.ok) return parsed;
  if (pos < tokens.length) {
    return { ok: false, error: `式子后面还有多余的东西：「${tokens[pos].value}」` };
  }
  return { ok: true, node: parsed.node };
}

/** 列出表达式里出现的变量名（去重，保持出现顺序）。 */
export function expressionVars(src) {
  const parsed = parseExpression(src);
  if (!parsed.ok) return [];
  const out = [];
  const walk = (node) => {
    if (!node) return;
    if (node.kind === 'var') {
      if (!out.includes(node.name)) out.push(node.name);
      return;
    }
    if (node.kind === 'binary') {
      walk(node.left);
      walk(node.right);
      return;
    }
    if (node.kind === 'unary') {
      walk(node.value);
      return;
    }
    if (node.kind === 'call') for (const a of node.args) walk(a);
  };
  walk(parsed.node);
  return out;
}

function evalNode(node, vars, missing) {
  if (node.kind === 'number') return { ok: true, value: node.value };
  if (node.kind === 'var') {
    const name = node.name;
    if (!vars || !Object.prototype.hasOwnProperty.call(vars, name)) {
      missing.push(name);
      return { ok: false, error: `没有这个变量：${name}` };
    }
    const n = toNumber(vars[name]);
    if (n === null) return { ok: false, error: `变量 ${name} 的值「${String(vars[name])}」不是数字` };
    return { ok: true, value: n };
  }
  if (node.kind === 'unary') {
    const inner = evalNode(node.value, vars, missing);
    if (!inner.ok) return inner;
    return { ok: true, value: -inner.value };
  }
  if (node.kind === 'binary') {
    const left = evalNode(node.left, vars, missing);
    if (!left.ok) return left;
    const right = evalNode(node.right, vars, missing);
    if (!right.ok) return right;
    switch (node.op) {
      case '-': return { ok: true, value: left.value - right.value };
      case '*': return { ok: true, value: left.value * right.value };
      case '/':
        if (right.value === 0) return { ok: false, error: '除数是 0' };
        return { ok: true, value: left.value / right.value };
      case '%':
        if (right.value === 0) return { ok: false, error: '取余的除数是 0' };
        return { ok: true, value: left.value % right.value };
      default: return { ok: true, value: left.value + right.value };
    }
  }
  if (node.kind === 'call') {
    const fn = EXPR_FUNCTIONS[node.name];
    if (!fn) return { ok: false, error: `没有这个函数：${node.name}` };
    const args = [];
    for (const arg of node.args) {
      const value = evalNode(arg, vars, missing);
      if (!value.ok) return value;
      args.push(value.value);
    }
    return { ok: true, value: fn.apply(args) };
  }
  return { ok: false, error: '看不懂的式子' };
}

/**
 * 求一条表达式的值。
 * @returns {{ok: boolean, value?: number, error?: string, missing: string[]}}
 */
export function evalExpression(src, vars = {}) {
  const parsed = parseExpression(src);
  if (!parsed.ok) return { ok: false, error: parsed.error, missing: [] };
  const missing = [];
  const result = evalNode(parsed.node, vars && typeof vars === 'object' ? vars : {}, missing);
  if (!result.ok) return { ...result, missing };
  return { ok: true, value: result.value, missing };
}

/** 数字显示成人读的样子：整数不带小数点，小数最多留 4 位。 */
export function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toFixed(4)));
}

const TEMPLATE_RE = /\{\{([^{}]*)\}\}/g;
const TEMPLATE_LIMIT = 4000;
const BARE_NAME = /^[\p{L}_][\p{L}\p{N}_]*$/u;

/**
 * 文本模板插值：把 `{{表达式}}` 换成值。
 * 找不到变量时**不静默变 undefined**：原文留一个醒目的 `⟨未定义:名字⟩`，并把缺失的名字交回去。
 * 为了兼容老数据，`{{ILB:名字}}` 仍然按"变量路径"处理（与 core/vars.js 的宏同一个意思）。
 * @returns {{text: string, missing: string[], errors: {expr: string, error: string}[]}}
 */
export function interpolate(text, vars = {}) {
  const raw = String(text ?? '');
  const missing = [];
  const errors = [];
  if (!raw) return { text: raw, missing, errors };
  const source = raw.length > TEMPLATE_LIMIT ? raw.slice(0, TEMPLATE_LIMIT) : raw;
  const out = source.replace(TEMPLATE_RE, (whole, inner) => {
    const expr = String(inner ?? '').trim();
    if (!expr) return whole;
    const pool = vars && typeof vars === 'object' ? vars : {};
    if (expr.startsWith('ILB:')) {
      const path = expr.slice(4).trim();
      const key = path.startsWith('chat.') ? path.slice(5) : path;
      if (Object.prototype.hasOwnProperty.call(pool, key)) return stringify(pool[key]);
      missing.push(path);
      return `⟨未定义:${path}⟩`;
    }
    // 只写一个变量名时按"填值"理解：开关显示成开/关，文本原样，不硬转成数字。
    if (BARE_NAME.test(expr) && Object.prototype.hasOwnProperty.call(pool, expr)) {
      return stringify(pool[expr]);
    }
    const result = evalExpression(expr, pool);
    if (result.ok) return formatNumber(result.value);
    for (const name of result.missing) if (!missing.includes(name)) missing.push(name);
    errors.push({ expr, error: result.error });
    const label = result.missing.length > 0 ? result.missing.join('、') : expr;
    return `⟨未定义:${label}⟩`;
  });
  return { text: out, missing, errors };
}

function stringify(value) {
  if (value === true) return '开';
  if (value === false) return '关';
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return formatNumber(value);
  return String(value);
}

/** 模板里出现的变量名（去重）。给静态验证器用。 */
export function templateVars(text) {
  const out = [];
  const raw = String(text ?? '');
  TEMPLATE_RE.lastIndex = 0;
  let match = TEMPLATE_RE.exec(raw);
  while (match) {
    const expr = String(match[1] ?? '').trim();
    if (expr.startsWith('ILB:')) {
      const path = expr.slice(4).trim();
      const key = path.startsWith('chat.') ? path.slice(5) : path;
      if (key && !out.includes(key)) out.push(key);
    } else {
      for (const name of expressionVars(expr)) if (!out.includes(name)) out.push(name);
    }
    match = TEMPLATE_RE.exec(raw);
  }
  return out;
}
