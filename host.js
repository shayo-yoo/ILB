// host.js —— 全项目唯一允许 import 宿主代码的文件（ILB-2.4）
// 其余模块一律通过这里拿东西。这样就算宿主的内部结构变了，也只有这个文件要改。
//
// 关于路径：SillyTavern 的内置扩展放在 public/scripts/extensions/<名字>/，
// 第三方扩展放在 public/scripts/extensions/third-party/<名字>/，比内置的深一层。
// 所以第三方扩展里：
//   getContext / extension_settings → '../../extensions.js'
//   eventSource / event_types / getRequestHeaders / saveSettingsDebounced
//                                  → '../../../../script.js'
// 内置扩展的写法是 '../../../script.js' 和 '../../extensions.js'，不要直接照抄。
// 这里仍然按"猜几个位置、哪个能成就用哪个"来写，因为宿主目录结构将来可能会变。

const HOST_CANDIDATES = [
  '../../extensions.js', // 第三方扩展最常见的正确位置
  '/scripts/extensions.js', // 以站点根为基准的等价写法
  '../../../../script.js', // 第三方扩展里的 script.js
  '../../../script.js', // 内置扩展的 script.js（放在这里只是兜底）
  '/script.js',
];

let loaded = null;

/** 从一堆已经 import 成功的模块里，挨个字段找可用的实现 */
function pick(modules, keys) {
  for (const key of keys) {
    for (const mod of modules) {
      const v = mod?.[key] ?? mod?.default?.[key];
      if (typeof v === 'function') return v;
    }
  }
  return null;
}

/** 从模块里找一个"对象型"导出（eventSource、event_types 不是函数） */
function pickValue(modules, keys) {
  for (const key of keys) {
    for (const mod of modules) {
      const v = mod?.[key] ?? mod?.default?.[key];
      if (v && typeof v === 'object') return v;
    }
  }
  return null;
}

function fromModules(modules, via) {
  const getContext = pick(modules, ['getContext']);
  if (!getContext) return null;

  const saveSettingsDebounced = pick(modules, ['saveSettingsDebounced', 'saveSettings']);
  const getRequestHeaders = pick(modules, ['getRequestHeaders']);
  const eventSource = pickValue(modules, ['eventSource']);
  const eventTypes = pickValue(modules, ['event_types']);

  return {
    getContext,
    getEventSource: () => eventSource ?? globalThis.SillyTavern?.eventSource ?? null,
    getEventTypes: () => eventTypes ?? globalThis.SillyTavern?.eventTypes ?? null,
    getRequestHeaders: () => {
      if (!getRequestHeaders) return {};
      try {
        return getRequestHeaders() ?? {};
      } catch {
        return {};
      }
    },
    /**
     * 让宿主把 extension_settings 真正写进磁盘。
     * 这一步不能省：只改内存里的 extension_settings 对象，刷新页面就全没了。
     */
    saveSettings: () => {
      if (!saveSettingsDebounced) return false;
      try {
        saveSettingsDebounced();
        return true;
      } catch {
        return false;
      }
    },
    via,
  };
}

function fromGlobal() {
  const g = globalThis.SillyTavern;
  if (g && typeof g.getContext === 'function') {
    return {
      getContext: () => g.getContext(),
      getEventSource: () => g.eventSource ?? null,
      getEventTypes: () => g.eventTypes ?? null,
      getRequestHeaders: () => {
        try {
          return g.getRequestHeaders?.() ?? {};
        } catch {
          return {};
        }
      },
      saveSettings: () => {
        try {
          const fn = g.saveSettingsDebounced ?? g.saveSettings;
          if (typeof fn !== 'function') return false;
          fn();
          return true;
        } catch {
          return false;
        }
      },
      via: 'globalThis.SillyTavern',
    };
  }
  return null;
}

/**
 * 加载宿主入口对象。失败会抛出，但调用方（index.js）会 catch 住并显示人话提示。
 * @returns {Promise<{getContext: Function, getEventSource: Function, getEventTypes: Function, getRequestHeaders: Function, saveSettings: Function, via: string}>}
 */
export async function loadHost() {
  if (loaded) return loaded;

  const modules = [];
  const tried = [];
  for (const path of HOST_CANDIDATES) {
    try {
      const mod = await import(/* @vite-ignore */ path);
      modules.push(mod);
      tried.push(path);
    } catch {
      // 路径不对就试下一个，不用记日志：这是预期内的探测
    }
  }

  const host = fromModules(modules, tried.join(' , '));
  if (host) {
    loaded = host;
    return host;
  }

  const globalHost = fromGlobal();
  if (globalHost) {
    loaded = globalHost;
    return globalHost;
  }

  throw new Error('找不到 SillyTavern 的入口（模块与全局两种方式都失败了）。扩展可能安装在了错误的目录。');
}

/** 给不希望 await 的场景用；未加载时返回 null */
export function peekHost() {
  return loaded;
}
