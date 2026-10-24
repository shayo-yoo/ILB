// narrative/schema.js —— 叙事引擎的"状态长什么样、什么算合法"（纯函数，零依赖）。
//
// 这一层只做三件事：
//   1. 把用户写的声明编译成可检查的结构（类型、初值、约束）；
//   2. 给出"某个值属于这个类型吗"的判定；
//   3. 检查一份状态是否满足全部约束（容量、范围、互斥、前置）。
//
// 它不认识 SillyTavern、不认识 DOM、不认识界面。所有函数都可以在 node 里直接跑。
//
// 设计纪律（见 docs/决策记录.md D-0040）：
//   - 能算的都不许存：数量、剩余格、总重量一律由 schema 从当前值算出来；
//   - 约束是声明，不是代码：加一个"背包容 8 格"不需要改这里的任何一行；
//   - 类型只有六种，够用且封闭：text / number / flag / list / map / enum。

export const TYPES = ['text', 'number', 'flag', 'list', 'map', 'enum'];

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v) => typeof v === 'string';

function problem(list, code, detail = {}) {
  list.push({ code, ...detail });
  return null;
}

/** 把一条变量声明补全成编译后的形状；写错就记一条 problem，不抛错。 */
function normalizeDecl(raw, problems) {
  const d = {
    name: raw.name,
    type: raw.type,
    label: raw.label ?? raw.name,
    init: raw.init,
    of: raw.of ?? null, // list：元素所属的目录类型（item / character / place）
    unique: raw.unique === true, // list：是否去重
    options: Array.isArray(raw.options) ? [...raw.options] : null, // enum
    constraints: Array.isArray(raw.constraints) ? raw.constraints.map((c) => ({ ...c })) : [],
    note: raw.note ?? '',
    private: raw.private === true, // 不参与注入渲染（例如纯内部计数器）
  };

  if (d.type === 'list' && d.init === undefined) d.init = [];
  if (d.type === 'map' && d.init === undefined) d.init = {};
  if (d.type === 'flag' && d.init === undefined) d.init = false;
  if (d.type === 'number' && d.init === undefined) d.init = 0;
  if (d.type === 'text' && d.init === undefined) d.init = '';
  if (d.type === 'enum') {
    if (!d.options || d.options.length === 0) {
      problem(problems, 'enum-without-options', { name: d.name });
      d.options = [];
    }
    if (d.init === undefined) d.init = d.options[0] ?? '';
    if (d.init !== undefined && d.options.length && !d.options.includes(d.init)) {
      problem(problems, 'enum-init-not-in-options', { name: d.name, init: d.init });
    }
  }

  if (!isValidValue(d, d.init)) {
    problem(problems, 'bad-init', { name: d.name, type: d.type, init: d.init });
  }
  return d;
}

/** 值是否符合某个声明（用于校验写入）。 */
export function isValidValue(decl, value) {
  if (!decl) return false;
  switch (decl.type) {
    case 'text':
      return isStr(value);
    case 'number':
      return isNum(value);
    case 'flag':
      return typeof value === 'boolean';
    case 'list':
      return Array.isArray(value) && value.every((v) => isStr(v) || isNum(v));
    case 'map':
      return isPlainObject(value) && Object.values(value).every((v) => isStr(v) || isNum(v));
    case 'enum':
      return isStr(value) && (decl.options ?? []).includes(value);
    default:
      return false;
  }
}

/**
 * 编译一份声明。
 * @param {{vars?: Array, constraints?: Array}} spec
 * @returns {{vars: Map, order: string[], constraints: Array, problems: Array}}
 */
export function compileSchema(spec = {}) {
  const problems = [];
  const vars = new Map();
  const order = [];
  const list = Array.isArray(spec) ? spec : (spec.vars ?? []);

  for (const raw of list) {
    if (!isPlainObject(raw)) {
      problem(problems, 'bad-decl');
      continue;
    }
    if (!isStr(raw.name) || raw.name.trim() === '') {
      problem(problems, 'bad-name', { name: raw.name });
      continue;
    }
    if (vars.has(raw.name)) {
      problem(problems, 'duplicate', { name: raw.name });
      continue;
    }
    if (!TYPES.includes(raw.type)) {
      problem(problems, 'bad-type', { name: raw.name, type: raw.type });
      continue;
    }
    const decl = normalizeDecl(raw, problems);
    vars.set(decl.name, decl);
    order.push(decl.name);
  }

  // 变量自带的约束 + 全局约束，合成一张表
  const constraints = [];
  for (const name of order) {
    const decl = vars.get(name);
    for (const c of decl.constraints) constraints.push({ ...c, var: name });
  }
  for (const c of Array.isArray(spec.constraints) ? spec.constraints : []) {
    constraints.push({ ...c });
  }

  // 约束本身写错（引用不存在的变量、缺参数）要在编译期就说清楚
  for (const c of constraints) {
    const targets = c.var ? [c.var] : Array.isArray(c.vars) ? c.vars : [];
    for (const t of targets) {
      if (!vars.has(t)) problem(problems, 'constraint-unknown-var', { var: t, kind: c.kind });
    }
    if (c.kind === 'max' && !isNum(c.value)) problem(problems, 'constraint-bad-value', { var: c.var });
    if (c.kind === 'range' && !(isNum(c.min) || isNum(c.max))) problem(problems, 'constraint-bad-range', { var: c.var });
    if (c.kind === 'sumMax' && (!isStr(c.field) || !isNum(c.value))) problem(problems, 'constraint-bad-sum', { var: c.var });
    if (c.kind === 'mutex' && (!Array.isArray(c.vars) || c.vars.length < 2)) problem(problems, 'constraint-bad-mutex');
  }

  return { vars, order, constraints, problems };
}

