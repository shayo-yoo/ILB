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
  SET_OPS,
  SET_OP_LABEL,
  SET_OP_FIELDS,
  BRANCHING_KINDS,
  MAX_REPEAT,
  MAX_CANDIDATES,
  makeNode,
  makeCondition,
  normalizeFlow,
  countFlowNodes,
  describeNode,
  describeCondition,
  checkUiNode,
} from '../core/flow.js';
import { validateFlow, summarizeProblems } from '../core/validate.js';
import { renderFlowText, parseFlowText, FLOW_TEXT_HINT, FLOW_TEXT_AI_PROMPT, FLOW_TEXT_AI_TAIL } from '../core/flow-text.js';

const CONDITION_ITEMS = CONDITION_KINDS.map((k) => ({ value: k, label: CONDITION_KIND_LABEL[k] }));
const BRANCH_KINDS = BRANCHING_KINDS.slice();

// 添加器按"用户想干什么"分类（ILB-3.2）：常用动作直接摆出来，冷门的收进「更多」。
// keywords 是给搜索框用的：用户会搜"加 1"、"扣除"、"拼接"、"随机选"、"重复 3 次"。
const ACTION_GROUPS = [
  {
    key: 'condition',
    label: '条件',
    items: [
      { kind: 'test', keywords: '如果 判断 包含 出现 关键词 条件' },
      { kind: 'judge', keywords: '而且 或者 多条条件 全部满足 任意满足' },
      { kind: 'compare', keywords: '比较 大于 小于 等于 不少于 至少 金币 数量' },
      { kind: 'if', keywords: '条件组 嵌套 并且 或者 不是 取反' },
    ],
  },
  {
    key: 'var',
    label: '变量',
    items: [
      { kind: 'set', keywords: '增加 减少 扣除 加 1 减 1 设置 清空 删除 四舍五入 取整 上限' },
      { kind: 'define', keywords: '定义 赋值 初始值 新建变量' },
      { kind: 'remember', keywords: '记住 存下来 记成 持久' },
      { kind: 'calc', keywords: '计算 加减乘除 求和 平均值 最大 最小' },
    ],
  },
  {
    key: 'text',
    label: '文本',
    items: [
      { kind: 'add', keywords: '输出 追加 拼接 正文 提示 插值 模板' },
    ],
  },
  {
    key: 'random',
    label: '随机',
    items: [
      { kind: 'choose', keywords: '随机选 抽一个 候选 随机文本 随机提示' },
      { kind: 'random', keywords: '随机数 骰子 1d6 范围' },
      { kind: 'chance', keywords: '概率 几率 百分比 触发 走运' },
    ],
  },
  {
    key: 'entry',
    label: '条目',
    items: [
      { kind: 'activate', keywords: '激活 带出 一起出现 联动 条目' },
    ],
  },
  {
    key: 'flow',
    label: '流程',
    items: [
      { kind: 'repeat', keywords: '重复 循环 做几次 重复 3 次' },
      { kind: 'stop', keywords: '结束 提前结束 中断 返回 停止' },
      { kind: 'call', keywords: '调用 子逻辑 复用 函数' },
    ],
    more: [
      { kind: 'goto', keywords: '跳转 跳回 回头 高级' },
      { kind: 'pass', keywords: '通过 放行 高级' },
      { kind: 'fail', keywords: '不通过 拒绝 高级' },
      { kind: 'ui', keywords: '界面 翻页 提示 弹窗 高级' },
    ],
  },
];

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
  /** 折叠起来的节点 id（只影响看起来，不影响数据） */
  const collapsed = new Set();
  /** 表单 / 文本两种写法，改的是同一个 model（ILB-4.20） */
  let textMode = false;

  function newId() {
    return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  }

  /** 深拷贝一个节点，并给节点与条件换新 id（复制粘贴后两棵子树互不影响） */
  function cloneFresh(node) {
    const copy = JSON.parse(JSON.stringify(node ?? {}));
    const walkCond = (c) => {
      if (!c || typeof c !== 'object') return;
      if (c.id) c.id = newId();
      (c.children ?? []).forEach(walkCond);
    };
    const walk = (n) => {
      if (!n || typeof n !== 'object') return;
      n.id = newId();
      if (Array.isArray(n.conditions)) n.conditions.forEach(walkCond);
      if (n.condition) walkCond(n.condition);
      if (n.when) walkCond(n.when);
      ['then', 'else', 'body'].forEach((key) => (n[key] ?? []).forEach(walk));
    };
    walk(copy);
    return copy;
  }

  /** 文本语法目前只认这些节点（其余一律只读，见 textUnsupported） */
  const TEXT_KINDS = new Set(['test', 'judge', 'compare', 'define', 'calc', 'random', 'add', 'remember', 'activate', 'goto', 'call', 'ui', 'pass', 'fail']);

  /** 文本语法装不下的节点类型（ILB-7.16：宁可只读，也不静默丢字段） */
  function textUnsupported(nodes, out = new Set()) {
    const walkCond = (c) => {
      if (!c || typeof c !== 'object') return;
      if (c.what === 'group') out.add('条件组');
      (c.children ?? []).forEach(walkCond);
    };
    const walk = (list) => {
      for (const n of Array.isArray(list) ? list : []) {
        if (!TEXT_KINDS.has(n.kind) || n.unknown) out.add(FLOW_KIND_LABEL[n.kind] ?? n.kind);
        if (n.condition) walkCond(n.condition);
        if (n.when) walkCond(n.when);
        (n.conditions ?? []).forEach(walkCond);
        walk(n.then);
        walk(n.else);
        walk(n.body);
      }
    };
    walk(nodes);
    return out;
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
    if (!textMode) {
      head.appendChild(button('全部折叠', () => {
        for (const n of flattenNodes(model.nodes)) collapsed.add(n.id);
        redraw();
      }, { ghost: true }));
      head.appendChild(button('全部展开', () => {
        collapsed.clear();
        redraw();
      }, { ghost: true }));
    }
    root.appendChild(head);

    root.appendChild(renderValidation());

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

  /** 静态检查（ILB-7.17）：只看结构，不跑流程；没问题时只留一行很轻的字 */
  function renderValidation() {
    let result;
    try {
      result = validateFlow(model, { entries, logics });
    } catch (err) {
      return el('p', { class: 'ilb-hint', text: `流程检查没跑起来：${err?.message ?? err}` });
    }
    const problems = result.problems ?? [];
    const errors = problems.filter((p) => p.level === 'error');
    const warns = problems.filter((p) => p.level !== 'error');
    const box = el('div', { class: problems.length ? 'ilb-flow-validate ilb-flow-validate-bad' : 'ilb-flow-validate' });
    box.appendChild(el('span', { class: 'ilb-sub', text: summarizeProblems(result) }));
    if (problems.length > 0) {
      box.appendChild(el('ul', { class: 'ilb-warn-list' }, problems.slice(0, 6).map((p) => el('li', {
        class: p.level === 'error' ? 'ilb-warn' : 'ilb-sub',
        text: `${p.path ? `${p.path}：` : ''}${p.message}`,
      }))));
      if (problems.length > 6) box.appendChild(el('span', { class: 'ilb-sub', text: `还有 ${problems.length - 6} 条，改完这些再看` }));
      if (errors.length > 0) box.appendChild(hint('有"会挡住运行"的问题时，这条流程仍然可以保存，但跑起来会在诊断页报出来。'));
      void warns;
    }
    return box;
  }
  function renderTextMode() {
    const box = el('div', { class: 'ilb-flow-text' });
    const area = el('textarea', { class: 'ilb-input ilb-flow-area', spellcheck: 'false' });
    area.value = renderFlowText(model, { entries, logics });
    area.rows = 12;

    // 文本语法还没覆盖新节点（变量操作 / 条件组 / 随机选择 / 重复 / 概率 / 结束流程 / 未知节点）。
    // 装不下的部分一律只读，绝不"显示成一个空行 → 用户一收就没"。
    const unrepresentable = textUnsupported(model.nodes);
    if (unrepresentable.size > 0) {
      area.readOnly = true;
      box.appendChild(el('p', {
        class: 'ilb-warn',
        text: `这条流程里有文本模式还装不下的步骤：${[...unrepresentable].join('、')}。为了不丢数据，文本模式现在是只读的；要改请切回表单。`,
      }));
    }

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
          // 只读时按钮本来就是 disabled；万一宿主/假 DOM 没拦住，这里再挡一次
          if (textUnsupported(model.nodes).size > 0) return;
          const parsed = sync(true);
          model = parsed.flow;
          notify();
          redraw();
        }, { title: '把文本变成节点树并保存；看不懂的行会列出来', disabled: unrepresentable.size > 0 }),
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
    // 文本模式装不下这条流程时它是只读的：这时候绝不能拿 textarea 的内容覆盖模型。
    if (textUnsupported(model.nodes).size > 0) return;
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

  // 添加器（ILB-3.2）：先按"想干什么"分类，能搜，冷门的收进「更多（高级）」。
  // 点开哪个分支的「＋ 添加一步」，新节点就加在那个分支末尾（手机上也一样）。
  function addRow(list) {
    const picker = el('div', { class: 'ilb-flow-picker' });
    picker.style.display = 'none';
    const search = el('input', {
      class: 'ilb-input ilb-flow-search',
      placeholder: '搜你想做的事：加 1 / 扣除 / 拼接 / 随机选 / 重复 3 次…',
    });
    const body = el('div', { class: 'ilb-flow-picker-body' });

    function addNode(kind) {
      list.push(makeNode(kind));
      notify();
      redraw();
    }

    function itemButton(kind) {
      return button(`＋ ${FLOW_KIND_LABEL[kind] ?? kind}`, () => addNode(kind), { ghost: true, title: FLOW_KIND_HINT[kind] ?? '' });
    }

    function allItems() {
      const out = [];
      for (const group of ACTION_GROUPS) {
        for (const item of [...group.items, ...(group.more ?? [])]) out.push({ ...item, group: group.label });
      }
      // 兜底：没进分类的节点类型也要能加，不能让功能凭空消失
      const listed = new Set(out.map((i) => i.kind));
      for (const kind of FLOW_KINDS) if (!listed.has(kind)) out.push({ kind, keywords: '', group: '其他' });
      return out;
    }

    function drawPanel() {
      const q = String(search.value ?? '').trim().toLowerCase();
      body.innerHTML = '';
      const hits = (item) => !q
        || `${FLOW_KIND_LABEL[item.kind] ?? ''} ${item.kind} ${item.keywords ?? ''}`.toLowerCase().includes(q);
      if (q) {
        const found = allItems().filter(hits);
        if (found.length === 0) {
          body.appendChild(el('p', { class: 'ilb-hint', text: '没找到。换个说法试试，比如"增加"、"如果"、"随机"、"重复"。' }));
          return;
        }
        for (const item of found) body.appendChild(itemButton(item.kind));
        return;
      }
      for (const group of ACTION_GROUPS) {
        const items = group.items.filter(hits);
        if (items.length === 0) continue;
        const row = el('div', { class: 'ilb-flow-group' }, [el('span', { class: 'ilb-sub', text: group.label })]);
        for (const item of items) row.appendChild(itemButton(item.kind));
        body.appendChild(row);
      }
      const common = new Set(ACTION_GROUPS.flatMap((g) => g.items.map((i) => i.kind)));
      const more = allItems().filter((i) => !common.has(i.kind));
      if (more.length > 0) {
        const row = el('div', { class: 'ilb-flow-group ilb-flow-group-more' }, [el('span', { class: 'ilb-sub', text: '更多（高级）' })]);
        for (const item of more) row.appendChild(itemButton(item.kind));
        body.appendChild(row);
      }
    }

    search.addEventListener('input', () => drawPanel());
    drawPanel();
    picker.appendChild(search);
    picker.appendChild(body);

    const addBtn = button('＋ 添加一步', () => {
      picker.style.display = picker.style.display === 'none' ? 'flex' : 'none';
      if (picker.style.display === 'flex') search.focus?.();
    }, { ghost: true });

    const row = el('div', { class: 'ilb-flow-add' }, [addBtn, picker]);
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
    const isCollapsed = collapsed.has(node.id);
    const kindLabel = node.unknown ? '不支持编辑的节点' : (FLOW_KIND_LABEL[node.kind] ?? node.kind);
    const card = el('div', { class: `ilb-flow-node ilb-flow-${node.kind}${node.unknown ? ' ilb-flow-unknown' : ''}` });
    const head = el('div', { class: 'ilb-flow-node-head' }, [
      el('button', {
        type: 'button',
        class: 'ilb-flow-toggle',
        text: isCollapsed ? '▸' : '▾',
        title: isCollapsed ? '展开这一步' : '收起这一步（数据不受影响）',
        onclick: () => {
          if (isCollapsed) collapsed.delete(node.id);
          else collapsed.add(node.id);
          redraw();
        },
      }),
      el('span', { class: 'ilb-flow-kind', text: kindLabel }),
      el('span', { class: 'ilb-hint', text: describeNode(node) }),
    ]);

    // 一个节点只常驻一个「更多」，不再摆五六个按钮（ILB-3.10）
    const menu = el('div', { class: 'ilb-flow-more-menu' });
    menu.style.display = 'none';
    menu.appendChild(button('复制这一步', () => {
      copied = JSON.parse(JSON.stringify(node));
      redraw();
    }, { ghost: true, title: '连它下面的分支一起复制' }));
    menu.appendChild(button('粘在这条下面', () => {
      if (!copied) return;
      list.splice(index + 1, 0, cloneFresh(copied));
      notify();
      redraw();
    }, { ghost: true, disabled: !copied }));
    menu.appendChild(button('上移', () => move(list, index, -1), { ghost: true, disabled: index === 0 }));
    menu.appendChild(button('下移', () => move(list, index, 1), { ghost: true, disabled: index === list.length - 1 }));
    menu.appendChild(button('删除这一步', () => remove(list, index), { ghost: true }));

    head.appendChild(el('div', { class: 'ilb-actions' }, [
      button('⋯ 更多', () => {
        menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
      }, { ghost: true, title: '复制 / 粘贴 / 上移 / 下移 / 删除' }),
    ]));
    card.appendChild(head);
    card.appendChild(menu);

    if (isCollapsed) {
      card.appendChild(el('p', {
        class: 'ilb-hint',
        text: `${FLOW_KIND_LABEL[node.kind] ?? node.kind} · ${describeNode(node)}${branchSummary(node)}`,
      }));
      return card;
    }

    card.appendChild(renderBody(node));

    if (BRANCH_KINDS.includes(node.kind)) {
      card.appendChild(renderBranch('✓ 成立时', node.then, '成立时没有后续，就继续往下走', 'then'));
      card.appendChild(renderBranch('✗ 不成立时', node.else, '不成立时留空，这条规则就不出现', 'else'));
    }
    return card;
  }

  /** 收起时也要看得出下面挂了多少东西 */
  function branchSummary(node) {
    const parts = [];
    if ((node.then ?? []).length) parts.push(`成立时 ${node.then.length} 步`);
    if ((node.else ?? []).length) parts.push(`不成立时 ${node.else.length} 步`);
    if ((node.body ?? []).length) parts.push(`循环体 ${node.body.length} 步`);
    return parts.length ? `（${parts.join(' · ')}）` : '';
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

    // —— 新增的普通动作（ILB-3.3 / 3.5 / 3.6 / 3.7）——
    if (node.unknown) {
      body.appendChild(el('p', {
        class: 'ilb-warn',
        text: `这一步的类型是「${node.kind}」，当前版本不认识它。数据原样保留，可以复制、导出、删除；不会在你保存时被改成别的类型。`,
      }));
      body.appendChild(el('pre', { class: 'ilb-flow-raw', text: JSON.stringify(node, null, 2).slice(0, 1200) }));
      return body;
    }

    if (node.kind === 'if') {
      body.appendChild(renderConditionGroup(node.when ?? makeCondition('group')));
      return body;
    }

    if (node.kind === 'chance') {
      body.appendChild(
        el('div', { class: 'ilb-inline ilb-flow-expr' }, [
          el('span', { class: 'ilb-sub', text: '有' }),
          input(node.percent ?? 50, (value) => {
            node.percent = Math.max(0, Math.min(100, Number(value) || 0));
            notify();
          }, { type: 'number', placeholder: '0–100' }),
          el('span', { class: 'ilb-sub', text: '% 的概率走「成立时」' }),
        ]),
      );
      body.appendChild(hint('同一楼层重画多少次结果都一样；换楼层才重新掷。0% 一定不走成立时，100% 一定走。'));
      return body;
    }

    if (node.kind === 'set') {
      const opLabel = SET_OP_LABEL[node.op] ?? node.op;
      body.appendChild(
        el('div', { class: 'ilb-inline ilb-flow-expr' }, [
          el('span', { class: 'ilb-sub', text: '变量' }),
          input(node.name, (value) => {
            node.name = value;
            notify();
          }, { placeholder: '例如 金币' }),
          selectBox(node.op, SET_OPS.map((op) => ({ value: op, label: SET_OP_LABEL[op] ?? op })), (value) => {
            node.op = value;
            notify();
            redraw();
          }, 'ilb-select'),
        ]),
      );
      const fields = SET_OP_FIELDS[node.op] ?? [];
      if (fields.includes('value')) {
        body.appendChild(
          el('div', { class: 'ilb-inline ilb-flow-expr' }, [
            el('span', { class: 'ilb-sub', text: opLabel }),
            renderOperand(node.value ?? { type: 'number', value: 1 }, (next) => {
              node.value = next;
              notify();
              redraw();
            }),
          ]),
        );
      }
      if (fields.includes('min') || fields.includes('max')) {
        body.appendChild(
          el('div', { class: 'ilb-inline ilb-flow-expr' }, [
            el('span', { class: 'ilb-sub', text: '限制在' }),
            input(String(node.min ?? 0), (value) => {
              node.min = Number(value) || 0;
              notify();
            }, { type: 'number' }),
            el('span', { class: 'ilb-sub', text: '到' }),
            input(String(node.max ?? 999), (value) => {
              node.max = Number(value) || 0;
              notify();
            }, { type: 'number' }),
            el('span', { class: 'ilb-sub', text: '之间' }),
          ]),
        );
      }
      if (fields.includes('digits')) {
        body.appendChild(
          el('div', { class: 'ilb-inline' }, [
            el('span', { class: 'ilb-sub', text: '保留' }),
            input(String(node.digits ?? 0), (value) => {
              node.digits = Math.max(0, Math.min(6, Number(value) || 0));
              notify();
            }, { type: 'number' }),
            el('span', { class: 'ilb-sub', text: '位小数' }),
          ]),
        );
      }
      if (['set', 'add', 'sub', 'mul', 'append', 'clamp', 'round'].includes(node.op)) {
        body.appendChild(
          el('div', { class: 'ilb-inline ilb-flow-persist' }, [
            checkbox(node.persist !== false, (checked) => {
              node.persist = checked;
              notify();
            }, '写进这张聊天（不勾就只是本轮临时值）'),
          ]),
        );
      }
      if (node.op === 'delete') {
        body.appendChild(hint('删除变量：写进聊天后，这一项会从聊天变量里消失。本轮之后读它会显示"未定义"。'));
      }
      body.appendChild(el('p', { class: 'ilb-sub', text: describeNode(node) }));
      return body;
    }

    if (node.kind === 'choose') {
      const area = el('textarea', {
        class: 'ilb-textarea',
        rows: 4,
        placeholder: '一行一个候选，例如：\n你捡到一枚铜币。\n你什么也没找到。',
        oninput: (event) => {
          node.candidates = event.target.value.split('\n').slice(0, MAX_CANDIDATES);
          notify();
        },
      });
      area.value = (node.candidates ?? []).join('\n');
      body.appendChild(area);
      body.appendChild(
        el('div', { class: 'ilb-inline ilb-flow-expr' }, [
          el('span', { class: 'ilb-sub', text: '结果存到（留空就只追加到正文）' }),
          input(node.target, (value) => {
            node.target = value;
            notify();
          }, { placeholder: '变量名，可留空' }),
        ]),
      );
      if (node.target) {
        body.appendChild(
          el('div', { class: 'ilb-inline ilb-flow-persist' }, [
            checkbox(node.persist !== false, (checked) => {
              node.persist = checked;
              notify();
            }, '写进这张聊天'),
          ]),
        );
      }
      body.appendChild(hint(`最多 ${MAX_CANDIDATES} 条候选。同一楼层结果固定（重画不会换一条）；候选里可以写 {{变量}}。`));
      return body;
    }

    if (node.kind === 'repeat') {
      body.appendChild(
        el('div', { class: 'ilb-inline ilb-flow-expr' }, [
          el('span', { class: 'ilb-sub', text: '重复' }),
          input(String(node.times ?? 3), (value) => {
            const n = Math.trunc(Number(value) || 1);
            node.times = Math.max(1, Math.min(MAX_REPEAT, n));
            notify();
          }, { type: 'number' }),
          el('span', { class: 'ilb-sub', text: `次（最多 ${MAX_REPEAT} 次）` }),
        ]),
      );
      body.appendChild(renderBranch('循环体', node.body, '循环体是空的：这一步什么也不做', 'body'));
      body.appendChild(hint('循环次数是写死的有限值，不会无限跑；循环体里可以用「结束流程」提前跳出来。'));
      return body;
    }

    if (node.kind === 'stop') {
      body.appendChild(
        el('div', { class: 'ilb-inline ilb-flow-expr' }, [
          el('span', { class: 'ilb-sub', text: '以' }),
          selectBox(node.result ?? 'pass', [
            { value: 'pass', label: '通过' },
            { value: 'fail', label: '不通过' },
          ], (value) => {
            node.result = value;
            notify();
            redraw();
          }, 'ilb-select'),
          el('span', { class: 'ilb-sub', text: '结束这条流程，原因' }),
          input(node.reason, (value) => {
            node.reason = value;
            notify();
          }, { placeholder: '例如 金币不够了' }),
        ]),
      );
      body.appendChild(hint('剩下的步骤不再执行。写在分支或循环体里，只结束最里面那一层所在的整条流程。'));
      return body;
    }

    body.appendChild(el('p', { class: 'ilb-hint', text: FLOW_KIND_HINT[node.kind] ?? '' }));
    return body;
  }

  /** 一条条件（检测节点自带一条；判定节点里有多条） */
  function renderCondition(cond, withKindSelect, depth = 0) {
    if (cond.what === 'group') return renderConditionGroup(cond, depth);
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

  /**
   * 条件组（ILB-3.3）：里面既可以是条件，也可以是另一个条件组。
   * 用缩进 + 边框表示层级，不做连线——手机上连线根本点不准。
   */
  function renderConditionGroup(group, depth = 0) {
    const box = el('div', { class: `ilb-flow-group-cond ilb-flow-group-depth-${Math.min(depth, 3)}` });
    box.appendChild(
      el('div', { class: 'ilb-inline' }, [
        el('span', { class: 'ilb-sub', text: depth === 0 ? '当以下条件' : '这一组' }),
        selectBox(group.op ?? 'and', [
          { value: 'and', label: '全部满足（并且）' },
          { value: 'or', label: '任意一条满足（或者）' },
        ], (value) => {
          group.op = value;
          notify();
          redraw();
        }, 'ilb-select'),
        checkbox(group.negate === true, (value) => {
          group.negate = value;
          notify();
          redraw();
        }, '整体取反'),
      ]),
    );

    const children = group.children ?? (group.children = []);
    if (children.length === 0) {
      box.appendChild(el('p', { class: 'ilb-hint', text: '这一组还是空的：空的条件组按"通过"处理，运行前建议至少加一条。' }));
    }
    children.forEach((child, i) => {
      const row = el('div', { class: 'ilb-flow-cond-row' }, [renderCondition(child, true, depth + 1)]);
      row.appendChild(button('移除', () => {
        children.splice(i, 1);
        notify();
        redraw();
      }, { ghost: true }));
      box.appendChild(row);
    });

    const tools = el('div', { class: 'ilb-inline ilb-flow-group-tools' }, [
      button('＋ 添加条件', () => {
        children.push(makeCondition('contains'));
        notify();
        redraw();
      }, { ghost: true }),
    ]);
    if (depth < 3) {
      tools.appendChild(button('＋ 添加条件组', () => {
        children.push(makeCondition('group'));
        notify();
        redraw();
      }, { ghost: true, title: '组里还能再套一组；最多套 3 层，再深就读不懂了' }));
    }
    box.appendChild(tools);
    box.appendChild(el('p', { class: 'ilb-sub', text: describeCondition(group) }));
    return box;
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
    } else if (type === 'template') {
      wrap.appendChild(input(op?.value, (value) => {
        op.value = value;
        notify();
      }, { placeholder: '你当前有 {{金币}} 枚金币' }));
      wrap.appendChild(el('span', { class: 'ilb-hint', text: '{{变量}} 会被替换成值；缺的变量会显示 ⟨未定义:名字⟩，不会变成空。' }));
    } else if (type === 'expr') {
      wrap.appendChild(input(op?.value, (value) => {
        op.value = value;
        notify();
      }, { placeholder: '金币 + 5、min(金币, 99)、round(攻击 / 3)' }));
      wrap.appendChild(el('span', { class: 'ilb-hint', text: '支持 + - * / % 和 min max round floor ceil abs clamp；变量名直接用中文；算不出来会报错，不会当成 0。' }));
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
