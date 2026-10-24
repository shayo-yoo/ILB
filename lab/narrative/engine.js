// lab/narrative/engine.js —— 规则匹配、作用应用、状态重放（纯函数，零依赖）。
//
// 三条纪律：
//   1. 事实 → 效果是**整条原子**的：任何一条约束不过，整条事实被拒绝，绝不半生效；
//   2. 拒绝要带原因（"背包 8/8 已满"），上层必须显示出来；
//   3. 状态是**重放**出来的：fold(消息 1..N) 而不是"在旧状态上改"。滑动、删消息、刷新
//      都只是重算，不需要版本号。
//
// 规则的触发条件只看"这条事实发生之前"的状态（见 applyFact 里的说明），
// 所以规则表里谁先谁后不会改变语义——这对让用户自己写规则很关键。
//
// 规则不认识变量、写错 op 都在编译期报出来（compileRules），不要在跑的时候静默跳过。

import { cloneState, derive, checkConstraints, isValidValue } from './schema.js';

export const FACT_TYPES = ['gain', 'lose', 'use', 'mark', 'unmark', 'relation', 'move', 'seen', 'tick'];
export const EFFECT_OPS = ['add', 'remove', 'set', 'inc', 'dec', 'mapInc', 'mark', 'unmark', 'reject'];
const MAX_EFFECTS_PER_FACT = 50;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function guardPass(guard, state) {
  if (!isPlainObject(guard)) return true;
  const value = state.vars[guard.var];
  switch (guard.op ?? '==') {
    case '==':
      return value === guard.value;
    case '!=':
      return value !== guard.value;
    case '>':
      return isNum(value) && value > guard.value;
    case '>=':
      return isNum(value) && value >= guard.value;
    case '<':
      return isNum(value) && value < guard.value;
    case '<=':
      return isNum(value) && value <= guard.value;
    case 'has':
      return Array.isArray(value) ? value.includes(guard.value) : Boolean(value?.[guard.value]);
    case 'notHas':
      return Array.isArray(value) ? !value.includes(guard.value) : !value?.[guard.value];
    default:
      return false;
  }
}

function conditionPass(cond, fact, state, catalog) {
  if (!isPlainObject(cond)) return true;
  if (cond.tags && Array.isArray(cond.tags)) {
    for (const tag of cond.tags) {
      const fromFact = Array.isArray(fact.tags) && fact.tags.includes(tag);
      const fromCatalog = fact.name ? catalog?.hasTag?.(fact.name, tag) : false;
      if (!fromFact && !fromCatalog) return false;
    }
  }
  if (cond.name !== undefined) {
    const names = Array.isArray(cond.name) ? cond.name : [cond.name];
    if (!names.includes(fact.name)) return false;
  }
  if (cond.dir !== undefined && fact.dir !== cond.dir) return false;
  if (cond.from !== undefined && fact.from !== cond.from) return false;
  if (cond.to !== undefined && fact.to !== cond.to) return false;
  if (Array.isArray(cond.all)) {
    for (const guard of cond.all) if (!guardPass(guard, state)) return false;
  }
  if (cond.not && conditionPass(cond.not, fact, state, catalog)) return false;
  return true;
}

/** 编译规则表：把引用不存在的变量、不认识的 op/事实类型提前说出来。 */
export function compileRules(rules = [], schema) {
  const problems = [];
  const list = [];
  for (const raw of rules) {
    if (!isPlainObject(raw)) {
      problems.push({ code: 'bad-rule' });
      continue;
    }
    const rule = {
      id: raw.id ?? `rule-${list.length + 1}`,
      on: raw.on ?? 'gain',
      when: raw.when ?? {},
      effects: Array.isArray(raw.effects) ? raw.effects : [],
      note: raw.note ?? '',
      stop: raw.stop === true, // 命中后不再继续匹配后续规则
    };
    if (!FACT_TYPES.includes(rule.on)) problems.push({ code: 'bad-rule-on', id: rule.id, on: rule.on });
    if (rule.effects.length === 0) problems.push({ code: 'rule-without-effects', id: rule.id });
    for (const effect of rule.effects) {
      if (!EFFECT_OPS.includes(effect.op)) problems.push({ code: 'bad-effect-op', id: rule.id, op: effect.op });
      if (effect.var && schema && !schema.vars.has(effect.var)) {
        problems.push({ code: 'effect-unknown-var', id: rule.id, var: effect.var });
      }
    }
    for (const guard of rule.when?.all ?? []) {
      if (schema && !schema.vars.has(guard.var)) problems.push({ code: 'guard-unknown-var', id: rule.id, var: guard.var });
    }
    list.push(rule);
  }
  return { rules: list, problems };
}

