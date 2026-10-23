// ui/help.js —— 帮助浮层。规格里要求"每个页面都有帮助按钮"（ILB-6.4），
// 所以把这件事做成一份公共件，而不是每个界面各写一遍。
// 文案不写在这里：全部来自 data/help/<locale>.json，改文案不用动代码。

// v0.5.0 起：这里只剩**电脑**那套浮层。手机上不再复用（手机走 ui/mobile.js 的整屏二级页），
// 通过 setOverlayBackend() 把"出口"换掉，调用方一行都不用改。

import { el } from './dom.js';

const DEFAULT_LOCALE = 'zh-cn';

function helpUrl(locale = DEFAULT_LOCALE) {
  return new URL(`../data/help/${locale}.json`, import.meta.url);
}

let cached = null;
let loading = null;

/**
 * 读帮助文案。读失败不抛：帮助坏了不能拖垮主功能，界面上会显示"说明还没写"。
 * @returns {Promise<object>} 形如 { shelf: {title, what, why, how}, ... }
 */
export async function loadHelp(locale = DEFAULT_LOCALE) {
  if (cached) return cached;
  if (loading) return loading;
  loading = (async () => {
    try {
      const res = await fetch(helpUrl(locale), { cache: 'no-cache' });
      cached = res && res.ok ? await res.json() : {};
    } catch {
      cached = {};
    }
    loading = null;
    return cached;
  })();
  return loading;
}

/** 直接把已经读到的文案挂进来（测试或离线时用）。 */
export function primeHelp(dict) {
  cached = dict && typeof dict === 'object' ? dict : {};
  return cached;
}

export function helpText(topic) {
  if (!cached || !topic) return null;
  const item = cached[topic];
  return item && typeof item === 'object' ? item : null;
}

let current = null;

/**
 * 浮层的"出口"可以整个换掉。手机界面（ui/mobile.js）启动时会把自己注册进来，
 * 于是面板、编辑器、导入、自检里那些直接调 openOverlay() 的地方不用改一行，
 * 手机上就自动变成"整屏里叠一页"——不再有"弹窗太窄/太扁/跑到屏幕外"这些坏法。
 * 传 null 恢复成下面这套内置的居中浮层。
 */
let backend = null;

export function setOverlayBackend(next) {
  backend = next && typeof next.openOverlay === 'function' ? next : null;
  return backend;
}

export function getOverlayBackend() {
  return backend;
}

export function isOverlayOpen() {
  if (backend) {
    try {
      if (typeof backend.isOverlayOpen === 'function') return Boolean(backend.isOverlayOpen());
    } catch {
      /* 后端坏了就按内置浮层算 */
    }
  }
  return current !== null;
}

export function closeOverlay() {
  if (backend) {
    try {
      if (typeof backend.closeOverlay === 'function') backend.closeOverlay();
      return;
    } catch (err) {
      console.warn('[ILB] 手机浮层没关掉，改用内置浮层', err);
    }
  }
  if (!current) return;
  try {
    document.removeEventListener('keydown', current.onKey);
    current.overlay.remove();
    document.body.classList.remove('ilb-overlay-open');
  } catch {
    /* ignore */
  }
  current = null;
}

/**
 * 给浮层套一套"内置样式"：不依赖 style.css，也不用主题变量以外的东西。
 * 为什么需要这一步：只修好浮层的几何还不够。用户报过"不薄了，但点了什么都没显示"——
 * 那一层浮层与弹窗其实都开出来了、位置也对，只是**背景是透明的、边框和文字颜色也丢了**，
 * 于是在深色聊天页上看过去就像什么都没发生。判断"看不看得见"不能只量尺寸，还要看底色。
 *
 * 这套皮肤只服务电脑（手机上根本走不到这里：手机浮层由 ui/mobile.js 自己画）。
 */