/** 空状态：按声明填初值（深拷贝，避免多个状态共享同一个数组）。 */
export function initialState(schema) {
  const vars = {};
  for (const name of schema.order) {
    const decl = schema.vars.get(name);
    vars[name] = cloneValue(decl.init);
  }
  return { vars };
}

export function cloneValue(value) {
  if (Array.isArray(value)) return [...value];
  if (isPlainObject(value)) return { ...value };
  return value;
}

export function cloneState(state) {
  const vars = {};
  for (const key of Object.keys(state.vars)) vars[key] = cloneValue(state.vars[key]);
  return { vars };
}

/** 列表里某个值的"权重"：查目录，查不到按 0 算（不猜）。 */
export function weightOf(catalog, decl, value) {
  if (!catalog || typeof value !== 'string') return 0;
  const entity = catalog.lookup?.(value);
  if (!entity) return 0;
  const w = entity.weight ?? entity.fields?.weight;
  return isNum(w) ? w : 0;
}

/** 派生值：数量、剩余、总重量、是否满、互斥冲突……全是算出来的，不存储。 */
export function derive(state, schema, catalog) {
  const out = {};
  for (const name of schema.order) {
    const decl = schema.vars.get(name);
    const value = state.vars[name];
    if (decl.type === 'list') {
      out[name] = { 数量: value.length };
      const cap = (schema.constraints ?? []).find((c) => c.kind === 'max' && c.var === name);
      if (cap) {
        out[name].上限 = cap.value;
        out[name].剩余 = Math.max(0, cap.value - value.length);
        out[name].满 = value.length >= cap.value;
      }
      const sum = (schema.constraints ?? []).find((c) => c.kind === 'sumMax' && c.var === name);
      if (sum) {
        const total = value.reduce((acc, v) => acc + weightOf(catalog, decl, v), 0);
        out[name].总重量 = total;
        out[name].重量上限 = sum.value;
        out[name].超重 = total > sum.value;
      }
    } else if (decl.type === 'map') {
      out[name] = { 数量: Object.keys(value).length };
    } else if (decl.type === 'number') {
      out[name] = { 值: value };
    }
  }
  return out;
}

/**
 * 检查一份状态是否满足全部约束。
 * @returns {Array<{kind: string, var: string, reason: string}>} 空数组表示合法
 */
export function checkConstraints(state, schema, catalog) {
  const bad = [];
  for (const c of schema.constraints ?? []) {
    if (c.kind === 'max') {
      const v = state.vars[c.var];
      if (Array.isArray(v) && v.length > c.value) {
        bad.push({ kind: 'max', var: c.var, reason: `${c.var}已满：上限 ${c.value} 件，这一件会让它变成 ${v.length} 件` });
      }
    } else if (c.kind === 'range') {
      const v = state.vars[c.var];
      if (isNum(v)) {
        if (isNum(c.min) && v < c.min) bad.push({ kind: 'range', var: c.var, reason: `${c.var}=${v} 低于下限 ${c.min}` });
        if (isNum(c.max) && v > c.max) bad.push({ kind: 'range', var: c.var, reason: `${c.var}=${v} 超过上限 ${c.max}` });
      }
    } else if (c.kind === 'sumMax') {
      const v = state.vars[c.var];
      if (Array.isArray(v)) {
        const total = v.reduce((acc, item) => acc + weightOf(catalog, null, item), 0);
        if (total > c.value) bad.push({ kind: 'sumMax', var: c.var, reason: `${c.var} 总重量 ${total} 超过上限 ${c.value}` });
      }
    } else if (c.kind === 'mutex') {
      const on = (c.vars ?? []).filter((n) => state.vars[n] === true);
      if (on.length > 1) bad.push({ kind: 'mutex', var: (c.vars ?? []).join('/'), reason: `${on.join(' 与 ')} 不能同时为真` });
    } else if (c.kind === 'require') {
      const gate = c.when ? state.vars[c.when.var] === c.when.equals : true;
      const v = state.vars[c.var];
      const filled = Array.isArray(v) ? v.length > 0 : Boolean(v);
      if (gate && !filled && c.must === true) {
        bad.push({ kind: 'require', var: c.var, reason: `${c.var} 不能为空（${c.when?.var} 满足条件时）` });
      }
    }
  }
  return bad;
}
