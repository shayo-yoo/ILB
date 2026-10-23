// core/settings-defaults.js —— 纯数据，无依赖
// 默认值一律保守（ILB-6.5.1）：失败方向永远是"不注入、不启用"。
// 每一个默认值都必须能被解释（见 docs/决策记录.md D-0011）。

export const DEFAULT_SETTINGS = Object.freeze({
  // 总开关（ILB-6.5.2）：关掉后完全不注入，但书和规则都还在
  enabled: true,

  // 判定
  scanDepth: 3,          // 只看最近几条消息
  maxChainDepth: 3,      // 连锁层数（ILB-4.6.3 默认 3；0 = 关闭）
  probabilityEnabled: false,

  // 预算
  budgetRatio: 0.15,
  budgetCap: 2000,

  // 注入
  defaultPosition: 'after_char',
  defaultDepth: 4,
  defaultRole: 'system',
  injectSeparator: false,

  // 书
  followCharacterCard: true,

  // 导入（ILB-3.6）
  importEnabledPolicy: 'ask',       // ask / keep / on / off
  batchImportIncludeExisting: false, // 批量导入时是否也更新已导入的书

  // 诊断
  showBudgetNotice: true,
  debugDiagnostics: false,
});

export const POSITIONS = Object.freeze(['before_char', 'after_char', 'in_chat']);
export const ROLES = Object.freeze(['system', 'user', 'assistant']);
export const SECONDARY_LOGIC = Object.freeze(['AND_ANY', 'AND_ALL', 'NOT_ANY', 'NOT_ALL']);
export const ACTIVATION_MODES = Object.freeze(['always', 'character', 'manual']);
