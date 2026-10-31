// core/validate.js —— 静态验证器（ILB-7.17）。纯函数：只看数据，不执行、不读宿主。
//
// 它回答一个问题：**这条流程照现在这样写，运行时会不会出问题？**
// 每条问题都带 nodeId，界面可以据此跳到那个节点（需求文档 §3.11）。
// 级别只有两种：
//   error —— 运行时一定会失败或一定不会按预期走
//   warn  —— 能跑，但很可能是笔误（例如引用了没赋过值的变量）

import {
  BRANCHING_KINDS,
  CALC_OPS,
  COMPARE_OPS,
  CONDITION_KINDS,
  FLOW_KIND_LABEL,
  FLOW_KINDS,
  MAX_DEPTH,
  MAX_NODES,
  MAX_REPEAT,
  OPERAND_TYPES,
  SET_OPS,
  countFlowNodes,
} from './flow.js';

export const VALIDATE_LIMITS = Object.freeze({ nodes: MAX_NODES, depth: MAX_DEPTH, repeat: MAX_REPEAT });

/** 变量在哪些节点里会被写出来（用于"引用了没赋过值的变量"的判断，不看顺序） */
export function collectVarWrites(nodes, out = new Set()) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node || typeof node !== 'object') continue;
    if (node.kind === 'set' && node.name) out.add(String(node.name));
    if ((node.kind === 'define' || node.kind === 'remember') && node.name) out.add(String(node.name));
    if (node.kind === 'calc' && node.target) out.add(String(node.target));
    if (node.kind === 'random' && node.target) out.add(String(node.target));
    if (node.kind === 'choose' && node.target) out.add(String(node.target));
    collectVarWrites(node.then, out);
    collectVarWrites(node.else, out);
    collectVarWrites(node.body, out);
  }
  return out;
}

function refsOfOperand(op) {
  if (!op || typeof op !== 'object') return [];
  return op.type === 'var' && op.name ? [String(op.name)] : [];
}

function describePath(path) {
  return path.length ? path.join(' · ') : '流程';
}

/**
 * @param {object} flow  normalizeFlow 之后的对象
 * @param {object} [options]
 *   entries —— 用来校验「激活条目」的目标是否存在
 *   logics  —— 用来校验「调用逻辑」的目标与调用环
 *   vars    —— 已知的变量名（聊天里已有的 + 字段）
 * @returns {{ok:boolean, problems:Array<{code:string,level:string,nodeId:string,path:string,message:string}>}}
 */
