# 下一阶段：可定制 UI 扩展（草稿，待拍板）

> 状态：**讨论稿，不是契约**。接口、字段、事件名以 `docs/UI扩展接口.md`（v1.1）为准；本文只保留"为什么这样设计"与分期建议。
> 2026-10-25 按 v0.12.0 校对过一遍，已删掉与实现不符的设想（去抖、事件名、`add` 动作）。
> 目标读者：之后接手开发这个新扩展的智能体。

## 1. 一句话

ILB 继续只做"逻辑与状态"（无界面、可测试）；新扩展只做"把状态画成可点的界面"。
两者通过一个很小的、带版本号的接口相连，谁也不 import 谁的内部文件。

## 2. 职责边界

| 事情 | 归谁 |
| --- | --- |
| 变量、宏、条件、流程、跳转、AI 调用 | ILB（已有） |
| 什么时候重算（消息事件、变量变化） | ILB 触发，UI 订阅 |
| 界面长什么样（网格、控件、配色） | UI 扩展 |
| 点击后发生什么（改变量 / 调逻辑） | UI 扩展发动作，ILB 执行 |
| 存盘 | 变量在 ILB 的聊天状态里；布局在 UI 扩展自己的设置里 |

**硬约束**：UI 扩展不直接改 `extension_settings.independent_lorebook` 的内部结构（那是实现细节），只用第 3 节的接口。

## 3. ILB 需要补的接口（约 100 行）

现有 `globalThis.ILB` 已有 `vars.list / get / set / remove`、`describeLastRun`、`runOnce`。再补四项：

```js
globalThis.ILB.api = {
  version: 1,                       // 接口版本；不兼容时加 2，旧版继续可用
  caps: ['vars', 'call', 'subscribe', 'tick'],

  // 读：一次拿全量，UI 只读快照
  snapshot() {
    return {
      chatId: '...',                // 当前聊天 id（换聊天要整体重画）
      vars: { 金币: 3, 生命: 90 },   // 已归一化（number/bool/text）
      tick: 12,                     // 第几次判定（消息数变化就 +1）
    };
  },

  // 写：UI 不直接赋值，走"写 + 重算"
  set(name, value) { /* 返回 {ok, outcome, reason?} */ },

  // 调：按 id 或名字跑一条已启用逻辑（不要求 exposed；exposed 只约束 AI 正文调用）
  call(nameOrId, args, opts) { /* 返回 {ok, outcome, ran, passed, reason, writes, extra, steps, vars, unusedArgs, missingParams} */ },

  // 订阅：变化时回调（不防抖，一次变化一次事件；UI 自己节流）
  subscribe(fn) { /* 返回取消函数 */ },
};
```

ILB 侧改动：
1. `set` 之后必须让下一轮注入反映新值——已经是每轮重算（`replay`），只需触发一次 `pipeline` 的"计划刷新"。
2. `subscribe` 的事件 `reason` 只有这几个：`run`（ILB 跑完一轮）、`set`、`remove`、`call`、`chat_changed`、`manual`（`api.notify()`）。没有 `vars_changed` / `turn_end` / `tick`——那些是草稿里的旧设想。
3. `call` 复用 `evaluate.js` 里已有的 `runLogicById` 与 `withBoundParams`，不要新写一套。
4. 文档里固定写死：**接口只保证上面这个形状**，UI 扩展不得依赖 `repository` 内部。

## 4. 布局声明（UI 扩展自有格式）

建议"网格区域"而不是绝对坐标：坐标法（x1/x2/y1/y2）会重叠、会留洞，手机上还要再算一遍；网格区域天然可重排。

```json
{
  "kind": "ilb-ui", "version": 1, "name": "行囊",
  "grid": { "cols": 4, "rows": 6, "gap": 8, "cell": 56 },
  "widgets": [
    { "id": "hp",  "type": "bar",    "area": [0, 0, 4, 1], "bind": "生命", "max": 100, "label": "生命" },
    { "id": "gold","type": "number", "area": [0, 1, 2, 1], "bind": "金币" },
    { "id": "bag", "type": "list",   "area": [0, 2, 4, 3], "bind": "背包", "columns": 2 },
    { "id": "draw","type": "button", "area": [2, 1, 2, 1], "text": "抽一次",
      "action": { "type": "call", "logic": "抽卡" } }
  ]
}
```

