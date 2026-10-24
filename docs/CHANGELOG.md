# 变更记录 CHANGELOG

**规则**（详见 `docs/留痕规范.md`）：

- 只追加，**永不修改或删除旧条目**。写错了就再写一条"更正"。
- 最新在最上面。
- 每条格式：`日期 · 版本 · 类型 · 引用编号 · 一句话`
- 类型只有五种：`新增` `修订` `废弃` `删除` `修正`
  - `新增`：加了不存在的东西
  - `修订`：改了已有的规定内容
  - `废弃`：东西还在文档里，但不再有效（必须写被谁替代）
  - `删除`：只用于删掉"从来没有生效过"的内容
  - `修正`：文档自身的错误（笔误、引用错位、自相矛盾、重复粘贴）
- 换了做法的改动，必须同时有决策记录（`docs/决策记录.md` 的 D-xxxx）。

---

## 0.8.0 · 2026-10-24 · 新增 · ILB-10.14 / 10.15 / 10.16 · 账本移出扩展，扩展只留聊天变量与「记住 / 激活条目」两个流程节点

**一句话**：按用户拍板的五步计划走第一步——把叙事账本整体搬到仓库根目录 `memory/` 留档、扩展不再加载；同时给扩展补上真正需要的那块：**聊天变量**（`{{ILB:名字}}` 宏、面板「状态」页）和流程图里的两个节点「记住」（写变量）与「激活条目」（拉出另一条设定），让"抽卡 + 条件 + 有限连锁"能先跑通。

**依据**：用户 m02480"好的你可以开始开发了"；决策 D-0044（搬家而非删除、不做兼容层）。

**新增**

| 位置 | 内容 |
|---|---|
| `core/vars.js` | 变量服务（纯计算）：`normalizeVars` / `coerceValue` / `readPath` / `displayValue` / `expandMacros` / `macroNames` / `missingMacros` / `resolveChatId`；值形状 `{type,value}`；删掉即未定义，宏原样保留 |
| `adapters/repository.js` | `getVars` / `mergeVars` / `deleteVar`，落在 `chatStates[chatId].__vars`，只对当前聊天生效 |
| `runtime/pipeline.js` | 读变量 → 宏展开条目正文；收集流程图写入，判定成功后一次性落盘；对外接口 `globalThis.ILB.vars` |
| `core/flow.js` | 新节点 `remember`（记住：名字 + 值）与 `activate`（激活条目：同书条目下拉，绕过触发词进入候选，受预算/上限/去重约束） |
| `ui/view-state.js` | 面板「状态」页：列出、新增、改值、删除当前聊天的变量 |
| `ui/flow-editor.js` | 两种节点的编辑表单 |
| 测试 | `tests/vars.test.mjs`（10）、`tests/flow-vars.test.mjs`（8） |

**修订（文档）**

| 位置 | 内容 |
|---|---|
| `参考文档.md` | 版本 **3.1.0**；§10 标题与开头注明"v0.8.0 已移出扩展"；新增 **§10.14 聊天变量与宏**、**§10.15 「记住」「激活条目」**、**§10.16 搬家与对外接口** |
| `docs/决策记录.md` | 追加 **D-0044**（搬家的理由、四项决定、三条否决、代价与待定） |
| `extension/README.md` | 测试计数改为 **120**、模块 **40**；新增变量/节点/状态页说明 |
| `memory/README.md` | 说明这是留档，不随扩展加载，以及重新启用的方式 |

**删除 / 移出**

- `extension/narrative/` → `memory/narrative/`；`extension/ui/view-narrative.js` → `memory/ui/`；叙事测试、探针、截图 → `memory/tests/`。
- `index.js` 去掉叙事装配、挂载、注入与 `CHAT_CHANGED` 刷新；`ui/panel.js` 去掉「叙事」页；`ui/view-diagnostics.js` 去掉叙事卡；`ui/selftest.js` 去掉 3.9 节。

**验收**

- 单元 **120/120**（原有 102 + vars 10 + flow-vars 8）；`linkcheck` **42/42**；`smoke-dom` **0 失败**；`node tests/narrative-demo.mjs` 随档案移到 `memory/tests/`。
- 叙事探针与截图留在 `memory/tests/`，不再计入扩展回归。

**已知未完成 / 未验证**

- 「调用函数 / 函数库」节点未做（P3 后半）；"有限连锁"（连锁深度默认 2、上限 5）未做（P4）；动态条目与手机版状态页未做（P5）。
- 真实 SillyTavern 内未验证：变量的落盘时机、手机壳五页/六页布局、宏在真实提示词里的展开。
- 残留：`ui/mobile.js` 的 `ledger` 状态与 `.ilb-m-dock` 样式暂无入口；`memory/narrative/` 的适配层路径未修（档案不可直接运行）。

---

## 0.7.1 · 2026-10-24 · 修订 · ILB-10.0 / 10.9（改名）/ 10.12 / 10.13 · 定位回调：记忆账本，不是事件驱动器（仅文档与措辞，无代码变更）

**一句话**：把这一模块的目标从"做法引擎/事件驱动器"改回"确定角色状态"——只做认出承诺、约束成确定、注入摘要、开放读写四件事；取消事件级联与可视化编程路线，"复杂来自组合"改由 §10.12 的条目/规则/宏/界面接口承担。

**依据**：用户指出 v0.7 只是横向扩展、没有增加深度，并复盘"最初要做的是总结与记录，不是游戏"。决策见 D-0043。

**修订（文档）**

| 位置 | 内容 |
|---|---|
| `参考文档.md` | 版本 3.0.0；新增 **§10.0 定位**（四件事、四个不做、涌现来自组合）；新增 **§10.12 组合面** 与 **§10.13 明确不做**；§10.7 重排优先级；§10.9 改名"自定义状态操作"，注明不再有排队/级联含义；§10.11.3 可视化编辑器改为"不做" |
| `docs/决策记录.md` | 追加 **D-0043**（定位回调、保留/降级清单、否决项、代价、三个待定问题） |
| `index.js` / `narrative/*` / `ui/*` | **不改代码**。`events` 字段名保留，避免破坏已保存的声明；只改解释与措辞 |

**保留**：事实解析、六类型/五约束、原子拒绝、重放与检查点、消息块、注入、「叙事」页、JSON 声明编辑、v0.7 的 `events` 能力（降级为"自定义状态操作"）。

**取消**：`emit`、事件队列、深度/循环调度、事件图/Blueprint、可视化编程、玩法/世界模板。

**下一步（待用户拍板，见 D-0043 待定项）**：① 派生状态与手动修正谁先；② 条目激活时是否允许"声明式写事实"（entry hook）；③ 手动修正是"直接改值"还是"补记/撤销事实（带审计）"。

---

## 0.7.0 · 2026-10-24 · 新增 · ILB-10.9.1–10.9.3 / 10.10.1–10.10.4 / 10.11.1 · 自定义事件、检查点存档、独立「叙事」标签页

**一句话**：账本不再只服务 RPG——用户可以在声明里登记**自定义事件**（`[[ILB:突破:筑基]]`）给任意玩法用；旧楼层折成**检查点存下来**，最新的几条仍现场重算；注入里加了一段"本轮变化（改前 → 改后）"供模型润色；所有叙事功能从"设置"页搬进**独立的「叙事」标签页**，并带上"复制编写说明"给 AI 用。

**依据**：用户反馈（m0???）"不同角色卡不可能只有 RPG 一个玩法""倾向于把状态存起来，并把改变前后两个版本发给 AI""叙事引擎可以放一个与设置同级的新 TAB"。本次实现逻辑与入口；可视化事件编辑器按用户要求留到逻辑稳定之后。

**新增**

| 位置 | 内容 |
|---|---|
| `narrative/facts.js` | `buildVerbMap({events, verbs})`：八个内置动词 + `verbs` 别名 + `events` 自定义事件；`parseFacts(text, verbMap)` 解析自定义事件为 `{type:'event', event, name, count}` |
| `narrative/engine.js` | `FACT_TYPES` 增加 `event`；条件支持 `when.event`；`compileRules` 对 `event` 规则校验事件是否已在声明里登记（`unknown-event`） |
| `narrative/checkpoint.js` | 检查点存储：按"聊天 key + 声明指纹"存 `{upto, state, totals}`；只保留最近 8 条聊天；`chatKeyOf(ctx)` 兼容 `chatId`/`chatMetadata.chat_id`/角色名 |
| `narrative/plan.js` | `replay` 支持从检查点续算（`initial/startIndex`）；`planLedger` 返回 `deltaLines`、`startIndex`、累计 `totals`；`composePrompt` 注入"本轮变化" |
| `narrative/guide.js` | `DECLARATION_GUIDE`：一份给 AI 的声明编写说明（形状、类型、约束、效果、自定义事件、约定） |
| `ui/view-narrative.js` | 新「叙事」标签页：开关/预算/检查点间隔、账本预览、查看账本、重放、重建账本、编辑声明、复制编写说明、恢复示例 |
| `tests/narrative-plan.test.mjs` | 新增 4 个用例：自定义事件与别名、未登记事件编译报错、检查点存取与失效、续算=全量重放且带"本轮变化" |

**修订**

| 位置 | 内容 |
|---|---|
| `ui/panel.js` | 标签从五个变六个：`书架 / 规则 / 快照 / 诊断 / 叙事 / 设置` |
| `ui/view-settings.js` | 移除原先塞在设置页的叙事卡片与声明编辑器（全部移入「叙事」页） |
| `narrative/adapter.js` | 读取检查点、续算、写回检查点；`clearCheckpoint()`；`describe()` 报检查点与窗口起点 |
| `narrative/store.js` | 新增 `narrativeCheckpointEvery`（默认 5，0 = 关闭，夹在 0–50） |
| `index.js` `manifest.json` | 版本 `0.7.0` |
| `tests/mobile-ui-run.html` | 「编辑声明」改在「叙事」标签下验证；横向溢出检查排除可横滑的标签栏 |
| `tests/smoke-dom.mjs` | 渲染循环加入 `narrative` 标签 |
| `tests/narrative-probe.html` | 探针关闭检查点，保持"每条消息一块"的断言可预期 |

**验收（2026-10-24 实测）**

- 单元 **133/133**（叙事 31 个）、`linkcheck` **54/54**、`smoke-dom` 0 失败
- `narrative-probe` **22/22**；`mobile-ui-probe` **4 轮全 PASS**（375 带样式 / 375 无样式 / 500×900 / 820 期望电脑）
- `selftest-probe` PASS；`browser-probe` PASS；`nocss-probe` PASS；`shell-route-probe` 3/3

**未做（下一步）**

- 可视化事件编辑器（按用户要求放在逻辑稳定之后）；"直接设值"事实仍待定（参考文档 §10.7）。
- 检查点只存"状态 + 累计统计"，不存每个旧楼层的事实原文；因此"重建账本"后旧楼层被隐藏的部分无法恢复。

---

## 0.6.2 · 2026-10-24 · 修正 · ILB-10.8.12–10.8.13 · 实测反馈：注入漏掉最新一条、长聊天全量重放、摘要误报容器

**一句话**：用户实测（没接 API，只看请求体与界面）发现两件事——账本被插在最新一条用户消息**之前**、而且"已发生的 N 条"少算了一条；长聊天每次刷新都全量重放。这一版把注入挪到消息之后、在用户消息到达时立刻重算，并给重放加了增量缓存。

**依据**：用户提供的请求体（`assistant` 问候 + 两条 user + 账本 system + 最后一条 user）与界面截图（账本块显示"未认领：获得 测试道具"）。

**修正**

| 位置 | 改了什么 |
|---|---|
| `narrative/adapter.js` | `INJECT_DEPTH` 1 → **0**：账本放到最新一条消息之后，不再被最后一条用户消息隔开 |
| `narrative/adapter.js` | 订阅 `USER_MESSAGE_RENDERED` 与 `MESSAGE_SENT` 时**立刻重算注入**：实测发现 `GENERATION_STARTED` 触发时最新一条用户消息可能还没进 `chat`，导致账本漏掉它的事实、计数少 1 |
| `narrative/plan.js` | `replay()` 增加指纹缓存（每条消息一个 djb2 指纹）：同一条聊天、同一份声明、前缀没变时直接复用前缀状态；编辑/滑动只从变化处重算，删楼层会剪掉缓存尾巴 |
| `narrative/render.js` | `summarize()` 不再把空的关系表算成"容器"，但保留"背包（0/8）"这种带容量的空列表 |
| `narrative/plan.js` | "未认领"的原因补上下一步动作（到「设置 → 编辑声明」补规则或目录项），避免只报"没有规则" |

**修订**

| 位置 | 内容 |
|---|---|
| `index.js` `manifest.json` | 版本 `0.6.2` |
| `tests/narrative-plan.test.mjs` | 新增 2 个用例：缓存前缀复用/改一条只重算后半/删消息剪尾；摘要忽略空关系但保留背包容量 |
| `tests/narrative-probe.html` | 深度改 0；新增"发消息后注入立刻包含它""删楼层后块重排"断言；22 项全过 |

**验收（2026-10-24 实测）**

- 单元 **129/129**、`linkcheck` **51/51**、`smoke-dom` 0 失败
- `tests/narrative-probe.html` **22/22**（其中"发消息后注入立刻包含它（应为 7 条）"直接对应这次实测的故障）
- `tests/mobile-ui-probe.html` 4 轮全 PASS；`selftest-probe` PASS，非预期失败 0

