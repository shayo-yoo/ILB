// ui/panel.js —— 面板外壳：只负责"六页标签 + 分发到对应视图"。
// 判定、存档、注入都不在这里。这样某一页坏掉时，其它页仍然能用（ILB-2.5）。

import { validateBook } from '../core/model.js';
import { el, button, hint } from './widgets.js';
import { loadHelp, showHelp, helpButton, openOverlay, closeOverlay } from './help.js';
import { openGuide } from './guide.js';
import { renderShelf } from './view-shelf.js';
import { renderRules } from './view-rules.js';
import { renderSnapshots } from './view-snapshots.js';
import { renderState } from './view-state.js';
import { renderDiagnostics } from './view-diagnostics.js';
import { renderSettings } from './view-settings.js';
import { openEditor, openPreview } from './editor.js';

const TABS = [
  { id: 'shelf', label: '书架' },
  { id: 'rules', label: '规则' },
  { id: 'snapshots', label: '快照' },
  { id: 'state', label: '状态' },
  { id: 'diagnostics', label: '诊断' },
  { id: 'settings', label: '设置' },
];

const VIEWS = {
  shelf: renderShelf,
  rules: renderRules,
  snapshots: renderSnapshots,
  state: renderState,
  diagnostics: renderDiagnostics,
  settings: renderSettings,
};

// 每页一句话：不是替代「?」里的完整说明，而是让人一进来就知道这页管什么。
const TAB_BLURB = {
  shelf: '所有书都在这里：从原生世界书导入、决定每本书什么时候参与判定。',
  rules: '这本书的条目：什么时候出现、还要满足什么条件、最后放在哪里。',
  snapshots: '把某一刻的开关组合存下来，之后一键切回去；只记开关，不改正文。',
  state: '这一场聊天里的变量和条目字段，随时可看、可改；换聊天会自动换一套。',
  diagnostics: '上一轮每条规则为什么出现、为什么没出现，卡在哪一步。',
  settings: '全局默认值，对所有书生效；不确定就先别动。',
};

export function createPanel(deps) {
  const { repository, nativeWorlds, pipeline, getChatId, notify } = deps;

  const state = {
    activeTab: 'shelf',
    activeBookId: null,
    bookQuery: '',
    ruleQuery: '',
    ruleGroup: '',
    ruleMode: 'all',
    selected: new Set(),
  };

  const root = el('div', { class: 'ilb-root' });

  function toast(message, kind = 'info') {
    if (typeof notify === 'function') {
      try {
        notify(message, kind);
        return;
      } catch {
        /* 提示失败不影响功能 */
      }
    }
    console.log(`[ILB] ${message}`);
  }

  function setTab(tab) {
    if (!VIEWS[tab] || state.activeTab === tab) return;
    state.activeTab = tab;
    render();
  }

  function saveEntries(book) {
    book.entries = (book.entries ?? []).map((entry, index) => ({
      ...entry,
      ui: { ...(entry.ui ?? {}), order: index },
    }));
    repository.saveBook(book);
  }

  const ctx = {
    repository,
    nativeWorlds,
    pipeline,
    getChatId,
    notify,
    state,
    toast,
    render,
    setTab,
    saveEntries,
    validateBook,
    openOverlay: (title, nodes) => openOverlay({ title, nodes }),
    closeOverlay,
    showHelp,
    helpButton,
    openEditor: (book, entry) => openEditor(ctx, book, entry),
    openPreview: (book, entry) => openPreview(ctx, book, entry),
  };

  function drawTab() {
    const bar = el('div', { class: 'ilb-tabs ilb-tabs-fill' }, TABS.map((tab) => el('button', {
      type: 'button',
      class: `ilb-tab ${state.activeTab === tab.id ? 'ilb-tab-active' : ''}`.trim(),
      text: tab.label,
      onclick: () => {
        state.activeTab = tab.id;
        render();
      },
    })));
    // 帮助按钮跟着当前标签走，但文案由 help.js 按 topic 取
    bar.appendChild(el('button', {
      type: 'button',
      class: 'ilb-tab ilb-tab-guide',
      text: '使用说明',
      title: '从零开始的完整说明：能做什么、怎么开始、每个功能在哪',
      onclick: () => {
        openGuide(ctx).catch((err) => {
          console.warn('[ILB] 使用说明打不开', err);
          ctx.notify?.('使用说明没打开：' + (err?.message ?? err), 'error');
        });
      },
    }));
    bar.appendChild(helpButton(state.activeTab));
    return bar;
  }

  function render() {
    try {
      root.innerHTML = '';
      root.appendChild(drawTab());
      const body = el('div', { class: 'ilb-tab-body' });
      const blurb = TAB_BLURB[state.activeTab];
      if (blurb) body.appendChild(el('p', { class: 'ilb-tab-blurb', text: blurb }));
      const view = VIEWS[state.activeTab] ?? renderShelf;
      try {
        body.appendChild(view(ctx));
      } catch (err) {
        console.error('[ILB] 这一页画不出来', err);
        body.appendChild(el('div', { class: 'ilb-card' }, [
          el('p', { class: 'ilb-error', text: `这一页出错了：${err?.message ?? err}` }),
          hint('其它页还能用。把这一行报给开发者即可。'),
          button('重新画一次', () => render(), { ghost: true }),
        ]));
      }
      root.appendChild(body);
    } catch (err) {
      console.error('[ILB] 面板渲染失败', err);
    }
  }

  async function mount(container) {
    try {
      await loadHelp();
    } catch {
      /* 帮助文案读不到也要能开 */
    }
    const host = typeof container === 'string' ? document.querySelector(container) : container;
    if (!host) {
      console.warn('[ILB] 面板没找到挂载点');
      return false;
    }
    host.appendChild(root);
    render();
    return true;
  }

  return {
    mount,
    render,
    toast,
    element: root,
    setTab,
    state,
    // 便于外部（index.js / 命令面板）直接打开某条规则
    openEditor: (book, entry) => openEditor(ctx, book, entry),
    openPreview: (book, entry) => openPreview(ctx, book, entry),
  };
}
