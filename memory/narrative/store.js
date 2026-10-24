// narrative/store.js —— 叙事引擎的设置与声明编译（不碰 DOM）。
//
// 设置存在 extension_settings.independent_lorebook.settings 里（和扩展其它设置同一个桶），
// 键名前缀 narrative，便于一眼认出归属：
//   narrativeEnabled       总开关，默认 false（新功能默认不介入，ILB-6.5.1）
//   narrativeInject        是否把账本写进提示词，默认 true（只在总开关打开时才有意义）
//   narrativeBudget        注入正文的字符预算，默认 600（不含固定前言）
//   narrativeDeclaration   用户自己的声明；null/缺省 = 用 narrative/preset.js 的内置示例
//
// 为什么不把状态也存起来：状态是聊天记录重放出来的（D-0040 第三条），存了就会和
// 聊天记录不一致——滑动、删除、编辑消息之后，存下来的那份就变成第二个真相。

import { createNarrative } from './index.js';
import { PRESET } from './preset.js';

export const NARRATIVE_DEFAULTS = Object.freeze({
  narrativeEnabled: false,
  narrativeInject: true,
  narrativeBudget: 600,
  narrativeDeclaration: null,
  narrativeCheckpointEvery: 5,
});

export const BUDGET_MIN = 120;
export const BUDGET_MAX = 2000;
export const CHECKPOINT_MIN = 0;
export const CHECKPOINT_MAX = 50;

function clampBudget(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return NARRATIVE_DEFAULTS.narrativeBudget;
  return Math.min(BUDGET_MAX, Math.max(BUDGET_MIN, Math.round(raw)));
}

function clampCheckpoint(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return NARRATIVE_DEFAULTS.narrativeCheckpointEvery;
  return Math.min(CHECKPOINT_MAX, Math.max(CHECKPOINT_MIN, Math.round(raw)));
}

/**
 * 从扩展的 settings 里取出叙事引擎这一份。
 * @param {object} settings repository.getSettings() 的返回值
 */
export function readNarrativeSettings(settings = {}) {
  const custom = settings.narrativeDeclaration;
  const customOk = custom !== null && typeof custom === 'object' && !Array.isArray(custom);
  return {
    enabled: settings.narrativeEnabled === true,
    inject: settings.narrativeInject !== false,
    budget: clampBudget(settings.narrativeBudget ?? NARRATIVE_DEFAULTS.narrativeBudget),
    checkpointEvery: clampCheckpoint(settings.narrativeCheckpointEvery ?? NARRATIVE_DEFAULTS.narrativeCheckpointEvery),
    declaration: customOk ? custom : PRESET,
    usingPreset: !customOk,
  };
}

/**
 * 编译声明。编译失败不抛出来：上层要把原因显示在界面上（失败必须出声）。
 * @returns {{narrative: object|null, error: string}}
 */
export function compileDeclaration(declaration) {
  try {
    return { narrative: createNarrative(declaration ?? {}), error: '' };
  } catch (err) {
    return { narrative: null, error: String(err?.message ?? err) };
  }
}

/**
 * 给人看的声明摘要：几个变量、几条规则、几个问题。
 * 编译问题不在这里修——原样交出去，由界面显示。
 */
export function describeDeclaration(declaration) {
  const { narrative, error } = compileDeclaration(declaration);
  if (error || !narrative) {
    return { ok: false, error, variables: 0, rules: 0, problems: [], problemText: error };
  }
  const problems = narrative.problems ?? [];
  const problemText = problems
    .slice(0, 5)
    .map((p) => p.code + (p.id ? `（${p.id}）` : '') + (p.var ? `：${p.var}` : ''))
    .join('、');
  return {
    ok: true,
    error: '',
    variables: narrative.schema?.order?.length ?? 0,
    rules: narrative.rules?.length ?? 0,
    problems,
    problemText: problems.length ? `${problems.length} 个：${problemText}` : '',
  };
}