**未改（按用户要求）**

`[[ILB:…]]` 标记本身保持原样，不在扩展里剥离；隐藏它们交给外部正则扩展。

---

## 0.6.1 · 2026-10-24 · 新增 · ILB-10.8.9–10.8.11 · 补完账本的三个界面（声明编辑器 / 手机状态坞 / 诊断卡片）

**一句话**：叙事引擎的"能看、能改、能查"补齐——设置页可以直接改 JSON 声明（编译不过不保存），手机整屏界面多一条只读账本坞（关着时整条隐藏），诊断页多一张叙事卡片（开关、声明、统计、注入原文）。

**依据**：合并后 §10.7 列出的两个界面缺口（手机状态坞、声明编辑器）与"出问题时看不到注入原文"。本轮用户暂时不便测试，先把不依赖真机的部分做完（m01221）。

**新增**

| 位置 | 内容 |
|---|---|
| `ui/view-settings.js` | 「编辑声明」二级页：JSON 文本域、`校验`（`describeDeclaration` 编译）、`校验并保存`（有问题拒绝保存）、`填入内置示例`、`导出当前文本`；保存后立即 `narrative.refresh('declaration')` |
| `ui/mobile.js` `ui/mobile-skin.js` | 账本状态坞 `.ilb-m-dock`：只在 `narrativeEnabled` 为真时出现，显示 `plan.summary`；点「账本」开二级页（状态行、重放统计、注入原文）。`MOBILE_SKIN_VERSION='0.6.1'` |
| `ui/shell.js` `index.js` | `createShell({ ledger })` 把"读账本"传给手机壳；`shell.refreshLedger()` / `setLedger()` |
| `ui/view-diagnostics.js` | 叙事卡片：开关、声明来源与变量/规则数、重放统计、注入字数与块数；`查看注入原文`、`重放一次` |
| `tests/narrative-plan.test.mjs` | 新增"声明能导出成 JSON 再读回来"（编辑器依赖的行为） |
| `tests/mobile-ui-run.html` | 新增 7 项断言：账本坞出现/点开/状态行/关闭、设置页有「编辑声明」、textarea 出现且是 JSON、编辑器尺寸 |

**修订**

| 位置 | 改了什么 |
|---|---|
| `index.js` `manifest.json` | 版本 `0.6.1` |
| `tests/selftest-probe.html` | 预期失败项加上"叙事引擎没接上"（该探针只装面板，不装引擎） |
| 单元测试总数 | 126 → **127** |

**验收（2026-10-24 实测）**

- `node --test tests/{core,flow,import-plan,search,snapshot,ui-layout,narrative,narrative-plan}.test.mjs`：**127/127**
- `node tests/linkcheck.mjs`：**51/51**；`node tests/smoke-dom.mjs`：**0 失败**
- `tests/mobile-ui-probe.html`：**4 轮全 PASS**（含新增的坞与编辑器 7 项；375 带样式 / 375 无 `style.css` / 500×900 / 820×620 期望电脑）
- `tests/narrative-probe.html`：**19/19**；`tests/selftest-probe.html`：PASS，非预期失败 0
- **仍未验证**：真实 SillyTavern 对话端到端、真机 WebView

---


**一句话**：把 `lab/` 里的叙事引擎并进扩展本体——AI 只写 `[[ILB:获得:铜钥匙]]` 这类事实，规则按声明改状态，状态永远由聊天记录**重放**得出；消息末尾追加只读账本块，下一轮把账本以 `ILB_NARRATIVE` 注入；**默认关闭**，关着时与 v0.5.0 行为完全一致。

**依据**：用户要求（m00874）"开始合并，但保留一份原版备份，完成后写报告"。备份为 `backup/v0.5.0-2026-10-24/`（78 个文件）与 git 标签 `v0.5.0`（指向 `665dc9a`）。决策见 D-0041（合并方式）与 D-0040（四条设计纪律，此前只在 lab 注释里引用）。

**新增**

| 位置 | 内容 |
|---|---|
| `narrative/schema.js` `catalog.js` `facts.js` `engine.js` `render.js` `index.js` | 由 `lab/narrative/` 原样并入的纯计算层（六类型/五约束/九效果、事实解析、原子应用、`fold` 重放、注入渲染）；`NARRATIVE_VERSION='0.6.0'` |
| `narrative/preset.js` | 内置示例声明（原 `lab/example/spec.js`）；`PRESET` 为正式名字，`SPEC` 保留给测试 |
| `narrative/store.js` | 设置读取（`narrativeEnabled/Inject/Budget/Declaration`，预算夹在 120–2000）、声明编译与摘要 |
| `narrative/plan.js` | 接入层的纯计算：`replay()` 逐条重放、`planLedger()` 出注入文本+每条消息的块+统计、`composePrompt()` 前言/用法/截断 |
| `narrative/block.js` | 消息末尾的只读账本块 DOM（`✓/✗/?/·` + 原因 + 摘要 + "另有 N 条"），`mountBlock` 幂等 |
| `narrative/adapter.js` | 宿主接线：事件订阅、`setExtensionPrompt`（独立 key `ILB_NARRATIVE`、IN_CHAT/深度 1/system）、开关、异常兜底、`describe()` |
| `narrative/README.md` | 模块说明：四层模型、三条纪律、文件表、事件与注入、开关语义、验收与未做 |
| `tests/narrative.test.mjs` `tests/narrative-demo.mjs` | 从 `lab/` 移入并改路径；仍是 15 个用例与一段端到端演示 |
| `tests/narrative-plan.test.mjs` | 9 个用例：设置默认/夹取、重放与 `fold` 一致、每条消息一块、拒绝/未认领/看不懂都在块里、注入带约束现状、预算截断、声明写错有报错 |
| `tests/narrative-probe.html` + `tests/shot-narrative.png` | 真实浏览器探针（19 项断言）：块出现/拒绝原因/注入 key 与位置/新消息只补一条/关闭后清空/删除消息后对齐 |

**修订**

| 位置 | 原做法 | 新做法 |
|---|---|---|
| `index.js` | v0.5.0 只装配世界书 | `VERSION='0.6.0'`；新增 `createNarrativeRuntime(...)`、`narrative.mount()`、`CHAT_CHANGED` 时重放、`globalThis.ILB.narrative`；启动日志报"账本：开/关" |
| `ui/panel.js` | `ctx` 里没有叙事引擎 | 透传 `narrative`，供设置页使用 |
| `ui/view-settings.js` | 设置页只有世界书相关卡片 | 新增"叙事引擎（账本）"卡片：状态徽章、开关、注入字数、查看账本、重放一次、恢复示例声明、语法说明 |
| `ui/selftest.js` | 只报界面/浮层/宿主 | 新增一条：引擎是否接上、声明能否编译、开关与重放统计（成功/被拒/未认领/看不懂/注入字数/块数） |
| `style.css` | 无消息块样式 | 追加 `.ilb-narr*` 一节（**无媒体查询**，靠 flex-wrap/min-width:0 自适应，D-0037 的教训） |
| `manifest.json` | `0.5.0` | `0.6.0` |
| `tests/linkcheck.mjs` | 跳过 `lab/` | 不再跳过叙事引擎，当前 **51 个模块全过** |
| `参考文档.md` | v2.7.0，§10 为"实验，不随 v0.5.0 发布" | v2.8.0：§10 改为"已并入、默认关闭"；10.1.1–10.1.5、10.5.2 标 ⛔ 并给出替代；新增 10.1.6–10.1.10、10.5.4、10.6.4–10.6.6、10.8.1–10.8.8 |

**废弃**

| 编号/位置 | 原因 | 替代 |
|---|---|---|
| ILB-10.1.1–10.1.5 | 描述的是合并前的隔离状态 | ILB-10.1.6–10.1.10 |
| ILB-10.5.2 | 实现里不修改宿主消息正文 | ILB-10.5.4 |
| `extension/lab/` 整个目录 | 已并入 `extension/narrative/`，不留两份 | 见上表新增 |

**删除**

- `extension/lab/`（迁出后删除；`tests/linkcheck.mjs` 的跳过逻辑同步去掉）。

**验收**

- `node --test tests/narrative.test.mjs tests/narrative-plan.test.mjs` → **24/24**
- 全量单元测试 → **126/126**；`node tests/linkcheck.mjs` → **51/51**；`node tests/smoke-dom.mjs` → 0 失败
- `tests/narrative-probe.html`（无头 Chrome，500×900）→ **19/19 PASS**，截图 `tests/shot-narrative.png`（块在消息下方、拒绝原因可见、没有横向溢出）
- 关掉开关：块全清、`ILB_NARRATIVE` 写成空串、`describe()` 块数与字数归零（探针第 11–14 条）

**仍未验证 / 未做**

- 真实 SillyTavern 对话端到端（原合并条件②）：探针只能证明 DOM 与注入接线，不能证明"模型下一轮遵守账本"。
- 手机"状态坞"（原合并条件③）：手机上读的是同一份消息块。
- 正文里标记的剥离显示、动态条目、手动补记界面、声明编辑界面、存档迁移。

---

## lab/narrative 0.1.0-lab · 2026-10-24 · 叙事引擎子项目落地（隔离开发，不接入扩展；含规格 v2.7.0 的 §10）

**一句话**：按用户要求（m00671）把"ILB 变成叙事引擎"这件事先做成**隔离子项目**：`extension/lab/` 里一套纯计算库，AI 只写"获得/失去/使用/关系/地点"这类事实，规则按声明改状态，状态由 `fold(消息 1..N)` **重放**得到；`index.js`、`manifest.json`、`style.css`、现有面板一行未动，`main` 仍停在可发布的 v0.5.0。

**依据**：直接改装配会把刚发布的 v0.5.0 拖进实验；而"能不能当叙事引擎"这个问题可以用纯函数库在 node 里单独回答——不需要宿主、不需要浏览器、不需要存档。决策见 D-0039，规格见 `参考文档.md` §10（实验章，**不进 §9 验收清单**）。

**新增**

| 位置 | 内容 |
|---|---|
| `lab/narrative/schema.js` | 六种类型（text/number/flag/list/map/enum）、声明编译与初值、派生值（剩余格/总重量/是否满，全算不存）、五种约束（max/sumMax/range/mutex/require） |
| `lab/narrative/catalog.js` | 实体目录：名字 → 标签/重量/字段，大小写与别名归一 |
| `lab/narrative/facts.js` | 解析 `[[ILB:…]]` 八个动词、去重、剥标记、事实 → 人话；解析失败进 `unknowns` 带建议 |
| `lab/narrative/engine.js` | 规则匹配与效果应用（**原子**：任何一处不过则整条不生效、带原因）、`fold` 整段重放（每条消息末尾自动一次 `tick`）、`stateAt` |
| `lab/narrative/render.js` | 注入文本（带容量现状、字符预算、"另有 N 项未显示"）、界面行、改动描述、一行摘要 |
| `lab/narrative/index.js` | 门面 `createNarrative({schema,catalog,rules})`；`NARRATIVE_VERSION='0.1.0-lab'` |
| `lab/example/spec.js` | 一份零代码的完整声明样本（六种玩法都在里面），测试与演示共用 |
| `lab/tests/narrative.test.mjs` | 15 个用例：六玩法 + 解析 + 剥标记 + 改消息重放 + 补记 + 未知标记 + 渲染预算 + 编译期报错 + 未认领 |
| `lab/demo/run.mjs` | 一段模拟对话的端到端演示（逐条记账/拒绝原因/看不懂的标记/最终注入文本/重放两次结果一致） |
| `lab/README.md` | 子项目说明：隔离契约、四层模型、三条纪律、事实语法、声明字段、API、六玩法对照、未做项、合并条件 |

**修订**

| 位置 | 内容 |
|---|---|
| `tests/linkcheck.mjs` | 遍历时跳过 `lab/`：它是隔离子项目，有自己的测试命令；发布前检查仍是 40 个模块全过 |

**验收**

- `node --test lab/tests/narrative.test.mjs` → **15 通过 / 0 失败**（含"背包 8 格第 9 件被拒且整条不生效""负重 20 超重被拒""圣剑/魔剑互斥""药水冷却 3 轮""关系累加可正可负""任务状态机重复交付被拒""改一条消息状态跟着变"）。
- `node lab/demo/run.mjs` → 六条消息逐条记账，`看不懂：[[ILB:拿到:神秘符文]]` 被显示、塞满后"背包已满：上限 8 件，这一件会让它变成 9 件"被显示、拒绝后状态不变、同一段对话重放两次结果一致。
- `node tests/linkcheck.mjs` → 共 40 个模块：通过 40、失败 0（扩展本体未受影响）。
- 修掉一个实现期发现的真 bug：规则触发条件原本用"改到一半的状态"判断，`完成委托` 改完任务后紧跟着的"委托已完成"规则会误拒自己；改为**一律用事实前的快照判断**，效果仍在副本上累积。

**未合并**：`lab/` 现在不参与扩展装配与发布。合并前必须满足 §10.1.4 的五条（六玩法零改动、真实 ST 对话端到端、手机壳能放状态坞、关掉即回到 v0.5.0 行为、文档同步）。

---

## v0.5.0 · 2026-10-24 · 手机端换成独立界面：不再让同一套 UI 在手机上"变形"（含规格 v2.6.0）

