// index.js —— 装配层。只做"把零件接起来"，不含任何业务判断。
// 新增功能时的正确做法：写一个新模块 + 在 registry 里注册，而不是改这个文件。
//
// 界面结构（从 v0.2.0 起）：
//   扩展设置页  → 一张小卡片（ui/settings-card.js）：几个常用开关 + "打开控制器"
//   页面右下角  → 悬浮球（ui/floating.js）：点开是浮窗，书架/规则/诊断/设置都在里面
// 两块界面共用同一个 panel，所以不存在"两处显示不一致"。

import { loadHost } from './host.js';
import { createRepository } from './adapters/repository.js';
import { createNativeWorlds } from './adapters/native-worlds.js';
import { createInjector } from './adapters/inject.js';
import { createPipeline } from './runtime/pipeline.js';
import { createRegistry } from './runtime/registry.js';
import { createPanel } from './ui/panel.js';
import { createSettingsCard } from './ui/settings-card.js';
import { createFloatingWindow } from './ui/floating.js';
import { loadHelp } from './ui/help.js';
import { runSelfTest } from './ui/selftest.js';

const EXT_LABEL = 'Independent Lorebook';
const VERSION = '0.4.3';

function notify(message, kind = 'info') {
  try {
    const toastr = globalThis.toastr;
    if (toastr && typeof toastr[kind] === 'function') toastr[kind](message, EXT_LABEL);
  } catch {
    /* toastr 坏了不影响功能 */
  }
  console.info(`[ILB] ${message}`);
}

/** 等扩展设置区出现。它由宿主在启动时插入，扩展脚本可能先跑。 */
function waitFor(selector, attempts = 20, interval = 500) {
  return new Promise((resolve) => {
    let left = attempts;
    const tick = () => {
      const node = document.querySelector(selector);
      if (node) {
        resolve(node);
        return;
      }
      left -= 1;
      if (left <= 0) {
        resolve(null);
        return;
      }
      setTimeout(tick, interval);
    };
    tick();
  });
}

