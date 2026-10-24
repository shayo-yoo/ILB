// narrative/block.js —— 消息末尾那一块"账本"的 DOM（只画，不算）。
//
// 为什么单独一层：聊天区的渲染受宿主控制，消息会被重画、被滑动、被删除。
// 这里提供"造一个块"的纯函数，adapter.js 负责"什么时候造、放哪、何时清掉"，
// 这样画错和算错可以分开查。
//
// 块的定位：挂在 `.mes[mesid]` 的末尾、`.mes_text` 之下。只读，没有任何按钮——
// 手机上误触的代价比"少一个功能"大（D-0038 的同一思路）。

import { el } from '../ui/dom.js';

const KIND_CLASS = {
  ok: 'ilb-narr-ok',
  bad: 'ilb-narr-bad',
  unknown: 'ilb-narr-unknown',
  noop: 'ilb-narr-noop',
};

function itemNode(item) {
  const kindClass = KIND_CLASS[item.kind] ?? 'ilb-narr-noop';
  return el('li', { class: `ilb-narr-item ${kindClass}` }, [
    el('span', { class: 'ilb-narr-mark', text: item.mark ?? '·' }),
    el('span', { class: 'ilb-narr-text', text: item.text }),
    item.reason ? el('span', { class: 'ilb-narr-why', text: item.reason }) : null,
  ]);
}

/**
 * 造一条消息的账本块。
 * @param {{index: number, items: Array, rest: number, summary: string, duplicateNote?: string}} block
 */
export function buildBlock(block) {
  const children = [
    el('div', { class: 'ilb-narr-top' }, [
      el('span', { class: 'ilb-narr-tag', text: '账本' }),
      el('span', { class: 'ilb-narr-summary', text: block.summary ?? '' }),
    ]),
    el('ul', { class: 'ilb-narr-list' }, (block.items ?? []).map(itemNode)),
  ];
  const footBits = [];
  if (block.rest > 0) footBits.push(`另有 ${block.rest} 条未显示`);
  if (block.duplicateNote) footBits.push(block.duplicateNote);
  if (footBits.length) {
    children.push(el('div', { class: 'ilb-narr-foot', text: footBits.join(' · ') }));
  }
  return el('div', {
    class: 'ilb-narr',
    dataset: { mesid: String(block.index) },
  }, children);
}

/** 从聊天区里找出第 mesid 条消息的元素（找不到返回 null，不抛错）。 */
export function messageElement(mesid) {
  try {
    return document.querySelector(`#chat .mes[mesid="${String(mesid)}"]`);
  } catch {
    return null;
  }
}

/** 清掉整个聊天区里由 ILB 画的账本块。 */
export function clearBlocks(root = document) {
  try {
    const nodes = root.querySelectorAll?.('.ilb-narr') ?? [];
    for (const node of nodes) node.remove();
  } catch {
    /* 清不掉不影响下一次重画：重画前也会再清一次 */
  }
}

/** 把块挂到某条消息上；已有旧块先清掉（重画必须幂等）。 */
export function mountBlock(block) {
  const host = messageElement(block.index);
  if (!host) return false;
  try {
    for (const old of host.querySelectorAll('.ilb-narr')) old.remove();
    host.appendChild(buildBlock(block));
    return true;
  } catch {
    return false;
  }
}
