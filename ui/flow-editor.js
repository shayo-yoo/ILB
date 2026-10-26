// ui/flow-editor.js —— 判定流程的树形编辑器（ILB-6.13）
//
// 它不是"连线画布"，而是一层套一层的卡片：
// 每个判断节点下面直接长出「成立时」和「不成立时」两块，块里可以继续放节点。
// 这样在手机上也能编辑——画布上的拖线和端口在手指上根本点不准。

import { el, button, selectBox, hint } from './widgets.js';
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
  checkUiNode,
} from '../core/flow.js';
import { renderFlowText, parseFlowText, FLOW_TEXT_HINT, FLOW_TEXT_AI_PROMPT, FLOW_TEXT_AI_TAIL } from '../core/flow-text.js';

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
  let model = normalizeFlow(options.flow);
  const entries = Array.isArray(options.entries) ? options.entries.filter((e) => e && e.id) : [];
  const logics = Array.isArray(options.logics) ? options.logics.filter((l) => l && l.id) : [];
  /** 提示（toast）走外面传进来的 ctx；没传就安静跳过，不能因为"没地方弹提示"而抛错 */
  const ctx = options.ctx ?? null;
  const root = el('div', { class: 'ilb-flow' });
  /** 复制缓冲区：只在本编辑器内有效，粘过来会给所有节点换新 id，避免和原来的撞上 */
  let copied = null;
  /** 表单 / 文本两种写法，改的是同一个 model（ILB-4.20） */
  let textMode = false;

  function newId() {
    return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  }

  /** 深拷贝一个节点，并给节点与条件换新 id（复制粘贴后两棵子树互不影响） */
  function cloneFresh(node) {
    const copy = JSON.parse(JSON.stringify(node ?? {}));
    const walk = (n) => {
      if (!n || typeof n !== 'object') return;
      n.id = newId();
      if (Array.isArray(n.conditions)) n.conditions.forEach((c) => { c.id = newId(); });
      ['then', 'else'].forEach((key) => (n[key] ?? []).forEach(walk));
    };
    walk(copy);
    return copy;
  }

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
    head.appendChild(
      button(textMode ? '切回表单' : '文本模式', () => {
        if (textMode) commitText(); // 切回之前，把文本收成节点树
        textMode = !textMode;
        redraw();
      }, { ghost: true, title: '表单和文本改的是同一份流程，随时换着用' }),
    );
    root.appendChild(head);

    if (textMode) {
      root.appendChild(renderTextMode());
      return;
    }

    root.appendChild(
      el('p', {
        class: 'ilb-hint',
        text: '从上往下执行。判断节点不成立时，走进「不成立时」那一块；那里没放东西，这条规则就不出现。一个节点都不放，这条规则就完全按关键词和注入参数工作（跟原生世界书一样）。',
      }),
    );

    root.appendChild(renderNodes(model.nodes, 0));
    root.appendChild(addRow(model.nodes));
  }

  /** 文本模式：和表单改的是同一份 model.nodes，切回去之前用 parseFlowText 收口 */
  function renderTextMode() {
    const box = el('div', { class: 'ilb-flow-text' });
    const area = el('textarea', { class: 'ilb-input ilb-flow-area', spellcheck: 'false' });
    area.value = renderFlowText(model, { entries, logics });
    area.rows = 12;

    const report = el('div', { class: 'ilb-flow-problems' });
    const preview = el('p', { class: 'ilb-hint' });

    const sync = (announce) => {
      const parsed = parseFlowText(area.value, { entries, logics });
      report.innerHTML = '';
      if (parsed.problems.length === 0) {
        report.appendChild(el('p', { class: 'ilb-hint', text: '没有看不懂的行。' }));
      } else {
        for (const p of parsed.problems) {
          report.appendChild(
            el('p', { class: 'ilb-bad', text: `第 ${p.line} 行：${p.reason}` }),
          );
        }
      }
      // 警告不是"看不懂"，而是"看得懂但大概不是你要的"（比如跳转原地打转）
      for (const w of parsed.warnings ?? []) {
        report.appendChild(el('p', { class: 'ilb-warn', text: `第 ${w.line} 行：${w.reason}` }));
      }
      const count = countFlowNodes(parsed.flow.nodes);
      preview.textContent = announce
        ? `已经收下了：${count} 个节点${parsed.problems.length > 0 ? `（${parsed.problems.length} 行没看懂，那几行没生效）` : ''}`
        : `现在能读懂 ${count} 个节点，${parsed.problems.length} 行有问题。`;
      return parsed;
    };

    area.addEventListener('input', () => sync(false));

    box.appendChild(el('p', { class: 'ilb-hint', text: FLOW_TEXT_HINT }));
    box.appendChild(area);
    box.appendChild(
      el('div', { class: 'ilb-actions' }, [
        button('收下这段文本', () => {
          const parsed = sync(true);
          model = parsed.flow;
          notify();
          redraw();
        }, { title: '把文本变成节点树并保存；看不懂的行会列出来' }),
        button('复制给 AI 的说明', () => {
          // 复制是异步的（可能等剪贴板权限），这里必须接住，否则失败会变成"未处理的异步错误"
          copyForAi().catch(() => {});
        }, { ghost: true, title: '复制一段提示词，粘给 AI，它就会按这个格式写' }),
        button('清空', () => {
          area.value = renderFlowText({ mode: model.mode, nodes: [] }, { entries, logics });
          sync(false);
        }, { ghost: true }),
      ]),
    );
    box.appendChild(report);
    box.appendChild(preview);
    sync(false);
    return box;
  }

  /** 把语法说明 + 一句"按这个格式写"复制到剪贴板；剪贴板不可用时退回旧办法。 */
  async function copyForAi() {
    const text = `${FLOW_TEXT_AI_PROMPT}\n${FLOW_TEXT_AI_TAIL}`;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        if (ctx?.toast) ctx.toast('提示词已复制，直接粘给 AI 就行');
        return;
      }
    } catch (error) {
      // 某些 WebView 没给剪贴板权限，往下走兜底
    }
    try {
      const holder = el('textarea', { class: 'ilb-input' });
      holder.value = text;
      holder.style.position = 'fixed';
      holder.style.left = '-9999px';
      document.body.appendChild(holder);
      holder.select();
      const ok = document.execCommand && document.execCommand('copy');
      holder.remove();
      if (ctx?.toast) ctx.toast(ok ? '提示词已复制，直接粘给 AI 就行' : '复制没成功，可以手动选中文本框里的内容');
    } catch (error) {
      if (ctx?.toast) ctx.toast('这个浏览器不让复制，请手动选择文本');
    }
  }

  /** 离开文本模式时把 textarea 里的内容收进 model（没看懂的行不生效，但不静默） */
  function commitText() {
    // redraw 会把 DOM 拆掉，所以这里只能靠最后一次 input 的结果；
    // 保险起见再从当前 textarea 读一次。
    const area = root.querySelector ? root.querySelector('.ilb-flow-area') : null;
    if (!area) return;
    const parsed = parseFlowText(area.value, { entries, logics });
    model = parsed.flow;
    notify();
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

  // 先点「添加一步」，再选是哪一种（以前是下拉里选好了再点添加，顺序反着不好用）
  function addRow(list) {
    const picker = el('div', { class: 'ilb-flow-picker' });
    picker.style.display = 'none';
    for (const kind of FLOW_KINDS) {
      picker.appendChild(
        button(`＋ ${FLOW_KIND_LABEL[kind]}`, () => {
          list.push(makeNode(kind));
          notify();
          redraw();
        }, { ghost: true, title: FLOW_KIND_HINT[kind] ?? '' }),
      );
    }
    const add = button('＋ 添加一步', () => {
      picker.style.display = picker.style.display === 'none' ? 'flex' : 'none';
    }, { ghost: true });

    const row = el('div', { class: 'ilb-flow-add' }, [add, picker]);
    if (copied) {
      row.appendChild(
        button('粘贴步骤', () => {
          list.push(cloneFresh(copied));
          notify();
          redraw();
        }, { ghost: true, title: '把刚才复制的步骤粘到这里' }),
      );
    }
    return row;
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
        button('复制', () => {
          copied = JSON.parse(JSON.stringify(node));
          redraw();
        }, { ghost: true, title: '复制这个步骤（含它下面的分支）' }),
        button('粘贴', () => {
          if (!copied) return;
          list.splice(index + 1, 0, cloneFresh(copied));
          notify();
          redraw();
        }, { ghost: true, disabled: !copied, title: '粘在这条下面' }),
        button('↑', () => move(list, index, -1), { ghost: true, disabled: index === 0, title: '上移' }),
        button('↓', () => move(list, index, 1), { ghost: true, disabled: index === list.length - 1, title: '下移' }),
        button('删除', () => remove(list, index), { ghost: true }),
      ]),
    );
    card.appendChild(head);
    card.appendChild(renderBody(node));

    if (BRANCH_KINDS.includes(node.kind)) {
      card.appendChild(renderBranch('✓ 成立时', node.then, '成立时没有后续，就继续往下走', 'then'));
      card.appendChild(renderBranch('✗ 不成立时', node.else, '不成立时留空，这条规则就不出现', 'else'));
    }
    return card;
  }

  function renderBranch(title, list, emptyHint, tone) {
    const box = el('div', { class: `ilb-flow-branch ilb-flow-branch-${tone ?? 'then'}` });
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

    if (node.kind === 'random') {
      // 随机数（ILB-4.19）：范围 + 是否整数 + 是否存进聊天
      body.appendChild(
        el('div', { class: 'ilb-inline ilb-flow-expr' }, [
          el('span', { class: 'ilb-sub', text: '存到' }),
          input(node.target, (value) => {
            node.target = value;
            notify();
          }, { placeholder: '变量名' }),
          el('span', { class: 'ilb-sub', text: '范围' }),
          input(String(node.min), (value) => {
            node.min = Math.trunc(Number(value) || 0);
            if (node.max < node.min) node.max = node.min;
            notify();
          }, { placeholder: '最小', type: 'number' }),
          el('span', { class: 'ilb-sub', text: '–' }),
          input(String(node.max), (value) => {
            node.max = Math.trunc(Number(value) || 0);
            if (node.max < node.min) node.max = node.min;
            notify();
          }, { placeholder: '最大', type: 'number' }),
        ]),
      );
      body.appendChild(
        el('div', { class: 'ilb-inline ilb-flow-persist' }, [
          checkbox(node.integer !== false, (checked) => {
            node.integer = checked;
            notify();
          }, '要整数'),
          checkbox(node.persist !== false, (checked) => {
            node.persist = checked;
            notify();
          }, '存进聊天（不勾就只是本轮临时值）'),
        ]),
      );
      body.appendChild(hint('同一楼层重画多少次，结果都一样；换楼层才重新掷。'));
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
      const items = [{ value: '', label: '（选择要一起出现的条目或逻辑）' }]
        .concat(entries.map((e) => ({ value: e.id, label: `条目 · ${e.title || e.id}` })))
        .concat(logics.map((l) => ({ value: l.id, label: `逻辑 · ${l.name || l.id}` })));
      if (items.length > 1) {
        body.appendChild(pickSelect(node.entryId, items, (value) => {
          node.entryId = value;
          notify();
        }, '搜索条目或逻辑…'));
      } else {
        body.appendChild(
          input(node.entryId, (value) => {
            node.entryId = value;
            notify();
          }, { placeholder: '条目 id' }),
        );
      }
      body.appendChild(
        el('p', { class: 'ilb-hint', text: '被点名的条目会跳过关键词与条件直接出现；点名独立逻辑时，它也会照常跑完流程。预算、分组与概率仍然生效。' }),
      );
      return body;
    }

    if (node.kind === 'goto') {
      const targets = [{ value: '', label: '（选择跳到哪一步）' }].concat(
        flattenNodes(model.nodes).map((n) => ({ value: n.id, label: `${n.path} · ${FLOW_KIND_LABEL[n.kind] ?? n.kind}` })),
      );
      body.appendChild(
        pickSelect(node.target, targets, (value) => {
          node.target = value;
          notify();
        }, '搜索步骤…'),
      );
      body.appendChild(
        el('div', { class: 'ilb-inline' }, [
          el('span', { class: 'ilb-sub', text: '最多跳' }),
          input(node.max ?? 20, (value) => {
            node.max = Number(value) || 20;
            notify();
          }, { type: 'number' }),
          el('span', { class: 'ilb-sub', text: '次，超了' }),
          selectBox(node.onLimit ?? 'stop', [
            { value: 'stop', label: '直接终止这条流程' },
            { value: 'continue', label: '跳过跳转、接着往下' },
          ], (value) => {
            node.onLimit = value;
            notify();
          }, 'ilb-select'),
        ]),
      );
      body.appendChild(el('p', { class: 'ilb-hint', text: '可以往回跳，也可以在几段逻辑之间来回跑；次数用完按上面选的做，不会死循环。' }));
      return body;
    }

    if (node.kind === 'call') {
      const items = [{ value: '', label: '（选择要调用的逻辑）' }].concat(
        logics.map((l) => ({ value: l.id, label: l.name || l.id })),
      );
      if (items.length > 1) {
        body.appendChild(pickSelect(node.logicId, items, (value) => {
          node.logicId = value;
          notify();
        }, '搜索逻辑…'));
      } else {
        body.appendChild(
          input(node.logicId, (value) => {
            node.logicId = value;
            notify();
          }, { placeholder: '逻辑 id（书id::L::本地id）' }),
        );
      }
      body.appendChild(el('p', { class: 'ilb-hint', text: '把另一条独立逻辑当成这一步来跑：它写的变量、加的正文、点名的条目都会并进来；它不通过，这一步也不通过。' }));
      return body;
    }

    if (node.kind === 'ui') {
      // 「界面」步骤：只填这几格，别的一律不收（ILB-4.21）
      const row = (label, key, opts = {}) => {
        const box = el('label', { class: 'ilb-inline ilb-flow-ui-row' }, [el('span', { class: 'ilb-sub', text: label })]);
        box.appendChild(
          input(node[key] ?? '', (value) => {
            node[key] = value;
            notify();
            redraw();
          }, opts),
        );
        return box;
      };
      body.appendChild(row('翻到哪页', 'page', { placeholder: '页面 id，例如 结果页（留空就不翻页）' }));
      body.appendChild(row('提示一句', 'toast', { placeholder: '底栏提示，例如 SSR！（留空就不提示）' }));
      body.appendChild(row('聚焦控件', 'select', { placeholder: '控件 id，例如 card-3（留空就不聚焦）' }));
      body.appendChild(el('p', { class: 'ilb-sub', text: '问一句（只提示，不会停下来等用户点）' }));
      body.appendChild(row('问题标题', 'askTitle', { placeholder: '例如 确认抽卡？' }));
      body.appendChild(row('问题正文', 'askText', { placeholder: '例如 消耗 10 金币' }));
      body.appendChild(row('按钮文字', 'askOk', { placeholder: '例如 确定（可留空）' }));

      const problems = checkUiNode(node);
      const line = el('p', { class: problems.length > 0 ? 'ilb-warn' : 'ilb-hint', text: problems.length > 0 ? problems.join('；') : describeNode(node) });
      body.appendChild(line);
      body.appendChild(
        el('p', {
          class: 'ilb-hint',
          text: '只有「用户点了按钮来调用这条逻辑」时才会执行；聊天里自动触发时这一步会被跳过（诊断页里能看见）。一次调用只发第一条。',
        }),
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
      const items = [{ value: '', label: '（选择一条规则或逻辑）' }]
        .concat(entries.map((e) => ({ value: e.id, label: `条目 · ${e.title || e.id}` })))
        .concat(logics.map((l) => ({ value: l.id, label: `逻辑 · ${l.name || l.id}` })));
      if (items.length > 1) {
        row.appendChild(pickSelect(cond.entryId, items, (value) => {
          cond.entryId = value;
          notify();
        }, '搜索…'));
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

  /** 所有步骤拍平，给「跳转」当目标列表用；path 是给人看的位置（例如 第 2✓.1 步） */
  function flattenNodes(list, prefix = '', out = []) {
    (Array.isArray(list) ? list : []).forEach((n, i) => {
      const label = prefix ? `${prefix}.${i + 1}` : String(i + 1);
      out.push({ id: n.id, kind: n.kind, path: `第 ${label} 步` });
      flattenNodes(n.then ?? [], `${label}✓`, out);
      flattenNodes(n.else ?? [], `${label}✗`, out);
    });
    return out;
  }

  /** 带搜索框的下拉：条目一多，纯下拉找起来太费眼 */
  function pickSelect(initial, items, onPick, searchPlaceholder) {
    const wrap = el('div', { class: 'ilb-flow-pick' });
    const select = el('select', { class: 'ilb-select' });
    let value = initial ?? '';
    const search = el('input', {
      class: 'ilb-input',
      placeholder: searchPlaceholder ?? '搜索…',
      oninput: (event) => fill(event.target.value),
    });

    function fill(query) {
      const needle = String(query ?? '').trim().toLowerCase();
      const visible = items.filter((it) => !needle
        || String(it.label).toLowerCase().includes(needle)
        || String(it.value).toLowerCase().includes(needle));
      select.innerHTML = '';
      for (const it of visible) select.appendChild(el('option', { value: it.value, text: it.label }));
      if (items.some((it) => it.value === value)) select.value = value;
      else if (visible.length > 0) select.value = visible[0].value;
      value = select.value;
    }

    fill('');
    select.addEventListener('change', (event) => {
      value = event.target.value;
      onPick(value);
    });
    wrap.appendChild(search);
    wrap.appendChild(select);
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
