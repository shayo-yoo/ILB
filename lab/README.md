# `lab/` · 叙事引擎子项目（实验）

这里是 ILB 的**第二个子项目**：把"世界书加载器"往"叙事引擎"推一步——AI 只叙述发生了什么，引擎负责记账。

它**不随 v0.5.0 发布**，也**不与现有扩展互相引用**。现在是一个可以单独跑、单独测的纯计算库：

```powershell
node --test lab/tests/narrative.test.mjs   # 15 个用例，覆盖六种玩法
node lab/demo/run.mjs                      # 拿一段带标记的对话跑一遍，看它怎么记账
```

两条命令都不需要 SillyTavern、不需要浏览器、不需要 `manifest.json`。

---

## 1. 隔离契约（为什么它现在不算"扩展的一部分"）

| 约束 | 具体做法 |
|---|---|
| 不被装配 | `index.js` 不 import `lab/`，`manifest.json` 的 `js` 仍然只有 `index.js` |
| 不被检查工具带进来 | `tests/linkcheck.mjs` 遍历时跳过 `lab/`（它是发布前的"扩展能不能加载"检查；`lab` 有自己的测试） |
| 独立版本号 | `lab/narrative/index.js` 里 `NARRATIVE_VERSION = '0.1.0-lab'`；扩展本体仍是 `0.5.0` |
| 独立分支 | mirror 仓库（`github/`）上 `feat/narrative-core` 分支，`main` 保持 v0.5.0 可发布 |
| 数据格式独立 | 只吃普通的 JS 对象（声明），不读存档里的 `uiState`/`settings`，也不写 |

合并条件、以及为什么选"先隔离再合并"，见 `docs/决策记录.md` 的 **D-0039**。

---

## 2. 四层模型

这是整个子项目的骨架。四层都是**声明**，加玩法不改代码：

```
实体目录 catalog      这个世界里有什么（钥匙、药水、艾琳、地窖）——只读名词表
状态 schema.vars      要记什么（背包、生命、关系、任务、声望）——类型 + 初值
约束 schema.constraints 什么算合法（8 格、负重 20、两把剑互斥、范围 0–100）
规则 rules            发生了事实之后状态怎么变（拿到→进背包、喝药→回血+冷却）
```

**能算的都不许存**：`剩余格`、`总重量`、`是否满`、`关系数量` 全是 `derive()` 从当前值算的。存计数器一定会漂移；算出来的值不会。

---

## 3. 三条设计纪律

1. **AI 只写事实，不写机制。** 标记里只有"获得/失去/使用/关系/地点"这些动词，没有类型、没有数值、没有平衡。数值、容量、上限全部由声明决定。模型写不出"获得 99 把钥匙"这种越权操作，因为它只能写"获得 钥匙×99"，而数量会被上限拒掉。
2. **状态是重放出来的，不是被修改的。**
   `状态(第 N 条) = fold(消息 1..N 的事实 + 界面补记)`。
   滑动、重生成、删消息、刷新页面都只是"重新算一遍"，不需要版本号，也不可能出现"账本和对话对不上"。改第 3 条消息的正文，第 3 条之后的状态自动跟着变。
3. **原子拒绝，且必须看得见。** 一条事实要么整条生效，要么完全不变——不会出现"东西没进背包但剑已经拿到"。被拒时要带原因（`背包已满：上限 8 件…`），由上层显示成徽章；解析不出来的标记进 `unknowns`，不许静默丢弃。

附带一条：**规则的触发条件只看"这条事实之前"的状态**。所以规则表里谁先谁后不改变语义——用户写规则时不用推理顺序，也不会被"前一条规则改出来的值把后一条带起来"坑到（这是 v0.1.0 修掉的一个真 bug：`完成委托` 把任务改成"完成"之后，紧跟着的"委托已完成"规则会误以为自己该拒绝）。

---

## 4. 文件

| 文件 | 职责 |
|---|---|
| `lab/narrative/schema.js` | 类型（`text/number/flag/list/map/enum`）、编译声明、初值、派生值、约束检查 |
| `lab/narrative/catalog.js` | 实体目录：名字 → 标签/重量/字段，大小写与别名归一 |
| `lab/narrative/facts.js` | 从文本里解析 `[[ILB:…]]` 标记；剥标记；事实 → 人话 |
| `lab/narrative/engine.js` | 规则匹配、效果应用（原子）、一条消息到多条事实、整段对话重放（`fold`） |
| `lab/narrative/render.js` | 两种输出：给模型看的注入文本（带预算）、给人看的行；改动描述 |
| `lab/narrative/index.js` | 门面 `createNarrative(spec)`，把上面几层缝在一起 |
| `lab/example/spec.js` | 一份"用户写得出来"的完整声明（六种玩法都在里面，零代码） |
| `lab/tests/narrative.test.mjs` | 15 个用例，Node 自带 test runner，无依赖 |
| `lab/demo/run.mjs` | 一段模拟对话的端到端演示（打印每条的记录/拒绝/看不懂） |

---

## 5. 事实语法（AI 写的东西）

```
[[ILB:获得:铜钥匙]]              得到某物（可写 ×3 表示数量）
[[ILB:失去:铜钥匙×1]]            失去某物
[[ILB:使用:药水]]                使用某物（通常来自界面按钮，模型也可以写）
[[ILB:关系:艾琳/信任+1]]         关系变化（只写方向和幅度，数值由规则累加）
[[ILB:地点:王城/地窖]]           从 A 到 B
[[ILB:标记:见过国王]]            打开一个开关
[[ILB:解除:见过国王]]
[[ILB:见过:王城地窖]]
```

