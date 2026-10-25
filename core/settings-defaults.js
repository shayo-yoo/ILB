// core/settings-defaults.js —— 纯数据，无依赖
// 默认值一律保守（ILB-6.5.1）：失败方向永远是"不注入、不启用"。
// 每一个默认值都必须能被解释（见 docs/决策记录.md D-0011）。

export const DEFAULT_SETTINGS = Object.freeze({
  // 总开关（ILB-6.5.2）：关掉后完全不注入，但书和规则都还在
  enabled: true,

  // 判定
  scanDepth: 3,          // 只看最近几条消息
  maxChainDepth: 3,      // 连锁层数（ILB-4.6.3 默认 3；0 = 关闭）
  maxActivateDepth: 2,   // 「激活条目」能再连锁几层（ILB-4.12 默认 2，上限 5；0 = 只认直接点名）
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

  // 独立逻辑（ILB-4.14）：书里的"逻辑"可以有自己的触发词，跑完可以写变量/拉条目/出正文
  logicEnabled: true,
  logicMaxPerTurn: 20,   // 一轮最多跑几条逻辑，防止逻辑互相激活失控

  // AI 通过正文宏指令调用逻辑（ILB-4.16）：默认关闭，开了也只认白名单
  aiCallsEnabled: false,
  aiCallMaxPerTurn: 3,   // 一轮最多认几条调用，多余的当普通文字
  aiCallScan: 3,         // 只在最近几条 AI 消息里找调用
});

export const POSITIONS = Object.freeze(['before_char', 'after_char', 'in_chat']);
export const ROLES = Object.freeze(['system', 'user', 'assistant']);
export const SECONDARY_LOGIC = Object.freeze(['AND_ANY', 'AND_ALL', 'NOT_ANY', 'NOT_ALL']);
export const ACTIVATION_MODES = Object.freeze(['always', 'character', 'manual']);
// 触发词只看谁说的话：both = 都看；user = 只看用户；ai = 只看 AI（ILB-4.15）
export const TRIGGER_SOURCES = Object.freeze(['both', 'user', 'ai']);
// 「跳转」节点到达上限后的两种做法：stop = 直接终止；continue = 跳过这次跳转、继续往下
export const GOTO_ON_LIMIT = Object.freeze(['stop', 'continue']);
