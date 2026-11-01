# 真实宿主验收（需要本地酒馆）

这里的脚本**不属于** `node --test`：它们要一个真的在跑的 SillyTavern，和一个带调试端口的 Chrome。
它们回答的是假 DOM 回答不了的问题——扩展在真实宿主里到底会不会加载、面板会不会溢出、手机上编辑框有多高。

## 准备

```bat
:: 1) 启动酒馆（另开一个窗口，保持运行）
cd /d D:\1\APP\SillyTavern
node server.js --port 8000 --listen false

:: 2) 启动一个带调试端口的 Chrome（另开一个窗口，保持运行）
"C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --disable-gpu ^
  --remote-debugging-port=9222 --user-data-dir=%TEMP%\ilb-cdp about:blank
```

扩展要放在酒馆的第三方扩展目录里（`public\scripts\extensions\third-party\ILB`），版本要对得上：

```bat
cd /d D:\1\APP\SillyTavern\public\scripts\extensions\third-party\ILB
git pull --ff-only
```

## 跑

```bat
cd /d D:\文档\1\DSH\ILB\extension
set ST_DIR=D:\1\APP\SillyTavern
node tests/live/st-live-check.mjs
node tests/live/st-flow-text.mjs
node tests/live/st-ui-step.mjs
node tests/live/st-mobile-check.mjs
node tests/live/st-text-roundtrip.mjs
node tests/live/st-double-inject.mjs
node tests/live/st-phase4-check.mjs
node tests/live/st-guard-check.mjs
node tests/live/st-extra-check.mjs
node tests/live/st-window-check.mjs
node tests/live/st-breakpoint-check.mjs
node tests/live/st-v22-mobile.mjs
node tests/live/st-v23-check.mjs
node tests/live/st-v24-check.mjs
node tests/live/st-v24b-check.mjs
```

- `st-live-check.mjs`：`globalThis.ILB` 是否加载、接口版本（现 1.2）与 `caps`（要含 `ui`、`callAsync`）、桌面外壳能开面板、不横向溢出；截图 `live/last-panel.png`。
- `st-flow-text.mjs`：流程文本模式能渲染、**点一次「复制给 AI 的说明」并要求控制台零错误**（v0.13.2 加，之前这里报过 `ctx is not defined`）、手机视口下编辑框 ≥ 半屏；截图 `live/last-flow-mobile.png`。
- `st-ui-step.mjs`：v0.14.0 的「界面」步骤。造一本临时书（`live-ui-probe`，跑完可从书架删掉），验 `api.call` 带回顶层 `ui` 与 `durationMs`、没有界面步骤时是 `null`、`callAsync` 同形且失败不 reject、事件顺序 `call,ui`；再在真 DOM 里画一个「界面」节点（`<dialog>` 里画，免得被宿主初始化白板挡住），数输入格与横向溢出。截图 `live/last-ui-step.png`。
- `st-mobile-check.mjs`：v0.19.2 加。iPhone 13 视口（390×844，DPR 3）下 `dialog.ilb-m` 打开、四个底部入口文案对、`overflowNodes` 为 0、顶部有书籍上下文条；建一本临时书（`live-mobile-probe`）选中后点「编辑」，断言手机浮层出现、底部三个按钮（试运行/保存/取消）贴在视口底边、没有横向溢出。截图 `live/last-mobile.png`。
- `st-text-roundtrip.mjs`：v0.19.2 加，v0.20.0 扩。桌面视口建临时书（`live-text-probe`）→ 编辑规则 → 文本模式：空流程带「关键词 + 流程」、写三段（比较 + 成立 + 变量）后报告「没有看不懂的行」、收下→切回表单→再切回文本后**逐行一致**（忽略首行标题）；v0.20.0 起再写一段「列表变量三动作 + 按列表循环」，同样要求收下后再切回来逐行一致；v0.21.0 把「分支选择（等于 3 / 等于 "VIP" / 否则）」接在同一段；v0.21.1 再写一段**全角空格缩进**的「条件组」，报告必须是「没有看不懂的行」；最后塞一行没归属的缩进，要求报告里逐行指出而不是悄悄丢掉。截图 `live/last-text-roundtrip.png`。
- `st-double-inject.mjs`：v0.19.2 加。在真酒馆里造一本原生世界书（`ILB-Double-Probe`，加进全局启用），再让 ILB 里一本书映射到它，然后跑两轮：`warn` 时这本 ILB 书照常启用、`extensionPrompts` 里真的出现它的正文；`skip` 时它被点名跳过、active 与激活列表里都没有它、注入内容里也搜不到。收尾会删掉探针书、把原生书从全局选择里摘掉、策略恢复成 `warn`。截图 `live/last-double-inject.png`。

