// index.js 鈥斺€?瑁呴厤灞傘€傚彧鍋?鎶婇浂浠舵帴璧锋潵"锛屼笉鍚换浣曚笟鍔″垽鏂€?// 鏂板鍔熻兘鏃剁殑姝ｇ‘鍋氭硶锛氬啓涓€涓柊妯″潡 + 鍦?registry 閲屾敞鍐岋紝鑰屼笉鏄敼杩欎釜鏂囦欢銆?//
// 鐣岄潰缁撴瀯锛堜粠 v0.2.0 璧凤級锛?//   鎵╁睍璁剧疆椤? 鈫?涓€寮犲皬鍗＄墖锛坲i/settings-card.js锛夛細鍑犱釜甯哥敤寮€鍏?+ "鎵撳紑鎺у埗鍣?
//   椤甸潰鍙充笅瑙? 鈫?鎮诞鐞冿紙ui/floating.js锛夛細鐐瑰紑鏄诞绐楋紝涔︽灦/瑙勫垯/璇婃柇/璁剧疆閮藉湪閲岄潰
// 涓ゅ潡鐣岄潰鍏辩敤鍚屼竴涓?panel锛屾墍浠ヤ笉瀛樺湪"涓ゅ鏄剧ず涓嶄竴鑷?銆?
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
const VERSION = '0.4.4';

function notify(message, kind = 'info') {
  try {
    const toastr = globalThis.toastr;
    if (toastr && typeof toastr[kind] === 'function') toastr[kind](message, EXT_LABEL);
  } catch {
    /* toastr 鍧忎簡涓嶅奖鍝嶅姛鑳?*/
  }
  console.info(`[ILB] ${message}`);
}