function applySkin(overlay, modal, why) {
  console.warn(`[ILB] 浮层样式没有生效（${why}），已用内置样式兜底。若反复出现，说明 style.css 没有被加载。`);
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.display = 'flex';
  overlay.style.justifyContent = 'center';
  overlay.style.alignItems = 'flex-start';
  overlay.style.padding = '16px';
  overlay.style.boxSizing = 'border-box';
  overlay.style.overflowY = 'auto';
  overlay.style.background = 'rgba(0,0,0,0.55)';
  overlay.style.zIndex = '2147483000';

  modal.style.margin = 'auto';
  modal.style.width = '100%';
  modal.style.maxWidth = 'min(92vw, 640px)';
  modal.style.minHeight = '160px';
  modal.style.maxHeight = 'calc(100vh - 32px)';
  modal.style.display = 'flex';
  modal.style.flexDirection = 'column';
  modal.style.overflow = 'hidden';
  modal.style.background = 'var(--SmartThemeBlurTintColor, #1e1e1e)';
  modal.style.color = 'var(--SmartThemeBodyColor, #eaeaea)';
  modal.style.border = '1px solid rgba(255,255,255,0.25)';
  modal.style.borderRadius = '8px';
  modal.style.boxShadow = '0 8px 32px rgba(0,0,0,0.5)';

  // 头、正文、关闭按钮也补上最低限度：只给弹窗加底色的话，用户会看到一块
  // 有底色的板子里挤着没有间距的文字，还是会觉得"没显示好"。
  const head = modal.querySelector('.ilb-modal-head');
  if (head) {
    head.style.display = 'flex';
    head.style.alignItems = 'center';
    head.style.justifyContent = 'space-between';
    head.style.gap = '8px';
    head.style.padding = '10px 12px';
    head.style.borderBottom = '1px solid rgba(255,255,255,0.15)';
  }
  const body = modal.querySelector('.ilb-modal-body');
  if (body) {
    body.style.padding = '12px';
    body.style.flex = '1 1 auto';
    body.style.minHeight = '0';
    body.style.overflowY = 'auto';
  }
  const x = modal.querySelector('.ilb-modal-x');
  if (x) {
    x.style.fontSize = '22px';
    x.style.lineHeight = '1';
    x.style.background = 'transparent';
    x.style.border = '0';
    x.style.color = 'inherit';
    x.style.padding = '8px 10px';
    x.style.cursor = 'pointer';
  }
}

/** 背景是不是"什么都没有"。不同浏览器对透明色的写法不一样，所以不比较字符串相等。 */
function isTransparentBackground(value) {
  if (!value) return true;
  if (value === 'transparent') return true;
  const m = /rgba?\(([^)]+)\)/.exec(value);
  if (!m) return false;
  const parts = m[1].split(',').map((s) => Number.parseFloat(s.trim()));
  if (parts.length < 3) return false;
  return parts.length === 4 ? !(parts[3] > 0.01) : false;
}

/**
 * 自愈：如果这一层浮层的样式没生效（浏览器缓存了旧 CSS、主题把它覆盖掉、
 * 选择器被别的扩展改掉），浮层可能变成 0 尺寸、被 display:none 藏起来、或者
 * 干脆变成"透明的一层"——位置尺寸都对，但看不见。
 * 那时用户看到的就是"点了按钮没有任何反应"，而控制台一片安静——最难查的那种坏法。
 * 所以这里不猜，量一次：真坏了就用内联样式把它撑起来，至少让人能看见内容。
 */
