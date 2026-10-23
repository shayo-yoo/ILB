// ui/settings-card.js —— 扩展设置页里那块"小卡片"。
// 只放最常改的两三个开关，其余功能都在悬浮球里（这是用户的要求，也是它存在的理由）。
// 这块卡片不画书架、不画规则表：它只负责"让你一眼看到状态、并能直接关掉它"。

import { el } from './dom.js';
import { helpButton } from './help.js';

function safeCall(fn, fallback) {
  try {
    const value = fn();
    return value === undefined || value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

/**
 * @param {object} options
 * @param {object} options.repository
 * @param {object} [options.pipeline]
 * @param {Function} options.openWindow 打开悬浮窗（由 floating.js 提供）
 * @param {Function} [options.notify]
 */
export function createSettingsCard({ repository, pipeline, openWindow, notify } = {}) {
  const root = el('div', { class: 'ilb-root ilb-card' });

  function readSettings() {
    return safeCall(() => repository.getSettings(), {});
  }

  function readSummary() {
    const books = safeCall(() => repository.listBooks(), []);
    const entries = books.reduce((sum, book) => sum + (Array.isArray(book.entries) ? book.entries.length : 0), 0);
    const last = safeCall(() => (pipeline && pipeline.describeLastRun ? pipeline.describeLastRun() : null), null);
    return { books: books.length, entries, last };
  }

  function save(patch) {
    try {
      repository.saveSettings(patch);
    } catch (err) {
      if (typeof notify === 'function') notify(`设置没保存上：${err?.message ?? err}`, 'error');
    }
  }

  function renderSummary(node) {
    const { books, entries, last } = readSummary();
    const pieces = [`${books} 本书`, `${entries} 条规则`];
    if (last && last.ran) {
      const count = Array.isArray(last.activated) ? last.activated.length : 0;
      pieces.push(count > 0 ? `上次注入了 ${count} 条` : '上次一条都没有出现');
    } else {
      pieces.push('还没发过消息');
    }
    node.textContent = pieces.join(' · ');
  }

  function row(label, control, hint) {
    const children = [el('span', { class: 'ilb-card-label', text: label }), control];
    return el('div', { class: 'ilb-card-row' }, [el('div', { class: 'ilb-card-main' }, children), hint ? el('div', { class: 'ilb-hint', text: hint }) : null]);
  }

  function render() {
    root.innerHTML = '';
    const settings = readSettings();
    const enabled = settings.enabled !== false;

    const summaryNode = el('div', { class: 'ilb-card-summary' });
    renderSummary(summaryNode);

    const toggle = el('label', { class: 'ilb-switch' }, [
      el('input', {
        type: 'checkbox',
        ...(enabled ? { checked: true } : {}),
        onchange: (event) => {
          save({ enabled: event.target.checked });
          render();
        },
      }),
      el('span', { text: enabled ? '正在工作' : '已停用' }),
    ]);

    const scan = el('input', {
      type: 'number',
      class: 'ilb-num',
      min: '0',
      max: '30',
      step: '1',
      value: String(settings.scanDepth ?? 3),
      onchange: (event) => {
        const value = Number(event.target.value);
        if (!Number.isFinite(value) || value < 0) {
          render();
          return;
        }
        save({ scanDepth: Math.min(30, Math.round(value)) });
        renderSummary(summaryNode);
      },
    });

    const chain = el('input', {
      type: 'number',
      class: 'ilb-num',
      min: '0',
      max: '10',
      step: '1',
      value: String(settings.maxChainDepth ?? 3),
      onchange: (event) => {
        const value = Number(event.target.value);
        if (!Number.isFinite(value) || value < 0) {
          render();
          return;
        }
        save({ maxChainDepth: Math.min(10, Math.round(value)) });
        renderSummary(summaryNode);
      },
    });

    const openButton = el('button', {
      type: 'button',
      class: 'ilb-btn ilb-btn-primary',
      text: '打开世界书控制器',
      onclick: () => {
        if (typeof openWindow === 'function') openWindow();
        else if (typeof notify === 'function') notify('悬浮窗没有就绪，请刷新页面试试', 'warn');
      },
    });

    root.appendChild(
      el('div', { class: 'ilb-card-head' }, [
        el('div', { class: 'ilb-card-title' }, [el('strong', { text: '世界书 · ILB' }), helpButton('card', '这张卡片上的选项是什么意思')]),
        el('div', { class: enabled ? 'ilb-badge ilb-badge-ok' : 'ilb-badge ilb-badge-warn', text: enabled ? '启用' : '停用' }),
      ]),
    );
    root.appendChild(summaryNode);
    root.appendChild(row('总开关', toggle, enabled ? null : '停用后完全不参与注入，规则和书都还在。'));
    root.appendChild(row('看最近几条消息', scan, '数字越大，越容易翻出旧话题里的设定；3 是默认值。'));
    root.appendChild(row('连锁最多几层', chain, '一个条目被带出来后，它的正文还能再带出别的条目。3 是默认值。'));
    root.appendChild(
      el('div', { class: 'ilb-card-actions' }, [
        openButton,
        el('button', {
          type: 'button',
          class: 'ilb-btn ilb-btn-ghost',
          text: '刷新状态',
          onclick: () => renderSummary(summaryNode),
        }),
      ]),
    );
    root.appendChild(
      el('div', { class: 'ilb-hint', text: '书架、规则表、诊断都在悬浮球里：点屏幕边缘那个圆球就能打开。' }),
    );
  }

  function mount(host) {
    if (!host) {
      console.warn('[ILB] 找不到扩展设置区，设置卡片没有挂上');
      return false;
    }
    try {
      host.appendChild(root);
      render();
      return true;
    } catch (err) {
      root.appendChild(el('p', { class: 'ilb-error', text: `设置卡片渲染出错：${err?.message ?? err}` }));
      return false;
    }
  }

  return { mount, render, element: root };
}