**一句话**：用户报"竖屏或手机比例下，点了按钮 UI 不显示"（m00002），而 v0.4.2–v0.4.8 四轮修补都在同一条路上加兜底、没有一次被真机确认。这一版停止修补这条路：手机改成**独立外壳**（`<dialog>` + `showModal()` 进 top layer、样式由 JS 自带、只认 `click`），电脑保持原样（悬浮球 + 可拖动浮窗 + `.ilb-overlay`），两套壳共用一个面板，由 `ui/shell.js` 按布局挑一套；同时把 `style.css` 与 `ui/floating.js` 里所有手机分支删掉。

**依据（为什么换路而不是再补一条兜底）**：在合成环境里用真实 `style.css` + 真实模块跑 500×749 手机布局，浮窗、标签切换、帮助浮层全部正常（FAB 52×52 @430,613；浮窗 500×749 display=flex z=4500；浮层 500×749 z=2147483000、弹窗 500×410 底色 `rgb(30,30,30)`；0 错误）。也就是说故障**在该环境里无法复现**，根因只可能在"同一套 DOM 进入真机环境后被改形"这条路线上——继续在同一条路上加兜底，等于每次都在猜。决策见 D-0037、D-0038。

**新增**

| 位置 | 内容 |
|---|---|
| `ui/mobile.js` | 手机外壳：悬浮球（56×56、距底 76px+安全区）+ 整屏 `<dialog class="ilb-m">`（`showModal()`；不支持时退回内联固定层）+ 二级页栈（`pushSheet/popSheet/closeSheet/clearSheets`）+ 自己的 `toast()`（界面开着时画在界面里，否则退回宿主）+ `setStatus` + `setVisible`。同时导出 `openOverlay/closeOverlay/isOverlayOpen` 三个名字，直接充当 `ui/help.js` 的浮层后端 |
| `ui/mobile-skin.js` | 手机专用皮肤：`ensureMobileSkin()` 往 `<head>` 注入 `<style id="ilb-mobile-skin">`（`.ilb-m` 前缀、55 条规则、不依赖 `style.css`）；`mobileSkinInfo()` 返回 `{installed, rules, version}` 供自检报数 |
| `ui/shell.js` | 双壳路由：`createShell({repository, notify, onOpen})` 同时建两套壳，`pickLayout(viewportOf())` 决定用哪套，`switchTo` 换壳时把面板挪过去、让另一套让位；`setOverlayBackend()` 随布局切换；`notify` 转发到当前可用的出口；窗口 `resize`/`orientationchange` 防抖 150ms 后重判 |
| `tests/mobile-ui-run.html` / `tests/mobile-ui-probe.html` | 手机界面真实浏览器探针：外层用 iframe 造出 375px 真窄视口（Chrome 无头窗口最窄 500px），内层跑真实模块 + 真实点击（悬浮球 → 整屏界面 → 切「规则」→ 点「?」→ 点 × → 点「导入记录」→ 关界面），四轮：375×780 带样式、375×780 不加载 `style.css`、500×900、820×620（期望电脑布局）。`POST /report` 回传 |
| `tests/shell-route-run.html` / `tests/shell-route-probe.html` | 双壳路由探针：在同一套装配（`createShell` + 面板）下分别用 375 与 900 视口跑，断言"挑中的壳在场、另一套整体让位、面板挂在挑中的壳里、`shell.notify` 落在当前看得见的那套里"。三轮：375×780 带样式、375×780 不加载 `style.css`、900×700 期望电脑 |

**修订**

| 位置 | 内容 |
|---|---|
| `index.js` | 装配从 `createFloatingWindow` 改为 `createShell`；`v0.5.0`。新增 `notifyVia`/`notifyThrough` 间接层：壳拿**原始** `notify`，面板与设置卡片拿转发口，壳建好后再把转发口指向 `shell.notify`（否则手机上视图的 toast 会落在 top layer 底下；若壳也拿转发口则会无限递归）；`globalThis.ILB` 增加 `shell`/`mobile`，`floating` 仍指向电脑那套 |
| `ui/help.js` | 只服务电脑：删 `pickLayout` 依赖、删 `syncLayoutClass()`、`applySkin`/`ensureVisible` 去掉 `isMobile` 分支（`min-height` 固定 160px、浮层固定顶对齐）、不再加/摘 `body.ilb-locked`；新增 `setOverlayBackend()/getOverlayBackend()`，有后端时 `openOverlay` 直接转交并返回关闭函数 |
| `ui/floating.js` | 只服务电脑：删手机布局分支、删 `ilb-fab-hidden`/`ilb-backdrop-open`/锁滚动，遮罩元素整个删除；新增 `visible` 状态与 `setVisible()`（用内联 `display` 隐藏，不能用 `hidden`，因为类里的 `display` 会赢），`describe()` 报 `visible` |
| `ui/shell.js` | `switchTo()` 换壳前先收干净手上的浮层（`closeOverlay()` + `mobile.clearOverlays()`）：否则屏幕转过来时，电脑那层 `.ilb-overlay` 会留在已经 `display:none` 的壳里，手机那边也可能挂着半截二级页——两种都表现为"点不开" |
| `ui/selftest.js` | 按两套界面重写：先问 `describeUi()` 是哪套，手机量 `dialog.ilb-m[open]`、电脑量 `.ilb-overlay`；新增"手机皮肤已注入（N 条规则，版本）"、"关闭按钮热区 ≥44×44"；浮层/二级页高度、两个底色、`elementFromPoint(中心)` 归属都按当前壳报数；修掉原文件 `*/export` 粘连成一行的问题 |
| `style.css` | 删掉全部手机分支：`@media (max-width:768px)` 贴底整宽、`.ilb-mobile` "第二把钥匙"、`body.ilb-locked`、`.ilb-window-mobile` 整块、`.ilb-fab-hidden`、`.ilb-backdrop(.ilb-backdrop-open)`；`body.ilb-overlay-open` 只保留让开 `.ilb-window`/`.ilb-fab`；`.ilb-modal-x` 从 32×32 改为 44×44（ILB-6.14.3 对两种布局同一标准）。`.ilb-` 规则从 149 条降到 130 条 |
| `manifest.json` | `version` 0.5.0 |
| `tests/smoke-dom.mjs` | 新增三步：手机界面开关与二级页栈（含"关掉上层不能连下层一起没了"）、双壳切换与 `describe()`；浮层关闭后改断言 `ilb-overlay-open` 已摘（`ilb-locked` 已不存在） |
| `tests/browser-probe.html` | 模拟整屏浮窗改用 `.ilb-window` + 内联 100vw/100vh（`ilb-window-mobile` 已删）；结果 `POST /report`；自检预期失败项加上"问不到界面状态" |
| `tests/selftest-probe.html` | 预期失败项加上"问不到界面状态（扩展可能还没启动完）" |
| `README.md` | 测试计数更新（链接 40 模块、冒烟 19 步）；用 `mobile-ui-probe` 的说明替换 `sizing-probe`；"已知未完成"里关于 `ilb-mobile` 的条目改成双壳说明 |

**废弃 / 删除**

| 位置 | 内容 |
|---|---|
| `参考文档.md` §6.8.4 后半 | ⛔ 手机布局不再是同一套窗口的变体（替代 ILB-6.19.1/6.19.2） |
| `参考文档.md` §6.14.5 | ⛔ 手机浮层贴底整宽作废（替代 ILB-6.19.7 的整屏二级页） |
| `参考文档.md` §6.14.6 | ⛔ `body.ilb-locked` 不再使用；手机锁滚动由外壳直接写 `body.style.overflow`（替代 ILB-6.19.5） |
| `参考文档.md` §6.17.1 | ⛔ "两把钥匙"作废（替代 ILB-6.19.3：手机样式自带） |
| `参考文档.md` §6.17.7 | ⛔ 手机 `45vh` 分支作废；电脑四条几何仍有效 |
| `参考文档.md` §6.17.6 | ⛔ `sizing-probe.html` 验收作废（替代 ILB-6.19.10） |
| `参考文档.md` §6.16.2 | 🔁 遮罩已删，让开的是浮窗与悬浮球两项 |
| `参考文档.md` §6.18.5 | 🔁 只覆盖电脑；手机对应验收在 `mobile-ui-probe` 的无样式轮 |
| `tests/sizing-probe.html` | **删除**：它验的是 `.ilb-mobile` 两把钥匙那套，手机变体删除后已无意义 |
| `tests/mobile-probe.html` | **删除**：v0.4.8 时期的临时探针，同样依赖旧手机变体 |
| `参考文档.md` §6.19 | **新增十一节**：手机界面独立成套（共用面板、top layer、自带皮肤、只认 click、visualViewport、自己的 toast、二级页栈、375px 无横滚、自量兜底、验收、电脑那套不许再判断"是否手机"） |

**实测（真实 Chrome，`--headless=new`，静态服务器 `node tests/serve.mjs 8799`）**

- `tests/mobile-ui-probe.html`：**4 轮全 PASS**。375×780 带样式：悬浮球 56×56 @307,648（距底 76px）、整屏界面 375×780 @0,0 `bg=rgb(21,21,27)`、面板 351×780、屏幕正中命中界面内元素、点「规则」出 2 张卡片、帮助二级页 375×719 `bg=rgb(24,24,32)`、× 热区 44×44 在 y=67、点 × 收起、点「导入记录」出二级页且有人话、横向溢出 0px、手机皮肤 55 条规则 v0.5.0。375×780 **不加载 `style.css`**：同上全 PASS，最右元素 376px（视口 375）。500×900 全 PASS。820×620 判定为电脑布局、手机界面不接管。
- `tests/shell-route-probe.html`：**3 轮全 PASS**。375×780：`shell.layout()=mobile`、手机悬浮球 `display=flex`、电脑悬浮球 `display=none`、电脑浮窗没同时打开、`shell.open()` 后 `dialog.open=true`、面板挂在手机壳里、`shell.notify` 落进 `.ilb-m-toasts`（真机上宿主 toastr 会被 top layer 压住）。900×700：反过来——电脑悬浮球在场、手机悬浮球 `display=none`、`shell.open()` 后 `.ilb-window` 打开、面板挂在电脑浮窗里。
- `tests/browser-probe.html`：`verdict PASS`、自检非预期失败 **0**（浮层铺满 984×765、屏幕正中属于浮层、关闭按钮 44×44）。
- `tests/nocss-probe.html`：八条全过（浮层 984×765 `rgba(0,0,0,0.55)`、弹窗 642×172 `rgb(30,30,30)`、一条"样式没生效已兜底"的 warn）。
- `tests/selftest-probe.html`：PASS、非预期失败 0（`style.css 里数到 130 条 .ilb- 规则`、`弹窗高度 162px（最小高度 160px，电脑布局）`）。
- `tests/empty-probe.html`：PASS（空正文在 t+400ms 被补上"这一层浮层没有内容"）。
- `node --test` 单元 **102/102**、`node tests/linkcheck.mjs` **40 个模块全过（含 index.js）**、`node tests/smoke-dom.mjs` **19 步 0 失败**。

**仍未验证**：SillyDroid 等手机 WebView 真机——`showModal()` 与宿主模态的叠加、安卓返回键是否走 `cancel` 事件、软键盘弹出时 `visualViewport` 的行为，目前都只有桌面 Chrome 的窄视口证据。

---

## v0.4.8-code · 2026-10-24 · "渲染出来了"不等于"看得见"：给浮层准备一套不依赖样式表的皮肤（含规格 v2.5.5）

**一句话**：v0.4.7 之后用户回报"不是一小条了，但是点击按钮后，没有页面弹出，或者单纯没有显示"。查下来是上一轮只修好了"浮层看不看得见"（内联几何），却没人管"**弹窗**看不看得见"：几何与尺寸全对，但底色、边框、文字颜色仍来自那份**没生效的样式表**，屏幕上是"透明容器里套一个透明盒子"。于是补一套内置皮肤，并让自检把两个底色也报出来。

**修正**

| 位置 | 内容 |
|---|---|
| `ui/help.js` | 新增 `applySkin(overlay, modal, isMobile, why)`：不依赖 `style.css` 的最小皮肤——浮层半透明黑底与层级；弹窗 `display:flex` 纵排、背景 `var(--SmartThemeBlurTintColor,#1e1e1e)`、文字 `var(--SmartThemeBodyColor,#eaeaea)`、边框、圆角、阴影、`min-height`（手机 `45vh` / 电脑 `160px`）、`max-height`、`overflow:hidden`；标题栏左右分布与下边框；正文区内边距与滚动；关闭按钮最小可点面积 |
| `ui/help.js` | 新增 `isTransparentBackground(value)`：不用字符串相等（`transparent` 与 `rgba(0,0,0,0)` 写法不同），解析 `rgb()`/`rgba()`，四分量要求 alpha > 0.01 |
| `ui/help.js` | `ensureVisible` 增加"看得见"判定：①浮层尺寸/定位都对但**背景透明** → 套皮肤并 return ②通过薄条检查后，弹窗背景透明 / 宽 < 40 / 高 < 8 → 套皮肤；全部通过才 `console.debug` 记一行"浮层可见性检查通过：弹窗 W×H，背景 …，layout" |
| `ui/help.js` | 兜底提示从"已用内联样式兜底"改为"浮层样式没有生效（命中的具体项），已用内置样式兜底。若反复出现，说明 style.css 没有被加载" |
| `ui/selftest.js` | 新增两条：`浮层底色 rgba(...)`、`弹窗底色 rgb(...)`，透明即判问题；并加本地 `isTransparent()` 辅助 |

**新增**

