// ui/mobile.js —— 手机专用界面（v0.5.0 起独立一套，不再复用 ui/floating.js）。
//
// 为什么另写一套而不是继续给浮窗加手机变体：
// 旧做法是"同一套 DOM + 一堆开关"（body.ilb-mobile、.ilb-window-mobile、媒体查询、内联兜底）。
// 手机上报的现象是"点了按钮，界面不出来"。点不出东西的地方可能有三处——判定成电脑布局、
// 触摸事件没落上、或者界面出来了但被盖住/是透明的——三处都在"共用的那一套"里，越兜越难查。
// 这一套只解决一件事：**在手机上，点一下就要看见**。为此做了几个明确的选择：
//  1. 开关只用 click（不用 pointerdown/pointerup 判断"点没点"）：WebView 里 pointer 事件
//     会被滚动/手势取消，pointerup 不来，"点一下"就永远不触发。click 是浏览器保证会来的那个。
//  2. 用原生 <dialog> + showModal()：它进的是浏览器的 top layer，天然盖住一切，
//     不需要跟宿主的 z-index 打仗，也不需要"打开时把自家浮窗藏起来"。
//  3. 尺寸由 JS 按 visualViewport 算，不靠 100vh/媒体查询（手机地址栏会变、WebView 会按桌面宽排版）。
//  4. 次级菜单不再做"居中的弹窗"，而是**在当前整屏里叠一页**（像手机 App 的二级页），
//     所以不存在"弹窗太扁/太窄/跑到屏幕外"这些坏法——直接铺满，左上角返回、右上角关闭。
//  5. 样式自带（ui/mobile-skin.js 注入），关键几何再内联一份。style.css 丢了也照样能用。

import { el, on } from './dom.js';
import { ensureMobileSkin, mobileSkinInfo, MOBILE_SKIN_VERSION } from './mobile-skin.js';
import { describeLayout } from './layout.js';

const FAB_BOTTOM = 76;
const TOAST_MS = 4200;

/** 底色是不是"什么都没有"（ILB-6.18.2：用数值判断，不比字符串）。 */
function isTransparentBackground(value) {
  if (!value) return true;
  if (value === 'transparent') return true;
  const m = /rgba?\(([^)]+)\)/.exec(value);
  if (!m) return false;
  const parts = m[1].split(',').map((s) => Number.parseFloat(s.trim()));
  if (parts.length < 3) return false;
  return parts.length === 4 ? !(parts[3] > 0.01) : false;
}

function describeNode(node) {
  if (!node || node.nodeType !== 1) return '未知元素';
  const id = node.id ? `#${node.id}` : '';
  const cls = typeof node.className === 'string' && node.className.trim()
    ? `.${node.className.trim().split(/\s+/).slice(0, 3).join('.')}`
    : '';
  return `${String(node.tagName || '').toLowerCase()}${id}${cls}`;
}

/**
 * @param {object} options
 * @param {object} [options.repository] 读"上次开没开"之类的界面状态（可省略）
 * @param {Function} [options.notify] 界面上开不了时说话用
 * @param {Function} [options.onOpen] 打开时回调（用来重画面板）
 */
