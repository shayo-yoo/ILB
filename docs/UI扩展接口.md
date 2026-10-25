# ILB 对外接口（给别的扩展用）· API v1.1

> 这份文件是**契约**。ILB 内部的 `repository / pipeline / 书的字段结构` 都可能在版本间改动；别的扩展只许用下面这些入口，不要直接读 `window.ILB.repository` 之类的东西。
>
> 接口代码：`extension/runtime/api.js`。测试：`extension/tests/api.test.mjs`；能跑一遍看的演示：`node tests/api-demo.mjs`。

## 1. 怎么拿到

SillyTavern 的第三方扩展都是同一批 ESM，谁先加载不确定。两种方式任选：

```js
// 方式一：ILB 已经加载完了
const api = window.ILB?.api;

// 方式二：不确定加载顺序，等它
window.addEventListener('ilb:ready', (event) => {
  // event.detail.version === '1.1'
  const api = window.ILB.api;
});
```

如果拿不到 `window.ILB.api`，说明 ILB 没装、没启用，或者版本低于 v0.11.0 —— 自己降级成"不显示"，不要报错刷屏。

## 2. 五个入口

| 方法 | 作用 | 返回 |
|---|---|---|
| `snapshot()` | 读一份当前聊天 + 书的只读快照 | `{ version, caps, chatId, tick, vars, books[] }` |
| `set(name, value)` | 写一个聊天变量（数字/文字/开关） | `{ ok:true, name, value }` 或 `{ ok:false, outcome:'error', reason }` |
| `remove(name)` | 删一个聊天变量 | `{ ok:true, name }` / `{ ok:false, outcome:'error', reason }` |
| `call(nameOrId, args?, opts?)` | 跑一条已启用的独立逻辑 | 见 §4 |
| `subscribe(fn)` | 订阅变化，返回退订函数 | `unsubscribe()`；`fn` 不是函数时返回空函数，不抛异常 |

另有：
- `version`（契约版本，现在是 `'1.1'`）；
- `caps`（能力清单，如 `'nonce'`、`'strict'`，比版本号更适合做特性判断）；
- `describe()`（自述，打印出来就知道这版有什么）；
- `ui.openPanel(tab?)` / `ui.close()`（打开/关闭 ILB 面板，`tab` 可以是 `'shelf' | 'rules' | 'logic' | 'snapshots' | 'state' | 'diagnostics' | 'settings'`）；
- `notify(reason?)`（让 ILB 主动广播一次变化，给"我改完自己的 UI 想顺手刷新别人"的场景）。

### snapshot 的样子

```json
{
  "version": "1.1",
  "caps": ["snapshot", "set", "remove", "call", "subscribe", "outcome", "byId", "nonce", "context", "strict", "vars", "caps"],
  "chatId": "某场聊天",
  "tick": 12,
  "vars": { "金币": 5, "天气": "雨" },
  "books": [
    { "id": "b1", "name": "文风", "enabled": true, "entries": 12, "logics": [
      { "id": "b1::L::1", "name": "掷骰", "enabled": true, "exposed": false, "params": [] }
    ] }
  ]
}
```

- 只给标量变量（数字/文字/开关），不给对象、不给函数、不给宿主引用。
- `tick` 是当前聊天消息条数，可用作"这一轮变没变"的粗判。
- `logics[].params` 是这条逻辑声明的参数名数组；用它给按钮生成输入框。
- `books[].logics[]` 里有 `id`：跨书同名时，**用 id 调用**。

## 3. set 写进去的是什么

`set` 会做一次"看着像什么就当什么"的转换，写进变量表的就是转换后的值：

| 你传的 | 落盘的值 |
|---|---|
| `5` / `"5"` | `5`（数字） |
| `"true"` / `"false"` | `true` / `false`（开关） |
| `"旅人"` | `"旅人"`（文字） |
| `""` | `""`（空文字，不删变量；要删用 `remove`） |
| `NaN` / `Infinity` | **拒绝**：`{ ok:false, outcome:'error', reason:'数字不合法…' }`（旧版会写成 `null`） |
| 对象 / 数组 / 函数 | 拒绝 |

