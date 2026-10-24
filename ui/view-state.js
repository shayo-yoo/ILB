// ui/view-state.js —— 状态页（v0.8.0）。
//
// 这里只管"这张聊天记住的一些值"：名字 + 值。条目正文用 {{ILB:chat.名字}} 读它们。
// 不在这里写判断、写表达式、跑脚本——那是条目逻辑流程图的事（D-0043）。
// 值只在本聊天内生效，换聊天互不影响；值是扩展自己的存档，不往聊天正文里塞东西。

import { el, button, hint, emptyText, card, actionRow } from './widgets.js';
import { coerceValue, displayValue } from '../core/vars.js';

function currentChatId(ctx) {
  try {
    if (typeof ctx.getChatId === 'function') return String(ctx.getChatId() || 'default');
  } catch {
    /* 掉到默认 */
  }
  return 'default';
}

function valueKind(value) {
  if (typeof value === 'number') return '数字';
  if (typeof value === 'boolean') return '开关';
  return '文本';
}

export function renderState(ctx) {
  const { repository } = ctx;
  const chatId = currentChatId(ctx);
  let vars = {};
  try {
    vars = repository.getVars(chatId);
  } catch {
    vars = {};
  }
  const names = Object.keys(vars).sort((a, b) => a.localeCompare(b, 'zh-CN'));

  const nameInput = el('input', {
    class: 'ilb-input',
    type: 'text',
    placeholder: '变量名，例如 幸运',
    style: 'max-width:180px',
  });
  const valueInput = el('input', {
    class: 'ilb-input',
    type: 'text',
    placeholder: '值（填 3 就是数字，填「开」是文本）',
  });

  function save(name, rawValue) {
    const key = String(name ?? '').trim();
    if (!key) {
      ctx.toast('先给变量起个名字', 'warn');
      return;
    }
    repository.mergeVars(chatId, { [key]: coerceValue(rawValue) });
    ctx.toast(`已记住「${key}」`);
    ctx.render();
  }

  function remove(name) {
    repository.deleteVar(chatId, name);
    ctx.toast(`已删掉「${name}」`);
    ctx.render();
  }

  const addCard = card([
    el('div', { class: 'ilb-section-title', text: '记一个新的值' }),
    el('div', { class: 'ilb-inline' }, [
      nameInput,
      el('span', { class: 'ilb-inline-eq', text: '=' }),
      valueInput,
      button('记住', () => {
        save(nameInput.value, valueInput.value);
        nameInput.value = '';
        valueInput.value = '';
      }),
    ]),
    hint('值会在下一轮注入时替换条目里的 {{ILB:chat.名字}}。数字可以参与条目逻辑里的加减比较；文本只能原样显示。'),
    hint('只影响这张聊天。换一张聊天，变量表是空的——避免把一张卡的状态串到另一张。'),
  ]);

  const listCard = card([
    el('div', { class: 'ilb-section-title', text: `这张聊天记住了 ${names.length} 个值` }),
    names.length === 0
      ? emptyText('还没有值。上面加一个，或者在条目逻辑里用「记住」节点写一个。')
      : el(
          'div',
          { class: 'ilb-state-table' },
          names.map((name) =>
            el('div', { class: 'ilb-state-row' }, [
              el('span', { class: 'ilb-state-name', text: name }),
              el('span', { class: 'ilb-state-kind', text: valueKind(vars[name]) }),
              el('span', { class: 'ilb-state-value', text: displayValue(vars[name]) }),
              button('改', () => {
                const next = window.prompt(`「${name}」改成什么？当前：${displayValue(vars[name])}`, String(vars[name]));
                if (next === null) return;
                save(name, next);
              }, { ghost: true }),
              button('删', () => remove(name), { ghost: true }),
            ]),
          ),
        ),
  ]);

  return el('div', { class: 'ilb-view' }, [
    el('p', {
      class: 'ilb-view-intro',
      text: '这里放"这张聊天记住的事"。条目正文通过宏读它，不需要把状态重复写进每一条提示词。',
    }),
    addCard,
    listCard,
    actionRow([button('刷新', () => ctx.render(), { ghost: true })]),
  ]);
}
