// lab/narrative/index.js —— 叙事引擎门面（子项目 v0.1.0-lab）。
//
// 这是 ILB 的**下一个子项目**，与已发布的扩展（v0.5.0）完全隔离：
//   - 不 import 扩展里的任何模块（只 import 本目录的兄弟文件）；
//   - 不被 index.js / manifest.json 引用，装上扩展也不会加载它；
//   - 自己带测试（lab/tests），可以在 node 里独立跑完。
// 只有等它被验证过，才会写适配层接进主管线（见 lab/README.md 的合并条件）。
//
// 用法：
//   const ilb = createNarrative({ schema, catalog, rules });
//   const state = ilb.initial();
//   const { facts, unknowns } = ilb.parse(text);
//   const result = ilb.apply(state, facts[0]);
//   const final = ilb.fold(messages);

import { compileSchema, initialState, derive, checkConstraints, TYPES } from './schema.js';
import { compileCatalog } from './catalog.js';
import { parseFacts, stripFacts, describeFact, FACT_OPS } from './facts.js';
import { compileRules, applyFact, applyFacts, fold, stateAt } from './engine.js';
import { renderPrompt, renderLines, describeChanges, summarize, lineOf } from './render.js';

export const NARRATIVE_VERSION = '0.1.0-lab';

/**
 * 把三份声明编译成一个可直接用的上下文。
 * @param {{schema?: object, catalog?: object, rules?: Array}} spec
 */
export function createNarrative(spec = {}) {
  const schema = compileSchema(spec.schema ?? {});
  const catalog = compileCatalog(spec.catalog ?? {});
  const compiledRules = compileRules(spec.rules ?? [], schema);

  const problems = [...schema.problems, ...catalog.problems, ...compiledRules.problems];
  const ctx = {
    schema,
    catalog,
    rules: compiledRules.rules,
    initial: initialState(schema),
    parseFacts,
    problems,
  };

  return {
    version: NARRATIVE_VERSION,
    schema,
    catalog,
    rules: ctx.rules,
    problems,
    initial: () => initialState(schema),
    parse: (text) => parseFacts(text),
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
export { parseFacts, stripFacts, describeFact, FACT_OPS, OP_LABEL } from './facts.js';
export { compileRules, applyFact, applyFacts, fold, stateAt, FACT_TYPES, EFFECT_OPS } from './engine.js';
export { renderPrompt, renderLines, describeChanges, summarize, lineOf } from './render.js';