| 位置 | 内容 |
|---|---|
| `tests/nocss-probe.html` | 真实浏览器探针：**故意不加载** `../style.css`，只 import `ui/help.js`，打开带标题与两段正文的浮层，等 600ms 后量尺寸与两个底色，断言八条（铺满 / 浮层有底色 / 弹窗有底色 / 弹窗高 ≥120 / 宽 ≥min(280, 视口-40) / 正文在 / 关闭按钮在 / 控制台说明原因），`POST /report` 回传 |
| `tests/selftest-probe.html` | 断言增加"报出浮层底色""报出弹窗底色"两条 |

**实测（真实 Chrome，`--headless=new`，静态服务器 `node tests/serve.mjs 8794`）**

| 项 | 结果 |
|---|---|
| `tests/nocss-probe.html` @390×844（视口 500×693） | **PASS**：浮层 500×693 背景 `rgba(0,0,0,0.55)` `position=fixed`；弹窗 500×314 背景 `rgb(30,30,30)` 边框 1px；正文 2 段；八条 ✓ |
| `tests/selftest-probe.html` | **PASS**：`style.css 里数到 144 条 .ilb- 规则`、`弹窗高度 314px`、`浮层底色 rgba(0, 0, 0, 0.55)`、`弹窗底色 rgb(30, 30, 30)` |
| `tests/sizing-probe.html` @390×844 | **PASS**：`emptyH=314`、`inlineMin=45vh`，warns 只有预期的"正文是空的"——**样式表正常时没有误触发皮肤兜底** |
| `node --test tests/*.test.mjs` / `linkcheck` / `smoke-dom` | 102/102、37 模块全通过、17 步 0 失败 |

**仍未被证明**

- 真实 SillyTavern + SillyDroid 里 `style.css` 到底有没有加载：这次只是证明了"没加载也不会看不见"，没有证明"一定会加载"。用户自检里的两个底色能直接分辨。
- 主题变量 `--SmartThemeBlurTintColor` / `--SmartThemeBodyColor` 缺失时退回 `#1e1e1e` / `#eaeaea` 的观感只在 Chromium 里看过。
- 皮肤兜底的触发条件用的是 `getComputedStyle`，在极旧 WebView 上的表现未验证（已用 `typeof getComputedStyle !== 'function'` 防御，但没实测）。

---

## v0.4.7-code · 2026-10-24 · 兜底自己也掉了链子：把"绝不能失效"的四条几何内联钉死（含规格 v2.5.4）

**一句话**：用户回报浮层依旧只有顶上很薄一排，并贴出了那层浮层的 DOM——浮层与弹窗上带着整串 `style="position: fixed; inset: 0px; …"`。这串内联样式本身就是证据：说明当时走的是 **"样式没生效 → 内联兜底"** 这条路，而当时的兜底**没有写 `min-height`**，于是兜底把用户送回了"一条缝"。教训不是"再调一次 CSS"，而是：**兜底必须比样式表更保守地保证"看得见"**。

**修正**

| 位置 | 内容 |
|---|---|
| `ui/help.js` | `openOverlay` 在插入后立即内联写上四条不能失效的几何：浮层 `position: fixed` / `inset: 0` / `display: flex` / `z-index: 2147483000`，以及弹窗 `min-height`（手机 `45vh`、电脑 `160px`）。理由见 ILB-6.17.7：内联样式不会被旧缓存、主题或别的扩展抢走 |
| `ui/help.js` | 兜底分支重写：`cssText` 按当前布局生成（手机贴底整宽 + `min-height: 45vh`，电脑居中 + `min-height: 160px`），并把**命中了哪一条**写进 warn（`display=none` / `visibility=hidden` / `position=static` / `宽 Npx` / `高 Npx`），不再只说"样式没生效" |
| `ui/help.js` | 自愈检查新增 `overlay.isConnected === false` 直接返回：延迟回调可能在浮层被关掉之后才跑，那时量到 0×0、`position` 也是 `static`，会误判成"样式没生效"并给一个已经不在页面上的元素套兜底 |
| `ui/help.js` | `syncLayoutClass()` 改为**返回**判定结果（`'mobile' \| 'desktop'`），供内联几何与自愈分支复用同一份判断 |
| `ui/selftest.js` | 新增三项"报数"检查：①`style.css` 里数到多少条 `.ilb-` 规则（< 20 条即旧版本或被截断）②弹窗实测高度 + 计算出的 `min-height` + 当前是手机还是电脑布局③弹窗上有没有就地固定的最小高度 |
| `tests/sizing-probe.html` | 量测字段补 `minHeight` 与 `inlineMin`，日志同时打印计算值与内联值——否则"兜底到底有没有生效"只能靠猜 |
| `tests/selftest-probe.html` | 新增探针：在真实浏览器里跑一遍真的 `runSelfTest()`，并额外检查"报数"的四项是否真的带数字（规则条数 / 弹窗高度 / 布局 / 内联最小高度） |

**修订**

| 位置 | 内容 |
|---|---|
| `参考文档.md` | 升 **2.5.4**；**§6.17** 增 **ILB-6.17.7**（四条几何必须内联，附"兜底本身把用户送回细缝"的反面证据）与 **ILB-6.17.8**（自检必须报数）；§9.3 增两条验收（删掉 `style.css` 的 link 后仍要能看见；自检要报规则条数/弹窗高度/布局） |
| `index.js` / `manifest.json` | 版本 `0.4.6` → `0.4.7` |

**实测**（真实 Chrome，本机）

| 场景 | 结果 |
|---|---|
| `node --test tests/*.test.mjs` | 102/102 通过 |
| `node tests/linkcheck.mjs` | 37 个模块全通过（含入口 `index.js`） |
| `tests/sizing-probe.html` `390×844`（视口 500×693） | 短内容 314 / 长内容 682 / 空内容 314 / 强制手机 682 贴底整宽 → PASS；`inlineMin=45vh`、计算值 `311.85px` |
| `tests/sizing-probe.html` `1280×800`（视口 1264×649） | 短 238 / 长 619 / 空 162 / 强制手机 1264 整宽 → PASS；`inlineMin=160px` |
| `tests/selftest-probe.html` `390×844` | PASS。自检实际输出：`样式表已解析`、`style.css 里数到 144 条 .ilb- 规则`、`浮层已铺满视口（500×693）`、`弹窗高度 314px（最小高度 311.85px，手机布局）`、`已就地固定最小高度 45vh`；三条"未加载宿主"为预期失败 |

**仍未被证明**

- 用户手机上（SillyDroid）是否真的还是旧缓存：本轮把"就算样式没生效也要看得见"做到了内联兜底，但没有他的设备可复现。
- 内联 `min-height: 45vh` 在极矮的横屏手机上会不会显得太空：没有真机数据。
- 自检的 `.ilb-` 规则计数依赖浏览器允许读 `cssRules`（跨域样式表会抛），已用 try/catch 兜住但没有真实宿主验证。

---

## v0.4.6-code · 2026-10-24 · 手机上浮层只剩"很薄一排"：两把钥匙 + 薄条自愈（含规格 v2.5.3）

**一句话**：用户报"点按钮后页面会正常弹出，可是只有高度非常小的一排，大概只覆盖了原本顶部的几个选项按钮"，并补充"PC 端没有任何问题，只有手机端"。根因是两件事叠加：**手机那套样式根本没生效**（SillyDroid 的 WebView 按桌面宽度排版，`@media (max-width: 768px)` 不成立），加上**浮层正文还没到（或渲染失败）导致高度由内容决定** → 桌面规则下顶对齐 + 空内容 = 一条细缝。

**新增**

| 位置 | 内容 |
|---|---|
| `style.css` | `.ilb-mobile` 类规则块（与 `@media (max-width:768px)` 同一套规则的"第二把钥匙"）：贴底、整宽、`min-height: 45vh`、安全区 padding、关闭按钮 44×44 |
| `ui/help.js` | `syncLayoutClass()`：按 `ui/layout.js` 的 `pickLayout()`（宽度 + 是否粗指针）给 `body` 切 `ilb-mobile` |
| `ui/help.js` | `ensureVisible` 新增两条自愈：弹窗高度 `< min(180, 视口×0.2)` → 内联 `min-height: 45vh` 并 warn；正文无子节点 → 插入"这一层浮层没有内容（可能是渲染时出错了）……"并 warn |
| `ui/help.js` | 自愈检查加定时兜底 `setTimeout(run, 400)` + 「只跑一次」标记：`requestAnimationFrame` 在后台标签页/部分 WebView/无头浏览器里会被节流甚至不触发 |
| `tests/sizing-probe.html` | 真实浏览器尺寸探针（加载真实 `style.css` 与 `ui/help.js`）：短内容 / 长内容+底栏 / 空内容 / 强制手机布局 四组，量 overlay、modal、head、body 的实际尺寸；结果 POST 回本地服务器 |
| `tests/empty-probe.html` | 只测一件事的探针：空浮层等 800ms，看自愈有没有插入提示（sizing-probe 四组连跑时有 rAF 串扰，需要隔离验证） |
| `tests/serve.mjs` | 新增 `POST /report`：把探针结果写成 `tests/last-report.json`（本机无头 Chrome 不往 stdout 写任何东西） |

**修订**

| 位置 | 内容 |
|---|---|
| `style.css` | `.ilb-modal` 的 `min-height: 0` → `min-height: 160px`（内容为空时也不能塌成一条缝，ILB-6.17.2） |
| `参考文档.md` | 升 **2.5.3**；新增 **§6.17 浮层不能变成"很薄的一排"**（ILB-6.17.1–6.17.6：两把钥匙、高度下限、量高度自愈、空正文必须说明、定时兜底、探针验收）；§9.3 增三条验收 |
| `index.js` / `manifest.json` | 版本 `0.4.5` → `0.4.6`（用 `[System.IO.File]::WriteAllText` + UTF8 无 BOM，避免重演 v0.4.4 的乱码事故） |

**实测**

- `tests/sizing-probe.html`：`--window-size=390,844`（实际视口 500×749）四组全 PASS；`--window-size=1280,800`（1264×705）四组全 PASS。空内容那组：手机 177px（head 61 + body 116，含说明文字），桌面 162px——修复前是 87px。
- `node --test tests/*.test.mjs`：102/102 通过。
- `node tests/linkcheck.mjs`：37 个模块全部通过（含 `index.js`）。
- `node tests/smoke-dom.mjs`：17 步，失败 0。

**仍未被证明**

- 没有 SillyDroid 真机验证：探针用的是桌面 Chrome 改窗口尺寸，只能证明"CSS 与自愈在 Chromium 下行为正确"，不能证明该 WebView 的宽度/像素比与 `pointer: coarse` 判定一致。
- 用户看到的"薄条"没有拿到他的实际截图与视口尺寸，所以"是这两件事叠加"目前是从两个特征（顶部、一排高）反推的，不是从他的环境里量出来的。
- 探针只量尺寸，不判断内容是否可点、可滚。

---

## v0.4.5-code · 2026-10-24 · 入口文件被我改坏了：整个扩展不加载（含规格 v2.5.2）

**一句话**：用户报"连悬浮球都没有显示"。根因不是功能，是 **`index.js` 变成了乱码并吃掉一个引号**，`node --check` 报 `SyntaxError: missing ) after argument list`（第 60 行）。SillyTavern 加载入口失败 → 整个扩展不启动 → 悬浮球、设置卡片、面板全部消失。而当时所有检查都通过，因为链接检查**跳过了入口文件**。

**修正**

| 位置 | 内容 |
|---|---|
| `index.js` | 从上一个好提交 `0536856:index.js` 取回原始字节（UTF-8 无 BOM，8415 字节）覆盖；随后用能保持编码的方式把 `VERSION` 改为 `0.4.4` → `0.4.5` |
| `manifest.json` | 版本号同步为 `0.4.5` |
| `tests/linkcheck.mjs` | 不再跳过 `index.js`：新增 `checkEntry()`，给 `document` 一个最小桩（`readyState:'loading'`），让入口只被解析、不真的启动；语法错误会输出 `FAIL index.js [语法错误]` 并以非零码退出 |

**新增**

| 内容 | 说明 |
|---|---|
| 入口解析检查 | 覆盖"整个扩展不显示"这一整类故障；此前 37 个模块里唯一没被解析的就是入口 |

**教训（写进规格 ILB-8.0.3）**

1. "检查所有模块"的脚本**不许跳过入口文件**。入口有语法错误时，扩展一行都不执行，用户看到的是"什么都没发生"。
2. 检查项的价值 = 它覆盖的失败面。少掉的那一项如果是入口，权重高于其余全部。
3. **禁止用 `Get-Content -Raw`（默认编码）+ `Set-Content -Encoding utf8` 改含中文的源码**：前者按 ANSI/GBK 解码、后者按 UTF-8 写回，等于把整份文件转码，字节数变化会吃掉引号。改源码只用能保持 UTF-8 的方式。

**待验证**

- [ ] 用户在 SillyTavern 里重新拉取后，悬浮球与设置卡片是否恢复（这是唯一有意义的验收）
- [ ] CI 在 `3b25222` 之后是否对坏入口报红（如果当时报绿，说明 CI 也没覆盖入口——本提交之后应能报红）

## v0.4.4-code · 2026-10-24 · 浮层没弹出来：是被 ILB 自己的浮窗盖住了（含规格 v2.5.1）