/** 绛夋墿灞曡缃尯鍑虹幇銆傚畠鐢卞涓诲湪鍚姩鏃舵彃鍏ワ紝鎵╁睍鑴氭湰鍙兘鍏堣窇銆?*/
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
    console.error(`[ILB] 鍚姩澶辫触锛?{err?.message ?? err}`);
    notify('ILB 鍚姩澶辫触锛氭壘涓嶅埌 SillyTavern 鍏ュ彛锛岃纭鎵╁睍瀹夎鍦?third-party 鐩綍涓?, 'error');
    return;
  }

  const getContext = host.getContext.bind(host);

  const registry = createRegistry();
  let repository;
  let injector;

  try {
    repository = createRepository({ getContext, persist: () => host.saveSettings() });
  } catch (err) {
    console.error('[ILB] 鏁版嵁绔彛鍒濆鍖栧け璐?, err);
    return;
  }

  try {
    injector = createInjector({ getContext });
  } catch (err) {
    console.error('[ILB] 娉ㄥ叆绔彛鍒濆鍖栧け璐?, err);
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

  // 鍏堣鏂囨锛氬府鍔╂寜閽偣涓嬪幓瑕佺珛鍒绘湁鍙嶅簲锛屼笉鑳界瓑 fetch銆?  await loadHelp();

  const panel = createPanel({ repository, nativeWorlds, pipeline, notify });

  // 澹筹細鎮诞鐞?+ 娴獥銆傚３涓嶈璇嗕功鏋讹紝鍙璇?閲岄潰瑁呬竴涓?panel"銆?  const floating = createFloatingWindow({
    repository,
    notify,
    onOpen: () => {
      try {
        panel.render();
      } catch (err) {
        console.warn('[ILB] 閲嶆柊娓叉煋闈㈡澘澶辫触', err);
      }
    },
  });

  const floatingReady = floating.mount();
  let panelReady = false;
  if (floatingReady) {
    panelReady = await floating.attachPanel(panel);
  }

  // 涓囦竴娴獥鎸備簡锛堟瘮濡傛病鏈?body锛夛紝鑷冲皯鎶婇潰鏉垮鍥炶缃〉锛屽姛鑳戒笉鑳芥暣涓秷澶便€?  if (!panelReady) {
    const fallback = await waitFor('#extensions_settings');
    if (fallback) {
      panelReady = (await panel.mount(fallback)) !== false;
      if (panelReady) console.warn('[ILB] 娴獥涓嶅彲鐢紝闈㈡澘宸查€€鍥炴墿灞曡缃〉');
    }
  }

  const card = createSettingsCard({
    repository,
    pipeline,
    openWindow: () => {
      if (!floatingReady) {
        notify('娴獥娌℃寕涓婏紝鐣岄潰鏆傛椂鐢ㄨ缃〉閲岀殑闈㈡澘锛涘埛鏂伴〉闈㈠彲浠ュ啀璇曚竴娆?, 'warn');
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
    console.warn('[ILB] 绛変笉鍒版墿灞曡缃尯锛岃缃崱鐗囨病鏈夋寕涓婏紱鐐规偓娴悆浠嶇劧鑳界敤');
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
      floating.setStatus(injected && count > 0 ? 'ok' : 'wait', count > 0 ? `杩欎竴杞敞鍏?${count} 鏉 : '杩欎竴杞病鏈夋潯鐩嚭鐜?);
    } catch {
      /* 鍦嗙偣棰滆壊涓嶅噯涓嶅奖鍝嶅姛鑳?*/
    }
  }

  function runOnce(reason) {
    try {
      const injected = pipeline.run(getContext, reason);
      updateStatusDot(injected);
      return injected;
    } catch (err) {
      console.error('[ILB] 鍒ゅ畾澶辫触锛岃繖涓€杞笉娉ㄥ叆', err);
      try {
        floating.setStatus('error', String(err?.message ?? err));
      } catch {
        /* ignore */
      }
      return false;
    }
  }

  // 浜嬩欢璁㈤槄锛氫换浣曚竴涓鐞嗗櫒鎸傛帀閮戒笉鑳藉奖鍝嶆墿灞曞叾浠栭儴鍒嗭紙ILB-2.5锛?  try {
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
          console.warn('[ILB] 鍒囨崲瀵硅瘽鍚庡埛鏂扮晫闈㈠け璐?, err);
        }
      });
    } else {
      console.warn('[ILB] 鎷夸笉鍒颁簨浠舵簮锛屾墿灞曚笉浼氳嚜鍔ㄦ敞鍏ワ紱璇锋鏌?SillyTavern 鐗堟湰');
    }
  } catch (err) {
    console.error('[ILB] 璁㈤槄浜嬩欢澶辫触', err);
  }

  // 缁欓珮绾х敤鎴锋帓闅滅敤
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

  console.info(`[ILB] 宸插惎鍔?v${VERSION}锛堥€氳繃 ${host.via} 鎷垮埌瀹夸富锛涚晫闈細${floatingReady ? '鎮诞鐞? : '閫€鍥炶缃〉'}锛塦);
}

function start() {
  // 璁╁潖浜嗙殑涓滆タ鍑哄０銆傜偣鍑诲鐞嗗櫒閲屾姏鐨勯敊銆佹病 await 鐨?promise 澶辫触锛屾湰鏉ュ彧浼氬畨闈欏湴
  // 鍐欒繘鎺у埗鍙帮紝鐢ㄦ埛鐪嬪埌鐨勬槸"鐐逛簡鎸夐挳娌℃湁浠讳綍鍙嶅簲"鈥斺€旀渶闅炬弿杩般€佷篃鏈€闅炬煡鐨勪竴绫绘晠闅溿€?  // 杩欓噷鍏滀竴灞傦細鑷冲皯 toast 涓€鍙ワ紝鍘熷閿欒浠嶇劧瀹屾暣鐣欏湪鎺у埗鍙般€?  if (!globalThis.__ILB_ERROR_HOOKED) {
    globalThis.__ILB_ERROR_HOOKED = true;
    const report = (label, err) => {
      const text = (err && (err.message || String(err))) || String(err);
      notify(`ILB 鍑洪敊浜嗭細${text}锛堣鎯呰娴忚鍣ㄦ帶鍒跺彴锛塦, 'error');
      console.error(`[ILB] ${label}`, err);
    };
    window.addEventListener('error', (event) => {
      if (event && event.error) report('鏈崟鑾烽敊璇?, event.error);
    });
    window.addEventListener('unhandledrejection', (event) => {
      report('鏈鐞嗙殑寮傛閿欒', event && event.reason);
    });
  }

  boot().catch((err) => {
    console.error('[ILB] 鍚姩鏃跺嚭鐜版湭鎹曡幏閿欒', err);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