export function validateFlow(flow, options = {}) {
  const problems = [];
  const nodes = Array.isArray(flow?.nodes) ? flow.nodes : [];
  const knownVars = new Set((Array.isArray(options.vars) ? options.vars : []).map(String));
  for (const name of collectVarWrites(nodes)) knownVars.add(name);
  const entryIds = new Set((Array.isArray(options.entries) ? options.entries : []).map((e) => String(e?.id ?? '')));
  const logicIds = new Set((Array.isArray(options.logics) ? options.logics : []).map((l) => String(l?.id ?? '')));
  const callsOf = new Map();
  for (const logic of Array.isArray(options.logics) ? options.logics : []) {
    callsOf.set(String(logic?.id ?? ''), collectCalls(logic?.flow?.nodes, []));
  }

  const total = countFlowNodes(nodes);
  if (total > MAX_NODES) {
    problems.push(mk('too-many-nodes', 'error', '', '流程', `一共 ${total} 步，超过上限 ${MAX_NODES} 步，运行时会被截断`));
  }
  if (nodes.length === 0) {
    problems.push(mk('empty-flow', 'warn', '', '流程', '这条流程一步都没有'));
  }

  walk(nodes, []);
  reportCycles();

  function walk(list, path) {
    if (path.length > MAX_DEPTH) return;
    list.forEach((node, index) => {
      if (!node || typeof node !== 'object') return;
      const here = [...path, `第 ${index + 1} 步`];
      checkNode(node, here);
      if (BRANCHING_KINDS.includes(node.kind)) {
        if (Array.isArray(node.then) && node.then.length) walk(node.then, [...here, '成立时']);
        if (Array.isArray(node.else) && node.else.length) walk(node.else, [...here, '不成立时']);
      }
      if (node.kind === 'repeat' && Array.isArray(node.body)) walk(node.body, [...here, '里面']);
    });
  }

  function checkNode(node, path) {
    const where = describePath(path);
    if (node.unknown === true) {
      problems.push(mk('unknown-node', 'error', node.id, where, `不支持编辑的节点「${node.kind}」：数据已保留，但运行时不会执行`));
      return;
    }
    if (!FLOW_KINDS.includes(node.kind)) {
      problems.push(mk('unknown-node', 'error', node.id, where, `不认识的节点类型「${node.kind}」`));
      return;
    }

    if (node.kind === 'test') checkCondition(node.condition, path, node);
    if (node.kind === 'if') checkCondition(node.when, path, node);
    if (node.kind === 'judge') {
      const list = Array.isArray(node.conditions) ? node.conditions : [];
      if (list.length === 0) problems.push(mk('empty-judge', 'warn', node.id, where, '「判断」里一条条件都没有，永远算成立'));
      list.forEach((cond, i) => checkCondition(cond, [...path, `条件 ${i + 1}`], node));
    }
    if (node.kind === 'compare') {
      checkOperand(node.left, path, node, '左边');
      checkOperand(node.right, path, node, '右边');
      if (!COMPARE_OPS.includes(node.op)) problems.push(mk('bad-op', 'error', node.id, where, `不认识的比较方式「${node.op}」`));
    }
    if (node.kind === 'calc' || node.kind === 'set') {
      if (!CALC_OPS.includes(node.op) && node.kind === 'calc') problems.push(mk('bad-op', 'error', node.id, where, `不认识的算法「${node.op}」`));
      if (node.kind === 'set' && !SET_OPS.includes(node.op)) problems.push(mk('bad-op', 'error', node.id, where, `不认识的变量动作「${node.op}」`));
      if (!String(node.target ?? node.name ?? '').trim()) problems.push(mk('no-target', 'error', node.id, where, '没有写要改哪个变量'));
      checkOperand(node.value ?? node.right, path, node, '值');
      if (node.kind === 'calc') checkOperand(node.left, path, node, '左边');
    }
    if (node.kind === 'random') {
      if (!node.target) problems.push(mk('no-target', 'warn', node.id, where, '「随机数」没有写存到哪个变量，结果会丢掉'));
      if (Number(node.max) < Number(node.min)) problems.push(mk('bad-range', 'error', node.id, where, '最大比最小还小'));
    }
    if (node.kind === 'choose') {
      const list = (Array.isArray(node.candidates) ? node.candidates : []).filter((c) => String(c ?? '').trim());
      if (list.length === 0) problems.push(mk('empty-choose', 'error', node.id, where, '「随机选择」一条候选都没写'));
      if (list.length === 1) problems.push(mk('single-choose', 'warn', node.id, where, '「随机选择」只有一条候选，其实等于固定输出'));
    }
    if (node.kind === 'repeat') {
      if (Array.isArray(node.body) && node.body.length === 0) problems.push(mk('empty-repeat', 'warn', node.id, where, '「重复」里面没有步骤'));
      if (Number(node.times) > MAX_REPEAT) problems.push(mk('too-many-repeat', 'error', node.id, where, `重复次数超过上限 ${MAX_REPEAT}`));
    }
    if (node.kind === 'chance') {
      const p = Number(node.percent);
      if (!Number.isFinite(p) || p < 0 || p > 100) problems.push(mk('bad-percent', 'error', node.id, where, '概率要写 0–100 之间的数'));
    }
    if (node.kind === 'goto') {
      if (!String(node.target ?? '').trim()) problems.push(mk('no-target', 'error', node.id, where, '「跳转」没有写要跳到哪一步'));
      else if (!options.ignoreMissingTargets) {
        // 跳转目标是节点 id；界面里存的是 id，这里只校验"非空"，具体是否可达由运行时兜底。
      }
    }
    if (node.kind === 'call') {
      const id = String(node.logicId ?? '');
      if (!id) problems.push(mk('no-target', 'error', node.id, where, '「调用逻辑」没有选要调用哪条逻辑'));
      else if (logicIds.size && !logicIds.has(id)) problems.push(mk('missing-logic', 'error', node.id, where, '要调用的逻辑已经不在了'));
    }
    if (node.kind === 'activate') {
      const id = String(node.entryId ?? '');
      if (!id) problems.push(mk('no-target', 'error', node.id, where, '「激活条目」没有选要激活哪一条'));
      else if (entryIds.size && !entryIds.has(id)) problems.push(mk('missing-entry', 'error', node.id, where, '要激活的条目已经不在了'));
    }
    if (node.kind === 'ui') {
      const any = ['page', 'toast', 'select', 'askTitle', 'askText'].some((k) => String(node[k] ?? '').trim());
      if (!any) problems.push(mk('empty-ui', 'warn', node.id, where, '「界面」这一步什么都没写，运行时会被跳过'));
    }
    if (BRANCHING_KINDS.includes(node.kind)) {
      const hasThen = Array.isArray(node.then) && node.then.length > 0;
      const hasElse = Array.isArray(node.else) && node.else.length > 0;
      if (!hasThen && !hasElse) problems.push(mk('empty-branch', 'warn', node.id, where, '两个分支都是空的，这一步什么也不做'));
      else if (!hasElse) problems.push(mk('no-else', 'warn', node.id, where, '只写了"成立时"：不成立时整条规则直接不出现'));
    }
    if (!FLOW_KIND_LABEL[node.kind]) problems.push(mk('no-label', 'warn', node.id, where, '这个节点类型没有中文名'));
  }

  function checkCondition(cond, path, node) {
    const where = describePath(path);
    if (!cond || typeof cond !== 'object') {
      problems.push(mk('bad-condition', 'error', node?.id, where, '这里缺一个条件'));
      return;
    }
    if (!CONDITION_KINDS.includes(cond.what)) {
      problems.push(mk('unknown-condition', 'error', node?.id, where, `不认识的条件类型「${cond.what}」`));
      return;
    }
    if (cond.what === 'group') {
      const children = Array.isArray(cond.children) ? cond.children : [];
      if (children.length === 0) problems.push(mk('empty-group', 'error', node?.id, where, '条件组里一个条件都没有'));
      if (path.length > MAX_DEPTH) {
        problems.push(mk('too-deep', 'error', node?.id, where, `条件组套得太深（上限 ${MAX_DEPTH} 层）`));
        return;
      }
      children.forEach((child, i) => checkCondition(child, [...path, `子条件 ${i + 1}`], node));
      return;
    }
    if (cond.what === 'contains' && !String(cond.text ?? '').trim()) {
      problems.push(mk('empty-text', 'warn', node?.id, where, '「包含」没有写要包含什么'));
    }
    if (cond.what === 'regex') {
      const pattern = String(cond.pattern ?? '');
      if (!pattern) problems.push(mk('empty-regex', 'error', node?.id, where, '「正则」没有写规则'));
      else {
        try {
          new RegExp(pattern, String(cond.flags ?? ''));
        } catch (err) {
          problems.push(mk('bad-regex', 'error', node?.id, where, `正则写错了：${err?.message ?? err}`));
        }
      }
    }
    if (cond.what === 'active' && !String(cond.entryId ?? '').trim()) {
      problems.push(mk('no-target', 'warn', node?.id, where, '「条目已激活」没有选条目'));
    }
    if (cond.what === 'var' && !String(cond.name ?? '').trim()) {
      problems.push(mk('no-var', 'error', node?.id, where, '「变量」条件没有写变量名'));
    } else if (cond.what === 'var' && cond.name && cond.compare) {
      checkOperand(cond.compare.left ?? { type: 'var', name: cond.name }, path, node, '左边');
      checkOperand(cond.compare.right, path, node, '右边');
    }
  }

  function checkOperand(op, path, node, role) {
    const where = describePath(path);
    if (!op || typeof op !== 'object') {
      problems.push(mk('bad-operand', 'error', node?.id, where, `缺少${role}`));
      return;
    }
    if (!OPERAND_TYPES.includes(op.type)) {
      problems.push(mk('bad-operand', 'error', node?.id, where, `${role}的类型不认识：「${op.type}」`));
      return;
    }
    for (const name of refsOfOperand(op)) {
      if (knownVars.size && !knownVars.has(name)) {
        problems.push(mk('undefined-var', 'warn', node?.id, where, `变量「${name}」在这条流程里没有赋过值，运行时会是 ⟨未定义:${name}⟩`));
      }
    }
    if (op.type === 'expr') {
      const src = String(op.value ?? '');
      if (!src.trim()) problems.push(mk('empty-expr', 'error', node?.id, where, '表达式是空的'));
    }
    if (op.type === 'template' && !String(op.value ?? '').trim()) {
      problems.push(mk('empty-template', 'warn', node?.id, where, '模板是空的'));
    }
  }

  function reportCycles() {
    if (!callsOf.size) return;
    const state = new Map();
    const stack = [];
    const visit = (id) => {
      if (state.get(id) === 'done') return;
      if (state.get(id) === 'visiting') {
        const loop = [...stack.slice(stack.indexOf(id)), id];
        const names = loop.map((x) => nameOf(x)).join(' → ');
        problems.push(mk('call-cycle', 'error', '', '流程', `调用成环：${names}（运行时会报错停止）`));
        return;
      }
      state.set(id, 'visiting');
      stack.push(id);
      for (const next of callsOf.get(id) ?? []) visit(next);
      stack.pop();
      state.set(id, 'done');
    };
    for (const id of callsOf.keys()) visit(id);
  }

  function nameOf(id) {
    const logic = (Array.isArray(options.logics) ? options.logics : []).find((l) => String(l?.id) === String(id));
    return logic?.name || id;
  }

  return { ok: problems.every((p) => p.level !== 'error'), problems };
}

function collectCalls(nodes, out) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node || typeof node !== 'object') continue;
    if (node.kind === 'call' && node.logicId) out.push(String(node.logicId));
    collectCalls(node.then, out);
    collectCalls(node.else, out);
    collectCalls(node.body, out);
  }
  return out;
}

function mk(code, level, nodeId, path, message) {
  return { code, level, nodeId: String(nodeId ?? ''), path, message };
}

/** 给人看的一句话总结 */
export function summarizeProblems(result) {
  const problems = Array.isArray(result?.problems) ? result.problems : [];
  const errors = problems.filter((p) => p.level === 'error').length;
  const warns = problems.length - errors;
  if (problems.length === 0) return '没发现问题';
  if (errors === 0) return `有 ${warns} 处提醒，不影响运行`;
  return `有 ${errors} 处会挡住运行的问题${warns ? `，另有 ${warns} 处提醒` : ''}`;
}
