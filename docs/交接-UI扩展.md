# 交接：给"UI 扩展"的下一个智能体

> 这份文档只讲**怎么做一个绑定 ILB 的 UI 扩展**，不讲 ILB 本身怎么实现。
> 交接对象：下一个负责写 UI 扩展的 AI（或人）。
> 写于 2026-10-25，更新于 2026-10-27：ILB 版本 v0.14.0（接口 v1.2）。

---

## 0. 先读这一节：不要读整个 ILB 项目

你要做的是一个**独立的 SillyTavern 扩展**，它和 ILB 之间只有一层接口。所以：

**该读（总共不到 1 小时）**

1. 本文档；
2. `docs/UI扩展接口.md`（接口契约，约 100 行）；
3. `docs/下一阶段-UI扩展方案.md`（已有的方案草稿，含网格布局示例）；
4. 需要抄"留痕格式"时，翻一下 ILB 的 `CHANGELOG.md` 最上面两条，和 `docs/决策记录.md` 的任意两条。

**不要读（读了只会浪费上下文、误导判断）**

- `extension/core/evaluate.js`（约 900 行判定逻辑，与 UI 无关）；
- `extension/core/flow.js`、`runtime/pipeline.js`、`adapters/*`；
- `参考文档.md` 全文（1600 行，绝大部分是 ILB 内部契约）；
- `docs/决策记录.md` 全文、`docs/history/*`、`memory/*`、`backup/*`。

**原因**：ILB 的内部实现随时会改，而 `window.ILB.api` v1.1 是稳定契约。你按内部代码写，等于给自己埋一个"ILB 一升级就坏"的雷；你读 1600 行，只会让真正要用的那 100 行被淹没。

如果你想确认某个行为，**优先问接口**（`api.snapshot()` 实际返回什么），而不是读源码猜。

---

## 1. 你要做什么

用户想要的不是"给 ILB 换皮"，而是：**用声明的方式，把聊天变量摆成自己想要的界面**。

- 用户写一份 JSON 声明：几行几列、每个控件放哪、显示哪个变量、点一下做什么；
- 你的扩展把它渲染出来（手机、电脑都要能用）；
- 控件**不自己存值**，所有值都读写 ILB 的聊天变量；
- 用户点按钮能改变量、调用逻辑、打开 ILB 的某个页面；
- 一个控件还能打开"另一个界面"（用户明确要的"多样性"）。

典型场景：一张角色卡，显示"生命 / 药水 / 委托"三个变量，下面是"喝药水""交委托"两个按钮；再放一个"背包"按钮，点开是另一个网格页。

**边界**：你不碰 SillyTavern 的 prompt、不碰模型输出、不写世界书。你只是 ILB 变量的可视化 + 操作入口。

---

## 2. 你唯一该依赖的东西：`window.ILB.api` v1.1

### 2.1 怎么拿

```js
// 等 ILB 就绪；不要轮询，也不要假设加载顺序
window.addEventListener('ilb:ready', () => {
  const api = window.ILB.api;
  // 用 caps 判断能力，比版本字符串稳（加字段不换大版本）
  if (!api || !api.caps?.includes('outcome')) {
    console.warn('[my-ui] 需要 ILB 接口 v1.2（扩展 v0.14.0 以上）');
    return;
  }
  start(api);
});
```

`ilb:ready` 会在 `document` 上派发；如果扩展加载时它已经发过，直接读 `window.ILB.api` 即可（用 `if (window.ILB?.api) start(...)` 兜底，两者都写）。

### 2.2 五个入口

| 方法 | 签名 | 说明 |
|---|---|---|
| `snapshot()` | → `{version, caps, chatId, tick, vars, books}` | 只读快照。`vars` 是扁平标量表：`{生命:90, 背包:'铁钥匙', 安静:true}`；`books[].logics[].params` 是参数名数组 |
| `set(name, value)` | → `{ok, outcome, reason?}` | 写/增变量。名字非空、≤40 字；值只收 number / string / boolean；`NaN/Infinity` 会被拒绝 |
| `remove(name)` | → `{ok, outcome, reason?}` | 删变量 |
| `call(nameOrId, args?, opts?)` | → `{ok, outcome, ran, passed, id, name, reason, writes, extra, steps, vars, unusedArgs, missingParams, ui, durationMs}` | 调用**已启用**的独立逻辑。`args` 是**对象**，键是 `call.params` 里的参数名（**按名绑定，不是按顺序**）；跨书同名时传 id（`B1::L::1`） |
| `callAsync(nameOrId, args?, opts?)` | 同 `call` | 先让出一帧再跑，返回值同形，**永不 reject**（1.2 新增） |
| `subscribe(fn)` | → `unsubscribe()` | 任何变化后回调（**不防抖**，UI 自己节流）；同时 `document` 上会发 `ilb:change`；`fn` 不是函数时返回空函数，不抛异常 |
| `ui.openPanel(tab?)` / `ui.close()` | — | 打开 ILB 面板（`shelf/rules/logic/snapshots/state/diagnostics/settings`）或收起 |