- `area: [col, row, colSpan, rowSpan]`（**从 0 数**，和 CSS Grid 一致）；窄屏时 `cols` 自动降为 2，超出按行堆叠。
- 控件统一 7 类：`text`、`number`、`bar`、`toggle`、`list`、`stat`（只读数值）、`button`。够搭出"行囊/属性/抽卡"。
- 值一律来自 `bind`（ILB 变量名），控件本身不存值——避免两套真相。

## 5. 动作（点击后发生什么）

只允许**三种**，全部是声明式的，**不引入表达式语言**（沿用 D-0006 红线）：

```json
{ "type": "set",  "name": "金币", "value": 10 }        // 直接写
{ "type": "call", "logic": "抽卡", "args": { "次数": 1 } }  // 跑逻辑，由逻辑决定写什么；args 是对象
{ "type": "open", "target": "page", "page": "背包" }    // 切页
```

- **没有 `add` 动作**：要"金币 -1"，按钮先 `snapshot().vars` 读值、算完再 `set`，或者干脆放进 ILB 逻辑用 `call`。
- 推荐**多用 `call` 少用 `set`**：数值规则应该待在 ILB 的逻辑里，UI 只负责"点了一下"。
- 失败（逻辑不存在、变量只读、参数不合法）要就地显示一句人话，不弹 alert。

## 6. 渲染与安全

- 只用 `document.createElement` / `textContent`，**禁止 innerHTML**（变量内容可能来自模型）。
- 不请求网络、不用 `eval`、不读文件。
- 单个页面最多 200 个控件；单个列表最多显示 50 行（超出显示"还有 N 项"，翻页）。
- 所有点击处理都包 try/catch，错误进 UI 扩展自己的诊断面板 + ILB 诊断页各一条。
- 手机：优先保证不横向溢出；网格在 < 640px 时按 2 列重排。

## 7. 生命周期

1. 扩展加载 → 等 `globalThis.ILB?.api?.version` 出现（最多 5 秒，超时显示"ILB 没有启动"）。
2. `snapshot()` 全量画一次；`subscribe` 后只做增量更新（值变了改文本/宽度，不重建 DOM，避免点击丢失焦点）。
3. `CHAT_CHANGED` → 重新 `snapshot` 并整体重画。
4. 页面切换只改可见性，不销毁控件（保留滚动位置）。

## 8. 分期

- **P0 契约先行**（ILB 侧，已完成）：`api.version / caps / snapshot / set / remove / call / subscribe`，契约文档 `docs/UI扩展接口.md`，测试 `tests/api.test.mjs`（12 条）。
- **P1 只读面板**（UI 扩展）：一个页面、四个控件、只读绑定；能跟着聊天换。
- **P2 点击动作**：`call` + `set` + 失败提示；抽卡 Demo 跑通。
- **P3 声明编辑**：网格可视化编辑（先做"选区域 + 选控件 + 选变量"的表单，不做拖拽）。
- **P4 导入导出与分享**：`{kind:'ilb-ui'}` JSON，带版本号与迁移。
- **P5 手机布局与主题**：2 列重排、字号、深浅色。

每期都可以单独验收；P0 不做完，P1 不开始。

## 9. 验收（P2 结束时）

用一个"行囊"页面演示：

1. 聊天里 AI 说"你捡到 3 枚金币"，逻辑写入 `金币=3`；页面数字自己变成 3。
2. 点「抽一次」→ `call 抽卡`；金币 3→2，同时主聊天注入"你抽到了普通卡"。
3. 重画/刷新/切消息，页面不回退、不重复扣钱（与 AI 调用同一套幂等）。
4. 手机宽度 375px：不横向滚动，按钮可点。
5. 关掉 UI 扩展，ILB 与主聊天完全不受影响。

## 10. 已拍板（原"待拍板"，2026-10-25 结论）

1. **随机数**：同一楼层重放结果一致（种子 = 聊天 id + 消息数 + 节点 id）；要"再抽一次"时接口传 `nonce`。已实现（D-0047）。
2. **常驻逻辑**：元触发器分四档 `none / always / on_ai / on_user`，「每轮」就是每轮跑、不依赖触发词。已实现（D-0047）。
3. **布局放哪**：UI 扩展自己的设置，不进 ILB 的书。
4. **网格**：区域式 `area: [列, 行, 跨列, 跨行]`（0 起），不做坐标式。
