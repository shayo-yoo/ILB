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
```

- `st-live-check.mjs`：`globalThis.ILB` 是否加载、接口版本、桌面外壳能开面板、不横向溢出；截图 `live/last-panel.png`。
- `st-flow-text.mjs`：流程文本模式能渲染、有「复制给 AI 的说明」、手机视口下编辑框 ≥ 半屏；截图 `live/last-flow-mobile.png`。

环境变量：`ST_DIR`（酒馆根目录，用来找 `ws` 模块）、`ST_URL`（默认 `http://127.0.0.1:8000/`）、`CDP_PORT`（默认 `9222`）。

## 已知的"这一步也测不了"

- 真实**生成**：需要模型接口。脚本只验加载与界面，不验"模型会不会照着写事实、逻辑有没有按预期跑完"。
- 手机真机（SillyDroid 之类 WebView）：只用 Chrome 的设备模拟过，`navigator.clipboard` 在真 WebView 里可能被拒（代码里有 `execCommand` 兜底，但没实测）。
- 主题：用浅色主题的实例验了对比度，深色主题靠改内联颜色模拟，没在真深色主题里点过。
