// ui/shell.js —— 界面外壳的路由（v0.5.0）。
//
// 从这一版起，"电脑界面"和"手机界面"是**两套独立的壳**，同一个 panel 装进哪一套由这里决定：
//   ui/floating.js  → 电脑：可拖动的悬浮窗（v0.2.0 起一直用它）
//   ui/mobile.js    → 手机：整屏 <dialog> + 二级页（v0.5.0 新写）
// 这样手机的问题不会再把电脑那套拖下水，反过来也一样。
// 判定仍然只有一处：ui/layout.js 的 pickLayout（宽度/高度/是不是触屏），不读媒体查询。
//
// 换壳时**只搬 panel 的 DOM，不重建数据**：panel.mount() 内部是把同一个 root 挪到新容器，
// 所以书架/规则的选中状态、滚动位置之外的东西都不会丢。

import { on } from './dom.js';
import { createFloatingWindow } from './floating.js';
import { createMobileUi } from './mobile.js';
import { setOverlayBackend, closeOverlay } from './help.js';
import { pickLayout, viewportOf, describeLayout } from './layout.js';

const RESIZE_DELAY = 150;

/**
 * @param {object} options
 * @param {object} [options.repository]
 * @param {Function} [options.notify]
 * @param {Function} [options.onOpen] 任一套壳打开时回调（用来重画面板）
 * @param {Function} [options.ledger] 读账本的函数（手机状态坞用；电脑不需要）
 */
export function createShell({ repository, notify, onOpen, ledger } = {}) {
  const desktop = createFloatingWindow({ repository, notify, onOpen });
  const mobile = createMobileUi({ repository, notify, onOpen, ledger });

  let layout = pickLayout(viewportOf());
  let panel = null;
  let timer = null;
  let bound = false;

  function current() {
    return layout === 'mobile' ? mobile : desktop;
  }

  /**
   * 浮层的出口也跟着布局走：
   *  - 电脑：用 ui/help.js 那套居中浮层（z-index 2147483000，够 PC 用）；
   *  - 手机：换成整屏里的二级页（top layer，不怕被盖）。
   * 走的是 ui/help.js 里的全局后端，所以面板、编辑器、导入、自检直接调 openOverlay 也会自动换过去。
   */
  function routeOverlay() {
    setOverlayBackend(layout === 'mobile' ? mobile : null);
  }

  /** 手机界面开着的时候，提示发到界面里；其余情况交给宿主 toastr。 */
  function notifyThrough(message, kind = 'info') {
    if (layout === 'mobile' && mobile.isOpen()) {
      mobile.toast(message, kind);
      return;
    }
    if (typeof notify === 'function') {
      try {
        notify(message, kind);
        return;
      } catch {
        /* 掉到控制台 */
      }
    }
    console.info(`[ILB] ${message}`);
  }

  function applyVisibility() {
    if (layout === 'mobile') {
      desktop.close();
      desktop.setVisible(false);
      mobile.setVisible(true);
    } else {
      mobile.close();
      mobile.setVisible(false);
      desktop.setVisible(true);
    }
  }

  async function switchTo(next, { silent = false } = {}) {
    if (next === layout) return;
    // 屏幕转了/窗口拉宽时，先把手上的浮层收干净：否则电脑那层 .ilb-overlay 会留在一个
    // 已经让位（display:none）的壳里，手机那边也可能挂着半截二级页——两种都表现为"点不开"。
    try {
      closeOverlay();
    } catch {
      /* 没有浮层时什么都不用做 */
    }
    try {
      mobile.clearOverlays();
    } catch {
      /* ignore */
    }
    layout = next;
    routeOverlay();
    applyVisibility();
    if (panel) {
      try {
        await current().attachPanel(panel);
      } catch (err) {
        console.warn('[ILB] 换壳时面板没搬过去', err);
      }
    }
    if (!silent) console.info(`[ILB] 界面切成${describeLayout(next)}`);
  }

  function bindResize() {
    if (bound) return;
    bound = true;
    const onResize = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const next = pickLayout(viewportOf());
        if (next !== layout) {
          switchTo(next).catch((err) => console.warn('[ILB] 切换界面布局失败', err));
        }
      }, RESIZE_DELAY);
    };
    on(globalThis, 'resize', onResize);
    on(globalThis, 'orientationchange', onResize);
  }

  function mount() {
    const desktopOk = desktop.mount();
    const mobileOk = mobile.mount();
    if (!desktopOk && !mobileOk) return false;
    layout = pickLayout(viewportOf());
    routeOverlay();
    applyVisibility();
    bindResize();
    console.info(`[ILB] 界面：${describeLayout(layout)}`);
    return true;
  }

  /** 把面板装进当前这套壳。 */
  async function attachPanel(nextPanel) {
    if (!nextPanel || typeof nextPanel.mount !== 'function') return false;
    panel = nextPanel;
    try {
      return await current().attachPanel(nextPanel);
    } catch (err) {
      console.error('[ILB] 面板没能挂进当前界面', err);
      return false;
    }
  }

  function open() {
    return layout === 'mobile' ? mobile.open() : desktop.open();
  }

  function close() {
    return layout === 'mobile' ? mobile.close() : desktop.close();
  }

  function toggle() {
    return layout === 'mobile' ? mobile.toggle() : desktop.toggle();
  }

  /** 状态点在两套壳上都有，一起更新，免得换壳后圆点颜色不对。 */
  function setStatus(kind = 'idle', tip = '') {
    try {
      desktop.setStatus(kind, tip);
    } catch {
      /* ignore */
    }
    try {
      mobile.setStatus(kind, tip);
    } catch {
      /* ignore */
    }
  }

  function refresh() {
    try {
      current().refresh();
    } catch {
      /* ignore */
    }
  }

  /** 叙事引擎重放之后调它，让手机那条状态坞跟着更新（电脑上没有坞，无操作）。 */
  function refreshLedger() {
    try {
      mobile.refreshLedger();
    } catch {
      /* ignore */
    }
  }

  /** 允许启动后再接上"读账本"的函数（叙事引擎可能比壳晚建好）。 */
  function setLedger(next) {
    try {
      mobile.setLedger(next);
    } catch {
      /* ignore */
    }
  }

  return {
    mount,
    attachPanel,
    open,
    close,
    toggle,
    isOpen: () => current().isOpen(),
    layout: () => layout,
    label: () => describeLayout(layout),
    setStatus,
    refresh,
    refreshLedger,
    setLedger,
    notify: notifyThrough,
    desktop,
    mobile,
    get body() {
      return current().body;
    },
    describe: () => ({
      layout,
      label: describeLayout(layout),
      desktop: desktop.describe(),
      mobile: mobile.describe(),
    }),
  };
}