**一句话**：上一轮没复现出来的故障，用户自己定位到了——**不是没弹，是弹出来的浮层被 ILB 的浮窗盖住了**。手机端（SillyDroid）上浮窗是整屏的，浮层一旦被压到它下面，整块消失；桌面上浮窗只占一角，所以看着"正常"。根因是浮层的可见性靠"比浮窗高 100 的 z-index"（4600 对 4500）维持，这个差值经不起任何一次覆盖。

**修正**

| 位置 | 内容 |
|---|---|
| `style.css` | `.ilb-overlay` 的层级从 4600 提到 **2147483000**（接近上限），不再靠"略高于浮窗"；新增 `body.ilb-overlay-open .ilb-window/.ilb-fab/.ilb-backdrop { visibility: hidden !important }`——浮层开着时让开自家界面，关掉后原样回来 |
| `ui/help.js` | `openOverlay()` 加 `ilb-overlay-open`（与 `ilb-locked` 一起成对增删）；`ensureVisible()` 增加**遮挡检测**：用 `document.elementFromPoint(屏幕正中)` 实测"最上面是谁"，命中浮层之外就把浮层内联提到最上层并警告说明被谁挡住 |
| `ui/selftest.js` | 自检新增两条：浮层层级是否高于浮窗、屏幕正中那一点是否属于浮层；另加 `describeNode()` 把遮挡物描述成人看得懂的名字 |
| `tests/browser-probe.html` | 新增"模拟整屏浮窗"场景：造一个 4500 层级的整屏 `.ilb-window`，再开浮层，断言屏幕正中命中的是浮层、浮窗已让开 |
| `tests/serve.mjs` | 新增：零依赖静态服务器，供探针使用（`node tests/serve.mjs 8792`） |

**实测结果（2026-10-24，无头 Chrome，390×844）**

```
viewport: 500×693
overlay: w=500 h=693 display=flex position=fixed z=2147483000
close-button: 44×44，在视口内
浮窗开着时，屏幕正中命中的是: div.ilb-overlay
浮层在最上层: 是
浮窗让开了吗: visibility=hidden
判定: PASS
node --test → 102/102；linkcheck → 37 模块 36 通过 1 跳过；smoke → 17 步 0 失败
```

**待验证**

1. 真机（SillyDroid）上复测：开着整屏浮窗再点「导入原生世界书」，浮层应完整可见。
2. 浮层开着时隐藏浮窗，是**行为变化**：关掉浮层后浮窗会重新出现（状态不丢），但视觉上会闪一下，是否可接受待观察。
3. `visibility: hidden` 的让开规则依赖 `body.ilb-overlay-open`；若别的扩展把浮窗挪出 body，则不生效（自检的遮挡检测会兜底）。

---

## v0.4.3-code · 2026-10-24 · "点了按钮没反应"：先让失败出声，再加一键自检（含规格 v2.5.0）

**一句话**：用户报告"点击按钮没有界面弹出，只有导出的功能正常"。这次没有直接改布局去猜原因——先用**真实的 Chrome（无头）**把浮层在手机与桌面两种视口下量了一遍，结果**两种尺寸都正常**（浮层铺满视口、关闭按钮在视口内、手机 44×44）。所以修复方向不是"再调一次 CSS"，而是：把**坏得安静**这件事本身当成缺陷，补上"打开有日志、样式失效有兜底、未捕获错误有提示、界面前一步先开再等数据"，并加一个一键自检，让下一轮能拿到事实而不是描述。

**新增**

| 位置 | 内容 |
|---|---|
| `ui/selftest.js` | `runSelfTest()` / `showSelfTest()`：检查样式表是否加载并解析、浮层规则是否生效、浮层能否开出来并铺满视口、关闭按钮是否存在、扩展与管线是否就绪；结果等宽可复制 |
| `ui/view-settings.js` | 新增「出问题时」卡片 + 「运行自检」按钮 |
| `index.js` | `window.ILB.selftest()`；全局 `error` / `unhandledrejection` 钩子，把未捕获异常变成界面上的 toast（原始错误仍完整留在控制台） |
| `tests/browser-probe.html` | 真实浏览器探针：无头 Chrome 打开即输出浮层矩形、关闭按钮尺寸、是否铺满、自检逐条结果 |
| `style.css` | `.ilb-selftest`（等宽、可选中、可换行） |

**修订**

| 位置 | 内容 |
|---|---|
| `ui/help.js` | `openOverlay()` 打开后打印 `[ILB] 浮层已打开：<标题>`，并调用 `ensureVisible()` 量一次 |
| `ui/importer.js` | `openImportDialog()` 先把浮层开出来（内容为"正在读取原生世界书列表…"）再请求宿主；读失败/空目录时把原因写在浮层里 |
| `docs/参考文档.md` | 新增 §6.15（ILB-6.15.1–6.15.7）与 §9.3 三条验收；版本 2.5.0 |
| `manifest.json` / `index.js` | 版本 0.4.2 → 0.4.3 |

**实测结果（2026-10-24 本机）**

```
node --test                      → tests 102, pass 102, fail 0
node tests/linkcheck.mjs         → 共 37 个模块：通过 36、跳过 1、失败 0
node tests/smoke-dom.mjs         → 界面冒烟：失败 0（17 步）
无头 Chrome 390×844（实际 500×693）→ 浮层 500×693 铺满、关闭按钮 44×44 在视口内、判定 PASS
无头 Chrome 1280×800（实际 1264×649）→ 浮层 1264×649 铺满、关闭按钮 32×32 在视口内、判定 PASS
自检（干净页面）→ 除"找不到 window.ILB / 管线 / 存档"三条预期失败外全部通过
```

**待验证**

1. **用户环境里的真实成因仍然未知**。干净页面复现不出来，最可能是"加载到了半新半旧的代码"（浏览器缓存了旧 `style.css`、或只覆盖了部分文件）。下一个动作必须是：强制刷新 → 设置页「运行自检」→ 把结果与控制台 `[ILB]` 行发回。
2. 自检在 SillyTavern 的真实主题与 CSS 变量下是否误报（例如主题让 `position` 计算值不同），未验证。
3. iOS Safari 的 `dvh` 与安全区仍未实测。

---

## v0.4.2-code · 2026-10-23 · 手机上浮层"太靠上、关闭按钮点不到"（含规格 v2.4.1）

**一句话**：真机测试发现，手机上从「试一句」「导入原生世界书」「导入记录」等处弹出的次级菜单位置过于靠上，右上角关闭按钮点不到。根因不是某个弹层写错，而是**定位策略**：`align-items: center` + 内容比屏幕高时，溢出部分会被平均顶到上方，标题栏和关闭按钮一起被顶出可视区。改成"所有浮层走同一个出口 + 顶对齐可滚动 + 手机贴底面板 + 固定标题栏 + 触控够大的 ×"。

**修正**

| 位置 | 问题 | 修法 |
|---|---|---|
| `style.css` `.ilb-overlay` / `.ilb-modal` | `align-items: center` 且 `max-height: 82vh`；手机上 `vh` 按地址栏收起后的高度算，内容又撑破 `max-height`（flex 子项默认 `min-height:auto` 不肯缩），整块弹层向上溢出，关闭按钮跑到屏幕外 | 容器改 `align-items: flex-start` + `overflow-y: auto` + 安全区 padding，弹层 `margin: auto`（短时居中、长时从顶开始）；`max-height` 用 `calc(100dvh - 32px)`；`.ilb-modal-body` 补 `min-height: 0` 让它真正滚动 |
| `style.css` | 关闭按钮是文字「关闭」，长标题下会被挤到换行 | 新增 `.ilb-modal-x`：`×` + `aria-label="关闭"`；桌面 32px，手机 44×44 |
| `ui/help.js` | 标题栏会随正文一起滚走 | `.ilb-modal-head` 改 `position: sticky; top: 0` 且给不透明背景 |
| `ui/help.js` | 浮层打开后，背景页面还能跟着手指滚，滚着滚着弹层就被顶走 | 打开时给 `body` 加 `ilb-locked`，关闭时在 `closeOverlay()` 里成对移除；CSS 只在 ≤768px 生效，避免桌面布局跳动 |
| `style.css` `@media (max-width: 768px)` | 手机上的弹窗居中，屏幕越大关闭按钮越往屏幕上半部跑 | 改为从底部升起的整宽面板（`align-items: flex-end`、`width: 100%`、`max-height: calc(100dvh - 12px)`、`border-radius` 只留上面两角、底部安全区） |
| `style.css` | `.ilb-modal-wide` 被 `help.js` 引用但从未定义，宽浮层并不宽 | 补 `.ilb-modal-wide { width: min(96vw, 900px) }` |
| `ui/importer.js` / `ui/editor.js` + `style.css` | 同一类"够不着"：这两处的「开始导入/保存」按钮放在浮层正文的最下方，正文一长就要一路滚到底才能按 | `.ilb-modal-body > .ilb-modal-foot` 改 `position: sticky; bottom: 0`（含底部安全区），让底栏钉住、正文自己滚 |

**新增**

| 位置 | 内容 |
|---|---|
| `docs/参考文档.md` §6.14（ILB-6.14.1–6.14.8） | 浮层与次级菜单的硬约束：统一出口、顶对齐、× 与触控尺寸、固定标题栏、手机贴底、锁背景滚动、必须挂 `document.body`、375px 验收 |
| `docs/参考文档.md` §9.3 | 两条验收：全部次级菜单在 375px 下关闭按钮首屏可点；浮层开着时背景不滚 |
| `tests/smoke-dom.mjs` | 新增一步：真的走 `openOverlay()` 开一层，检查 `ilb-overlay → ilb-modal-head → ilb-modal-x` 的结构、`aria-label`、`×` 文案，点一下确认浮层被移除且 `ilb-locked` 已解除（第 17 步） |

**实测结果（2026-10-23 本机）**

```
node --test tests/*.test.mjs     → tests 102, pass 102, fail 0
node tests/linkcheck.mjs         → 共 36 个模块：通过 35、跳过 1、失败 0
node tests/smoke-dom.mjs         → 界面冒烟：失败 0（17 步）
```

**待验证**

1. 这是按"手机上为什么点不到"推导出的修法，**没有在真机上复测过**——修的是成因，但真机行为（尤其 iOS 的 `dvh` 与安全区）仍需一次确认。
2. 贴底面板在横屏手机上是否过高（`88vh`），未验证。
3. 锁背景滚动依赖 `body` 是滚动容器；若 SillyTavern 的主题把滚动放在内层 `#chat` 上，本条不生效（不影响关闭按钮可用）。

---

## v0.4.1-code · 2026-10-23 · 第一次真的跑起来：102 个测试全过，连锁触发修好一处真 bug

**一句话**：这台机器上 `node` 突然能用了（此前一直报 `0xC0000142`）。于是把之前"写好了但没跑"的东西全部跑了一遍：单元测试 102 个、模块链接检查 36 个、假 DOM 界面冒烟 16 步。**跑出了 3 个失败，全在连锁触发上，根因是真的写错了。** 仍然没有在真实 SillyTavern 里跑过。

**修正**

| 位置 | 问题 | 修法 |
|---|---|---|
| `core/evaluate.js` 连锁循环 | 第 1 层只用"基础文本"去找下一条，**没有把第 0 层（关键词带出来的条目）的正文算进去**，所以"正文里的词继续触发下一条"实际上不生效。三个连锁用例全挂 | 进入循环前用 `afterWhen` 的正文初始化 `layerContents`，第 k 层看到的是"基础文本 + 前 k−1 层正文"；同层新增的正文放进 `newlyAdded`，本层结束后才并入，避免同层顺序影响结果（符合 ILB-4.6.2） |
| `ui/panel.js` | 只导出 `mount/render/toast/element/setTab/state`，`openEditor`/`openPreview` 只存在于内部 `ctx`，外部拿不到 | 返回值补上这两个，顺带让冒烟脚本能直接开编辑器 |

**新增**

| 位置 | 内容 |
|---|---|
| `tests/linkcheck.mjs` | 逐个 `import` 所有模块，抓"导入了不存在的名字"这类链接期错误（`index.js` 因为自启动会跳过）。结果：35 通过、1 跳过、0 失败 |
| `tests/smoke-dom.mjs` | 极简 DOM 桩（`createElement` / `appendChild` / `addEventListener` / `classList` / `nodeType`…），把面板五页、规则编辑器、「试一句」、Flow 编辑器（展开并连加两个节点）、导入选择浮层、设置卡片、悬浮球开关全部点一遍。16 步全过 |

**实测结果（2026-10-23）**

```
node --test tests/*.test.mjs     → tests 102, pass 102, fail 0
node tests/linkcheck.mjs         → 共 36 个模块：通过 35、跳过 1、失败 0
node tests/smoke-dom.mjs         → 界面冒烟：失败 0（16 步）
```

**这次仍然没有证明的事（不要当成已验证）**

1. **真实宿主**：`setExtensionPrompt` 的参数顺序、`event_types` 的字段名、`../../extensions.js` 这条路径，全都还只是按源码推的。
2. **注入是否真的进了提示词**、位置/深度/角色在文本与聊天补全两种模式下各是什么效果。
3. **真实浏览器里的布局**：假 DOM 不排版，375px 会不会横滑、浮窗能不能拖、`dvh` 是否生效，都没测到。
4. **空流程与升级前逐字一致**：逻辑上成立（`hasFlow` 为假就整段跳过），但没有拿真实注入文本对比过。
5. 导入/导出往返用的是构造出来的原生 JSON，不是从 SillyTavern 里真读出来的文件。

