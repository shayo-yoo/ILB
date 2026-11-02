// ui/menu.js —— 卡片「⋯」的弹出菜单。
//
// 为什么不再把菜单放在卡片里：v0.25 之前菜单是绝对定位在卡片内的，一旦卡片靠近
// 浮窗底部，下半截会被 `.ilb-window { overflow: hidden }` 裁掉。被裁掉的那段
// 既看不见、也点不到——真实鼠标点下去会落到浮窗下面的聊天楼层上。v0.26 起改为
// **portal**：菜单挂到 body（手机挂进打开着的 <dialog class="ilb-m">，那是最上层），
// 用 fixed 定位按锚点算位置，并夹在视口内。

import { el } from './widgets.js';

let current = null;

function layerNode() {
  try {
    const dialog = document.querySelector('dialog.ilb-m');
    if (dialog && dialog.open) return dialog;
  } catch {
    /* 没有 document 时走下面的兜底 */
  }
  return document.body;
}

function clamp(value, min, max) {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function unbind() {
  if (!current) return;
  const { onDown, onScroll, onResize, onKey } = current;
  try {
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('scroll', onScroll, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
  } catch {
    /* 测试桩没有这些方法时忽略 */
  }
}

/** 收起当前菜单（没有就什么也不做）。 */
export function closeMenu() {
  if (!current) return;
  unbind();
  try {
    current.node.remove();
  } catch {
    /* 假 DOM 也实现了 remove；真异常不该拖垮调用方 */
  }
  current = null;
}

export function isMenuOpen() {
  return current !== null;
}

/**
 * 在 anchor 旁打开一个菜单。
 * @param {Element} anchor 触发按钮
 * @param {Array<{label:string, onClick?:Function, disabled?:boolean, danger?:boolean, title?:string}>} items
 * @param {{align?:'left'|'right'}} [opts]
 */
export function openMenu(anchor, items, opts = {}) {
  // 再点同一个按钮＝收起：真实按钮的点击也会走这里。
  if (current && current.anchor === anchor) {
    closeMenu();
    return null;
  }
  closeMenu();
  const node = el('div', { class: 'ilb-menu ilb-menu-pop', role: 'menu' },
    items.filter(Boolean).map((item) => el('button', {
      type: 'button',
      class: `ilb-menu-item${item.danger ? ' ilb-menu-danger' : ''}`,
      text: item.label,
      title: item.title || item.label,
      disabled: item.disabled === true,
      role: 'menuitem',
      onclick: (event) => {
        event.stopPropagation();
        closeMenu();
        item.onClick?.();
      },
    })));
  node.style.position = 'fixed';
  node.style.visibility = 'hidden';
  layerNode().appendChild(node);

  // 先量再摆：菜单宽度由内容决定，位置要夹在视口里。
  const rect = anchor?.getBoundingClientRect?.() ?? { left: 8, right: 8, top: 8, bottom: 8, width: 0, height: 0 };
  const winW = Number(globalThis.innerWidth) || 1280;
  const winH = Number(globalThis.innerHeight) || 800;
  const menuRect = node.getBoundingClientRect?.() ?? { width: 160, height: 0 };
  const gap = 4;
  const margin = 8;

  let left = opts.align === 'right' ? rect.right - menuRect.width : rect.left;
  left = clamp(left, margin, winW - menuRect.width - margin);

  let top = rect.bottom + gap;
  const below = winH - top - margin;
  if (below < menuRect.height && rect.top - gap - margin > below) {
    top = Math.max(margin, rect.top - gap - menuRect.height);
  }
  top = clamp(top, margin, Math.max(margin, winH - menuRect.height - margin));

  node.style.left = `${Math.round(left)}px`;
  node.style.top = `${Math.round(top)}px`;
  node.style.maxHeight = `${Math.round(winH - margin * 2)}px`;
  node.style.visibility = 'visible';

  const onDown = (event) => {
    if (!current) return;
    if (node.contains?.(event.target)) return;
    if (anchor?.contains?.(event.target)) return;
    closeMenu();
  };
  const onScroll = (event) => {
    if (node.contains?.(event.target)) return;
    closeMenu();
  };
  const onResize = () => closeMenu();
  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeMenu();
    }
  };

  try {
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
  } catch {
    /* 同上 */
  }

  current = { node, anchor, onDown, onScroll, onResize, onKey };
  return node;
}
