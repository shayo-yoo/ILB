// ui/flow-editor.js —— 判定流程的树形编辑器（ILB-6.13）
//
// 它不是"连线画布"，而是一层套一层的卡片：
// 每个判断节点下面直接长出「成立时」和「不成立时」两块，块里可以继续放节点。
// 这样在手机上也能编辑——画布上的拖线和端口在手指上根本点不准。

import { el, button, selectBox } from './widgets.js';
import {
  FLOW_KINDS,
  FLOW_KIND_LABEL,
  FLOW_KIND_HINT,
  CONDITION_KINDS,
  CONDITION_KIND_LABEL,
  COMPARE_OPS,
  CALC_OPS,
  OPERAND_TYPES,
  OPERAND_TYPE_LABEL,
  makeNode,
  makeCondition,
  normalizeFlow,
  countFlowNodes,
  describeNode,
} from '../core/flow.js';

const KIND_ITEMS = FLOW_KINDS.map((k) => ({ value: k, label: FLOW_KIND_LABEL[k] }));
const CONDITION_ITEMS = CONDITION_KINDS.map((k) => ({ value: k, label: CONDITION_KIND_LABEL[k] }));
const BRANCH_KINDS = ['test', 'judge', 'compare'];

function input(value, onInput, options = {}) {
  return el('input', {
    class: 'ilb-input',
    type: options.type ?? 'text',
    value: value ?? '',
    placeholder: options.placeholder ?? '',
    oninput: (event) => onInput(event.target.value),
  });
}

function checkbox(checked, onChange, labelText) {
  return el('label', { class: 'ilb-inline ilb-flow-check' }, [
    el('input', { type: 'checkbox', class: 'ilb-check', ...(checked ? { checked: true } : {}), onchange: (e) => onChange(e.target.checked) }),
    el('span', { text: labelText }),
  ]);
}

/**
 * @param {{flow?: object, entries?: Array<{id:string,title:string}>,
 *          onChange?: (flow: object) => void, ctx?: object}} options
 * @returns {HTMLElement}
 */