function ensureVisible(overlay, modal, bodyNode) {
  if (typeof getComputedStyle !== 'function') return;
  const check = () => {
    try {
      // 已经被关掉了就别再管它：延迟回调可能在浮层移除之后才跑，
      // 那时量到的一定是 0×0、position 也会是 static，会误判成"样式没生效"。
      if (overlay.isConnected === false) return;
      const rect = overlay.getBoundingClientRect();
      const style = getComputedStyle(overlay);
      const reasons = [];
      if (style.display === 'none') reasons.push('display=none');
      if (style.visibility === 'hidden') reasons.push('visibility=hidden');
      if (style.position !== 'fixed') reasons.push(`position=${style.position}`);
      if (rect.width < 8) reasons.push(`宽 ${Math.round(rect.width)}px`);
      if (rect.height < 8) reasons.push(`高 ${Math.round(rect.height)}px`);
      if (reasons.length > 0) {
        applySkin(overlay, modal, reasons.join('，'));
        return;
      }

      // 样式生效了，但还有第三种坏法：**弹窗被压成薄薄一条**。
      // 原因通常是内容还在路上（例如导入列表正在读），或者某条主题规则把高度吃掉了。
      // 这时给它一个下限，至少让人看得出"这是一层浮层，不是页面抽了一下"。
      const modalRect = modal.getBoundingClientRect();
      const minBeauty = Math.min(180, (typeof window !== 'undefined' ? window.innerHeight : 800) * 0.2);
      if (modalRect.height < minBeauty) {
        const floor = '160px';
        console.warn(
          `[ILB] 浮层太扁（高 ${Math.round(modalRect.height)}px，视口 ${window.innerWidth}x${window.innerHeight}），已撑到 ${floor}。`,
        );
        modal.style.minHeight = floor;
      }

      // 第四种坏法：弹窗"在，但看不见"。尺寸可能完全正常，只是底色、边框、
      // 文字颜色全是默认值——在深色页面上就是一片透明。用户原话：
      // "现在不是一小条了，但是点击按钮后，没有页面弹出，或者单纯没有显示。"
      const modalStyle = getComputedStyle(modal);
      const modalReasons = [];
      if (isTransparentBackground(modalStyle.backgroundColor)) {
        modalReasons.push(`弹窗背景是透明的（${modalStyle.backgroundColor}）`);
      }
      if (modalRect.width < 40) modalReasons.push(`弹窗宽 ${Math.round(modalRect.width)}px`);
      if (modalRect.height < 8) modalReasons.push(`弹窗高 ${Math.round(modalRect.height)}px`);
      if (modalReasons.length > 0) applySkin(overlay, modal, modalReasons.join('，'));

      if (bodyNode && bodyNode.children && bodyNode.children.length === 0) {
        bodyNode.appendChild(el('p', {
          class: 'ilb-empty',
          text: '这一层浮层没有内容（可能是渲染时出错了）。请把浏览器控制台里的报错发给开发者。',
        }));
        console.warn('[ILB] 浮层打开了，但正文是空的。');
      }

      // 样式没问题，但"看得见"还有第二种坏法：浮层开出来了，却**被别的东西盖在上面**。
      // 判断方法不猜 z-index，直接问浏览器："屏幕正中间那个点，最上面是谁？"
      if (typeof document.elementFromPoint !== 'function') return;
      const hit = document.elementFromPoint(
        Math.round(window.innerWidth / 2),
        Math.round(window.innerHeight / 2),
      );
      if (!hit || overlay.contains(hit)) return;
      const cover = hit.closest?.('.ilb-window, .ilb-fab') ? 'ILB 自己的浮窗/悬浮球' : describeCover(hit);
      console.warn(`[ILB] 浮层被「${cover}」盖住了，已把浮层提到最上层。`);
      overlay.style.zIndex = '2147483000';
    } catch {
      /* 量不出来就算了，不能因为兜底逻辑把浮层本身弄坏 */
    }
  };
  // 为什么还要一个定时器：requestAnimationFrame 在后台标签页、部分 WebView、
  // 以及无头浏览器里会被节流甚至完全不触发。自愈逻辑本身很便宜，多跑一次没关系，
  // 但不能"因为没等到下一帧就永远不自愈"。
  let ran = false;
  const run = () => {
    if (ran) return;
    ran = true;
    check();
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(run));
  else setTimeout(run, 0);
  setTimeout(run, 400);
}

/** 给"盖住浮层的那个东西"起个人能听懂的名字，便于用户回报。 */
function describeCover(node) {
  if (!node || node.nodeType !== 1) return '未知元素';
  const id = node.id ? `#${node.id}` : '';
  const cls = typeof node.className === 'string' && node.className.trim()
    ? `.${node.className.trim().split(/\s+/).slice(0, 3).join('.')}`
    : '';
  const z = typeof getComputedStyle === 'function' ? getComputedStyle(node).zIndex : '';
  return `${node.tagName.toLowerCase()}${id}${cls}${z && z !== 'auto' ? `（z-index ${z}）` : ''}`;
}

