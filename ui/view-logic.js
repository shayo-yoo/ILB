// ui/view-logic.js —— 独立逻辑页（ILB-6.24）
//
// 和规则页分开：规则是"条目什么时候出现"，逻辑是"不用条目也能跑的一段判定"。
// 两边的编辑方式不一样，混在一页里容易看糊涂。

import { el, button, badge, hint, actionRow, downloadJson } from './widgets.js';
import { openLogicEditor } from './logic-editor.js';
import { countFlowNodes } from '../core/flow.js';
import { normalizeLogic, META_LABEL } from '../core/model.js';

export function renderLogicView(ctx) {
  const { repository, state } = ctx;
  const books = repository.listBooks();
  if (books.length === 0) return el('div', { class: 'ilb-empty' }, ['先去书架导入或新建一本书。']);

  const book = books.find((b) => b.book_id === state.activeBookId) ?? books[0];
  if (state.activeBookId !== book.book_id) state.activeBookId = book.book_id;

  const listHost = el('div', { class: 'ilb-logic-list' });

  function describeLogic(logic) {
    const parts = [];
    const any = logic.trigger?.any ?? [];
    const all = logic.trigger?.all ?? [];
    const meta = logic.trigger?.meta ?? 'none';
    if (meta !== 'none') parts.push(META_LABEL[meta] ?? meta);
    if (any.length) parts.push(`出现任一：${any.slice(0, 4).join('、')}`);
    if (all.length) parts.push(`同时出现：${all.slice(0, 4).join('、')}`);
    if (logic.trigger?.source === 'user') parts.push('只看用户');
    if (logic.trigger?.source === 'ai') parts.push('只看 AI');
    if (meta === 'none' && !parts.length) parts.push('没有触发词（只能被调用或激活）');
    const nodes = countFlowNodes(logic.flow?.nodes ?? []);
    if (nodes > 0) parts.push(`${nodes} 个步骤`);
    return parts.join('；');
  }

  function saveBook() {
    repository.saveBook(book);
    draw();
  }

  function removeLogic(logic) {
    if (!window.confirm(`删除逻辑「${logic.name || logic.id}」？`)) return;
    book.logic = (book.logic ?? []).filter((l) => l.id !== logic.id);
    repository.saveBook(book);
    draw();
    ctx.toast('逻辑已删除');
  }

  function importLogic() {
    const picker = el('input', { type: 'file', accept: '.json,application/json' });
    picker.style.display = 'none';
    picker.addEventListener('change', () => {
      const file = picker.files && picker.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(String(reader.result ?? '{}'));
          const rawList = Array.isArray(data) ? data : (Array.isArray(data.logics) ? data.logics : []);
          if (rawList.length === 0) {
            ctx.toast('这个文件里没有逻辑', 'warn');
            return;
          }
          const next = Array.isArray(book.logic) ? book.logic.slice() : [];
          const idMap = new Map();
          const added = [];
          for (const raw of rawList) {
            if (!raw || typeof raw !== 'object') continue;
            const before = String(raw.id ?? '');
            const fixed = normalizeLogic({ ...raw, id: undefined, localId: undefined }, book.book_id);
            if (next.some((l) => l.name === fixed.name && JSON.stringify(l.trigger) === JSON.stringify(fixed.trigger))) continue;
            if (before) idMap.set(before, fixed.id);
            added.push(fixed);
            next.push(fixed);
          }
          const fixTargets = (nodes) => {
            for (const node of Array.isArray(nodes) ? nodes : []) {
              if (node?.target && idMap.has(String(node.target))) node.target = idMap.get(String(node.target));
              fixTargets(node?.then);
              fixTargets(node?.else);
            }
          };
          added.forEach((l) => fixTargets(l.flow?.nodes));
          book.logic = next;
          repository.saveBook(book);
          draw();
          ctx.toast(added.length ? `已导入 ${added.length} 条逻辑` : '没有新逻辑（都和现有的重复）', added.length ? 'info' : 'warn');
        } catch (error) {
          ctx.toast(`这个文件读不了：${error?.message ?? error}`, 'warn');
        } finally {
          picker.remove();
        }
      };
      reader.onerror = () => {
        ctx.toast('读取文件失败', 'warn');
        picker.remove();
      };
      reader.readAsText(file, 'utf-8');
    });
    document.body.appendChild(picker);
    picker.click();
  }

  function draw() {
    listHost.innerHTML = '';
    const items = Array.isArray(book.logic) ? book.logic : [];
    listHost.appendChild(
      el('div', { class: 'ilb-logic-head' }, [
        el('h5', { class: 'ilb-section-title', text: `独立逻辑（不靠条目也能运行，共 ${items.length} 条）` }),
        button('新增逻辑', () => openLogicEditor(ctx, book, null), { ghost: true }),
        button('导出逻辑', () => {
          if (items.length === 0) {
            ctx.toast('这本书还没有逻辑可导出', 'warn');
            return;
          }
          downloadJson(`ilb-logic-${Date.now()}.json`, { kind: 'ilb-logic', version: 1, book: book.name, logics: items });
          ctx.toast(`已导出 ${items.length} 条逻辑`);
        }, { ghost: true }),
        button('导入逻辑', () => importLogic(), { ghost: true }),
      ]),
    );
    if (items.length === 0) {
      listHost.appendChild(hint('独立逻辑和规则的区别：它自己看触发词，不需要先命中一条世界书条目；也可以被别的逻辑「调用」。「每轮都跑」可以当初始化用。不想要就完全不用建，老规则照常工作。'));
      return;
    }
    for (const logic of items) {
      const badges = [];
      if (logic.enabled === false) badges.push(badge('已停用', 'warn'));
      if (logic.call?.exposed) badges.push(badge('AI 可调用', 'ok'));
      if (logic.output?.text) badges.push(badge('有正文'));
      const cardEl = el('div', { class: `ilb-card ilb-logic-card${logic.enabled === false ? ' ilb-card-off' : ''}` }, [
        el('div', { class: 'ilb-rule-head' }, [
          el('div', { class: 'ilb-rule-titles' }, [
            el('div', { class: 'ilb-title', text: logic.name || '未命名逻辑' }),
            el('div', { class: 'ilb-sub', text: describeLogic(logic) }),
          ]),
          el('div', { class: 'ilb-badges' }, badges),
        ]),
        actionRow([
          button('编辑', () => openLogicEditor(ctx, book, logic), { ghost: true }),
          button('试一句', () => {
            ctx.openPreview(book, {
              ...logic,
              title: logic.name,
              content: logic.output?.text ?? '',
              trigger: logic.trigger,
              wait: false,
            });
          }, { ghost: true }),
          button(logic.enabled === false ? '启用' : '停用', () => {
            logic.enabled = logic.enabled === false;
            saveBook();
          }, { ghost: true }),
          button('导出', () => {
            downloadJson(`ilb-logic-${(logic.name || 'logic').replace(/[\\/:*?"<>|]/g, '_')}.json`, {
              kind: 'ilb-logic', version: 1, book: book.name, logics: [logic],
            });
          }, { ghost: true }),
          button('删除', () => removeLogic(logic), { ghost: true }),
        ]),
      ]);
      listHost.appendChild(cardEl);
    }
  }

  draw();
  return el('div', {}, [
    el('div', { class: 'ilb-card' }, [
      hint('逻辑也可以完全不用条目：自己看触发词、每轮都跑、或在 AI 说到某个词时运行。它们和规则共用同一套变量与流程节点。'),
    ]),
    listHost,
  ]);
}
