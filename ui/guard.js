// ui/guard.js —— 「有未保存的修改」守卫。
//
// 为什么不用 window.confirm：手机上原生 confirm 可能被宿主拦掉、也不支持
// 「保存并离开」这种中间选项；需求（§6.4 / §6.6）要求离开未保存的编辑时给三选一。
// 这一层只做两件事：
//   1. 记住"现在打开的编辑器有没有改过、怎么保存、怎么放弃"；
//   2. 在真的要离开时弹一个三选一确认层。
// 真正关浮层、切标签、切书的动作仍由调用方在 after 回调里做——守卫不替别人做决定。
//
// 与宿主、核心判定无关；不读存档。可以单独测（tests/guard.test.mjs）。

import { el, on } from './dom.js';

/** @type {{dirty?:Function, save?:Function, discard?:Function, label?:string}|null} */
let current = null;
/** 用户选了「保存并离开 / 放弃修改」之后要执行的"离开动作"（切标签、切书、关窗……）。 */
let afterLeave = null;
let box = null;
let keyHandler = null;

const TITLE = '有未保存的修改';
const TEXT = '离开会丢掉刚才的改动。可以先保存，也可以放弃修改再离开。';

/**
 * 确认层该挂到哪儿。手机整屏界面在浏览器 top layer 里，挂在 body 上的确认层会被
 * 它盖住，所以优先挂进 <dialog class="ilb-m">；但只在它**真的打开**时才挂：
 * 桌面端这个 dialog 也存在、只是关着（display:none），挂进去的确认层会变成 0×0，
 * 用户看到的是"点了没反应"，其实确认层在屏幕外（v0.19.3 真机探针查出来的）。
 * 单独导出是为了能脱离 DOM 单测这条判断。
 */
export function hostFor(doc) {
  if (!doc) return null;
  const mobile = typeof doc.querySelector === 'function' ? doc.querySelector('dialog.ilb-m') : null;
  if (mobile && mobile.open === true) return mobile;
  return doc.body || null;
}

function hostNode() {
  return hostFor(typeof document === 'undefined' ? null : document);
}

function removeBox() {
  if (keyHandler) {
    try {
      document.removeEventListener('keydown', keyHandler, true);
    } catch {
      /* ignore */
    }
    keyHandler = null;
  }
  if (box) {
    try {
      box.remove();
    } catch {
      /* ignore */
    }
    box = null;
  }
}

/** 关掉确认层（不执行任何离开动作）。等于「继续编辑」。 */
export function hide() {
  removeBox();
  afterLeave = null;
}

export function isAsking() {
  return box !== null;
}

/** 当前有没有打开的编辑器（不区分干不干净）。 */
export function hasEditor() {
  return current !== null;
}

/** 当前编辑器是不是改过。编辑器没登记、或者检查函数自己抛错，都按"没改"处理，不能把人锁死。 */
export function isDirty() {
  if (!current || typeof current.dirty !== 'function') return false;
  try {
    return Boolean(current.dirty());
  } catch (err) {
    console.warn('[ILB] 检查未保存状态失败，按"没改"处理', err);
    return false;
  }
}

/**
 * 登记一个编辑器。返回"注销"函数，浮层真正关掉时调用。
 * @param {{dirty:Function, save?:Function, discard?:Function, label?:string}} next
 */
export function registerEditor(next) {
  current = next && typeof next === 'object' ? next : null;
  return () => {
    if (current === next) current = null;
  };
}

export function unregisterEditor() {
  current = null;
}

/**
 * 想离开时先问一声。
 * 没有未保存 → 直接返回 true，调用方继续原动作；
 * 有未保存 → 弹确认层并返回 false，调用方**不要**再执行原动作；
 * 用户选完「保存并离开 / 放弃修改」后，会在 after 里继续原动作。
 *
 * @param {Function} [after] 用户选择离开后要执行的动作
 */
export function allowLeave(after) {
  if (!isDirty()) {
    afterLeave = null;
    return true;
  }
  afterLeave = typeof after === 'function' ? after : null;
  show();
  return false;
}

/** 用「保存并离开 / 放弃修改 / 继续编辑」回答当前这一次询问。 */
export function answer(choice) {
  const entry = current;
  const after = afterLeave;
  removeBox();
  afterLeave = null;
  if (choice === 'save') {
    try {
      entry?.save?.();
    } catch (err) {
      console.error('[ILB] 保存并离开失败', err);
      return false;
    }
    try {
      after?.();
    } catch (err) {
      console.error('[ILB] 保存后的离开动作失败', err);
    }
    return true;
  }
  if (choice === 'discard') {
    try {
      entry?.discard?.();
    } catch (err) {
      console.error('[ILB] 放弃修改时出错', err);
    }
    try {
      after?.();
    } catch (err) {
      console.error('[ILB] 放弃后的离开动作失败', err);
    }
    return true;
  }
  return false;
}

function action(label, choice, kind) {
  const node = el('button', {
    type: 'button',
    class: `ilb-btn ${kind === 'primary' ? 'ilb-btn-primary' : 'ilb-btn-ghost'}`.trim(),
    text: label,
    onclick: () => answer(choice),
  });
  return node;
}

function show() {
  if (box) return;
  const host = hostNode();
  if (!host) return;
  const panel = el('div', { class: 'ilb-guard-box', role: 'document' }, [
    el('p', { class: 'ilb-guard-title', text: TITLE }),
    el('p', { class: 'ilb-guard-text', text: TEXT }),
    el('div', { class: 'ilb-guard-actions' }, [
      action('保存并离开', 'save', 'primary'),
      action('放弃修改', 'discard'),
      action('继续编辑', 'keep'),
    ]),
  ]);
  box = el('div', {
    class: 'ilb-guard',
    role: 'alertdialog',
    'aria-modal': 'true',
    'aria-label': TITLE,
  }, [panel]);
  // 点确认层外面 = 继续编辑（不丢草稿，也不误关）
  on(box, 'click', (event) => {
    if (event.target === box) hide();
  });
  keyHandler = (event) => {
    if (event.key !== 'Escape') return;
    // 确认层在最上面：这一下只关它，不要顺手把下面的编辑器也关掉
    event.preventDefault();
    event.stopPropagation();
    hide();
  };
  try {
    document.addEventListener('keydown', keyHandler, true);
  } catch {
    keyHandler = null;
  }
  host.appendChild(box);
  try {
    box.querySelector?.('.ilb-btn-primary')?.focus?.({ preventScroll: true });
  } catch {
    /* 聚焦失败无所谓 */
  }
}

/** 给诊断页/自检看的状态摘要。 */
export function describe() {
  return {
    editor: Boolean(current),
    dirty: isDirty(),
    asking: isAsking(),
    label: current?.label ?? '',
  };
}
