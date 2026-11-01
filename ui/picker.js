// ui/picker.js —— 可搜索的选择器（v0.24.0）
//
// 原生 <select> 在书上几百条、分组几十个时没法搜索，手机上长列表也很难点。
// 这里统一成一个"按钮 + 浮层（搜索框 + 过滤后的列表）"：书名、逻辑组、分组都用它。
// 组件只负责挑一个值，不读存档、不写数据；挑完把 value 交给调用方。

import { el, button, hint, emptyText } from './widgets.js';

/**
 * @param {object} ctx 面板上下文（要 openOverlay/closeOverlay）
 * @param {object} options
 * @param {string} options.title 浮层标题
 * @param {string} [options.value] 当前值
 * @param {Array<{value:string,label:string,detail?:string,group?:string}>} options.items
 * @param {string} [options.placeholder] 搜索框提示
 * @param {string} [options.empty] 没有匹配时的提示
 * @param {string} [options.hint] 浮层顶部的说明
 * @param {(value:string)=>void} options.onPick 选中回调
 * @param {{label:string,value:string}|null} [options.clear] 可选「清除」项
 */
export function openPicker(ctx, options) {
  const items = Array.isArray(options?.items) ? options.items : [];
  const queryHost = el('div', { class: 'ilb-picker-query' });
  const listHost = el('div', { class: 'ilb-picker-list' });

  function draw(query = '') {
    const words = String(query).trim().toLowerCase().split(/[\s,，、]+/).filter(Boolean);
    const matched = items.filter((item) => {
      if (words.length === 0) return true;
      const hay = `${item.label ?? ''} ${item.detail ?? ''} ${item.group ?? ''}`.toLowerCase();
      return words.every((word) => hay.includes(word));
    });
    listHost.innerHTML = '';
    if (matched.length === 0) {
      listHost.appendChild(emptyText(options.empty ?? '没有匹配的条目。'));
      return;
    }
    let lastGroup = null;
    for (const item of matched) {
      if (item.group && item.group !== lastGroup) {
        listHost.appendChild(el('div', { class: 'ilb-picker-group', text: item.group }));
        lastGroup = item.group;
      }
      const active = String(item.value) === String(options.value ?? '');
      listHost.appendChild(el('button', {
        type: 'button',
        class: `ilb-picker-item${active ? ' ilb-picker-item-on' : ''}`,
        onclick: () => {
          try {
            options.onPick?.(item.value);
          } finally {
            ctx.closeOverlay?.();
          }
        },
      }, [
        el('span', { class: 'ilb-picker-label', text: item.label }),
        item.detail ? el('span', { class: 'ilb-picker-detail', text: item.detail }) : null,
        active ? el('span', { class: 'ilb-picker-check', text: '✓' }) : null,
      ]));
    }
  }

  const input = el('input', {
    class: 'ilb-input ilb-picker-search',
    type: 'search',
    placeholder: options.placeholder ?? '搜索…',
    'aria-label': '搜索',
    oninput: () => draw(input.value),
    onkeydown: (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const first = listHost.querySelector?.('.ilb-picker-item');
      first?.click?.();
    },
  });
  queryHost.appendChild(input);
  if (options.clear) {
    queryHost.appendChild(button(options.clear.label ?? '清除', () => {
      options.onPick?.(options.clear.value ?? '');
      ctx.closeOverlay?.();
    }, { ghost: true }));
  }

  draw('');
  ctx.openOverlay(options.title ?? '选择一个', [
    options.hint ? hint(options.hint) : null,
    el('div', { class: 'ilb-picker' }, [queryHost, listHost]),
  ]);
  try {
    input.focus?.();
  } catch {
    /* 拿不到焦点不影响用 */
  }
}

/** 工具条上的按钮：显示当前值，点开选择器。 */
export function pickerButton(currentLabel, onClick, extras = {}) {
  const label = currentLabel ? `${extras.prefix ?? ''}${currentLabel}` : (extras.placeholder ?? '选择…');
  return el('button', {
    type: 'button',
    class: `ilb-btn ilb-btn-ghost ilb-picker-btn${extras.className ? ` ${extras.className}` : ''}`,
    title: extras.title ?? '点开选择（可搜索）',
    'aria-haspopup': 'dialog',
    onclick: onClick,
  }, [
    el('span', { class: 'ilb-picker-btn-text', text: label }),
    el('span', { class: 'ilb-picker-btn-caret', text: '▾' }),
  ]);
}