/** 把规则里可能的 "$target" 之类替换成事实里的实际值。 */
function resolveValue(effect, fact) {
  let value = effect.value;
  if (value === '$target') value = fact.to ?? fact.name;
  else if (value === '$from') value = fact.from;
  else if (value === '$name') value = fact.name;
  else if (typeof value === 'string' && value.startsWith('$name:')) value = fact[value.slice(6)];
  let amount = effect.amount;
  if (amount === '$count') amount = fact.count ?? 1;
  if (amount === '$sign') amount = fact.sign ?? 1;
  if (amount === '$amount') amount = fact.amount ?? 1;
  return { value, amount };
}

function applyEffect(state, effect, fact, schema, catalog) {
  const decl = schema.vars.get(effect.var);
  if (!decl) return { ok: false, reason: `没有这个变量：${effect.var}` };
  const { value, amount } = resolveValue(effect, fact);
  const before = state.vars[effect.var];
  const step = isNum(amount) ? amount : 1;

  switch (effect.op) {
    case 'add': {
      if (!Array.isArray(before)) return { ok: false, reason: `${effect.var} 不是列表，不能追加` };
      const item = value ?? fact.name;
      if (decl.unique && before.includes(item)) return { ok: true, noop: true, reason: `${effect.var} 里已经有 ${item}（已去重）` };
      state.vars[effect.var] = [...before, item];
      return { ok: true };
    }
    case 'remove': {
      if (!Array.isArray(before)) return { ok: false, reason: `${effect.var} 不是列表，不能移除` };
      const item = value ?? fact.name;
      const at = before.indexOf(item);
      if (at < 0) return { ok: true, noop: true, reason: `${effect.var} 里没有 ${item}，什么都不用做` };
      const copy = [...before];
      copy.splice(at, 1);
      state.vars[effect.var] = copy;
      return { ok: true };
    }
    case 'set': {
      if (value !== undefined && !isValidValue(decl, value)) return { ok: false, reason: `${effect.var} 不接受这个值：${String(value)}` };
      state.vars[effect.var] = value === undefined ? fact.name : value;
      return { ok: true };
    }
    case 'inc':
    case 'dec': {
      if (!isNum(before)) return { ok: false, reason: `${effect.var} 不是数值，不能加减` };
      state.vars[effect.var] = effect.op === 'inc' ? before + step : before - step;
      return { ok: true };
    }
    case 'mapInc': {
      if (!isPlainObject(before)) return { ok: false, reason: `${effect.var} 不是映射，不能按键累加` };
      const key = effect.key === '$name' ? fact.name : effect.key;
      if (typeof key !== 'string') return { ok: false, reason: '映射累加缺少 key' };
      state.vars[effect.var] = { ...before, [key]: (isNum(before[key]) ? before[key] : 0) + step };
      return { ok: true };
    }
    case 'mark':
    case 'unmark': {
      if (decl.type !== 'flag') return { ok: false, reason: `${effect.var} 不是开关` };
      state.vars[effect.var] = effect.op === 'mark';
      return { ok: true };
    }
    default:
      return { ok: false, reason: `不认识的写法：${effect.op}` };
  }
}

/**
 * 应用一条事实：匹配规则 → 收集效果 → 在副本上模拟 → 全量校验 → 通过才落地。
 * @returns {{ok: boolean, state: object, changes: Array, rejected: Array, matched: Array, noops: Array}}
 */
