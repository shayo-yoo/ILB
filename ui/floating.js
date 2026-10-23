// ui/floating.js —— 常驻的"悬浮球 + 浮窗"（电脑专用，v0.5.0 起不再管手机）。
// 为什么要有它：扩展设置页里塞满四个面板，用起来像在翻一个后台管理网站；
// 而"看书、改规则、看诊断"是高频操作，应该随手就能打开、随手就能关。
// 分工：这个文件只管"壳"（球在哪、窗多大、怎么拖动、什么时候关），
//       里面装什么由 panel.js 决定。所以换界面不用动这里。
//
// v0.5.0：手机不再走这里（手机是 ui/mobile.js 的整屏界面）。原先散在这个文件里的
// 手机分支——整屏 class、隐藏悬浮球、遮罩、锁背景滚动——全部删掉了，
// 因为那套"一套 DOM 掰成两种形状"的做法正是手机上反复出问题的来源。

import { el, on } from './dom.js';
import { helpButton, closeOverlay, isOverlayOpen } from './help.js';
import {
  pickLayout,
  defaultWindowGeometry,
  clampGeometry,
  defaultFabPosition,
  clampFabPosition,
  viewportOf,
  describeLayout,
} from './layout.js';

const SAVE_DELAY = 350;
const RESIZE_DELAY = 150;
const DRAG_THRESHOLD = 5;

function readUiState(repository) {
  try {
    if (repository && typeof repository.getUiState === 'function') {
      const value = repository.getUiState();
      if (value && typeof value === 'object') return value;
    }
  } catch {
    /* 读不到就用默认位置，不算错误 */
  }
  return {};
}

/**
 * @param {object} options
 * @param {object} [options.repository] 用来记住"上次窗子拖到哪"（可省略）
 * @param {Function} [options.notify] 出错时跟用户说一声
 * @param {Function} [options.onOpen] 打开时回调（用来刷新数据）
 */