- 定界符是 `[[ILB:…]]`，**不与 SillyTavern 的 `{{…}}` 混用**（别的扩展也在注册宏，混用迟早撞车）。
- `tick` 不是模型写的：每条消息末尾引擎自己发一次，用来做"冷却 3 轮"这类递减。
- 同一段文本只存原文（含标记）；**显示**与**注入**时把标记剥掉，换成"已记录：获得铜钥匙"这样的徽章。三者是同一段文本的三个视图，不能混着用。

---

## 6. 声明长什么样

完整样本见 `lab/example/spec.js`。要点：

```js
// 变量：类型 + 初值 + 自带约束
{ name: '背包', type: 'list', of: 'item', label: '背包',
  constraints: [{ kind: 'max', value: 8 }, { kind: 'sumMax', field: 'weight', value: 20 }] }

// 全局约束：互斥
constraints: [{ kind: 'mutex', vars: ['圣剑', '魔剑'] }]

// 规则：on = 事实类型；when = 条件；effects = 效果
{ id: '喝药', on: 'use',
  when: { name: '药水', all: [{ var: '冷却', op: '==', value: 0 }] },
  effects: [
    { op: 'remove', var: '背包', value: '$name' },
    { op: 'inc', var: '生命', amount: 10 },
    { op: 'set', var: '冷却', value: 3 },
  ],
  note: '回 10 点，冷却 3 轮' }
```

- 约束：`max`（列表格数）、`sumMax`（按目录 weight 求和）、`range`（数值范围）、`mutex`（开关互斥）、`require`（条件前置）。
- 效果：`add/remove/set/inc/dec/mapInc/mark/unmark/reject`。
- 条件：`name`、`tags`（查目录）、`dir`、`from`、`to`、`all`（变量比较）、`not`。
- 变量引用：`$name`、`$count`、`$sign`、`$amount`、`$target`、`$from`。
- 写错的东西（引用不存在的变量、不认识的 op、不认识的 `on`、没有效果的规则）在**编译期**进 `problems`，不在运行期静默跳过。

---

## 7. 门面 API

```js
const ilb = createNarrative({ schema, catalog, rules });

ilb.problems            // 编译期问题（配置写错）
ilb.initial()           // 初始状态
ilb.parse(text)         // → { facts, unknowns, duplicates, found }
ilb.strip(text)         // 剥掉标记的正文（显示/注入用）
ilb.apply(state, fact)  // → { ok, state, changes, rejected, matched, noops, unhandled? }
ilb.applyMany(state, facts)
ilb.fold(entries)       // 整段重放；entries = [string | { text, manual: [fact] }]
ilb.stateAt(entries, i) // 第 i 条消息之后的状态
ilb.derive(state)       // 派生值（剩余格、总重量…）
ilb.render(state, { budgetChars })  // 给模型看的注入文本
ilb.lines(state)        // 给人看的行
ilb.changes(result)     // 改动描述
ilb.summary(state)      // 一行摘要（状态坞用）
```

`fold()` 返回 `{ state, log, unknowns, problems, derived }`：`log` 每条消息都有 `facts`（每条事实的成功/拒绝/未认领）与 `unknowns`，界面上的"本轮已记录/未执行"徽章直接读它。

---

## 8. 六种玩法的验收（全用声明写出来，核心零改动）

| 玩法 | 只用声明怎么表达 | 用例 |
|---|---|---|
| 背包 8 格 | `list` + `max: 8`，第 9 件被拒 | 玩法 1 |
| 负重 20 | 目录 `weight` + `sumMax` | 玩法 2 |
| 圣剑/魔剑互斥 | 两个 `flag` + `mutex` | 玩法 3 |
| 药水冷却 3 轮 | `number` 冷却 + `tick` 规则 + `reject` 规则 | 玩法 4 |
| 关系表 | `map` + `mapInc` | 玩法 5 |
| 任务状态机 | `enum` + 三条互斥的 `use` 规则 | 玩法 6 |

如果哪天要实现第七种玩法（比如"配方合成"），先问：能不能只用上面这些原语写出来？写不出来再考虑加原语——**不要为一个玩法开一个口子**。

---

## 9. 还没做（合并前必须补上的）

- **SillyTavern 适配层**：监听消息渲染 → 追加状态块；聊天变更 → 重建；注入 → `setExtensionPrompt`。现在这一层完全不存在（`lab/` 里没有一行 DOM 代码）。
- **消息 UI 块**：布局声明、格子组件、徽章、按钮（补记/撤销）、手机端状态坞。设计已定（见 D-0039 的讨论结论），代码未写。
- **动态条目**：全局/局部条目的创建、归属、隐藏——这是 ST 侧的概念，要单独设计。
- **宏展开**：`{{…}}` 之外的 `[[ILB:…]]` 在提示词里能不能展开、在哪展开（角色卡正文不在 ILB 手里，这是硬限制）。
- **AI 提示词模板**：教模型"只写事实、不写机制"的那段话还没定稿。
- **存档迁移**：现有 v0.5.0 的 `uiState/settings` 不动；叙事子项目将来要独立的存储键。

## 10. 合并条件

1. 六种玩法的验收用例全绿，且**核心零改动**（新增玩法只写声明）。
2. 有一段真实的 ST 对话跑通端到端：标记解析 → 记账 → 消息块显示 → 注入 → 下一轮模型遵守账本。
3. 手机端（v0.5.0 的 `<dialog>` 壳）能显示状态坞，且不影响现有五个面板。
4. 关掉叙事子项目时，扩展行为与 v0.5.0 **完全一致**（可回退）。
5. 文档同步：`参考文档.md` 新章节、`CHANGELOG` 条目、决策记录、`README`。

这五条都满足才动 `index.js` 的装配。否则 `lab/` 就一直是"能跑但不装"的状态。