export function applyFact(state, fact, ctx) {
  const { schema, rules, catalog } = ctx;
  const next = cloneState(state);
  const matched = [];
  const changes = [];
  const rejected = [];
  const noops = [];

  for (const rule of rules) {
    if (rule.on !== fact.type) continue;
    // 条件一律用**这条事实之前**的状态判断：同一条事实里，前面规则改出来的值
    // 不许把后面的规则带起来。否则"完成委托"改完任务状态，紧跟着的"委托已完成"
    // 就会以为自己该拒绝——规则表顺序一换语义就变，用户没法推理。
    if (!conditionPass(rule.when, fact, state, catalog)) continue;
    matched.push(rule.id);
    for (const effect of rule.effects) {
      if (effect.onlyIf && !guardPass(effect.onlyIf, state)) continue;
      if (effect.op === 'reject') {
        // 规则可以主动拒绝：这是"背包满了/正在冷却"这类玩法规则的正确表达方式，
        // 比"没有规则匹配"更明确——用户能直接看到原因。
        rejected.push({ code: 'rule-reject', rule: rule.id, reason: effect.reason ?? rule.note ?? '规则拒绝执行' });
        return { ok: false, state, changes: [], rejected, matched, noops };
      }
      if (changes.length >= MAX_EFFECTS_PER_FACT) {
        rejected.push({ code: 'too-many-effects', reason: `一条事实最多 ${MAX_EFFECTS_PER_FACT} 处改动` });
        return { ok: false, state, changes: [], rejected, matched, noops };
      }
      const before = next.vars[effect.var];
      const result = applyEffect(next, effect, fact, schema, catalog);
      if (!result.ok) {
        rejected.push({ code: 'effect-failed', rule: rule.id, var: effect.var, reason: result.reason });
        return { ok: false, state, changes: [], rejected, matched, noops };
      }
      if (result.noop) noops.push({ rule: rule.id, var: effect.var, reason: result.reason });
      else changes.push({ rule: rule.id, var: effect.var, before, after: next.vars[effect.var], note: rule.note });
    }
    if (rule.stop) break;
  }

  if (matched.length === 0) {
    return { ok: true, state, changes: [], rejected: [], matched, noops, unhandled: true };
  }

  const violations = checkConstraints(next, schema, catalog);
  if (violations.length > 0) {
    return {
      ok: false,
      state,
      changes: [],
      rejected: violations.map((v) => ({ code: `constraint-${v.kind}`, var: v.var, reason: v.reason })),
      matched,
      noops,
    };
  }

  return { ok: true, state: next, changes, rejected, matched, noops };
}

/** 处理一条消息里的全部事实（顺序即文本出现顺序）。 */
export function applyFacts(state, facts, ctx) {
  let current = state;
  const log = [];
  for (const fact of facts) {
    const result = applyFact(current, fact, ctx);
    if (result.ok) current = result.state;
    log.push({ fact, ...result });
  }
  return { state: current, log };
}

/**
 * 重放整段对话。
 * @param {Array<{text?: string, manual?: Array}>} entries 每条消息（text 里可含标记，manual 是界面补记的事实）
 * @param {{schema, rules, catalog}} ctx
 * @returns {{state, log, unknowns, problems, derive}}
 */
export function fold(entries, ctx) {
  const { parseFacts } = ctx; // 由 index.js 注入，避免循环依赖
  if (!ctx.initial || !ctx.initial.vars) {
    throw new Error('fold 需要一个初始状态：用 initialState(schema) 得到，或直接传 initial');
  }
  let state = ctx.initial;
  const log = [];
  const unknowns = [];
  let index = -1;

  for (const entry of entries ?? []) {
    index += 1;
    const text = typeof entry === 'string' ? entry : entry?.text ?? '';
    const parsed = parseFacts ? parseFacts(text) : { facts: [], unknowns: [], duplicates: 0, found: 0 };
    const facts = [...parsed.facts, ...(Array.isArray(entry?.manual) ? entry.manual : [])];
    const applied = applyFacts(state, facts, ctx);
    state = applied.state;
    log.push({
      index,
      facts: applied.log.map((row) => ({ ...row })),
      unknowns: parsed.unknowns,
      duplicates: parsed.duplicates,
    });
    if (parsed.unknowns.length) unknowns.push({ index, items: parsed.unknowns });

    // 每条消息末尾自动记一次 tick：给"冷却 N 轮"这类规则用（不是 AI 写的事实）
    const ticked = applyFact(state, { type: 'tick', at: index }, ctx);
    if (ticked.ok) state = ticked.state;
  }

  return { state, log, unknowns, problems: ctx.problems ?? [], derived: ctx.schema ? derive(state, ctx.schema, ctx.catalog) : {} };
}

/** 取"第 index 条消息之后"的状态（含该条）——界面按消息画面板时用它。 */
export function stateAt(entries, ctx, index) {
  const slice = (entries ?? []).slice(0, Math.max(0, index + 1));
  return fold(slice, ctx);
}
