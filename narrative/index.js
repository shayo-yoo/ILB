// narrative/index.js —— 叙事引擎门面（v0.6.0 起并入扩展）。
//
// 这一层是纯计算：不 import 扩展的 DOM / 宿主 / 适配层，也不认识 SillyTavern。
// 接入工作全部在 narrative/adapter.js（聊天事件、注入、消息块），因此引擎可以
// 单独跑测试（tests/narrative.test.mjs），也可以在 node 里跑演示（tests/narrative-demo.mjs）。
// 关掉开关时适配层什么都不做，行为与 v0.5.0 完全一致。
//
// 用法：
//   const ilb = createNarrative({ schema, catalog, rules });
//   const state = ilb.initial();
//   const { facts, unknowns } = ilb.parse(text);
//   const result = ilb.apply(state, facts[0]);
//   const final = ilb.fold(messages);

import { compileSchema, initialState, derive, checkConstraints, TYPES } from './schema.js';
import { compileCatalog } from './catalog.js';
import { parseFacts, stripFacts, describeFact, FACT_OPS, buildVerbMap } from './facts.js';
import { compileRules, applyFact, applyFacts, fold, stateAt } from './engine.js';
import { renderPrompt, renderLines, describeChanges, summarize, lineOf } from './render.js';

export const NARRATIVE_VERSION = '0.7.0';

/**
 * 把声明编译成一个可直接用的上下文。
 * @param {{
 *   schema?: object, catalog?: object, rules?: Array,
 *   events?: Array<string|{id:string,label?:string}>,
 *   verbs?: Record<string,string>
 * }} spec
 */
export function createNarrative(spec = {}) {
  const schema = compileSchema(spec.schema ?? {});
  const catalog = compileCatalog(spec.catalog ?? {});

  // 自定义事件与别名：解析层只有这一处入口，规则仍然按 `on` 分发。
  const events = (Array.isArray(spec.events) ? spec.events : [])
    .map((raw) => (typeof raw === 'string' ? { id: raw } : raw))
    .filter((raw) => raw && typeof raw.id === 'string' && raw.id.trim())
    .map((raw) => ({ id: raw.id.trim(), label: raw.label ?? raw.id }));
  const verbs = buildVerbMap({ events, verbs: spec.verbs ?? {} });

  const compiledRules = compileRules(spec.rules ?? [], schema, events);

  const problems = [...schema.problems, ...catalog.problems, ...compiledRules.problems];
  const ctx = {
    schema,
    catalog,
    rules: compiledRules.rules,
    initial: initialState(schema),
    parseFacts: (text) => parseFacts(text, verbs),
    problems,
  };

  return {
    version: NARRATIVE_VERSION,
    schema,
    catalog,
    rules: ctx.rules,
    events,
    verbs,
    problems,
    initial: () => initialState(schema),
    parse: (text) => parseFacts(text, verbs),
    strip: (text) => stripFacts(text),
    describeFact,
    apply: (state, fact) => applyFact(state, fact, ctx),
    applyMany: (state, facts) => applyFacts(state, facts, ctx),
    fold: (entries) => fold(entries, ctx),
    stateAt: (entries, index) => stateAt(entries, ctx, index),
    derive: (state) => derive(state, schema, catalog),
    render: (state, options) => renderPrompt(state, { ...ctx, derived: derive(state, schema, catalog), ...options }),
    lines: (state) => renderLines(state, { schema, derived: derive(state, schema, catalog) }),
    summary: (state) => summarize(state, { schema, derived: derive(state, schema, catalog) }),
    changes: (changes) => describeChanges(changes),
    facts: FACT_OPS,
  };
}

export { compileSchema, initialState, derive, checkConstraints, TYPES } from './schema.js';
export { compileCatalog, describeCatalog } from './catalog.js';
export { parseFacts, stripFacts, describeFact, FACT_OPS, OP_LABEL, buildVerbMap } from './facts.js';
export { compileRules, applyFact, applyFacts, fold, stateAt, FACT_TYPES, EFFECT_OPS } from './engine.js';
export { renderPrompt, renderLines, describeChanges, summarize, lineOf } from './render.js';
