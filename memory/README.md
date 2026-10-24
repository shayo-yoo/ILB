# memory/ —— 记忆账本（留档，不随扩展加载）

这里放的是 v0.6.0–v0.7.1 期间写在 ILB 扩展里的叙事账本（事实解析 → 变量/约束/规则 → 原子应用 → 重放/检查点 → 消息块 + 提示词注入）。**v0.8.0 起它不再是扩展的一部分**：`extension/index.js` 不再 import 它，`manifest.json` 也只声明 `index.js`。

保留而不是删除，是因为它是"记忆 / 总结"方向的可用资产；什么时候重做，见决策 D-0044。

## 目录

| 路径 | 内容 |
|---|---|
| `narrative/` | 引擎本体：`schema.js`（六类型五约束）、`catalog.js`、`facts.js`（八个动词）、`engine.js`（原子应用、按事实前状态判定）、`render.js`、`plan.js`（重放、注入、消息块计划）、`checkpoint.js`、`block.js`、`adapter.js`、`preset.js`、`guide.js`、`store.js`、`index.js`、`README.md` |
| `ui/view-narrative.js` | 原来的「叙事」标签页（开关、预算、检查点、账本预览、声明编辑器） |
| `tests/` | `narrative.test.mjs`（15）、`narrative-plan.test.mjs`（9）、`narrative-demo.mjs`、`narrative-probe.html`（22 项断言）、`shot-narrative.png` |

## 它不能直接跑

适配层与界面文件是"从扩展里搬出来的"，不是独立发布物：`ui/view-narrative.js` 仍 import `./widgets.js`（该文件留在 `extension/ui/`，这里没有），所以它单独打不开；`narrative/` 的 import 是自洽的，但只导出工厂，需要宿主装配才能跑。要重新启用，按下面做：

1. 把 `narrative/` 搬回 `extension/narrative/`，`view-narrative.js` 搬回 `extension/ui/`；
2. 恢复 `index.js` 里的 `createNarrativeRuntime` 装配、`narrative.mount()`、注入与 `CHAT_CHANGED` 刷新；
3. 恢复 `ui/panel.js` 的「叙事」页与 `ui/view-diagnostics.js` 的叙事卡；
4. 把 `tests/` 里的四个文件搬回 `extension/tests/`，并把 `linkcheck.mjs` 的模块数从 42 改回去。

更推荐的做法是把它做成**独立扩展 / 独立仓库**，而不是再塞回 ILB（D-0044 待定项 1）。

## 与扩展现在的分工

- 扩展只负责：世界书、条目流程图、**聊天变量**（`core/vars.js`）、`{{ILB:名字}}` 宏、「记住」/「激活条目」两个节点、「状态」页。
- 账本负责（如果将来重新上线）：从正文里认事实、约束与计算、把确定状态注入给模型、消息末尾只读块。

两边的共同点只有"变量"：账本的 `catalog` 管类型/范围/容量，扩展的 `vars` 管"当前聊天的一个值"。将来对接时，变量表应当是共享的，但**不要**让账本直接改扩展的仓库对象——走 `globalThis.ILB.vars`（见 `extension/index.js`）。
