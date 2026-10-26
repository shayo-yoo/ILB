// index.js —— 装配层。只做"把零件接起来"，不含任何业务判断。
// 新增功能时的正确做法：写一个新模块 + 在 registry 里注册，而不是改这个文件。
//
// 界面结构（v0.5.0 起）：
//   扩展设置页  → 一张小卡片（ui/settings-card.js）：几个常用开关 + "打开控制器"
//   页面右下角  → 电脑：悬浮球 + 可拖动浮窗（ui/floating.js）
//                手机：悬浮球 + 整屏界面（ui/mobile.js，自带 skin，用 <dialog> 进顶层）
// 两套壳由 ui/shell.js 按 ui/layout.js 的判定挑一套，面板（ui/panel.js）是同一个。
// 为什么手机要单独一套：从 v0.4.2 到 v0.4.8 都在给同一套 DOM 加手机变体（媒体查询、
// body.ilb-mobile、内联兜底、皮肤自愈），手机上仍然反复出现"点了按钮界面不出来"。
// 与其继续抽奖，不如把手机这条路彻底独立出来（决策记录 D-0037）。
//
import { loadHost } from './host.js';
import { createRepository } from './adapters/repository.js';
import { createNativeWorlds } from './adapters/native-worlds.js';
import { createInjector } from './adapters/inject.js';
import { createPipeline } from './runtime/pipeline.js';
import { createApi } from './runtime/api.js';
import { resolveChatId, normalizeVars } from './core/vars.js';
import { createRegistry } from './runtime/registry.js';
import { createPanel } from './ui/panel.js';
import { createSettingsCard } from './ui/settings-card.js';
import { createShell } from './ui/shell.js';
import { loadHelp } from './ui/help.js';
import { runSelfTest } from './ui/selftest.js';

const EXT_LABEL = 'Independent Lorebook';
const VERSION = '0.13.1';

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

  // 通知转发：面板与设置卡片先拿到这个函数，等壳建好后再把出口指过去。
  // 为什么要绕一层：手机界面是 <dialog> 顶层模态，宿主的 toastr 画在它下面，用户看不见；
  // 手机界面开着的时候提示必须画在界面自己的容器里（ui/mobile.js 的 toast）。
  let notifyVia = notify;
  const notifyThrough = (message, kind = 'info') => {
    try {
      notifyVia(message, kind);
    } catch (err) {
      console.info(`[ILB] ${message}`);
      console.warn('[ILB] 提示没弹出来', err);
    }
  };

  const panel = createPanel({
    repository,
    nativeWorlds,
    pipeline,
    getChatId: () => {
      try {
        return resolveChatId(getContext());
      } catch {
        return 'default';
      }
    },
    notify: notifyThrough,
  });

  // 壳：电脑=悬浮球+可拖动浮窗，手机=悬浮球+整屏界面。挑哪套由 ui/layout.js 算，切换在 ui/shell.js。
  // 壳不认识书架，只认识"里面装一个 panel"，所以两套壳共用同一个面板（ILB-6.1.3）。
  const shell = createShell({
    repository,
    notify,
    onOpen: () => {
      try {
        panel.render();
      } catch (err) {
        console.warn('[ILB] 重新渲染面板失败', err);
      }
    },
    status: () => repository.getVars(resolveChatId(getContext())),
    openState: () => panel.setTab('state'),
  });

  // 对外接口：别的扩展/脚本只走这层，不直接碰 repository（见 runtime/api.js）
  const getChatIdSafe = () => {
    try {
      return resolveChatId(getContext());
    } catch {
      return 'default';
    }
  };

  const shellReady = shell.mount();
  const api = createApi({
    repository,
    getContext,
    getChatId: getChatIdSafe,
    notify,
    openPanel: (tab) => {
      if (tab) panel.setTab(tab);
      if (shellReady) shell.open();
    },
    closeUi: () => shell.close(),
  });
  notifyVia = (message, kind = 'info') => shell.notify(message, kind);
  let panelReady = false;
  if (shellReady) {
    panelReady = await shell.attachPanel(panel);
  }

  // 万一两套壳都没挂上（比如没有 body），至少把面板塞回设置页，功能不能整个消失。
  if (!panelReady) {
    const fallback = await waitFor('#extensions_settings');
    if (fallback) {
      panelReady = (await panel.mount(fallback)) !== false;
      if (panelReady) console.warn('[ILB] 悬浮球不可用，面板已退回扩展设置页');
    }
  }

  const card = createSettingsCard({
    repository,
    pipeline,
    openWindow: () => {
      if (!shellReady) {
        notify('悬浮球没挂上，界面暂时用设置页里的面板；刷新页面可以再试一次', 'warn');
        return;
      }
      shell.open();
    },
    notify: notifyThrough,
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
        shell.setStatus('error', info.error);
        return;
      }
      if (info && info.skipped) {
        shell.setStatus('idle', info.skipped);
        return;
      }
      const count = info && Array.isArray(info.activated) ? info.activated.length : 0;
      shell.setStatus(injected && count > 0 ? 'ok' : 'wait', count > 0 ? `这一轮注入 ${count} 条` : '这一轮没有条目出现');
    } catch {
      /* 圆点颜色不准不影响功能 */
    }
  }

  function runOnce(reason) {
    try {
      const injected = pipeline.run(getContext, reason);
      updateStatusDot(injected);
      try {
        api.notify('run');
      } catch {
        /* 订阅者报错不影响判定 */
      }
      return injected;
    } catch (err) {
      console.error('[ILB] 判定失败，这一轮不注入', err);
      try {
        shell.setStatus('error', String(err?.message ?? err));
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
          shell.setStatus('idle');
          api.notify('chat_changed');
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
    api,
    registry,
    repository,
    pipeline,
    host,
    panel,
    shell,
    floating: shell.desktop,
    mobile: shell.mobile,
    card,
    // 聊天变量：给别的扩展/用户脚本读写当前聊天的变量（失败只 warn，不抛进生成链路）
    vars: {
      list: () => repository.getVars(resolveChatId(getContext())),
      get: (name) => {
        const vars = repository.getVars(resolveChatId(getContext()));
        return Object.prototype.hasOwnProperty.call(vars, String(name)) ? vars[String(name)] : undefined;
      },
      set: (name, value, type) => {
        const one = normalizeVars({ [String(name)]: { type, value } });
        return repository.mergeVars(resolveChatId(getContext()), one);
      },
      remove: (name) => repository.deleteVar(resolveChatId(getContext()), String(name)),
    },
    describeLastRun: () => pipeline.describeLastRun(),
    describeUi: () => shell.describe(),
    selftest: () => runSelfTest(),
    runOnce,
  };

  console.info(
    `[ILB] 已启动 v${VERSION}（通过 ${host.via} 拿到宿主；界面：${shellReady ? `悬浮球 · ${shell.label()}` : '退回设置页'}）`,
  );
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