---

## v0.4.0-code · 2026-10-23 · 判定流程：把触发条件变成可以拼的节点（含规格 v2.4.0）

**一句话**：用户要的不是"填几个选项"，而是像蓝图那样从上往下自己搭判断。这一版加了节点树（检测 / 判定 / 比较 / 定义 / 计算 / 添加 / 通过 / 不通过），并且**空流程 = 完全等于原生世界书**。仍然**没有运行过一行**。

**新增**

| 编号 | 内容 |
|---|---|
| ILB-4.10.1–4.10.11 | 判定流程的模型与语义：八种节点、空流程即原生、执行顺序、分支留空 = 不通过、变量只在本次执行内有效、`add` 计入预算、`mode` 两档、上限 80/8/200、必须纯函数、试一句必须覆盖流程 |
| ILB-6.13.1–6.13.8 | 流程编辑器：树形块而非画布、默认空、每节点一句话、结构变更才重绘、规则卡徽标、原地展开不弹新层、手机不横滑、「不成立时」的后果必须印在原地 |
| ILB-7.19 | 流程的三种"以为坏了"：关键词与流程是并且关系、留空等于不通过、变量拼写不一致静默为空 |
| `extension/core/flow.js` | `normalizeFlow` / `hasFlow` / `countFlowNodes` / `evaluateFlow` / `evalCondition` / `compareValues` / `describeNode` / `describeFlow` / `makeNode` / `makeCondition`；常量 `MAX_NODES=80` `MAX_DEPTH=8` `MAX_STEPS=200` |
| `extension/ui/flow-editor.js` | `renderFlowEditor({flow, entries, onChange, ctx})` 与 `flowSummary(flow)` |
| `extension/tests/flow.test.mjs` | 15 个用例：空流程、检测成立/不成立、judge all/any、比较数字与文本、定义+计算、add 拼正文、pass/fail 终止、嵌套、节点上限、mode only、诊断 stage、试一句、makeNode 字段 |
| `extension/style.css` | `.ilb-flow*` 一族约 120 行，全部 `flex-wrap`，窄屏输入各占一行 |

**修订**

| 编号 | 内容 |
|---|---|
| ILB-4.2.1 顺序 | 流程追加在「触发词 → when 条件」之后、概率之前（ILB-4.10.3），不改变原有第 6–10 步的编号 |
| ILB-4.9.3 | 试一句的判定范围加上流程，`steps` 里以 `stage: "logic"` 出现 |
| `core/model.js` | `defaultEntry()` 增加 `logic: {mode:'and', nodes:[]}`；`normalizeEntry` 用 `normalizeFlow` 洗 `raw.logic`（否则界面存进去的脏数据会直接进判定） |
| `core/evaluate.js` | 触发阶段支持 `mode:"only"` 跳过关键词；when 之后跑流程；连锁循环同样跑；预算与输出用 `content + extraText` |
| `ui/editor.js` | 新增「判定流程（可以不加）」一段：摘要 + 模式下拉 + 「编辑流程」原地展开；`buildEntry()` 带上 `logic` |
| `ui/view-diagnostics.js` | `STAGE_LABEL` 增加 `logic: '判定流程'` |
| `ui/view-rules.js` | 规则卡增加徽标「有流程」/「只看流程」 |
| `参考文档.md` | 版本 2.3.0 → **2.4.0**；§9.3 增加三条验收（空流程逐字一致、试一句覆盖流程、375px 不横滑） |

**修正**

| 编号 | 内容 |
|---|---|
| 按钮文字被"蒙板"盖住 | 根因：`.ilb-btn` 用 `--SmartThemeQuoteColor` 画底、`#fff` 画字，而 `.ilb-btn-primary` 又把自己的字设成同一个颜色 —— **同一个颜色既画底又画字**，于是不 hover 时只剩一块纯色板。改为半透明白底 + `color: inherit`，补 `:hover` 与 `:disabled`；主按钮改用淡蓝底。涉及"导入全部"里的「先选择「条目开关」的处理方式」「保存快照」等所有按钮 |
| 流程编辑器不弹第二层浮层 | 帮助浮层是单层的，弹第二层会把正在编辑的规则顶掉（用户填一半的内容会没）。改为在编辑器内原地展开 |

**待验证（必须先跑，不能靠读代码下结论）**

1. `node --test tests/flow.test.mjs` 未执行。
2. 空流程是否真的与上一版逐字一致——需要在真实对话里对比注入文本。
3. `mode:"only"` 与连锁组合时，被连锁带出的规则是否按预期忽略关键词。
4. 流程编辑器在手机上展开后，节点卡与分支块是否仍然不横向滚动。
5. `add` 追加的正文是否真的出现在提示词里、且计入预算后不会把别的规则挤掉。

---

## v0.3.0-code · 2026-10-23 · 让判定看得见，加上搜索、快照、批量与导入策略（含规格 v2.3.0）

**一句话**：用户问"判定逻辑在哪里，我没看见"——不是功能缺失，而是**结果不可见**。这一版把规则页改成卡片、每条规则都能"试一句"并逐步显示卡在哪一步；同时补上搜索筛选、快照、批量操作、四种导入策略与一键导入。仍然**没有运行过一行**。

**用户依据**（m00845）：① "通过逻辑判定来选择是否触发世界树的功能，我好像并没有看见在哪里？" ② "在任何出现选择的页面中，多出筛选以及搜索的功能" ③ "添加快照保存功能……让用户可以同时在多个风格以及快照组之间来回切换" ④ "目前的规则列表，在手机端有些太宽了……一个规则的选择卡，可以上下比较长，但不能左右太宽" ⑤ "在导入原生世界书时，是否保留其默认的开启、关闭等选项" ⑥ "加一个导入所有原生世界书的按钮……排除已经导入过的世界书" ⑦ "添加批量操作功能……仅对当前筛选或搜索的结果生效"。

### 新增

| 编号 | 类型 | 内容 | 理由 / 决策 |
|---|---|---|---|
| `core/evaluate.js` 的 `previewEntry` | 新增 | 逐条预演：`enabled → timed → always → trigger → when`，返回 `{passed, reason, steps[]}`；复用 `evalTrigger`/`evalWhenArray`，不碰概率/同组/预算/连锁/状态 | 这是"判定看不见"的正解：**让它把过程说出来**，而不是再写一套判断（D-0025） |
| `core/search.js` | 新增 | 多关键词全部命中（AND）、可搜标题/正文/分组/触发词/正则源码；`filterEntries`、`filterBooks`、`listGroups`、`describeFilter` | 用户只记得"里面写过某个词"，未必记得标题，所以搜索必须覆盖正文 |
| `core/snapshot.js` | 新增 | 快照只存"哪些条目开着"，不存正文；常用 10 / 临时 5；按最近使用淘汰、`promotedAt` 防刚改名被顶掉；恢复前自动备份 | D-0021：切风格不该改正文 |
| `core/import-plan.js` | 新增 | 四档导入策略 `ask/keep/on/off`；`planBatchImport` 按 `_source.book_file` 判重，默认跳过已导入 | D-0023：`ask` 必须是真弹窗，不能静默替用户选 |
| `ui/widgets.js` | 新增 | 一堆小控件工厂（按钮、勾选、字段、徽标、筛选栏、搜索框、下拉……） | 五个页面各写一份造控件的代码，很快就不一致 |
| `ui/editor.js` | 新增 | 四段式编辑器：什么时候出现 / 还要满足什么条件 / 出现多久 / 怎么出现；同页有"试一句" | 把判定条件放在**第一段**，用户才找得到 |
| `ui/importer.js` | 新增 | `importMany` 批量导入、`openImportDialog` 选择浮层（搜索 + 勾选 + 策略 + 包含已导入） | 一本本点是最没必要的劳动 |
| `ui/view-shelf.js` / `view-rules.js` / `view-snapshots.js` / `view-diagnostics.js` / `view-settings.js` | 新增 | 五个标签页各自成文件 | ILB-6.1.4：一页坏了只坏一页 |
| `ui/panel.js` 路由壳 | 重写 | `ctx` 统一提供给各页；`state` 记住当前标签、当前书、搜索词、勾选集合；单页渲染单独 try/catch | 面板只做路由，不再兼任五个页面的实现 |
| `tests/search.test.mjs` / `snapshot.test.mjs` / `import-plan.test.mjs` | 新增 | 各 11 个用例；`core.test.mjs` 另加 10 个 `previewEntry` 用例 | **一个都没跑过** |
| 帮助文案 `snapshots` / `editor` / `import` / `batch` / `search` | 新增 | 五个新区域的三段式说明 | ILB-6.4.3 |

### 修订

| 编号 | 类型 | 内容 | 理由 / 决策 |
|---|---|---|---|
| `adapters/repository.js` | 修订 | 新增 `snapshots` 桶与 `listSnapshots/saveSnapshot/deleteSnapshot/renameSnapshot`；导出/导入带快照 | 快照是用户数据，导出备份时不能丢 |
| `settings` | 修订 | 新增 `importEnabledPolicy`（默认 `ask`）、`batchImportIncludeExisting`（默认 `false`） | 默认"每次问"比默认"替你决定"安全 |
| `ui/view-rules.js` | 修订 | 规则从表格改为卡片列表：勾选框 + 标题 + 徽标 + 元信息 + 操作，全部可换行；批量条按当前筛选结果生效 | ILB-6.10.7 / 6.12.1 |
| `style.css` | 修订 | 删掉 `.ilb-window-mobile .ilb-table { min-width: 520px; }`；新增卡片/筛选/批量/编辑器/预览样式，一律 `flex-wrap` + `min-width: 0` | **手机横滑的根因就是那行 `min-width`** |
| `参考文档.md` | 修订 | 新增 §3.6 导入策略、§4.9 试一句、§6.10 搜索筛选、§6.11 快照、§6.12 批量、§7.15–7.18 新坑；§6.1 由"四个面板"改为"五个面板"；§9 验收补 9 条 | 规格与实现同步，否则下一个人会按旧文档写 |

### 修正

| 编号 | 类型 | 内容 | 理由 / 决策 |
|---|---|---|---|
| `ui/editor.js` 导入 | 修正 | 曾从 `widgets.js` 导入并不存在的 `POSITION_LABEL`/`ROLE_LABEL`，ESM 会在加载时直接 `SyntaxError`（整个扩展起不来）；改用文件内常量 | 这类错误不会被 try/catch 抓住，只能靠读 |
| `ui/editor.js` 正则框 | 修正 | 正则在存储里是 `{source, flags}` 对象，原先直接 `join` 会显示 `[object Object]` | 用户会以为正则坏了 |
| `ui/editor.js` 新规则 id | 修正 | `defaultEntry().id` 是空串，第二条新规则会覆盖第一条；改为生成 `e-<时间戳>` 再交给 `normalizeEntry` 补前缀 | 会静默丢数据 |
| `ui/view-settings.js` 勾选 | 修正 | `widgets.checkbox(checked, onChange, title)` 只有三个参数，原先按四个调用把标签塞进了 `title` | 标签会变成悬浮提示，页面上看不见 |
| `index.js` 状态点 | 修正 | `floating.setStatus` 只认 `idle/ok/wait/error`，传 `'warn'` 会退化成灰色 | 状态点失去意义 |
| `ui/importer.js` 的 `ask` | 修正 | 策略配置成 `ask` 时，导入弹窗的"条目开关"下拉默认停在「保留原件」，用户不改就等于替他把 `ask` 静默解成了 `keep`——正是 ILB-3.6.2 禁止的。改为：`ask` 时下拉初始为「请选择…」，未选时「导入」按钮禁用并提示必须先选 | 默认值不能替用户做他明确要求"问我"的决定 |
| `core/search.js` 搜正则 | 修正 | 正则条目在存储里是 `{source, flags}` 对象，`entryHaystack` 直接 `join` 会得到 `[object Object]`，搜正则源码永远搜不到（与 ILB-6.10.2 不符）。改为只取 `source` | 搜索范围写进规格了，就必须真的能搜到 |

### 待验证（必须先做，再谈体验）

1. `node --test tests/` 一个都没跑过——本机执行任何命令都返回 `0xC0000142`。
2. 手机上是否真的不再横滑（375px 视口或真机），`@media` 与 `flex-wrap` 是否够。
3. 快照"恢复"是否真的只改开关、正文一字未动。
4. 一键导入是否真的跳过已导入的书、导入报告四个数是否对得上。
5. "试一句"的结论与真实判定是否一致（不一致就说明 `previewEntry` 偷偷写了第二套逻辑）。

---

## v0.2.0-code · 2026-10-23 · 界面改为"悬浮球 + 浮窗"，并区分电脑与手机（含规格 v2.2.0）

**一句话**：扩展设置页里只留一张小卡片（总开关、两个常用数字、"打开控制器"），其余功能全部搬进用悬浮球唤出的浮窗；电脑上是可拖动、可缩放的窗口，手机上是整屏；同时补上"总开关"。仍然**没有运行过**。

**用户依据**（m00642）："现在的扩展入口是在扩展页面的里面……在扩展页面中只留下一些比较重要的设置选项，而其他的功能和页面则设置一个悬浮窗口，使用悬浮球的方式进行触发，同时，将页面针对 PC 和手机分别修改 UI"。

### 新增