变量名 ≤ 40 字；空名拒绝。

## 4. call 的完整形状

```js
const result = api.call('抽卡', { 次数: 1 });
const again  = api.call('b1::L::1', { 次数: 1 }, { nonce: '再来一次', strict: true });
```

### 参数

- `nameOrId`：逻辑 **id**（推荐，如 `b1::L::1`）或 **名字**。先按 id 精确找；找不到再按名字找**已启用**的逻辑。
  - 多本书里有同名逻辑、而你没传 id → 返回 `{ ok:false, outcome:'error', candidates:[…] }`，**不会**静默取第一个。
- `args`：**对象**，键是逻辑里声明的参数名（`snapshot().books[].logics[].params`），不是数组、也不是按顺序。
  - 值同样走 `set` 的类型转换；非标量值直接拒绝。
- `opts`：
  | 键 | 默认 | 作用 |
  |---|---|---|
  | `nonce` | `''` | 同一楼层重复调用默认给同一随机结果；传一个不同的 nonce 才能"再抽一次" |
  | `text` | `''` | 本次调用的"这句话"，给带文本条件的逻辑用 |
  | `messages` | `[]` | 本次调用的消息数组（形如 `[{role:'user', content:'…'}]`） |
  | `userInput` | `''` | 额外的用户输入 |
  | `strict` | `false` | 参数多余/缺失时直接 `outcome:'error'`，而不是只报告 |

**默认没有上下文**：不传 `text/messages/userInput` 时，逻辑看到的是"空聊天"。这是为了保住"同一楼层重放一致"（D-0009 的延伸）。带文本条件的逻辑从 UI 调用必然走"不成立"，想跑通就显式传 `opts.text`。

### 返回

```js
{
  ok: false,            // 旧字段，= passed
  outcome: 'blocked',   // 'ok' | 'blocked' | 'error'  ← 1.1 新增
  ran: true,            // 流程到底有没有跑起来（参数校验失败时为 false）
  passed: false,        // 流程的结论
  reason: '比较：金币 > 0 不成立，且没有写"不成立时"要做什么',
  writes: {},           // 本次落盘的变量
  extra: [],            // 本次产生的正文
  steps: [ … ],         // 走过哪几步（给人看）
  vars: { … },          // 跑完之后的完整变量表（= snapshot().vars）
  unusedArgs: [],       // 传了但逻辑没声明的参数名  ← 1.1 新增
  missingParams: [],    // 声明了但没传的参数名      ← 1.1 新增
  candidates: undefined // 只在"同名逻辑"时出现
}
```

`outcome` 三态，UI 可以据此画不同颜色：

| outcome | 含义 | 例子 |
|---|---|---|
| `'ok'` | 流程通过 | 抽到卡、扣款成功 |
| `'blocked'` | **业务拒绝**，流程是故意拦下的 | 次数不够、金币不足（走到「不通过」、或条件不成立且没写「不成立时」） |
| `'error'` | 流程或调用本身出错 | 找不到逻辑、同名歧义、参数不合法、跳转目标不存在、嵌套太深 |

`ok` 仍然是 `passed`，旧代码（只看 `ok`）行为不变；只是想区分"黄字"与"红字"时看 `outcome`。

### 能「调用逻辑」吗

能。1.1 起，`call` 里带「调用逻辑」节点的逻辑会正常往下跑（深度上限 3 层），被调用的逻辑同样只能看已启用、按 id/名字解析。1.0 里这里会静默跳过。

## 5. subscribe 会收到什么

```js
const off = api.subscribe((payload) => {
  // payload = { version, reason: 'set'|'remove'|'call'|'run'|'chat_changed'|'manual', chatId, tick, ... }
  redraw(api.snapshot());
});
```

