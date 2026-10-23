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
  } catch {
    /* ignore */
  }
  current = null;
}

/**
 * 弹一层浮层。节点自备，这里只负责"居中、可关、Esc 能走"。
 * @param {{title?:string, nodes?:Array, footer?:Array, wide?:boolean}} options
 */
export function openOverlay({ title = '', nodes = [], footer = [], wide = false } = {}) {
  closeOverlay();

  const body = el('div', { class: 'ilb-modal-body' }, nodes);
  const head = el('div', { class: 'ilb-modal-head' }, [
    el('strong', { text: title }),
    el('button', { type: 'button', class: 'ilb-btn ilb-btn-ghost', text: '关闭', onclick: () => closeOverlay() }),
  ]);
  const parts = [head, body];
  if (Array.isArray(footer) && footer.length > 0) parts.push(el('div', { class: 'ilb-modal-foot' }, footer));

  const modal = el('div', { class: wide ? 'ilb-modal ilb-modal-wide' : 'ilb-modal', role: 'dialog', 'aria-modal': 'true' }, parts);
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