export function renderFlowEditor(options = {}) {
  const model = normalizeFlow(options.flow);
  const entries = Array.isArray(options.entries) ? options.entries.filter((e) => e && e.id) : [];
  const root = el('div', { class: 'ilb-flow' });

  function notify() {
    if (typeof options.onChange !== 'function') return;
    try {
      options.onChange(normalizeFlow(model));
    } catch (error) {
      // 回调出问题不能把编辑器带崩
      if (typeof console !== 'undefined') console.warn('[ILB] 流程保存回调出错', error);
    }
  }

  // 分支里的操作：只改模型，然后整体重绘（结构变了才重绘，输入不重绘）
  function redraw() {
    root.innerHTML = '';
    const head = el('div', { class: 'ilb-flow-head' }, [
      el('strong', { text: '判定流程' }),
      el('span', { class: 'ilb-hint', text: `共 ${countFlowNodes(model.nodes)} 个节点` }),
    ]);
    root.appendChild(head);
    root.appendChild(
      el('p', {
        class: 'ilb-hint',
        text: '从上往下执行。判断节点不成立时，走进「不成立时」那一块；那里没放东西，这条规则就不出现。一个节点都不放，这条规则就完全按关键词和注入参数工作（跟原生世界书一样）。',
      }),
    );

    root.appendChild(renderNodes(model.nodes, 0));
    root.appendChild(addRow(model.nodes));
  }

  function move(list, index, delta) {
    const next = index + delta;
    if (next < 0 || next >= list.length) return;
    const [item] = list.splice(index, 1);
    list.splice(next, 0, item);
    notify();
    redraw();
  }

  function remove(list, index) {
    list.splice(index, 1);
    notify();
    redraw();
  }

  function addRow(list) {
    let pending = 'test';
    const select = selectBox('test', KIND_ITEMS, (value) => {
      pending = value;
    }, 'ilb-select ilb-flow-kind-select');
    const add = button('＋ 添加一步', () => {
      list.push(makeNode(pending));
      notify();
      redraw();
    }, { ghost: true });
    return el('div', { class: 'ilb-flow-add' }, [select, add]);
  }

  function renderNodes(list) {
    const wrap = el('div', { class: 'ilb-flow-list' });
    if (list.length === 0) {
      wrap.appendChild(el('p', { class: 'ilb-empty', text: '（这条分支里还没有任何步骤）' }));
      return wrap;
    }
    list.forEach((node, index) => {
      wrap.appendChild(renderNode(list, node, index));
    });
    return wrap;
  }

  function renderNode(list, node, index) {
    const card = el('div', { class: `ilb-flow-node ilb-flow-${node.kind}` });
    const head = el('div', { class: 'ilb-flow-node-head' }, [
      el('span', { class: 'ilb-flow-kind', text: FLOW_KIND_LABEL[node.kind] ?? node.kind }),
      el('span', { class: 'ilb-hint', text: describeNode(node) }),
    ]);
    head.appendChild(
      el('div', { class: 'ilb-actions' }, [
        button('↑', () => move(list, index, -1), { ghost: true, disabled: index === 0, title: '上移' }),
        button('↓', () => move(list, index, 1), { ghost: true, disabled: index === list.length - 1, title: '下移' }),
        button('删除', () => remove(list, index), { ghost: true }),
      ]),
    );
    card.appendChild(head);
    card.appendChild(renderBody(node));

    if (BRANCH_KINDS.includes(node.kind)) {
      card.appendChild(renderBranch('✓ 成立时', node.then, '成立时没有后续，就继续往下走'));
      card.appendChild(renderBranch('✗ 不成立时', node.else, '不成立时留空，这条规则就不出现'));
    }
    return card;
  }

  function renderBranch(title, list, emptyHint) {
    const box = el('div', { class: 'ilb-flow-branch' });
    box.appendChild(el('div', { class: 'ilb-flow-branch-title', text: title }));
    if (list.length === 0) box.appendChild(el('p', { class: 'ilb-hint', text: emptyHint }));
    box.appendChild(renderNodes(list));
    box.appendChild(addRow(list));
    return box;
  }

  function renderBody(node) {
    const body = el('div', { class: 'ilb-flow-body' });

    if (node.kind === 'test') {
      body.appendChild(renderCondition(node.condition, true));
      return body;
    }

    if (node.kind === 'judge') {
      body.appendChild(
        el('div', { class: 'ilb-inline' }, [
          el('span', { class: 'ilb-sub', text: '这些条件' }),
          selectBox(node.mode, [
            { value: 'all', label: '全部满足' },
            { value: 'any', label: '满足任意一条' },
          ], (value) => {
            node.mode = value;
            notify();
            redraw();
          }, 'ilb-select'),
        ]),
      );
      node.conditions.forEach((cond, i) => {
        const row = el('div', { class: 'ilb-flow-cond-row' }, [renderCondition(cond, false)]);
        row.appendChild(
          button('移除', () => {
            node.conditions.splice(i, 1);
            if (node.conditions.length === 0) node.conditions.push(makeCondition('contains'));
            notify();
            redraw();
          }, { ghost: true }),
        );
        body.appendChild(row);
      });
      body.appendChild(
        button('＋ 再加一个条件', () => {
          node.conditions.push(makeCondition('contains'));
          notify();
          redraw();
        }, { ghost: true }),
      );
      return body;
    }

    if (node.kind === 'compare') {
      body.appendChild(
        el('div', { class: 'ilb-inline ilb-flow-expr' }, [
          renderOperand(node.left, (next) => {
            node.left = next;
            notify();
            redraw();
          }),
          selectBox(node.op, COMPARE_OPS.map((op) => ({ value: op, label: op })), (value) => {
            node.op = value;
            notify();
          }, 'ilb-select ilb-flow-op'),
          renderOperand(node.right, (next) => {
            node.right = next;
            notify();
            redraw();
          }),
        ]),
      );
      return body;
    }

    if (node.kind === 'define') {
      body.appendChild(
        el('div', { class: 'ilb-inline ilb-flow-expr' }, [
          el('span', { class: 'ilb-sub', text: '变量名' }),
          input(node.name, (value) => {
            node.name = value;
            notify();
          }, { placeholder: '例如 mood' }),
          el('span', { class: 'ilb-sub', text: '等于' }),
          renderOperand(node.value, (next) => {
            node.value = next;
            notify();
            redraw();
          }),
        ]),
      );
      return body;
    }

    if (node.kind === 'calc') {
      body.appendChild(
        el('div', { class: 'ilb-inline ilb-flow-expr' }, [
          el('span', { class: 'ilb-sub', text: '存到' }),
          input(node.target, (value) => {
            node.target = value;
            notify();
          }, { placeholder: '变量名' }),
          el('span', { class: 'ilb-sub', text: '=' }),
          renderOperand(node.left, (next) => {
            node.left = next;
            notify();
            redraw();
          }),
          selectBox(node.op, CALC_OPS.map((op) => ({ value: op, label: op })), (value) => {
            node.op = value;
            notify();
          }, 'ilb-select ilb-flow-op'),
          renderOperand(node.right, (next) => {
            node.right = next;
            notify();
            redraw();
          }),
        ]),
      );
      body.appendChild(
        el('label', { class: 'ilb-inline ilb-flow-persist' }, [
          checkbox(node.persist === true, (checked) => {
            node.persist = checked;
            notify();
          }, '把计算结果存进这张聊天'),
          el('span', { class: 'ilb-sub', text: '存进聊天（下一轮还在；不勾就只是本轮临时值）' }),
        ]),
      );
      return body;
    }

    if (node.kind === 'add') {
      const area = el('textarea', {
        class: 'ilb-textarea',
        rows: 3,
        placeholder: '这段文字会追加在这条规则的正文后面',
        oninput: (event) => {
          node.text = event.target.value;
          notify();
        },
      });
      area.value = node.text ?? '';
      body.appendChild(area);
      return body;
    }

    if (node.kind === 'remember') {
      body.appendChild(
        el('div', { class: 'ilb-inline ilb-flow-expr' }, [
          el('span', { class: 'ilb-sub', text: '记成' }),
          input(node.name, (value) => {
            node.name = value;
            notify();
          }, { placeholder: '例如 金币' }),
          el('span', { class: 'ilb-sub', text: '=' }),
          renderOperand(node.value, (next) => {
            node.value = next;
            notify();
            redraw();
          }),
        ]),
      );
      body.appendChild(
        el('p', {
          class: 'ilb-hint',
          text: '下一轮在条目正文里写 {{ILB:chat.' + (node.name || '名字') + '}} 就能读到这个值；换一张聊天互不影响。',
        }),
      );
      return body;
    }

    if (node.kind === 'activate') {
      if (entries.length > 0) {
        body.appendChild(
          selectBox(node.entryId ?? '', [{ value: '', label: '（选择要一起出现的条目）' }].concat(
            entries.map((e) => ({ value: e.id, label: e.title || e.id })),
          ), (value) => {
            node.entryId = value;
            notify();
          }, 'ilb-select'),
        );
      } else {
        body.appendChild(
          input(node.entryId, (value) => {
            node.entryId = value;
            notify();
          }, { placeholder: '条目 id' }),
        );
      }
      body.appendChild(
        el('p', { class: 'ilb-hint', text: '被点名的条目会跳过关键词与条件直接出现；预算、分组与概率仍然生效。' }),
      );
      return body;
    }

    body.appendChild(el('p', { class: 'ilb-hint', text: FLOW_KIND_HINT[node.kind] ?? '' }));
    return body;
  }

  /** 一条条件（检测节点自带一条；判定节点里有多条） */
  function renderCondition(cond, withKindSelect) {
    const row = el('div', { class: 'ilb-inline ilb-flow-cond' });

    if (withKindSelect) {
      row.appendChild(
        selectBox(cond.what, CONDITION_ITEMS, (value) => {
          const next = makeCondition(value);
          next.id = cond.id;
          Object.keys(cond).forEach((k) => delete cond[k]);
          Object.assign(cond, next);
          notify();
          redraw();
        }, 'ilb-select'),
      );
    }

    if (cond.what === 'contains') {
      row.appendChild(
        input(cond.text, (value) => {
          cond.text = value;
          notify();
        }, { placeholder: '要出现的词' }),
      );
      row.appendChild(
        el('label', { class: 'ilb-inline' }, [
          el('span', { class: 'ilb-sub', text: '最近' }),
          input(cond.within ?? 5, (value) => {
            cond.within = Number(value) || 1;
            notify();
          }, { type: 'number' }),
          el('span', { class: 'ilb-sub', text: '条' }),
        ]),
      );
      row.appendChild(checkbox(cond.negate === true, (value) => {
        cond.negate = value;
        notify();
      }, '反过来（不能出现）'));
      return row;
    }

    if (cond.what === 'regex') {
      row.appendChild(
        input(cond.pattern, (value) => {
          cond.pattern = value;
          notify();
        }, { placeholder: '正则，例如 王城|皇都' }),
      );
      row.appendChild(checkbox(cond.negate === true, (value) => {
        cond.negate = value;
        notify();
      }, '反过来'));
      return row;
    }

    if (cond.what === 'active') {
      if (entries.length > 0) {
        row.appendChild(
          selectBox(cond.entryId ?? '', [{ value: '', label: '（选择一条规则）' }].concat(
            entries.map((e) => ({ value: e.id, label: e.title || e.id })),
          ), (value) => {
            cond.entryId = value;
            notify();
          }, 'ilb-select'),
        );
      } else {
        row.appendChild(input(cond.entryId, (value) => {
          cond.entryId = value;
          notify();
        }, { placeholder: '规则 id' }));
      }
      row.appendChild(checkbox(cond.negate === true, (value) => {
        cond.negate = value;
        notify();
      }, '反过来（要求它没出现）'));
      return row;
    }

    if (cond.what === 'messages') {
      row.appendChild(
        el('label', { class: 'ilb-inline' }, [
          el('span', { class: 'ilb-sub', text: '至少聊够' }),
          input(cond.count ?? 1, (value) => {
            cond.count = Number(value) || 0;
            notify();
          }, { type: 'number' }),
          el('span', { class: 'ilb-sub', text: '条消息' }),
        ]),
      );
      return row;
    }

    row.appendChild(
      input(cond.name, (value) => {
        cond.name = value;
        notify();
      }, { placeholder: '变量名' }),
    );
    row.appendChild(checkbox(cond.negate === true, (value) => {
      cond.negate = value;
      notify();
    }, '反过来（要求它没有值）'));
    return row;
  }

  function renderOperand(op, onChange) {
    const wrap = el('span', { class: 'ilb-inline ilb-flow-operand' });
    const type = op?.type ?? 'text';
    wrap.appendChild(
      selectBox(type, OPERAND_TYPES.map((t) => ({ value: t, label: OPERAND_TYPE_LABEL[t] })), (value) => {
        const next = { type: value };
        if (value === 'var') next.name = op?.name ?? '';
        else if (value === 'number') next.value = Number(op?.value) || 0;
        else next.value = String(op?.value ?? '');
        onChange(next);
      }, 'ilb-select ilb-flow-op'),
    );
    if (type === 'var') {
      wrap.appendChild(input(op?.name, (value) => {
        op.name = value;
        notify();
      }, { placeholder: '变量名' }));
    } else if (type === 'number') {
      wrap.appendChild(input(op?.value ?? 0, (value) => {
        op.value = Number(value) || 0;
        notify();
      }, { type: 'number' }));
    } else {
      wrap.appendChild(input(op?.value, (value) => {
        op.value = value;
        notify();
      }, { placeholder: '文本' }));
    }
    return wrap;
  }

  redraw();
  return root;
}

/** 给规则编辑器用的一行摘要 + 「编辑流程」按钮（ILB-6.13.5） */
export function flowSummary(flow) {
  const nodes = Array.isArray(flow?.nodes) ? flow.nodes : [];
  if (nodes.length === 0) return '没有流程：完全按关键词与注入参数工作（和原生世界书一样）';
  return `${flow.mode === 'only' ? '只看流程' : '关键词 + 流程'}，共 ${countFlowNodes(nodes)} 个节点`;
}