| 编号 | 类型 | 内容 | 理由 / 决策 |
|---|---|---|---|
| `ui/layout.js` | 新增 | 纯计算：`pickLayout`（窄屏／矮屏／触屏平板 → 手机布局）、`defaultWindowGeometry`、`clampGeometry`、`defaultFabPosition`、`clampFabPosition`、`viewportOf`、`describeLayout` | 位置算错的表现很隐蔽（窗口跑到屏幕外、球被输入框挡住）。把计算从 DOM 里拆出来就能直接测，不需要浏览器 |
| `ui/floating.js` | 新增 | 悬浮球 + 浮窗的"壳"：拖动（球与标题栏）、窗口缩放记忆、Esc 关闭、手机整屏 + 背景滚动锁、`setStatus` 状态点、上下次位置持久化 | 壳只管壳：里面装什么由 `panel.js` 决定，所以以后换界面不用动这里 |
| `ui/settings-card.js` | 新增 | 设置页里的小卡片：总开关、扫描条数、连锁层数、书籍／规则计数、上一轮结果、"打开世界书控制器" | 让第一次用的人不用先学会四个面板 |
| `ui/dom.js` | 新增 | `el`、`option`、`on`、`isAttached`、`closest` | 界面会有好几块，各写一份造元素的函数迟早不一致 |
| `ui/help.js` | 新增 | `loadHelp`、`helpText`、`openOverlay`、`closeOverlay`、`showHelp`、`helpButton`、`isOverlayOpen`、`primeHelp` | 帮助浮层只留一份实现；文案仍然外置在 `data/help/*.json` |
| `settings.enabled` | 新增 | 总开关，默认 `true`；关闭后不判定、不注入，并清掉上一轮的注入残留 | 用户要"只留重要选项"，总开关是唯一能在出问题时立刻止损的选项 |
| `repository.getUiState/saveUiState` | 新增 | `extension_settings.independent_lorebook.ui` 存浮窗位置、尺寸、悬浮球位置、上次是否打开 | 界面状态不能混进设置：判定层读不到它，它也不该影响注入结果 |
| `tests/ui-layout.test.mjs` | 新增 | 11 个用例：三种屏幕判定、手机整屏、窗口不越界、拖出屏幕能拉回、换小显示器会缩、悬浮球不被底边吃掉 | 这些断言全是纯数字，跑起来才有意义（**尚未运行**） |
| 帮助文案 `fab` / `card` | 新增 | 悬浮球与浮窗、设置卡片的说明 | ILB-6.4.3：新出现的界面元素必须能一句话解释 |

### 修订

| 编号 | 类型 | 内容 | 理由 / 决策 |
|---|---|---|---|
| `ui/panel.js` 渲染 | 修订 | `render()` 不再画标题栏与整块边框，改为"标签行 + 内容"；帮助按钮移到标签行末尾；根容器类从 `.ilb-block` 改为 `.ilb-surface` | 标题属于浮窗（壳），面板只负责内容；同一个面板既能进浮窗、也能退回设置页 |
| `ui/panel.js` 挂载 | 修订 | `mount(container)` 必须显式给挂载点，不再自己去 `#extensions_settings` 里找 | "谁来挂我"应该由装配层决定；面板自己去猜位置会和浮窗打架 |
| `runtime/pipeline.js` | 修订 | `run()` 读取设置后先看 `settings.enabled`；为 `false` 时清注入、返回，并把原因记进新的 `lastSkip`（与"出错"分开） | 开关关掉还应算"故意不做"，不能染成红色报错 |
| `style.css` | 新增 | 悬浮球、浮窗、遮罩、设置卡片、状态点、手机整屏（含 `env(safe-area-inset-*)` 与 `100dvh` 回退）、`prefers-reduced-motion` | 手机上的刘海与底部手势区会把按钮吃掉，必须留安全边 |
| `data/help/zh-cn.json` | 新增 | `fab`、`card` 两段三段式说明 | 同上 |
| `index.js` 装配 | 修订 | 先挂浮窗→把面板塞进浮窗→再挂设置卡片；浮窗失败时把面板退回 `#extensions_settings`；生成后按结果更新悬浮球状态点；版本 0.2.0 | 装配层是唯一知道"东西往哪挂"的地方；任一界面挂了都要能退回可用状态 |
| `manifest.json` | 修订 | `version` → `0.2.0` | 与代码一致 |
| `参考文档.md` | 修订 | 升 v2.2.0：新增 ILB-6.6（入口与两套布局）、ILB-6.7（界面状态不参与判定）、ILB-6.5.2（总开关）；ILB-6.1 补充"面板可被浮窗承载" | 规格必须描述线上真实形态，否则下一轮会照旧画设置页内嵌的界面 |

### 设计说明（为什么不是"只写 CSS 媒体查询"）

- 窗口是**被拖动**的，坐标由 JS 记住；纯 CSS 无法回答"用户把窗拖到哪、换小屏后还在不在屏幕里"。所以判定与钳制必须落在代码里，CSS 只负责外观。
- 手机与电脑的差别不只是宽度：触屏平板竖握（900px 宽）按鼠标布局会很难点，所以判定里带 `pointer: coarse`。这条规则写在 `ui/layout.js`，改的时候只改一处。

### 待验证

- `tests/ui-layout.test.mjs` 与原有 `tests/core.test.mjs` **一个都没跑过**（本机无法执行 node，见 D-0016）。
- 悬浮球在触屏上的"拖动 vs 点按"用 `pointer` 事件 + 5px 阈值区分；真实手机上是否会误判（比如手指抖动）没有实测。
- `resize: both` 的缩放手柄在 SillyTavern 各主题下的可见性未验证；若不可见，用户仍可通过拖动和默认尺寸使用。
- 手机整屏用了 `100dvh`（带回退到 `100vh`）；老浏览器上可能出现地址栏遮挡，属已知取舍。
- 浮窗打开状态会被记住：刷新页面后如果上次是开着的，这次也开着；如果不喜欢，改 `saveUiState` 里的 `open` 即可。

---

## v0.1.2-code · 2026-10-23 · 宿主落盘与导入路径修正（含规格 v2.1.1）

**一句话**：对照 SillyTavern 内置扩展的真实 import 写法，修掉两个"代码写得出来、但现实中一定不工作"的问题——宿主导入路径与设置从不落盘；同时清理规格里三处与 v2.1.0 决定相矛盾的残留条款。仍然**没有运行过**。

### 修正

| 编号 | 类型 | 内容 | 理由 / 决策 |
|---|---|---|---|
| `host.js` 导入路径 | 修正 | 候选从 `['../../../script.js', ...]` 改为优先 `'../../extensions.js'`（`getContext`）与 `'../../../../script.js'`（`eventSource`/`event_types`/`getRequestHeaders`/`saveSettingsDebounced`），全部候选都尝试后合并可用字段，而不是第一个成功就返回 | 第三方扩展比内置扩展深一层；内置扩展的表达方式（`'../../../script.js'`）照抄到 `third-party/ILB/` 会指向 `public/scripts/script.js`，那个文件不存在。证据：`public/scripts/extensions/expressions/index.js` 的 import 头部 |
| `host.js` 新增 `saveSettings()` | 新增 | 把 `saveSettingsDebounced` 包成宿主端口的一个方法，失败返回 false 不抛 | 宿主不负责替 ILB 保存，必须自己叫一声 |
| `adapters/repository.js` 落盘 | 修正 | `createRepository({getContext, persist})` 新增 `commit()`，在 `saveSettings`/`saveBook`/`deleteBook`/`setManualState`/`mergeChatState`/`clearChatState`/`appendImportLog`/`importAll` 每次写完后调用 `persist()` | 原实现只改内存里的 `extension_settings` 对象，**刷新页面全部丢失**——这是"看起来能用、实际什么都没存下"的典型缺陷 |
| `index.js` 装配 | 修正 | `createRepository({getContext, persist: () => host.saveSettings()})`；版本号 `globalThis.ILB.version` 与 `manifest.json` 同步到 0.1.2 | 装配层是唯一知道"宿主怎么落盘"的地方，符合 ILB-2.4 |
| `参考文档.md` ILB-1.2.4 | 修订 | 改为"数据只存自己的命名空间"（`extension_settings.independent_lorebook`，只经 `BookRepository` 读写），原文"不写入 `extension_settings` 作为主存储"标注作废 | 与 ILB-3.1.2、D-0012 冲突的残留条款；不一致的规格比没有规格更危险 |
| `参考文档.md` ILB-4.5.2 | 修订 | 时效状态 `data/state/` → `extension_settings.independent_lorebook.chatStates[<聊天>]` | 同上，v2.1.0 已搬家但此处漏改 |
| `参考文档.md` §2 数据层示意图 | 修正 | `books/*.json、settings.json、导入日志` → `extension_settings.independent_lorebook`（books/settings/manualState/chatStates/导入日志） | 同上 |
| `参考文档.md` ILB-7.8 | 修订 | 从"独立文件为主存储"改为"只改自己的命名空间 + 每次写完交给宿主去抖保存" | 标题是"设置写入竞争"，原文的对策与 ILB-3.1.2 自相矛盾 |
| `参考文档.md` 头部 | 修订 | 版本 2.1.1；状态改为"部分实现（代码骨架已落盘、未实机验证，见 §8）" | 留痕：这一轮改了规格，必须升版 |

### 待验证（新增）

- 修正后的 import 路径没有在真实 SillyTavern 中加载过；`'../../extensions.js'` 是否导出 `getContext`（内置扩展这样用）未实证。
- `commit()` 依赖宿主把 `extension_settings` 整体序列化写盘；若宿主对深层对象的改动不敏感（某些版本只在引用替换时保存），需要改成"写回桶引用"的方式。这条必须在 Phase 0 探针里专门验证。
- 落盘失败时的行为（`persist` 返回 false）目前只是静默，界面没有提示。

---

## v0.1.1-code · 2026-10-23 · 幂等导入与自检修正

**一句话**：把 ILB-3.3.3 的"重复导入要合并"补上（`core/merge-book.js` + 导入日志），并修掉测试里让断言必然失效的 book_id 问题。仍然**没有运行过**。

### 新增

| 编号 | 类型 | 内容 | 理由 / 决策 |
|---|---|---|---|
| `core/merge-book.js` | 新增 | `mergeImportedBook(existing, incoming, now)`：按 `_source.uid` 配对，只增只更新、不删用户条目；用户改过正文的条目保留用户版本并报告冲突；书的启用方式/是否进池不被重导入覆盖 | 落地 ILB-3.3.3；原先"整本按书名替换"会让用户的手改与开关全部丢失 |
| `_source.content_hash` | 新增 | 条目记录导入时正文的哈希；`content !== hash(content)` 即判定"用户改过" | 没有它就无法区分"原件变了"和"用户改了"，只能二选一牺牲一方 |
| `_source.source_hash` / `imported_at` / `import_count` | 新增 | 书级别记录原件指纹、最近导入时间、导入次数；指纹用键排序后的稳定序列化计算 | ILB-3.3.1 的"原件即备份"需要能回答"还是不是同一份原件" |
| `repository.appendImportLog` / `getImportLog` | 新增 | 导入日志进 `extension_settings.independent_lorebook.importLog`，上限 50 条，写失败返回 false 不抛 | 落地 ILB-3.3.6（D-0017 已把 `import-log.jsonl` 改掉） |

### 修订

| 编号 | 类型 | 内容 | 理由 |
|---|---|---|---|
| `ui/panel.js` 导入流程 | 修订 | 导入改为"找同名来源书 → 合并 → 存 → 记日志"，浮层同时显示更新/新增/保留与冲突条目 | 让 ILB-3.3.3 的"第 N 次导入，更新 X 新增 Y"在界面上真实存在 |
| `adapters/repository.js` 备份 | 修订 | `exportAll` 含 `importLog`，`importAll` 恢复它（截到 50 条） | 备份应当是完整快照，否则导回后"第几次导入"会错 |

### 修正

| 编号 | 类型 | 内容 | 理由 |
|---|---|---|---|
| `tests/core.test.mjs` | 修正 | `makeBook` 原先不传 `book_id`，`normalizeBook` 会生成 `book-<hash>` 前缀，导致所有写死 `'T::1'` 的断言必然失败；改为 `book_id: patch.name ?? 'T'` | 这是我方代码错误，不算规格变更 |
| `model.js` | 修正 | `normalizeEntry` / `normalizeBook` 原本会丢掉 `_source.content_hash` 与书级 `_source`，补上透传 | 否则合并逻辑的"用户改过"判断在每次读盘后失效 |

### 待验证（新增）

- 合并逻辑的新用例同样没有跑过；`source_hash` 的稳定序列化在极端值（BigInt/循环引用）下的行为未验证。

---



## v0.1.0-code · 2026-10-23 · 代码骨架

**一句话**：按 v2.1.0 的规格写出第一版可加载的扩展代码（判定层纯函数 + 四个端口 + 最小界面 + 测试文件）。**没有运行过**，Phase 0 探针尚未执行。

### 新增

| 编号 | 类型 | 内容 | 理由 / 决策 |
|---|---|---|---|
| ILB-4.1.5 | 新增 | `ActivationResult` 增加三个只给界面用的附加字段：`budget`、`books`、`poolSize`；明确注入层不得读取 | 诊断面板要回答"为什么没出现"，预算与书级启用是最常见答案，让界面重算会与判定层算出不同的数；决策 D-0015 |
| ILB-8.0.1 | 新增 | Phase 进度记录：Phase 1–4 已有代码，Phase 0 未执行，全部属"未验证" | 留痕要求"哪一次发生了什么"，且不得把未验证说成已完成；决策 D-0016 |
| `extension/` 代码 | 新增 | `core/`（ids、text-match、settings-defaults、budget、model、resolve-books、import-native、export-native、evaluate）、`runtime/`（pipeline、registry）、`adapters/`（repository、native-worlds、inject）、`host.js`、`ui/panel.js`、`index.js`、`manifest.json`、`style.css`、`data/help/zh-cn.json`、`tests/core.test.mjs`、`README.md` | 落地 v2.1.0 的端口化与扩展点设计（决策 D-0014） |