async function boot() {
  if (globalThis.__ILB_BOOTED === true) return;
  globalThis.__ILB_BOOTED = true;

  let host;
  try {
    host = await loadHost();
  } catch (err) {
    console.error(`[ILB] 启动失败：${err?.message ?? err}`);
    notify('ILB 启动失败：找不到 SillyTavern 入口，请确认扩展安装在 third-party 目录下', 'error');
    return;
  }

  const getContext = host.getContext.bind(host);

  const registry = createRegistry();
  let repository;
  let injector;

  try {
    repository = createRepository({ getContext, persist: () => host.saveSettings() });
  } catch (err) {
    console.error('[ILB] 数据端口初始化失败', err);
    return;
  }

  try {
    injector = createInjector({ getContext });
  } catch (err) {
    console.error('[ILB] 注入端口初始化失败', err);
    return;
  }

  const nativeWorlds = createNativeWorlds({
    getRequestHeaders: () => {
      try {
        return host.getRequestHeaders?.() ?? {};
      } catch {
        return {};
      }
    },
  });

  const pipeline = createPipeline({
    repository,
    injector,
    registry,
    logger: {
      info: (m) => console.info(`[ILB] ${m}`),
      warn: (m) => console.warn(`[ILB] ${m}`),
      error: (m, e) => console.error(`[ILB] ${m}`, e ?? ''),
    },
  });

  // 先读文案：帮助按钮点下去要立刻有反应，不能等 fetch。
  await loadHelp();

  const panel = createPanel({ repository, nativeWorlds, pipeline, notify });

  // 壳：悬浮球 + 浮窗。壳不认识书架，只认识"里面装一个 panel"。
  const floating = createFloatingWindow({
    repository,
    notify,
    onOpen: () => {
      try {
        panel.render();
      } catch (err) {
        console.warn('[ILB] 重新渲染面板失败', err);
      }
    },
  });

  const floatingReady = floating.mount();
  let panelReady = false;
  if (floatingReady) {
    panelReady = await floating.attachPanel(panel);
  }

  // 万一浮窗挂了（比如没有 body），至少把面板塞回设置页，功能不能整个消失。
  if (!panelReady) {
    const fallback = await waitFor('#extensions_settings');
    if (fallback) {
      panelReady = (await panel.mount(fallback)) !== false;
      if (panelReady) console.warn('[ILB] 浮窗不可用，面板已退回扩展设置页');
    }
  }

  const card = createSettingsCard({
    repository,
    pipeline,
    openWindow: () => {
      if (!floatingReady) {
        notify('浮窗没挂上，界面暂时用设置页里的面板；刷新页面可以再试一次', 'warn');
        return;
      }
      floating.open();
    },
    notify,
  });
  const settingsHost = await waitFor('#extensions_settings');
  if (settingsHost) {
    card.mount(settingsHost);
  } else {
    console.warn('[ILB] 等不到扩展设置区，设置卡片没有挂上；点悬浮球仍然能用');
  }

  function updateStatusDot(injected) {
    try {
      const info = pipeline.describeLastRun();
      if (info && info.error) {
        floating.setStatus('error', info.error);
        return;
      }
      if (info && info.skipped) {
        floating.setStatus('idle', info.skipped);
        return;
      }
      const count = info && Array.isArray(info.activated) ? info.activated.length : 0;
      floating.setStatus(injected && count > 0 ? 'ok' : 'wait', count > 0 ? `这一轮注入 ${count} 条` : '这一轮没有条目出现');
    } catch {
      /* 圆点颜色不准不影响功能 */
    }
  }

  function runOnce(reason) {
    try {
      const injected = pipeline.run(getContext, reason);
      updateStatusDot(injected);
      return injected;
    } catch (err) {
      console.error('[ILB] 判定失败，这一轮不注入', err);
      try {
        floating.setStatus('error', String(err?.message ?? err));
      } catch {
        /* ignore */
      }
      return false;
    }
  }

  // 事件订阅：任何一个处理器挂掉都不能影响扩展其他部分（ILB-2.5）
  try {
    const eventTypes = host.getEventTypes() ?? {};
    const source = host.getEventSource();
    if (source && typeof source.on === 'function') {
      const genEvent = eventTypes.GENERATION_STARTED ?? 'generation_started';
      source.on(genEvent, () => runOnce('generation'));

      const chatEvent = eventTypes.CHAT_CHANGED ?? 'chat_changed';
      source.on(chatEvent, () => {
        try {
          pipeline.reset();
          panel.render();
          card.render();
          floating.setStatus('idle');
        } catch (err) {
          console.warn('[ILB] 切换对话后刷新界面失败', err);
        }
      });
    } else {
      console.warn('[ILB] 拿不到事件源，扩展不会自动注入；请检查 SillyTavern 版本');
    }
  } catch (err) {
    console.error('[ILB] 订阅事件失败', err);
  }

  // 给高级用户排障用
  globalThis.ILB = {
    version: VERSION,
    registry,
    repository,
    pipeline,
    host,
    panel,
    floating,
    card,
    describeLastRun: () => pipeline.describeLastRun(),
    describeUi: () => floating.describe(),
    selftest: () => runSelfTest(),
    runOnce,
  };

  console.info(`[ILB] 已启动 v${VERSION}（通过 ${host.via} 拿到宿主；界面：${floatingReady ? '悬浮球' : '退回设置页'}）`);
}

function start() {
  // 让坏了的东西出声。点击处理器里抛的错、没 await 的 promise 失败，本来只会安静地
  // 写进控制台，用户看到的是"点了按钮没有任何反应"——最难描述、也最难查的一类故障。
  // 这里兜一层：至少 toast 一句，原始错误仍然完整留在控制台。
  if (!globalThis.__ILB_ERROR_HOOKED) {
    globalThis.__ILB_ERROR_HOOKED = true;
    const report = (label, err) => {
      const text = (err && (err.message || String(err))) || String(err);
      notify(`ILB 出错了：${text}（详情见浏览器控制台）`, 'error');
      console.error(`[ILB] ${label}`, err);
    };
    window.addEventListener('error', (event) => {
      if (event && event.error) report('未捕获错误', event.error);
    });
    window.addEventListener('unhandledrejection', (event) => {
      report('未处理的异步错误', event && event.reason);
    });
  }

  boot().catch((err) => {
    console.error('[ILB] 启动时出现未捕获错误', err);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