`call` 的 `opts`（都可选）：`nonce`（同一楼层"再抽一次"）、`text` / `messages` / `userInput`（给带文本条件的逻辑用；**默认空上下文**）、`strict`（参数多余/缺失直接报错）。

`outcome` 三态：`'ok'` / `'blocked'`（业务拒绝，画黄字）/ `'error'`（调用或流程出错，画红字）。`ok` 仍等于 `passed`，旧写法不变。

`ui`（1.2 新增）：逻辑里写了「界面」步骤时，`call` 会带回一条指令 `{ v, page?, toast?, select?, ask?, seq? }`，没写就是 `null`。它**只在用户调 `call` 时**产生（聊天里自动触发不发），**一次只有一条**，不落盘、不进提示词、也不会等你点。详细字段与四条规矩见 `docs/UI扩展接口.md` §4「带回来的界面指令」。

三条容易踩的（v0.14.1 写死）：`page` 和 `select` 都是 **id**，不是标题/label；`seq` 是"一条逻辑一格"，分桶要用 `call` 返回的 `id`（不是 `name`，跨书会重名）；`page` 优先于 `select`，只给 `select` 时你可以自己翻到那一页，给了 `page` 就按 `page` 来。

`snapshot()` 的形状：

```js
{
  version: '1.2',
  caps: ['snapshot', 'set', 'remove', 'call', 'callAsync', 'ui', 'subscribe', 'outcome', 'byId', 'nonce', 'context', 'strict', 'vars', 'caps'],
  chatId: 'abc123',
  tick: 12,                     // 当前楼层
  vars: { 生命: 90, 药水冷却: 0, 委托: '未接' },
  books: [
    { id: 'B1', name: '王国', enabled: true, entries: 12,
      logics: [{ id: 'B1::L::1', name: '扣款', enabled: true, exposed: true, params: ['次数'] }] }
  ]
}
```

`vars` 是**浅拷贝**：改它不会回写 ILB。想改必须走 `set`——这是故意的，保证所有写操作都有返回值、可报错。

### 2.3 三条铁律（接口层面）

1. **不要 import ILB 的任何文件**。两个扩展之间没有稳定的加载顺序，import 会在某些启动顺序下直接炸。
2. **不要写 ILB 的存储**（`extension_settings.independent_lorebook`）。你不是它的 owner，写坏了整个扩展的数据都乱。
3. **不要 `eval` / `new Function` / 拼 `innerHTML`**。声明是数据，不是代码。

### 2.4 失败了怎么办

- `set/remove/call` 返回 `{ok:false, outcome, reason}`：在界面上给一句人话（例如"变量名太长，最多 40 字"），不要静默吞掉。`outcome === 'blocked'` 是业务拒绝（用黄字），`'error'` 才是真错（红字）。
- 拿不到 `window.ILB.api`：显示"未检测到 ILB（需要 v0.12.0 以上）"，而不是白屏。
- 跨书同名逻辑：`call` 会返回 `candidates` 让你选；别猜，直接把候选列给用户，或一开始就用 id。
- `subscribe` 回调里做渲染要节流（例如 50ms），别每来一次变化就整页重建（接口本身不防抖）。

---

## 3. 建议的技术形态

**独立扩展、独立仓库**，不要把文件塞进 ILB：

```
my-ilb-ui/
  manifest.json          # { "js": "index.js", "css": "style.css" } 只声明入口
  index.js               # 装配：等 ILB、读设置、挂设置页、注册渲染
  ui/
    panel.js             # 打开/关闭、手机与电脑两套壳（可先只做浮窗）
    grid.js              # 按声明算网格、摆控件
    widgets.js           # 文本/数字/进度/按钮/列表，全部手写 DOM
  core/
    declare.js           # 解析+校验声明（纯函数，可单测）
    layout.js            # 网格计算（纯函数：声明 → 每个控件的位置）
    actions.js           # set / add / call / openPanel 的语义（纯函数 + 注入 api）
  adapters/
    ilb.js               # 只在这里碰 window.ILB.api（方便 mock）
  data/
    example.json         # 示例声明
  tests/
    declare.test.mjs
    layout.test.mjs
    actions.test.mjs
    smoke-dom.mjs        # 假 DOM 冒烟
```

约定（和 ILB 保持一致，用户已经习惯了）：

- **没有构建步骤**：纯 ESM，浏览器直接跑；`manifest.json` 只声明 `index.js`，其余靠 import。
- **`core/` 是纯函数**：不碰 DOM、不碰 `window.ILB`、不读存储；给它数据就出结果，所以能直接 `node --test`。
- **只有 `adapters/ilb.js` 认识 ILB**；以后接口升到 2.0，只改这一个文件。
- **不引第三方库**（ILB 也没引，用户很在意"打开就能跑"）。