### 修正

| 编号 | 类型 | 内容 | 理由 |
|---|---|---|---|
| ILB-2.4 引用路径 | 修正 | v2.1.0 条目里写的 `adapters/host.js` → 实际为扩展根目录的 `host.js` | 代码落地时按根目录实现；保留唯一宿主入口的约束不变 |
| v2.1.0 · ILB-2.4 行 | 修正 | 同上，旧条目文字不改，另记此处 | 遵守"只追加、不改旧条目" |

### 待验证（不允许当成已完成）

- 未执行 `node --test`：开发环境无法运行 node，`tests/core.test.mjs` 属"写好未跑"。
- 未在 SillyTavern 中载入：`host.js` 的三条探测路径、`setExtensionPrompt` 的参数顺序、`event_types.GENERATING`/`GENERATION_STARTED` 的字段名都需实机确认。
- 界面只在代码层面完成，未做任何浏览器内的视觉与交互检查。

---

## v2.1.0 · 2026-10-23 · 多书与解耦

**一句话**：补上"多本书按角色卡/手动启用 + 全局条目池"；把"存成文件"改为"存进自己的命名空间 + 存储端口"；把低耦合从一句口号变成可检查的约束（每个外部依赖都必须藏在端口后面，全项目只有一个文件 import 宿主的 `script.js`）。

### 新增

| 编号 | 类型 | 内容 | 理由 / 决策 |
|---|---|---|---|
| ILB-2.4 | 新增 | 端口化硬约束：外部依赖必须藏在"接口 + 默认实现"后面，只允许 `adapters/host.js` 一个文件 import `script.js`；模块可被单独删除 | 用户要求"每个模块只管自己的事，新增功能只通过预留接口接入" |
| ILB-2.5 | 新增 | 失败隔离与降级顺序：功能不可用 → 书不出现 → 零注入 → 界面报原因 | 用户要求"就算坏，也不至于整个项目一起崩溃" |
| ILB-3.5.1–3.5.8 | 新增 | 多本书的启用方式（`always`/`character`/`manual`）+ 参与全局池（`pool.share`）+ 条目池定义 + `resolveBooks` 纯函数 + `BookActivationProvider` 扩展点 | 用户要求"像原生世界书一样按角色卡和不同情况选择触发哪些书"，且"逻辑部分也能从所有书的总条目池中调用"；决策 D-0013 |
| ILB-3.2.1 | 新增 | 书顶层增加 `activation` 与 `pool` 两个字段 | 承载 ILB-3.5 |
| ILB-4.2.1 | 新增 | 执行顺序增加第 0 步「解析活跃书集合与条目池」 | 多书必须先于第 0 层判定 |
| 附录 D · ILB-D4 / D5 | 新增 | "按情况启用"是否内置；全局池是否需要批量开关 | 先留口，不先实现 |

### 修订

| 编号 | 类型 | 内容 | 理由 / 决策 |
|---|---|---|---|
| ILB-3.1.1 | 修订 | "数据位于扩展目录 `data/`" → "数据位于扩展自己的命名空间"，逻辑布局不变 | 第三方前端扩展没有服务端写文件权限，原写法无法落地；决策 D-0012 |
| ILB-3.1.2 | 修订 | 明确物理落地为 `extension_settings.independent_lorebook`，且必须经 `BookRepository` 端口访问 | 同上；同时避免上层直接依赖宿主设置对象 |
| ILB-3.1.3 | 修订 | "先写临时文件再改名" → "只经宿主去抖保存，禁止自写盘、禁止生成路径上写" | 存储由宿主负责后，原子性由宿主保证；生成路径上不得有 IO |
| ILB-4.4.5 | 修订 | `activated` 卡片从"只允许同书引用"放宽为"允许引用池内任何条目" | 否则"文风书引用设定书"这种正当需求无处安放（ILB-3.5.4） |
| ILB-6.1.1 | 修订 | 书架面板必须显示每本书的启用方式、手动开关、是否入池、以及"为什么没生效" | 多书并存后，"书为什么不生效"会成为最高频的疑问 |
| ILB-8 Phase 1 / Phase 2 | 修订 | Phase 1 增加 `resolveBooks` 与书架开关；Phase 2 增加多书条目池与跨书用例 | 让实现顺序与新章节对齐 |

### 待验证（不允许当成已完成）

| 项 | 状态 | 说明 |
|---|---|---|
| Phase 0 探针 | ❌ 未执行 | 注入接口、interceptor 是否泄漏进 chat、原生世界书列表接口，均需在真实实例上验证 |
| 代码能否运行 | ❌ 未验证 | 本机 `pwsh` 不可用（0xC0000142），所有代码均未经执行验证，仅经人工逐行检查 |

---

## v2.0.0 · 2026-10-23 · 重写

**一句话**：从"给程序员的架构说明书"改写为"约束 + 验收依据 + 用户看到什么"。核心变化是砍掉表达式语言、加入连锁触发、修正注入路径、补齐体验与留痕。

### 修正文档自身

| 编号 | 类型 | 内容 |
|---|---|---|
| — | 修正 | v1 正文从第 333 行起整段重复粘贴（同一份内容出现两遍），已合并为一份 |
| ILB-2.1 / 2.2 | 修正 | v1 §2 说"注入层不得调用逻辑层的判定函数"，同一个 v1 §6.1 接线表却把 `evaluate(request, entries)` 列为"注入层 → 逻辑层"。矛盾之处以 v2 的 ILB-2.1/2.2 为准：注入层可以引用类型、可以调用 `evaluate`，因为 `evaluate` 是唯一对外契约；"不得调用"改为"不得调用其**内部**函数" |
| ILB-0.1 | 修正 | v1 的 A4 写"见 §5"，契约实际在 §4.1，属引用错位。v2 改为编号体系，不再用章节号互相指代 |

### 废弃

| 编号 | 类型 | 内容 | 替代 |
|---|---|---|---|
| ILB-4.4.1 | 废弃 | v1 §4.3「算术与条件表达式 AST」（支持 `+ - * /` 等任意表达式） | 三种固定卡片 + 且/或（ILB-4.4.2）；决策 D-0006 |
| ILB-5.1.1 | 废弃 | v1 §5.1「路径 A：`llm/stream` 请求级改写」作为主路径 | `setExtensionPrompt` 为主路径（ILB-5.1.3）；决策 D-0007 |
| ILB-5.3.3 | 废弃 | v1 §7.5「检查前后同角色连续消息，必要时合并」 | 不合并，交给宿主处理（ILB-5.3.3 新内容） |
| ILB-6.7.4 | 废弃 | v1 §3.4「常驻条目分类器 + 待复核队列」 | 「体检」按钮 + 建议卡片（ILB-6.7）；决策 D-0009 |

### 新增

| 编号 | 类型 | 内容 | 理由 / 决策 |
|---|---|---|---|
| ILB-0.x | 新增 | 编号体系 + 三态（生效/待定/废弃）+ 不删号规则 | 可追溯的前提 |
| ILB-1.1.2 | 新增 | 成败标准：不读文档十分钟内能用 | 用户的第一目标 |
| ILB-1.2.7 | 新增 | 可复现优先于随机（种子） | 用户报"时灵时不灵"时必须能复现 |
| ILB-3.1.3 | 新增 | 写文件先写临时文件再改名 | 生成中途崩溃会截断书 |
| ILB-3.3.1 | 新增 | 导入信任三原则（只读 / 存副本 / 不自动删） | D-0008 |
| ILB-3.3.3 | 新增 | 导入幂等（按源文件哈希 + uid 配对） | 用户点三次会得到三本书 |
| ILB-3.3.5 | 新增 | 未知字段存 `_source.unknown`，导出还原 | D-0010 |
| ILB-3.3.7 | 新增 | 转换警告必须界面可见、可逐条查看 | 静默降级等于骗用户 |
| ILB-3.3.8 | 新增 | 导出功能必须存在 | 可退出性 = 用户敢投入的前提 |
| ILB-4.2.1 第 8 步 | 新增 | 三级稳定排序（权重 → 用户位次 → id） | 顺序抖动会打穿提示词缓存（ILB-7.11） |
| ILB-4.5 | 新增 | 时效：`delay` / `cooldown` / `sticky` | 原生已有，不做就是功能倒退 |
| ILB-4.6 | 新增 | 连锁触发（正文里的词可继续触发其他条目） | 涌现机制；D-0005 |
| ILB-4.7.2 | 新增 | 预算以条目为原子单位，不截断正文 | 半句话比不注入更糟 |
| ILB-4.7.4 | 新增 | 被预算挤掉必须可见 | 原生"静默丢弃"是已知痛点 |
| ILB-5.1.2 | 新增 | `InjectionSink` 抽象 + 能力探测 | 注入路径必须可替换，否则一次版本升级就全废 |
| ILB-5.2 | 新增 | 同时支持聊天补全与文本补全两种形态 | v1 默认了 messages 数组，文本补全装不进去 |
| ILB-5.4 | 新增 | 注入前在副本上做宏替换 | v1 完全没提，导入的书会显示字面 `{{char}}` |
| ILB-6.2 | 新增 | 规则表视图（一行一条规则，就地编辑） | 低门槛的落点 |
| ILB-6.3 | 新增 | 诊断面板：每条未出现都要说清原因 | 把 `diagnostics` 从调试附属品升为产品功能 |
| ILB-6.4 | 新增 | 每个面板一个醒目 `？` 按钮，点击原地弹三段式浮层；文案外置 JSON；无文案视为未完成 | 用户明确要求；D-0011 |
| ILB-6.5 | 新增 | 默认值表 + 每条的理由 + "为什么默认是这个"写进帮助浮层 | 用户明确要求按保守默认走，用可解释性补齐 |
| ILB-6.6 | 新增 | 空状态三步引导 | 第一次打开不能是空白页 |
| ILB-7.11 | 新增 | 注入顺序不稳定会打穿提示词缓存 | 与钱直接相关的问题 |
| ILB-7.14 | 新增 | 导入字段遗漏导致静默行为变化 | 用户只会觉得"这插件不准" |
| ILB-8.0 / Phase 0 | 新增 | 路线反转：先做注入探针，再写任何功能 | 产品成立与否押在这一件事上 |
| ILB-9.3 | 新增 | 体验验收清单（不通过则前两节不算数） | 防止交付一个"架构漂亮但没人用"的东西 |
| 附录 C / D | 新增 | 人话术语表 / 待定事项编号 | 非技术读者入口 + 悬而未决的东西不能烂在脑子里 |

### 修订

| 编号 | 类型 | 内容 | 理由 / 决策 |
|---|---|---|---|
| ILB-1.3.2 | 修订 | 允许**只读**角色卡绑定字段用于自动选书（v1 的 A1 一概禁止） | D-0002 |
| ILB-1.2.2 | 修订 | "条件不进 prompt"保留，追加"用户永不书写表达式语法" | 原条款只管注入侧，不管输入侧 |
| ILB-3.2.2 | 修订 | 条目结构 v1 → v2：新增 `always` / `when` / `timed` / `chain` / `_source`，`match`+`filter` 改名 `trigger`+平铺字段 | 后加字段要迁移数据，一次到位 |
| ILB-4.1.1 / 4.1.2 | 修订 | 契约新增 `history` / `vars` / `seed` / `stateUpdates` / `basedOnMessageCount` | 时效需要状态进出，随机需要种子 |
| ILB-4.2.1 | 修订 | 执行顺序插入"时效判定"与"连锁循环"两步 | 原顺序无法表达连锁 |
| 附录 A | 修订 | 字段映射 9 行 → 22 行（补 `caseSensitive`、`matchWholeWords`、条目级 `scanDepth`、`sticky/cooldown/delay`、位置 2/3、`uid`、未知字段等） | 漏一个字段 = 静默行为变化 |
| ILB-6.5.2 / 6.5.3 | 修订 | 明确"默认值宁可保守"+ "不靠调研定默认值，靠可解释性补齐" | 用户明确表态 |

### 保留（v1 中经评估仍然正确、未改动的部分）

- A2 的实质、A3 全文、A5 全文 → 对应 v2 的 ILB-1.2.2 / 1.2.1 / 1.2.3
- 三层结构与依赖方向 → ILB-2.1 / 2.2
- `match` 与 `filter` 必须分离 → ILB-3.2.3
- 数据存扩展自己目录 → ILB-1.2.4 / 3.1
- 字符估算 token、异步回填 → ILB-4.7.3（沿用 v1 §7.4 的数值）
- 正则 10ms 预算 → ILB-7.6
- 条目 id 加 `bookId::` 前缀 → ILB-3.4.1
- 独立 `settings.json`、只镜像摘要 → ILB-3.1.2

---

## v1.0.0 · 2026-10-23 之前 · 初始

用户提供、由 AI 根据需求撰写的架构文档。原始全文只存在于当时的对话中；结构快照见 `docs/历史/参考文档-v1.0.md`。

已知缺陷：正文重复粘贴一次。