export function createMobileUi({ repository, notify, onOpen, ledger } = {}) {
  let open = false;
  let mounted = false;
  let modalMode = false;
  let locked = false;
  let previousOverflow = '';
  let lastFocus = null;
  let viewportTimer = null;
  let ledgerProvider = typeof ledger === 'function' ? ledger : null;
  const sheets = [];

  // ---- 元素 ----
  const fabDot = el('span', { class: 'ilb-m-dot', 'aria-hidden': 'true' });
  const fab = el('button', {
    type: 'button',
    class: 'ilb-m-fab',
    title: '世界书（ILB）',
    'aria-label': '打开世界书控制器',
    'aria-expanded': 'false',
  }, [el('span', { 'aria-hidden': 'true', text: '书' }), fabDot]);

  const subNode = el('p', { class: 'ilb-m-sub', text: '手机界面 · 整屏' });
  const titleNode = el('h2', { class: 'ilb-m-title', text: '世界书 · ILB' });
  const closeBtn = el('button', {
    type: 'button',
    class: 'ilb-m-x',
    text: '×',
    title: '关闭',
    'aria-label': '关闭',
  });
  const head = el('div', { class: 'ilb-m-head' }, [
    el('div', { class: 'ilb-m-head-text' }, [titleNode, subNode]),
    closeBtn,
  ]);

  // 账本状态坞：只读的一行摘要，点开才看全部。不开叙事引擎时整条隐藏，
  // 这样没开账本的手机上界面与 v0.5.0 长得一模一样。
  const dockText = el('span', { class: 'ilb-m-dock-text', text: '' });
  const dockBtn = el('button', { type: 'button', class: 'ilb-m-dock-open', text: '账本', title: '查看账本' });
  const dock = el('div', { class: 'ilb-m-dock', hidden: true }, [
    el('span', { class: 'ilb-m-dock-tag', text: '账本' }),
    dockText,
    dockBtn,
  ]);

  const panelHost = el('div', { class: 'ilb-m-panel' });
  const sheetsLayer = el('div', { class: 'ilb-m-sheets', 'data-open': '0' });
  const stage = el('div', { class: 'ilb-m-stage' }, [panelHost, sheetsLayer]);
  const toasts = el('div', { class: 'ilb-m-toasts', role: 'status', 'aria-live': 'polite' });
  const dialog = el('dialog', { class: 'ilb-m', 'aria-label': '世界书 ILB 控制器' }, [head, dock, stage, toasts]);

  // "绝不失效"的那几条用内联钉住（ILB-6.17.7 / D-0035）：
  // 位置、铺满、层级、底色、不滚动。其余观感交给 mobile-skin.js。
  Object.assign(dialog.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    right: '0',
    bottom: '0',
    margin: '0',
    padding: '0',
    border: '0',
    width: '100%',
    height: '100%',
    maxWidth: 'none',
    maxHeight: 'none',
    boxSizing: 'border-box',
    display: 'none',
    flexDirection: 'column',
    overflow: 'hidden',
    backgroundColor: '#15151b',
    color: '#eaeaea',
    zIndex: '2147483000',
  });
  Object.assign(panelHost.style, { flex: '1 1 auto', minHeight: '0', overflowY: 'auto' });
  fab.style.bottom = `calc(${FAB_BOTTOM}px + env(safe-area-inset-bottom))`;

  // ---- 视口 ----
  // 不读 100vh：手机地址栏收起/弹出时它会变；iOS 上它还会比看得见的区域高。
  function syncViewport() {
    try {
      if (typeof window === 'undefined') return;
      const vv = window.visualViewport;
      const height = vv && vv.height ? Math.round(vv.height) : Math.round(window.innerHeight || 0);
      const top = vv && typeof vv.offsetTop === 'number' ? Math.round(vv.offsetTop) : 0;
      if (height > 0) {
        dialog.style.top = `${top}px`;
        dialog.style.height = `${height}px`;
        dialog.style.bottom = 'auto';
      }
      const width = vv && vv.width ? Math.round(vv.width) : Math.round(window.innerWidth || 0);
      subNode.textContent = `${describeLayout('mobile')} · ${width}×${height}`;
    } catch {
      /* 量不到就用 CSS 的 100% 顶着 */
    }
  }

  function scheduleViewport() {
    if (viewportTimer) clearTimeout(viewportTimer);
    viewportTimer = setTimeout(() => {
      viewportTimer = null;
      syncViewport();
    }, 120);
  }

  // ---- 锁背景滚动 ----
  function lockScroll() {
    if (locked || typeof document === 'undefined' || !document.body) return;
    try {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      document.body.classList.add('ilb-m-open');
      locked = true;
    } catch {
      /* 锁不住也能用：dialog 本来就铺满 */
    }
  }

  function unlockScroll() {
    if (!locked || typeof document === 'undefined' || !document.body) return;
    try {
      document.body.style.overflow = previousOverflow || '';
      document.body.classList.remove('ilb-m-open');
    } catch {
      /* ignore */
    }
    previousOverflow = '';
    locked = false;
  }

  // ---- 提示条 ----
  function showToast(message, kind = 'info') {
    try {
      const kindClass = kind === 'error' ? ' ilb-m-toast-error' : kind === 'warn' ? ' ilb-m-toast-warn' : '';
      const node = el('div', { class: `ilb-m-toast${kindClass}`, role: 'alert', text: String(message ?? '') });
      toasts.appendChild(node);
      while (toasts.childElementCount > 3) toasts.firstElementChild?.remove();
      setTimeout(() => {
        try {
          node.remove();
        } catch {
          /* ignore */
        }
      }, TOAST_MS);
    } catch {
      /* 提示失败不影响功能 */
    }
  }

  /** 界面开着的时候，提示就发在界面里（宿主 toastr 在顶层下面，看不见）。 */
  function toast(message, kind = 'info') {
    console.info(`[ILB] ${message}`);
    if (open) {
      showToast(message, kind);
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
  }

  // ---- 打开 / 关闭 ----
  function openUi() {
    if (open) return true;
    ensureMobileSkin();
    open = true;
    lastFocus = typeof document !== 'undefined' ? document.activeElement : null;
    try {
      if (!dialog.open && typeof dialog.showModal === 'function') {
        dialog.showModal();
        modalMode = true;
      } else if (!dialog.open) {
        dialog.setAttribute('open', '');
        modalMode = false;
      }
    } catch (err) {
      // 老 WebView 没有 showModal/open 属性语义：退回"普通固定层"，照样铺满。
      console.warn('[ILB] showModal 不可用，改用普通固定层', err);
      try {
        dialog.setAttribute('open', '');
      } catch {
        /* ignore */
      }
      modalMode = false;
    }
    dialog.style.display = 'flex';
    syncViewport();
    lockScroll();
    fab.hidden = true;
    fab.setAttribute('aria-expanded', 'true');
    if (typeof onOpen === 'function') {
      try {
        onOpen();
      } catch (err) {
        console.warn('[ILB] 打开手机界面时的回调出错', err);
      }
    }
    refreshLedger();
    try {
      closeBtn.focus({ preventScroll: true });
    } catch {
      /* 聚焦失败无所谓 */
    }
    console.info(`[ILB] 手机界面已打开（${describeLayout('mobile')}，${modalMode ? 'top layer' : '固定层'}）`);
    audit();
    return true;
  }

  function closeUi() {
    if (!open) return;
    clearSheets();
    open = false;
    try {
      if (modalMode) dialog.close();
      else dialog.removeAttribute('open');
    } catch {
      try {
        dialog.removeAttribute('open');
      } catch {
        /* ignore */
      }
    }
    dialog.style.display = 'none';
    unlockScroll();
    fab.hidden = false;
    fab.setAttribute('aria-expanded', 'false');
    const back = lastFocus;
    lastFocus = null;
    try {
      if (back && typeof back.focus === 'function') back.focus({ preventScroll: true });
      else fab.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
    console.info('[ILB] 手机界面已关闭');
  }

  function toggle() {
    if (open) closeUi();
    else openUi();
  }

  // ---- 浮层栈 ----
  function syncSheetChrome() {
    sheets.forEach((entry, index) => {
      const isTop = index === sheets.length - 1;
      if (isTop) entry.node.removeAttribute('hidden');
      else entry.node.setAttribute('hidden', '');
      const back = entry.node.querySelector('.ilb-m-back');
      if (back) {
        // 第一页的"返回"含义是"回到面板"，所以一直在。
        back.hidden = false;
        back.title = index === sheets.length - 1 && index > 0 ? '返回上一级' : '返回';
      }
    });
    sheetsLayer.setAttribute('data-open', sheets.length > 0 ? '1' : '0');
  }

  function removeAt(index) {
    const entry = sheets[index];
    if (!entry) return;
    sheets.splice(index, 1);
    try {
      entry.node.remove();
    } catch {
      /* ignore */
    }
  }

  function popSheet() {
    if (sheets.length === 0) return false;
    removeAt(sheets.length - 1);
    syncSheetChrome();
    return sheets.length > 0;
  }

  function closeSheet(node) {
    const index = sheets.findIndex((entry) => entry.node === node);
    if (index < 0) return;
    while (sheets.length > index) removeAt(sheets.length - 1);
    syncSheetChrome();
  }

  function clearSheets() {
    while (sheets.length > 0) removeAt(sheets.length - 1);
    sheetsLayer.setAttribute('data-open', '0');
  }

  /** 自愈：浮层开出来了但看不见时，把关键几条内联顶上去。 */
  function auditSheet(entry) {
    const run = () => {
      try {
        const { node } = entry;
        if (!node.isConnected) return;
        const rect = node.getBoundingClientRect();
        const style = typeof getComputedStyle === 'function' ? getComputedStyle(node) : null;
        const reasons = [];
        if (style && style.display === 'none') reasons.push('display=none');
        if (style && style.visibility === 'hidden') reasons.push('visibility=hidden');
        if (rect.width < 8) reasons.push(`宽 ${Math.round(rect.width)}px`);
        if (rect.height < 8) reasons.push(`高 ${Math.round(rect.height)}px`);
        if (style && isTransparentBackground(style.backgroundColor)) reasons.push(`底色透明（${style.backgroundColor}）`);
        if (reasons.length === 0) return;
        console.warn(`[ILB] 手机浮层样式没生效（${reasons.join('，')}），已改用内联样式。`);
        Object.assign(node.style, {
          position: 'absolute',
          inset: '0',
          display: 'flex',
          flexDirection: 'column',
          minWidth: '0',
          backgroundColor: '#181820',
          color: '#eaeaea',
        });
      } catch {
        /* 量不出来就算了 */
      }
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(run));
    else setTimeout(run, 0);
    setTimeout(run, 400);
  }

  /**
   * 开一层浮层。签名与 ui/help.js 的 openOverlay 一致，所以两边可以直接互换。
   * @param {{title?:string, nodes?:Array, footer?:Array, wide?:boolean, key?:string}} options
   */
  function pushSheet({ title = '', nodes = [], footer = [], wide = false, key = null } = {}) {
    if (!open) openUi();
    if (key) {
      for (let i = sheets.length - 1; i >= 0; i -= 1) {
        if (sheets[i].key === key) removeAt(i);
      }
    }
    const body = el('div', { class: 'ilb-m-sheet-body' }, nodes);
    const sheetTitle = el('h3', { class: 'ilb-m-sheet-title', text: title || '说明' });
    const back = el('button', { type: 'button', class: 'ilb-m-back', text: '←', title: '返回', 'aria-label': '返回' });
    const x = el('button', { type: 'button', class: 'ilb-m-x', text: '×', title: '关闭', 'aria-label': '关闭' });
    const sheetHead = el('div', { class: 'ilb-m-sheet-head' }, [back, sheetTitle, x]);
    const parts = [sheetHead, body];
    if (Array.isArray(footer) && footer.length > 0) {
      parts.push(el('div', { class: 'ilb-m-sheet-foot' }, footer));
    }
    const node = el('section', { class: 'ilb-m-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title || '浮层' }, parts);

    on(back, 'click', () => {
      if (sheets.length > 1) popSheet();
      else closeSheet(node);
    });
    on(x, 'click', () => closeSheet(node));

    if (!body.childElementCount) {
      body.appendChild(el('p', {
        class: 'ilb-empty',
        text: '这一层浮层没有内容（可能是渲染时出错了）。请把浏览器控制台里的报错发给开发者。',
      }));
      console.warn('[ILB] 手机上开了一层空浮层');
    }

    sheetsLayer.appendChild(node);
    sheets.push({ node, key, title: title || '说明' });
    syncSheetChrome();
    console.info(`[ILB] 浮层已打开：${title || '(无标题)'}（手机）`);
    auditSheet(sheets[sheets.length - 1]);
    try {
      node.querySelector('.ilb-m-sheet-body')?.focus?.({ preventScroll: true });
    } catch {
      /* ignore */
    }
    return node;
  }

  /** 自愈：整屏界面被宿主样式弄坏时，把关键几条内联顶上去。 */
  function audit() {
    const run = () => {
      try {
        if (!open || !dialog.isConnected) return;
        const rect = dialog.getBoundingClientRect();
        const style = typeof getComputedStyle === 'function' ? getComputedStyle(dialog) : null;
        const reasons = [];
        if (style && style.display === 'none') reasons.push('display=none');
        if (style && style.visibility === 'hidden') reasons.push('visibility=hidden');
        if (rect.width < 8 || rect.height < 8) reasons.push(`尺寸 ${Math.round(rect.width)}×${Math.round(rect.height)}`);
        if (style && isTransparentBackground(style.backgroundColor)) reasons.push(`底色透明（${style.backgroundColor}）`);
        if (reasons.length > 0) {
          console.warn(`[ILB] 手机界面样式没生效（${reasons.join('，')}），已改用内联样式。若反复出现，说明宿主把 <dialog> 改了。`);
          Object.assign(dialog.style, {
            position: 'fixed',
            inset: '0',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: '#15151b',
            color: '#eaeaea',
            zIndex: '2147483000',
          });
        }
        if (typeof document.elementFromPoint !== 'function') return;
        const hit = document.elementFromPoint(
          Math.round((window.innerWidth || 0) / 2),
          Math.round((window.innerHeight || 0) / 2),
        );
        if (hit && !dialog.contains(hit) && hit !== dialog) {
          console.warn(`[ILB] 手机界面正中最上层是「${describeNode(hit)}」，不是它自己。`);
        }
      } catch {
        /* 量不出来就算了 */
      }
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(run));
    else setTimeout(run, 0);
    setTimeout(run, 400);
  }

  // ---- 账本状态坞 ----
  function ledgerData() {
    if (!ledgerProvider) return null;
    try {
      return ledgerProvider();
    } catch (err) {
      console.warn('[ILB] 读账本失败', err);
      return null;
    }
  }

  function refreshLedger() {
    const data = ledgerData();
    const enabled = Boolean(data && data.settings && data.settings.enabled);
    dock.hidden = !enabled;
    if (!enabled) {
      dockText.textContent = '';
      return;
    }
    const plan = data.plan ?? null;
    dockText.textContent = plan?.summary || '账本已打开';
    const t = plan?.totals ?? null;
    if (t && t.facts) {
      dockBtn.textContent = t.rejected ? `账本 · ${t.rejected} 被拒` : `账本 · ${t.facts} 条`;
    } else {
      dockBtn.textContent = '账本';
    }
  }

  function ledgerNodes() {
    const data = ledgerData();
    if (!data) return [el('p', { class: 'ilb-m-note', text: '叙事引擎没接上，账本读不到。' })];
    if (!data.settings || !data.settings.enabled) {
      return [el('p', { class: 'ilb-m-note', text: '账本现在关着。到「设置 → 叙事引擎（账本）」打开开关。' })];
    }
    const plan = data.plan ?? {};
    const nodes = [];
    if (plan.summary) nodes.push(el('p', { class: 'ilb-m-note', text: plan.summary }));
    if (plan.lines && plan.lines.length) {
      nodes.push(el('ul', { class: 'ilb-m-list' }, plan.lines.map((line) => el('li', { text: line.text }))));
    } else {
      nodes.push(el('p', { class: 'ilb-m-note', text: '还没有任何事实进来。' }));
    }
    const t = plan.totals;
    if (t) {
      nodes.push(el('p', {
        class: 'ilb-m-note',
        text: `重放：${t.messages} 条消息 · ${t.facts} 条事实（成功 ${t.ok}、被拒 ${t.rejected}、未认领 ${t.unhandled}、看不懂 ${t.unknown}）`,
      }));
    }
    if (plan.prompt) {
      nodes.push(el('h4', { class: 'ilb-m-note', text: '下一轮注入给模型的文本' }));
      nodes.push(el('pre', { class: 'ilb-m-pre', text: plan.prompt }));
    }
    return nodes;
  }

  function openLedger() {
    pushSheet({ title: '账本', nodes: ledgerNodes(), key: 'ledger' });
  }

  function setLedger(next) {
    ledgerProvider = typeof next === 'function' ? next : null;
    refreshLedger();
  }

  // ---- 状态点 ----
  function setStatus(kind = 'idle', tip = '') {
    const map = { idle: '', ok: ' ilb-m-dot-ok', wait: ' ilb-m-dot-warn', error: ' ilb-m-dot-error' };
    fabDot.className = `ilb-m-dot${map[kind] ?? ''}`;
    if (tip) fab.title = `世界书（ILB）— ${tip}`;
  }

  // ---- 对外 ----
  function bind() {
    on(fab, 'click', () => {
      // 只认 click。手指点一下必然产生 click；pointer 事件在 WebView 里可能被手势取消。
      try {
        openUi();
      } catch (err) {
        console.error('[ILB] 手机界面没能打开', err);
        toast(`界面没能打开：${err?.message ?? err}`, 'error');
      }
    });
    on(closeBtn, 'click', () => closeUi());
    on(dockBtn, 'click', () => {
      try {
        openLedger();
      } catch (err) {
        console.error('[ILB] 账本没能打开', err);
      }
    });
    on(dialog, 'cancel', (event) => {
      // Esc / 安卓返回键：有浮层先退浮层，没有就关整屏。
      event.preventDefault();
      if (sheets.length > 0) popSheet();
      else closeUi();
    });
    on(dialog, 'close', () => {
      if (open) closeUi();
    });
    on(dialog, 'click', (event) => {
      // 点 ::backdrop（顶层里它算 dialog 自己）时先退浮层，不直接关整屏。
      if (event.target === dialog && sheets.length > 0) popSheet();
    });
    on(globalThis, 'resize', scheduleViewport);
    on(globalThis, 'orientationchange', () => {
      scheduleViewport();
      audit();
    });
    try {
      const vv = typeof window !== 'undefined' ? window.visualViewport : null;
      if (vv && typeof vv.addEventListener === 'function') {
        vv.addEventListener('resize', scheduleViewport);
        vv.addEventListener('scroll', scheduleViewport);
      }
    } catch {
      /* 没有 visualViewport 就靠 resize */
    }
  }

  function mount() {
    if (mounted) return true;
    if (typeof document === 'undefined' || !document.body) {
      console.warn('[ILB] 页面还没准备好，手机界面没有挂上');
      return false;
    }
    ensureMobileSkin();
    try {
      document.body.appendChild(dialog);
      document.body.appendChild(fab);
    } catch (err) {
      console.error('[ILB] 手机界面挂载失败', err);
      return false;
    }
    mounted = true;
    bind();
    syncViewport();
    return true;
  }

  /** 把面板塞进整屏里。面板自己负责画内容（书架/规则/快照/诊断/设置）。 */
  async function attachPanel(panel) {
    if (!panel || typeof panel.mount !== 'function') return false;
    try {
      const result = await panel.mount(panelHost);
      return result !== false;
    } catch (err) {
      console.error('[ILB] 面板没能挂进手机界面', err);
      toast(`界面加载失败：${err?.message ?? err}`, 'error');
      return false;
    }
  }

  function setVisible(visible) {
    fab.hidden = !visible;
    if (!visible) closeUi();
  }

  function refresh() {
    refreshLedger();
    if (open && typeof onOpen === 'function') {
      try {
        onOpen();
      } catch {
        /* ignore */
      }
    }
  }

  function describe() {
    let rect = null;
    try {
      rect = dialog.getBoundingClientRect();
    } catch {
      rect = null;
    }
    return {
      open,
      mounted,
      modal: modalMode,
      dock: !dock.hidden,
      sheets: sheets.map((entry) => entry.title),
      skin: mobileSkinInfo(),
      skinVersion: MOBILE_SKIN_VERSION,
      viewport: typeof window !== 'undefined'
        ? { width: Math.round(window.innerWidth || 0), height: Math.round(window.innerHeight || 0) }
        : null,
      dialog: rect ? { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } : null,
    };
  }

  return {
    mount,
    attachPanel,
    open: openUi,
    close: closeUi,
    toggle,
    isOpen: () => open,
    // 给 ui/help.js 当"浮层出口"用（签名与 openOverlay 一致）
    openOverlay: pushSheet,
    closeOverlay: popSheet,
    isOverlayOpen: () => sheets.length > 0,
    clearOverlays: clearSheets,
    toast,
    body: panelHost,
    dialog,
    fab,
    setStatus,
    setVisible,
    refresh,
    refreshLedger,
    setLedger,
    describe,
  };
}