---

## 4. 声明格式（给用户的写法）

沿用方案草稿里的"区域"写法，不要用绝对坐标（手机上会错位）：

```json
{
  "version": 1,
  "name": "角色状态",
  "grid": { "cols": 4, "rows": 3, "gap": 8 },
  "widgets": [
    { "type": "stat",  "label": "生命", "bind": "生命", "area": [0, 0, 2, 1] },
    { "type": "stat",  "label": "药水", "bind": "药水冷却", "area": [2, 0, 2, 1] },
    { "type": "text",  "label": "委托", "bind": "委托", "area": [0, 1, 4, 1] },
    { "type": "button", "label": "喝药水",
      "action": { "kind": "call", "name": "喝药水" }, "area": [0, 2, 2, 1] },
    { "type": "button", "label": "背包",
      "action": { "kind": "open", "page": "背包" }, "area": [2, 2, 2, 1] },
    { "type": "button", "label": "交委托",
      "action": { "kind": "set", "key": "委托", "value": "已完成" }, "area": [0, 2, 4, 1] }
  ]
}
```

- `area: [列, 行, 跨列, 跨行]`，**从 0 开始**（和 CSS Grid 一致；`docs/下一阶段-UI扩展方案.md` 同此约定）；超界要夹到网格内，别让控件跑到屏幕外。
- 控件类型统一为 **7 类**，够用就别再加：`text`（文字）、`number`（数字，可带输入）、`bar`（进度条，读一个数字 + `max`）、`toggle`（开关，写 true/false）、`list`（一列条目，读文字）、`stat`（只读数值，点一下可以什么都不做）、`button`（动作）。
- `action.kind` 只有三种：`set`（写变量）、`call`（调逻辑）、`open`（打开另一个声明页或 ILB 页面）。
  - **没有 `add` 动作**：要"加 1"，让按钮先 `snapshot().vars` 读值、自己加完再 `set`。接口是同步的，这样不会写出两套加法语义。
- 控件只读 `bind` 指向的变量；值不合法（绑定的变量不存在）显示 `—`，不要抛错。
- 声明校验失败要给"第几个控件、哪一项不对"的人话，不要只说"JSON 无效"。

---

## 5. 分期（每期都能独立验收，别一口气全做）

| 期 | 内容 | 验收标准 |
|---|---|---|
| P1 | 只读面板：加载示例声明，把 `snapshot().vars` 渲染成卡片；`subscribe` 变化时刷新 | 手动改 ILB 状态页的变量，面板数字跟着变；ILB 没装时显示提示 |
| P2 | 点击动作：`set` / `call` / `openPanel`；失败提示 | 点"交委托"变量真的变；点"扣款"调用逻辑成功；非法值显示原因 |
| P3 | 声明编辑器：文本框 + 校验 + 保存到本扩展设置 | 坏 JSON 不能保存；保存后面板立即按新声明重排 |
| P4 | 多页面 + `open` 动作 + 导入导出 | 能从一个网格打开另一个；JSON 导出再导入结果一致 |
| P5 | 手机主题、无障碍、键盘操作 | 375 宽不横向滚动；Tab 能走完所有按钮 |

先做 P1，让用户看见东西，再谈别的。

---

## 6. 测试怎么做（别测 ILB）

- **纯函数单测**：声明解析、网格计算、动作语义——`node --test tests/*.test.mjs`。动作语义测试里用假 api：

```js
const fake = {
  version: '1.2',
  vars: { 生命: 90 },
  calls: [],
  snapshot() { return { vars: this.vars }; },
  set(k, v) { this.vars[k] = v; return { ok: true, outcome: 'ok' }; },
  call(n, a) { this.calls.push([n, a]); return { ok: true, outcome: 'ok', writes: {}, ui: null, durationMs: 1 }; },
  async callAsync(n, a) { return this.call(n, a); }
};
```

- **假 DOM 冒烟**：和 ILB 一样，用最小 DOM 桩把"打开面板 → 渲染 → 点一个按钮 → 关闭"点一遍，只验证不抛错。
- **不要写"ILB 能不能存变量"的测试**：那是 ILB 的责任，`tests/api.test.mjs` 已经覆盖；你再测一遍只会在 ILB 改实现时误报。
- 探针：准备一个 `probe.html`，用静态服务器打开，在真实 Chrome 里量一次"375 宽是否横向滚动"，布局结论不靠猜。

---

## 7. 工作方式：留痕、修改记录、开发理念（重要）

用户（非技术背景、中文）反复强调：**看得懂、能回退、失败要出声**。ILB 项目的做法值得照搬，下面是可直接套用的模板。