/**
 * 弹一层浮层。节点自备，这里只负责"居中、可关、Esc 能走"。
 *
 * 关闭按钮用"×"而不是文字"关闭"：手机上文字按钮要么被挤到换行，
 * 要么在标题很长时把标题压成一条缝（ILB-6.14.3）。
 *
 * v0.5.0 起：手机上这个函数会把请求转给 ui/mobile.js（整屏二级页），
 * 自己只服务电脑。调用方不需要知道这件事。
 *
 * @param {{title?:string, nodes?:Array, footer?:Array, wide?:boolean}} options
 */
export function openOverlay(options = {}) {
  if (backend) {
    try {
      backend.openOverlay(options);
      return () => closeOverlay();
    } catch (err) {
      console.error('[ILB] 手机浮层没能打开，改用内置浮层', err);
    }
  }
  const { title = '', nodes = [], footer = [], wide = false } = options;
  closeOverlay();

  const body = el('div', { class: 'ilb-modal-body' }, nodes);
  const head = el('div', { class: 'ilb-modal-head' }, [
    el('strong', { class: 'ilb-modal-title', text: title }),
    el('button', {
      type: 'button',
      class: 'ilb-modal-x',
      text: '×',
      title: '关闭',
      'aria-label': '关闭',
      onclick: () => closeOverlay(),
    }),
  ]);
  const parts = [head, body];
  if (Array.isArray(footer) && footer.length > 0) parts.push(el('div', { class: 'ilb-modal-foot' }, footer));

  const modal = el('div', { class: wide ? 'ilb-modal ilb-modal-wide' : 'ilb-modal', role: 'dialog', 'aria-modal': 'true', tabindex: '-1' }, parts);
  const overlay = el('div', { class: 'ilb-overlay' }, [modal]);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeOverlay();
  });

  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeOverlay();
    }
  };
  document.addEventListener('keydown', onKey);

  try {
    document.body.appendChild(overlay);
    // 先钉上几条"绝不能失效"的几何：位置、铺满、层级、最小高度。
    // 为什么用内联而不是靠 CSS：这几条一旦失效，用户看到的就是"点了没反应"或"一条缝"，
    // 而它们恰恰最容易被主题/别的扩展/旧缓存改掉。内联样式谁也抢不走；其余观感仍交给 CSS。
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.display = 'flex';
    overlay.style.zIndex = '2147483000';
    modal.style.minHeight = '160px';
    // 浮层开着的时候，让电脑那套浮窗让开（见 style.css 里 body.ilb-overlay-open 的规则）。
    document.body.classList.add('ilb-overlay-open');
    if (typeof modal.focus === 'function') modal.focus({ preventScroll: true });
    console.info(`[ILB] 浮层已打开：${title || '(无标题)'}（电脑）`);
    ensureVisible(overlay, modal, body);
  } catch (err) {
    console.warn('[ILB] 浮层没能挂上', err);
  }
  current = { overlay, onKey };
  return closeOverlay;
}

/** 三段式说明：这是什么 / 为什么这么设计 / 怎么用。 */
export function showHelp(topic) {
  const item = helpText(topic);
  if (!item) {
    openOverlay({
      title: '说明',
      nodes: [el('p', { class: 'ilb-hint', text: '这一处的说明还没写（属于未完成项，不是出错）。' })],
    });
    return;
  }
  const nodes = [
    el('div', { class: 'ilb-help-what' }, [el('p', { text: item.what ?? '暂无说明。' })]),
  ];
  if (item.why) nodes.push(el('div', { class: 'ilb-help-why' }, [el('p', { text: item.why })]));
  if (item.how) {
    const lines = Array.isArray(item.how) ? item.how : [item.how];
    nodes.push(el('div', { class: 'ilb-help-how' }, lines.map((line) => el('p', { text: String(line) }))));
  }
  openOverlay({ title: item.title ?? '说明', nodes });
}

/** 那个小问号按钮。 */
export function helpButton(topic, label = '这项功能的说明') {
  return el('button', {
    type: 'button',
    class: 'ilb-help',
    text: '?',
    title: label,
    'aria-label': label,
    onclick: () => showHelp(topic),
  });
}
