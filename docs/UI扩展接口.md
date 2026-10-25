# ILB 对外接口（给别的扩展用）· API v1.0

> 这份文件是**契约**。ILB 内部的 `repository / pipeline / 书的字段结构` 都可能在版本间改动；别的扩展只许用下面这些入口，不要直接读 `window.ILB.repository` 之类的东西。
>
> 接口代码：`extension/runtime/api.js`。测试：`extension/tests/api.test.mjs`。

## 1. 怎么拿到

SillyTavern 的第三方扩展都是同一批 ESM，谁先加载不确定。两种方式任选：

```js
// 方式一：ILB 已经加载完了
const api = window.ILB?.api;

// 方式二：不确定加载顺序，等它
window.addEventListener('ilb:ready', (event) => {
  // event.detail.version === '1.0'
  const api = window.ILB.api;
});
```

如果拿不到 `window.ILB.api`，说明 ILB 没装、没启用，或者版本低于 v0.11.0 —— 自己降级成"不显示"，不要报错刷屏。

## 2. 四个入口

| 方法 | 作用 | 返回 |
|---|---|---|
| `snapshot()` | 读一份当前聊天 + 书的只读快照 | `{ version, chatId, tick, vars, books[] }` |
| `set(name, value)` | 写一个聊天变量（数字/文字/开关） | `{ ok:true, name, value }` 或 `{ ok:false, reason }` |
| `remove(name)` | 删一个聊天变量 | `{ ok:true, name }` / `{ ok:false, reason }` |
| `call(name, args)` | 按名字跑一条已启用的独立逻辑 | `{ ok, reason, writes, extra, steps }` |
| `subscribe(fn)` | 订阅变化，返回退订函数 | `unsubscribe()` |

另有 `version`（契约版本，现在是 `'1.0'`）、`describe()`（自述）、`ui.openPanel(tab)` / `ui.close()`（打开/关闭 ILB 面板）。

### snapshot 的样子

```json
{
  "version": "1.0",
  "chatId": "某场聊天",
  "tick": 12,
  "vars": { "金币": 5, "天气": "雨" },
  "books": [
    { "id": "b1", "name": "文风", "enabled": true, "entries": 12, "logics": [
      { "id": "b1::L::1", "name": "掷骰", "enabled": true, "exposed": false }
    ] }
  ]
}
```

- 只给标量变量（数字/文字/开关），不给对象、不给函数、不给宿主引用。
- `tick` 是当前聊天消息条数，可用作"这一轮变没变"的粗判。

### subscribe 会收到什么

```js
const off = api.subscribe((payload) => {
  // payload = { version, reason: 'run'|'set'|'remove'|'call'|'chat_changed', chatId, tick, ... }
  redraw(api.snapshot());
});
```

同时会往 `document` 发一个 `CustomEvent('ilb:change', { detail: payload })`，给不方便保存回调的脚本用。

**退订**：`off()`。不用的订阅一定要退，否则界面关了还在后台重画。

## 3. 边界（这些事不要做，也做不了）

- **只能写聊天变量**：`set/remove/call` 都只落在"这一场聊天"的变量表里，碰不到 SillyTavern 设置、扩展设置、书本身。
- **`call` 只跑流程**：它按名字找**已启用**的独立逻辑（不要求 `exposed`；`exposed` 只约束 AI 正文里的调用），跑完把 `writes`（记进聊天状态的值）落盘，返回 `extra`（这次产生的正文）和 `steps`（走过哪几步，给人看）。
- **失败不抛异常**：一律 `{ ok:false, reason }`；调用方自己决定是静默、还是画一行红字。
- **不保证顺序**：`call` 不参与注入预算与排序，它不会替 UI 扩展决定"这条内容该不该进提示词"——那是 UI 扩展自己的业务。

## 4. 版本策略

- `API_VERSION` 是**契约**版本，与扩展版本号（`manifest.json` 的 `0.11.0`）分开。
- 加字段、加方法：小版本（`1.0 → 1.1`），老调用不受影响。
- 改字段语义、删方法：大版本（`1.x → 2.0`），并至少在旧版本里保留一个发布周期的兼容层。
- 破坏性变更必须写进 `docs/决策记录.md` 与 `参考文档.md` 的编号条款。

## 5. 给"可定制 UI"扩展的用法

UI 扩展（独立仓库/独立 SillyTavern 扩展）不需要 import ILB 的任何模块：

```js
function mount(widget) {
  const api = window.ILB.api;
  const off = api.subscribe(() => render(api.snapshot()));
  widget.querySelector('[data-action="roll"]').addEventListener('click', () => {
    const result = api.call('掷骰');
    if (!result.ok) widget.querySelector('.error').textContent = result.reason;
  });
  return () => off();
}
```

- 控件只**绑定**变量名，不自己存值；值永远以 `snapshot().vars` 为准。
- 动作只有四种：`set`（直接赋值）、`call`（跑逻辑）、`openPanel`（打开 ILB 某页）、以及 UI 扩展自己的动作。
- 布局、样式、声明格式由 UI 扩展自己负责；ILB 不解释布局。

## 6. 现在的已知限制（v1.0）

| 限制 | 说明 |
|---|---|
| 变量只有标量 | 没有数组/对象；AI 调用同样受限 |
| 没有"变量变了"的细粒度事件 | 只有整场 `ilb:change`，UI 需要自己 diff |
| `call` 无参数类型校验 | 参数按 `coerceValue` 粗转；类型错误由逻辑自己处理 |
| 没有写权限委托 | UI 扩展不能替 ILB 改书/改设置，这是有意的 |