export function createFloatingWindow({ repository, notify, onOpen } = {}) {
  const saved = readUiState(repository);
  const initialViewport = viewportOf();

  let layout = pickLayout(initialViewport);
  let geometry = clampGeometry(
    saved.geometry ?? defaultWindowGeometry(layout, initialViewport),
    layout,
    initialViewport,
  );
  let fabPos = clampFabPosition(saved.fab ?? defaultFabPosition(layout, initialViewport), initialViewport);
  let open = saved.open === true;
  let mounted = false;
  let visible = true;
  let saveTimer = null;
  let resizeTimer = null;
  let lastFocus = null;

  // ---- 元素 ----
  const fabDot = el('span', { class: 'ilb-fab-dot ilb-dot-idle', 'aria-hidden': 'true' });
  const fab = el(
    'button',
    {
      type: 'button',
      class: 'ilb-fab',
      title: '世界书（ILB）',
      'aria-label': '打开世界书控制器',
      'aria-expanded': 'false',
    },
    [el('span', { class: 'ilb-fab-glyph', text: '书' }), fabDot],
  );

  const titleNode = el('div', { class: 'ilb-window-title', text: '世界书 · ILB' });
  const layoutNode = el('div', { class: 'ilb-window-sub' });
  const closeBtn = el('button', { type: 'button', class: 'ilb-window-x', 'aria-label': '关闭', title: '关闭', text: '×' });
  const head = el('div', { class: 'ilb-window-head' }, [
    el('div', { class: 'ilb-window-titles' }, [titleNode, layoutNode]),
    el('div', { class: 'ilb-window-tools' }, [helpButton('fab', '这个浮窗怎么用'), closeBtn]),
  ]);
  const body = el('div', { class: 'ilb-window-body' });
  const win = el(
    'div',
    { class: 'ilb-window', role: 'dialog', 'aria-label': '世界书 ILB 控制器', 'aria-hidden': 'true' },
    [head, body],
  );

  // ---- 状态保存 ----
  function persistNow() {
    if (!repository || typeof repository.saveUiState !== 'function') return;
    try {
      repository.saveUiState({ open, geometry, fab: fabPos, layout });
    } catch {
      /* 记住窗口位置失败不该影响使用 */
    }
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      persistNow();
    }, SAVE_DELAY);
  }

  // ---- 摆放 ----
  function applyGeometry() {
    win.style.left = `${geometry.x}px`;
    win.style.top = `${geometry.y}px`;
    win.style.width = `${geometry.w}px`;
    win.style.height = `${geometry.h}px`;
  }

  function applyFab() {
    fab.style.left = `${fabPos.x}px`;
    fab.style.top = `${fabPos.y}px`;
  }

  function applyOpenState() {
    if (!document.body) return;
    win.classList.toggle('ilb-window-open', open);
    win.setAttribute('aria-hidden', open ? 'false' : 'true');
    fab.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function applyLayout() {
    const viewport = viewportOf();
    layout = pickLayout(viewport);
    geometry = clampGeometry(geometry, layout, viewport);
    fabPos = clampFabPosition(fabPos, viewport);
    win.classList.add('ilb-window-desktop');
    applyGeometry();
    applyFab();
    applyOpenState();
    layoutNode.textContent = describeLayout(layout);
  }

  // ---- 开关 ----
  function openWindow() {
    if (open) return;
    open = true;
    lastFocus = document.activeElement;
    applyLayout();
    try {
      closeBtn.focus({ preventScroll: true });
    } catch {
      /* 聚焦失败无所谓 */
    }
    scheduleSave();
    if (typeof onOpen === 'function') {
      try {
        onOpen();
      } catch (err) {
        console.warn('[ILB] 打开浮窗时的回调出错', err);
      }
    }
  }

  function closeWindow() {
    if (!open) return;
    open = false;
    applyOpenState();
    scheduleSave();
    try {
      if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus({ preventScroll: true });
      else fab.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
  }

  function toggle() {
    if (open) closeWindow();
    else openWindow();
  }

  // ---- 拖动 ----
  function makeDrag(handle, handlers = {}) {
    const { onStart, onMove, onEnd, skipInteractive = true } = handlers;
    let start = null;
    let moved = false;

    on(handle, 'pointerdown', (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      if (skipInteractive) {
        const target = event.target;
        if (target && typeof target.closest === 'function' && target.closest('button, a, input, select, textarea')) return;
      }
      start = { x: event.clientX, y: event.clientY };
      moved = false;
      try {
        handle.setPointerCapture(event.pointerId);
      } catch {
        /* 不支持捕获也不影响拖动 */
      }
      if (typeof onStart === 'function') onStart();
    });

    on(handle, 'pointermove', (event) => {
      if (!start) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (!moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
      moved = true;
      if (typeof onMove === 'function') onMove(dx, dy);
      if (event.cancelable) event.preventDefault();
    });

    const finish = (event) => {
      if (!start) return;
      try {
        handle.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      start = null;
      if (typeof onEnd === 'function') onEnd(moved);
    };
    on(handle, 'pointerup', finish);
    on(handle, 'pointercancel', finish);
  }

  function bindDrag() {
    // 悬浮球：拖动是"挪个位置"，不拖就是"点一下打开"。
    let fabBase = null;
    makeDrag(fab, {
      skipInteractive: false,
      onStart: () => {
        fabBase = { ...fabPos };
      },
      onMove: (dx, dy) => {
        if (!fabBase) return;
        fabPos = clampFabPosition({ x: fabBase.x + dx, y: fabBase.y + dy }, viewportOf());
        applyFab();
      },
      onEnd: (moved) => {
        fabBase = null;
        if (moved) scheduleSave();
        else toggle();
      },
    });

    // 窗口标题栏：拖动挪位置。
    let winBase = null;
    makeDrag(head, {
      skipInteractive: true,
      onStart: () => {
        winBase = { ...geometry };
      },
      onMove: (dx, dy) => {
        if (!winBase) return;
        geometry = clampGeometry({ ...winBase, x: winBase.x + dx, y: winBase.y + dy }, layout, viewportOf());
        applyGeometry();
      },
      onEnd: (moved) => {
        winBase = null;
        if (moved) scheduleSave();
      },
    });
  }

  function bindResize() {
    // 用户拖窗子右下角改大小：ResizeObserver 比 poll 尺寸更省事。
    if (typeof ResizeObserver === 'function') {
      try {
        const observer = new ResizeObserver(() => {
          if (!mounted || !open || !visible) return;
          const w = Math.round(win.offsetWidth);
          const h = Math.round(win.offsetHeight);
          if (!w || !h) return;
          if (w !== geometry.w || h !== geometry.h) {
            geometry = clampGeometry({ ...geometry, w, h }, layout, viewportOf());
            scheduleSave();
          }
        });
        observer.observe(win);
      } catch (err) {
        console.warn('[ILB] 窗口尺寸监听没装上（不影响使用）', err);
      }
    }

    on(globalThis, 'resize', () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = null;
        applyLayout();
        scheduleSave();
      }, RESIZE_DELAY);
    });
    on(globalThis, 'orientationchange', applyLayout);
  }

  function bind() {
    bindDrag();
    bindResize();
    // 注意：悬浮球"点一下打开"是靠 pointerup 里判断"有没有拖动"实现的，
    // 这里不要再加 click 监听，否则一次点击会开关两次。
    on(closeBtn, 'click', closeWindow);
    on(document, 'keydown', (event) => {
      if (event.key !== 'Escape' || !open) return;
      if (isOverlayOpen()) return; // 先关浮层，再关窗口
      event.preventDefault();
      closeWindow();
    });
  }

  // ---- 对外 ----
  function mount() {
    if (mounted) return true;
    if (!document.body) {
      console.warn('[ILB] 页面还没准备好，浮窗没有挂上');
      return false;
    }
    try {
      document.body.appendChild(win);
      document.body.appendChild(fab);
    } catch (err) {
      console.error('[ILB] 浮窗挂载失败', err);
      return false;
    }
    mounted = true;
    applyLayout();
    bind();
    return true;
  }

  /** 把面板塞进窗子里。面板自己负责画内容。 */
  async function attachPanel(panel) {
    if (!panel || typeof panel.mount !== 'function') return false;
    try {
      const result = await panel.mount(body);
      return result !== false;
    } catch (err) {
      console.error('[ILB] 面板没能挂进浮窗', err);
      if (typeof notify === 'function') notify(`界面加载失败：${err?.message ?? err}`, 'error');
      return false;
    }
  }

  /** 悬浮球上的小圆点：绿=这轮有内容，黄=这轮空，红=出错。 */
  function setStatus(kind = 'idle', tip = '') {
    const map = { idle: 'ilb-dot-idle', ok: 'ilb-dot-ok', wait: 'ilb-dot-warn', error: 'ilb-dot-error' };
    fabDot.className = `ilb-fab-dot ${map[kind] ?? map.idle}`;
    if (tip) fab.title = `世界书（ILB）— ${tip}`;
  }

  function refresh() {
    if (open && typeof onOpen === 'function') {
      try {
        onOpen();
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * 整壳显隐。手机布局下电脑这套要整体让位——不是销毁，切回电脑布局时位置和状态原样还在。
   * 用内联 display 而不是 hidden：.ilb-window-open / .ilb-fab 这些类里的 display 会盖过 [hidden]。
   */
  function setVisible(next) {
    visible = Boolean(next);
    if (!visible && open) closeWindow();
    for (const node of [win, fab]) {
      if (node) node.style.display = visible ? '' : 'none';
    }
    return visible;
  }

  return {
    mount,
    attachPanel,
    open: openWindow,
    close: closeWindow,
    toggle,
    isOpen: () => open,
    layout: () => layout,
    body,
    setStatus,
    setVisible,
    refresh,
    describe: () => ({
      open,
      visible,
      layout,
      geometry: { ...geometry },
      fab: { ...fabPos },
      mounted,
    }),
  };
}