- `st-phase4-check.mjs`：v0.19.2 加。造一本探针书（`probe-phase4-live`），用 `ILB.api.call` 在真酒馆里跑六条逻辑：权重 `[0,1]` 的随机选只挑第二条；参数 21 传进被调逻辑、翻倍后按名字取回 42；要了不存在的返回值会报「没有给出返回值」且不写空值；列表循环拼出「甲乙丙」；列表名不存在会报「还不是列表」且不写脏值；分支选择命中第三条写「三」。跑完删书、清聊天变量。**这条探针在 v0.19.1 上抓出过真 bug（按钮调用里的「调用逻辑」丢参数），走的就是它。**

- `st-window-check.mjs`：v0.21.2 加。桌面 1360×900 验浮窗本身：打开落在视口内；用 `PointerEvent` 拖标题栏 +120/+70 后位置真的变；往右下猛拖 4000px 被夹在可见区（`right<=1360`、`bottom<=900`）；最大化铺开、再点还原、最小化后 `display:none` 且悬浮球可见、再点回原高度；关掉再开与 `Page.reload` 之后位置都还在。截图 `live/last-window.png`。
- `st-extra-check.mjs`：v0.19.4 加。两件事：① C2 复杂往返——把「条件组 全部满足 + 两条条件 + 成立/不成立 + 按概率 + 重复 + 结束」整段写进文本模式，收下后切回表单再切回文本，要求逐行一致、报告「没有看不懂的行」；② E2 六十项上限——列表写 60 项，循环只跑 50 次，并断言步骤里写「原来的 60 项只留前 50 项」。截图 `live/last-extra-check.png`。

- `st-v22-mobile.mjs`：v0.22.0 加。手机视口 390×844 验这一轮的手机界面重排：底栏是不是挂在滚动区外、内容 1 条与 12 条时底边都不动；顶部「书籍 / 新建 / 排序 / 筛选 / 变量」默认收起、展开后能选书；排序切「手动」后每条卡片有「排序权重」输入框，把最后一条权重改成 999 它会跳到第一条并把 `listSort.rules` 写进 `uiState`；卡片「⋯ → 设置分组」能把 `entry.group` 存下来；「更多」是页面而不是浮层，点「设置」真的切页。截图 `live/last-v22-mobile.png`。
- `st-v23-check.mjs`：v0.23.0 加。桌面 1360×900 验这一轮：书架卡片默认紧凑、「⋯」菜单可开可关、「展开详情」出现管理控件、切「舒适」后写进 `uiState.shelfMode`；规则列表停用项沉底（启用优先）、次排序选「名称」后 `listSort.rules.secondKey` 落盘、手动排序有权重框；逻辑页有默认组、新建组后组数 +1、组内新建逻辑成功且 `groupId` 对得上。截图 `live/last-v23-shelf.png`。

- st-v24-check.mjs：v0.24.0 加。手机视口 390×844 验折叠条在标题栏里且不在滚动区、容器 32px/按钮 30px、标题栏折叠按钮能整条收起；书籍选择器可搜索并真的切书；规则搜索「只搜标题」与「全部字段」结果不同且范围落盘；紧凑隐藏/舒适显示「酒馆关联」行。截图 live/last-v24-mobile.png。
- st-v24b-check.mjs：v0.24.1 加。手机视口 390×844 量 3 本书卡片高度（124px）、点 chip 真的展开（回归点）、打开「详情设置」抽屉验 5 行两列设置、「进总池」立即写回、关抽屉卡片高度不变、「打开规则」可用；再用「⋯ → 删除」验证 ILB 自己的确认浮层（不是原生 confirm）并真的删掉。截图 live/last-v24b-mobile.png 与 live/last-v241-shelf.png。

这些脚本都会自建临时书并在结束时删掉，**不会动你已有的书**。跑之前酒馆必须已经把 `extension/` 里的新版拷进 `third-party\ILB`，否则验的是老版本。

环境变量：`ST_DIR`（酒馆根目录，用来找 `ws` 模块）、`ST_URL`（默认 `http://127.0.0.1:8000/`）、`CDP_PORT`（默认 `9222`）。

## 已知的"这一步也测不了"

- 真实**生成**：需要模型接口。脚本只验加载与界面，不验"模型会不会照着写事实、逻辑有没有按预期跑完"。
- 手机真机（SillyDroid 之类 WebView）：只用 Chrome 的设备模拟过，`navigator.clipboard` 在真 WebView 里可能被拒（代码里有 `execCommand` 兜底，但没实测）。
- 主题：用浅色主题的实例验了对比度，深色主题靠改内联颜色模拟，没在真深色主题里点过。