### 7.1 四份文档，各管一件事

| 文件 | 写什么 | 规则 |
|---|---|---|
| `参考文档.md` | 契约：做成什么样、边界在哪、什么算错 | 每条编号 `UI-x.y.z`；**只增不改**；废弃标 ⛔ 并写替代编号 |
| `CHANGELOG.md` | 改了什么 | 只追加，最新在上；一行一条 |
| `docs/决策记录.md` | 为什么这么定、否决了什么 | 每条 `D-xxxx`，**必须写否决方案与代价** |
| `docs/使用指南.md` | 用户怎么用 | 从扩展内的说明 JSON 导出，别手改 |

### 7.2 每条改动的固定动作

1. 改代码；
2. 加/改测试（能自动化就自动化）；
3. 同步 `参考文档.md` 的编号条款；
4. 在 `CHANGELOG.md` 顶部加一行；
5. 如果**换了做法**（不只是修 bug），在 `docs/决策记录.md` 追加一条 D-xxxx；
6. 文档里的数字（测试数、控件数、模块数）一起改，别让它们过期；
7. 提交：`feat(ui): 一句话（vX.Y.Z）` / `fix(ui): …` / `docs: …`。

### 7.3 三条记录模板

**CHANGELOG 一行**

```
## 0.2.0 · 2026-10-26 · 新增 · UI-3.2 · 点按钮能改变量
```

（类型只有：新增 / 修订 / 废弃 / 删除 / 修正）

**决策一条**

```
## D-0003 · 网格用"区域"而不是绝对坐标（v0.2.0，2026-10-26）

- 背景：手机上不同宽高比，绝对坐标必错位。
- 决定：widgets[].area = [列, 行, 跨列, 跨行]，由 CSS Grid 落地。
- 否决"百分比坐标"：仍然要自己算像素，且和滚动冲突。
- 代价：用户不能说"这个按钮往右 3 像素"，只能按格摆。
```

**参考文档一条**

```
- **UI-3.2.1** ✅ 声明里的 `area` 是四元组 `[列, 行, 跨列, 跨行]`，越界时夹到网格内，不报错。
```

### 7.4 开发理念（和 ILB 一致，别自己另立一套）

- **低复杂度换涌现**：只做几个正交原语（读取、写值、调用、打开），组合交给用户；不要为每个场景写一个专用控件。
- **模块隔离**：纯计算 / 渲染 / 宿主适配分开；换外壳（手机/电脑）不改计算。
- **失败可见**：所有错误给一句人话 + 一个可查的位置；不许静默 catch。
- **可回退**：新能力默认关闭或只读先行；改坏了能一键退回上一个版本（打 tag、留备份）。
- **单一事实来源**：值只存在 ILB 变量里；你的扩展不另存一份，否则两边会打架。
- **小步可验证**：每期都能单独跑、单独给用户看；不要攒一个"大版本"再交付。
- **不是 agent**：不做自动决策、不偷偷改用户的配置、不联网。

### 7.5 和用户沟通的方式

- 中文、短句、先说"你能看到什么"，再说"怎么做到的"。
- 每次交付写清楚：做了什么、验证了什么、**没验证什么**、下一步是什么。
- 不确定的地方直接问，不要替用户拍板；方案给两个选项 + 推荐理由。

---

## 8. 第一次开工的检查单

1. [ ] 读完本文 + `docs/UI扩展接口.md` + `docs/下一阶段-UI扩展方案.md`（**不要**去读 ILB 核心代码）；
2. [ ] 在真实页面里 `console.log(window.ILB.api.snapshot())`，确认接口在（ILB v0.12.0+，接口 v1.1）；
3. [ ] 建独立仓库骨架：`manifest.json` / `index.js` / `core/` / `ui/` / `tests/`；
4. [ ] 先写 `core/declare.js` + `core/layout.js` + 单测（此时还不需要 DOM）；
5. [ ] 再写 `ui/grid.js`，用 `data/example.json` 渲染出第一屏；
6. [ ] 最后接 `subscribe` 与动作，补假 DOM 冒烟；
7. [ ] 建 `参考文档.md` / `CHANGELOG.md` / `docs/决策记录.md` 三份空文档，**从第一条改动就开始记**。

## 9. 不要做的事（用户已经明确否决过）

- 不要把 UI 直接写进 ILB 的 `ui/` 里——两边都要独立升级。
- 不要让 UI 扩展 import ILB 内部模块，或直接读写 ILB 的 `extension_settings`。
- 不要引入构建步骤、npm 运行时依赖、CDN 资源。
- 不要用 `eval` / `new Function` / `innerHTML` 渲染声明。
- 不要为某个具体玩法写死界面（"抽卡专用面板"这种）；用声明组合出来。
- 不要在没跑过假 DOM 冒烟的情况下说"界面好了"。
