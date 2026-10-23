// ui/help.js —— 帮助浮层。规格里要求"每个页面都有帮助按钮"（ILB-6.4），
// 所以把这件事做成一份公共件，而不是每个界面各写一遍。
// 文案不写在这里：全部来自 data/help/<locale>.json，改文案不用动代码。

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

export function isOverlayOpen() {
  return current !== null;
}

export function closeOverlay() {
  if (!current) return;
  try {
    document.removeEventListener('keydown', current.onKey);
    current.overlay.remove();
    document.body.classList.remove('ilb-locked');
  } catch {
    /* ignore */
  }
  current = null;
}

/**
 * 自愈：如果这一层浮层的样式没生效（浏览器缓存了旧 CSS、主题把它覆盖掉、
 * 选择器被别的扩展改掉），浮层可能变成 0 尺寸或被 display:none 藏起来。
 * 那时用户看到的就是"点了按钮没有任何反应"，而控制台一片安静——最难查的那种坏法。
 * 所以这里不猜，量一次：真坏了就用内联样式把它撑起来，至少让人能看见内容。
 */
function ensureVisible(overlay, modal) {
  if (typeof getComputedStyle !== 'function') return;
  const check = () => {
    try {
      const rect = overlay.getBoundingClientRect();
      const style = getComputedStyle(overlay);
      const broken =
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.position !== 'fixed' ||
        rect.width < 8 ||
        rect.height < 8;
      if (!broken) return;
      console.warn('[ILB] 浮层样式没有生效（可能加载了旧的 style.css），已用内联样式兜底。建议强制刷新页面。');
      overlay.style.cssText =
        'position:fixed;inset:0;display:flex;align-items:flex-start;justify-content:center;' +
        'overflow-y:auto;box-sizing:border-box;padding:16px;background:rgba(0,0,0,0.55);z-index:2147483000';
      modal.style.cssText =
        'margin:auto;width:100%;max-width:min(92vw,640px);max-height:calc(100vh - 32px);overflow-y:auto;' +
        'background:var(--SmartThemeBlurTintColor,#1e1e1e);color:inherit;border:1px solid #555;border-radius:8px';
    } catch {
      /* 量不出来就算了，不能因为兜底逻辑把浮层本身弄坏 */
    }
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(check));
  else setTimeout(check, 0);
}

/**
 * 弹一层浮层。节点自备，这里只负责"居中、可关、Esc 能走"。
 *
 * 关闭按钮用"×"而不是文字"关闭"：手机上文字按钮要么被挤到换行，
 * 要么在标题很长时把标题压成一条缝（ILB-6.14.3）。
 *
 * @param {{title?:string, nodes?:Array, footer?:Array, wide?:boolean}} options
 */
export function openOverlay({ title = '', nodes = [], footer = [], wide = false } = {}) {
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
    // 手机下落层后面的页面还能滚，手指一划就把浮层顶走；锁住（只在窄屏生效，见 style.css）。
    document.body.classList.add('ilb-locked');
    if (typeof modal.focus === 'function') modal.focus({ preventScroll: true });
    console.info(`[ILB] 浮层已打开：${title || '(无标题)'}`);
    ensureVisible(overlay, modal);
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