- `reason` 是固定枚举：`'set'`、`'remove'`、`'call'`、`'run'`（ILB 自己跑了一轮）、`'chat_changed'`、`'manual'`（`api.notify()`）。
- **不防抖**：一次 `set` 一次事件。UI 自己用 `requestAnimationFrame` 或短定时器合并重绘。
- 同时会往 `document` 发一个 `CustomEvent('ilb:change', { detail: payload })`，给不方便保存回调的脚本用。
- `subscribe(fn)` 的 `fn` 不是函数时：`console.warn` 一句 + 返回空退订函数，**不抛异常**。
- **退订**：`off()`。不用的订阅一定要退，否则界面关了还在后台重画。

## 6. 边界（这些事不要做，也做不了）

- **只能写聊天变量**：`set/remove/call` 都只落在"这一场聊天"的变量表里，碰不到 SillyTavern 设置、扩展设置、书本身。
- **`call` 只跑流程**：按 id/名字找**已启用**的独立逻辑（不要求 `exposed`；`exposed` 只约束 AI 正文里的调用），跑完把 `writes` 落盘，返回 `extra`（这次产生的正文）和 `steps`（走过哪几步）。
- **失败不抛异常**：一律 `{ ok:false, outcome, reason }`；调用方自己决定是静默、还是画一行字。
- **不保证顺序**：`call` 不参与注入预算与排序，它不会替 UI 扩展决定"这条内容该不该进提示词"——那是 UI 扩展自己的业务。
- **没有 `api.add`**："加一个数值"由 UI 自己 `snapshot().vars` 取值、算完再 `set`。同步接口下这样够用，少一个入口少一套错误语义。

## 7. 版本策略

- `API_VERSION` 是**契约**版本，与扩展版本号（`manifest.json` 的 `0.12.0`）分开。
- 加字段、加可选参数、加方法：小版本（`1.0 → 1.1`），老调用不受影响。
  - 1.1 相对 1.0：`outcome/ran/vars/unusedArgs/missingParams`、`snapshot` 的 `params`、`call` 的 `opts`、`subscribe` 不再抛异常、`set` 拒绝 `NaN/Infinity`。其中"同名逻辑不再取第一个"会让**原本静默成功的旧写法**变成报错——这是有意的修正，写进了 D-0049。
- 改字段语义、删方法：大版本（`1.x → 2.0`），并至少在旧版本里保留一个发布周期的兼容层。
- 破坏性变更必须写进 `docs/决策记录.md` 与 `参考文档.md` 的编号条款。

## 8. 给"可定制 UI"扩展的用法

UI 扩展（独立仓库/独立 SillyTavern 扩展）不需要 import ILB 的任何模块：

```js
function mount(widget) {
  const api = window.ILB.api;
  const off = api.subscribe(() => render(api.snapshot()));
  widget.querySelector('[data-action="roll"]').addEventListener('click', () => {
    const result = api.call('掷骰', {});
    const tone = result.outcome === 'ok' ? 'ok' : result.outcome === 'blocked' ? 'warn' : 'error';
    widget.querySelector('.status').textContent = `${tone}：${result.reason}`;
    if (!result.ok && result.outcome === 'error') console.warn('[UI]', result);
  });
  return () => off();
}
```

- 控件只**绑定**变量名，不自己存值；值永远以 `snapshot().vars` 为准。
- 动作只有三种：`set`（写变量）、`call`（走逻辑）、`open`（打开别的界面/ILB 面板）。`add` 不是接口动作，是 UI 侧的"读-算-写"。
- 布局、样式、声明格式由 UI 扩展自己负责；ILB 不解释布局。

## 9. 现在的已知限制（v1.1）

| 限制 | 说明 |
|---|---|
| 变量只有标量 | 没有数组/对象；AI 调用同样受限 |
| 没有"变量变了"的细粒度事件 | 只有整场 `ilb:change`，UI 需要自己 diff |
| `call` 没有事务 | 流程里已经写下的值，不会因为后面「不通过」而回滚；要原子性得自己先算后写 |
| 没有写权限委托 | UI 扩展不能替 ILB 改书/改设置，这是有意的 |
| 没有异步 | 全部同步返回；耗时的动画/网络请 UI 自己做 |
