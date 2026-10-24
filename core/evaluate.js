// core/evaluate.js —— 纯函数，整个扩展的心脏（ILB-4.1 / ILB-4.2）
// 输入：一份 EvalRequest 快照（不含 chat 引用，不碰 DOM，不读写宿主）
// 输出：一份 ActivationResult。同样的输入 + 同样的 seed，必须得到逐字节相同的结果。

import { containsNeedle, compileRegex, safeRegexTest, toStringArray } from './text-match.js';
import { hashToUnit, compareId } from './ids.js';
import { estimateTokens } from './budget.js';
import { DEFAULT_SETTINGS, POSITIONS, ROLES } from './settings-defaults.js';
import { resolveBooks } from './resolve-books.js';
import { evaluateFlow, hasFlow } from './flow.js';

const FALLBACK_CONTEXT_SIZE = 8192;

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function normalizeHistory(history) {
  const out = {};
  for (const rec of Array.isArray(history) ? history : []) {
    if (!rec || !rec.entryId) continue;
    out[String(rec.entryId)] = {
      lastActiveAt: rec.lastActiveAt ?? null,
      activeSince: rec.activeSince ?? null,
    };
  }
  return out;
}

function contentOf(message) {
  if (!message) return '';
  if (typeof message === 'string') return message;
  return String(message.content ?? message.mes ?? '');
}

/** 最近 n 条消息 + 用户这一句，拼成判定用的文本 */
function buildText(messages, n, userInput) {
  const depth = clamp(Math.trunc(num(n, 3)), 0, 200);
  const tail = depth > 0 ? messages.slice(-depth) : [];
  const parts = [];
  for (const m of tail) {
    const c = contentOf(m);
    if (c) parts.push(c);
  }
  const ui = String(userInput ?? '').trim();
  if (ui) parts.push(ui);
  return parts.join('\n');
}

function normalizeInjection(injection, settings) {
  const position = POSITIONS.includes(injection?.position) ? injection.position : settings.defaultPosition;
  const role = ROLES.includes(injection?.role) ? injection.role : settings.defaultRole;
  const depth = clamp(Math.trunc(num(injection?.depth, settings.defaultDepth)), 0, 999);
  return { position, depth, role };
}

/** 触发词判定 */
export function evalTrigger(trigger, text) {
  const t = trigger ?? {};
  const opts = { caseSensitive: t.matchCase === true, wholeWords: t.wholeWords === true };
  const any = toStringArray(t.any);
  const all = toStringArray(t.all);
  const not = toStringArray(t.not);
  const regex = toStringArray(t.regex);

  if (any.length === 0 && all.length === 0 && regex.length === 0) {
    return { passed: false, reason: '没有设置触发词，也不是常驻条目' };
  }
  if (any.length > 0 && !any.some((k) => containsNeedle(text, k, opts))) {
    return { passed: false, reason: `没有出现任何一个词（${any.slice(0, 3).join('、')}…）` };
  }
  if (all.length > 0 && !all.every((k) => containsNeedle(text, k, opts))) {
    return { passed: false, reason: '没有同时出现所有必含词' };
  }
  if (regex.length > 0) {
    const hit = regex.some((spec) => {
      const re = compileRegex(spec);
      return re ? safeRegexTest(re, text) : false;
    });
    if (!hit) return { passed: false, reason: '正则没有匹配上' };
  }
  if (not.length > 0 && not.some((k) => containsNeedle(text, k, opts))) {
    return { passed: false, reason: '出现了排除词' };
  }

  const secondary = t.secondary;
  const secKeys = toStringArray(secondary?.keys);
  if (secKeys.length > 0) {
    const hits = secKeys.map((k) => containsNeedle(text, k, opts));
    const logic = secondary?.logic ?? 'AND_ANY';
    let ok = true;
    if (logic === 'AND_ALL') ok = hits.every(Boolean);
    else if (logic === 'NOT_ANY') ok = !hits.some(Boolean);
    else if (logic === 'NOT_ALL') ok = !hits.every(Boolean);
    else ok = hits.some(Boolean);
    if (!ok) return { passed: false, reason: '第二组触发词的条件不满足' };
  }

  return { passed: true, reason: '出现了触发词' };
}

/** 条件卡片判定（ILB-4.4） */
export function evalCondition(card, ctx) {
  if (!card || typeof card !== 'object') return { passed: true, reason: '空条件' };

  if (card.type === 'all' || card.type === 'any') {
    const of = Array.isArray(card.of) ? card.of : [];
    if (of.length === 0) return { passed: true, reason: '没有子条件' };
    if (card.type === 'all') {
      for (const sub of of) {
        const r = evalCondition(sub, ctx);
        if (!r.passed) return { passed: false, reason: `「并且」里有一项不满足：${r.reason}` };
      }
      return { passed: true, reason: '全部满足' };
    }
    const reasons = [];
    for (const sub of of) {
      const r = evalCondition(sub, ctx);
      if (r.passed) return { passed: true, reason: '满足其中一项' };
      reasons.push(r.reason);
    }
    return { passed: false, reason: `「或者」里一项都没满足：${reasons[0] ?? ''}` };
  }

  if (card.type === 'contains') {
    const needle = String(card.text ?? '');
    if (!needle) return { passed: true, reason: '条件没填内容，视为不限制' };
    let hit = containsNeedle(String(ctx.text ?? ''), needle, { caseSensitive: false, wholeWords: false });
    if (card.negate === true) hit = !hit;
    return { passed: hit, reason: hit ? '文本里出现了' : '文本里没有出现' };
  }

  if (card.type === 'activated') {
    const id = String(card.entryId ?? '');
    const hit = ctx.activated instanceof Set ? ctx.activated.has(id) : false;
    return { passed: hit, reason: hit ? '被引用的条目已激活' : '被引用的条目没激活' };
  }

  if (card.type === 'var') {
    const name = String(card.name ?? '');
    const raw = ctx.vars ? ctx.vars[name] : undefined;
    const exists = raw !== undefined && raw !== null;
    const a = String(raw ?? '');
    const b = String(card.value ?? '');
    switch (card.op ?? 'equals') {
      case 'equals':
        return { passed: exists && a === b, reason: exists ? '变量值相符' : '变量不存在' };
      case 'not_equals':
        return { passed: !exists ? true : a !== b, reason: '变量值不同' };
      case 'contains':
        return { passed: exists && a.includes(b), reason: '变量内容包含' };
      case 'exists':
        return { passed: exists, reason: exists ? '变量存在' : '变量不存在' };
      case 'missing':
        return { passed: !exists, reason: exists ? '变量存在' : '变量不存在' };
      case 'gt':
      case 'lt': {
        const x = Number(raw);
        const y = Number(card.value);
        const ok = Number.isFinite(x) && Number.isFinite(y) && (card.op === 'gt' ? x > y : x < y);
        return { passed: ok, reason: ok ? '数值比较成立' : '数值比较不成立' };
      }
      default:
        return { passed: true, reason: `不认识的比较方式 ${card.op}，已忽略` };
    }
  }

  return { passed: true, reason: `不认识的条件类型 ${card.type}，已忽略` };
}

function evalWhenArray(when, ctx) {
  const list = Array.isArray(when) ? when : [];
  for (const card of list) {
    const r = evalCondition(card, ctx);
    if (!r.passed) return r;
  }
  return { passed: true, reason: '条件都满足' };
}

/** 排序偏好：权重高的优先；同权重按用户拖拽位次；再按 id 保证稳定 */
function comparePreference(a, b) {
  const wa = num(a?.weight, 100);
  const wb = num(b?.weight, 100);
  if (wa !== wb) return wb - wa;
  const oa = num(a?.ui?.order, 0);
  const ob = num(b?.ui?.order, 0);
  if (oa !== ob) return oa - ob;
  return compareId(String(a?.id ?? ''), String(b?.id ?? ''));
}

/**
 * 跑一条规则的判定流程（ILB-4.11）。
 * 没有流程时直接放行，一个字都不改——这保证"不画流程就完全等于原生世界书"。
 * 流程里的「添加」节点产生正文，拼在这条规则正文的后面。
 */
function runEntryFlow(entry, ctx) {
  if (!hasFlow(entry)) {
    return { active: false, passed: true, reason: '没有流程', extraText: '', steps: [], writes: {}, activations: [] };
  }
  const result = evaluateFlow(entry.logic, ctx);
  const extraText = result.extra.length > 0 ? `\n${result.extra.join('\n')}` : '';
  return {
    active: true,
    passed: result.passed,
    reason: result.reason,
    extraText,
    steps: result.steps,
    writes: result.writes ?? {},
    activations: result.activations ?? [],
  };
}

/**
 * @param {object} request EvalRequest
 * @param {object} options { books, context, providers, settings, resolved, pool }
 */
export function evaluate(request = {}, options = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...(options.settings ?? {}) };
  const messages = Array.isArray(request.messages) ? request.messages : [];
  const userInput = String(request.userInput ?? '');
  const msgCount = messages.length;
  const seed = request.seed ?? 0;
  const vars = request.vars && typeof request.vars === 'object' ? request.vars : {};
  const history = normalizeHistory(request.history);

  const resolved =
    options.resolved ?? resolveBooks(options.books ?? [], options.context ?? {}, options.providers ?? []);
  const pool = Array.isArray(options.pool) ? options.pool : resolved.pool;

  const scanDepth = clamp(Math.trunc(num(request.scanDepth, settings.scanDepth)), 0, 200);
  const baseText = buildText(messages, scanDepth, userInput);

  const diagnostics = [];
  const activated = new Set();

  // —— 第 1–4 步：触发、条件、时效 ——
  const triggerPassers = [];
  for (const entry of pool) {
    if (!entry || !entry.id) continue;
    if (entry.enabled === false) {
      diagnostics.push({ entryId: entry.id, passed: false, reason: '条目被关闭', stage: 'trigger' });
      continue;
    }

    const state = history[entry.id] ?? {};
    const sticky = Math.max(0, num(entry.timed?.sticky, 0));
    const cooldown = Math.max(0, num(entry.timed?.cooldown, 0));
    const delay = Math.max(0, num(entry.timed?.delay, 0));

    // sticky：持续期内不需要触发词
    if (sticky > 0 && state.activeSince != null && msgCount - state.activeSince < sticky) {
      const left = sticky - (msgCount - state.activeSince);
      triggerPassers.push({ entry, stage: 'timed', reason: `还在持续期内，还剩 ${left} 条` });
      diagnostics.push({ entryId: entry.id, passed: true, stage: 'timed', reason: `持续期内，还剩 ${left} 条`, estimatedTokens: estimateTokens(entry.content) });
      continue;
    }
    if (delay > 0 && msgCount < delay) {
      diagnostics.push({ entryId: entry.id, passed: false, stage: 'timed', reason: `要等够 ${delay} 条消息才会出现` });
      continue;
    }
    if (cooldown > 0 && state.lastActiveAt != null && msgCount - state.lastActiveAt < cooldown) {
      const left = cooldown - (msgCount - state.lastActiveAt);
      diagnostics.push({ entryId: entry.id, passed: false, stage: 'timed', reason: `冷却中，还要 ${left} 条` });
      continue;
    }

    const text = entry.scope?.within ? buildText(messages, entry.scope.within, userInput) : baseText;
    // 流程设为"只用流程"时，关键词不参与判定（ILB-4.11.7）
    const flowOnly = hasFlow(entry) && entry.logic?.mode === 'only';
    const trig =
      flowOnly || entry.always === true
        ? { passed: true, reason: flowOnly ? '由判定流程决定' : '常驻条目' }
        : evalTrigger(entry.trigger, text);
    if (!trig.passed) {
      diagnostics.push({ entryId: entry.id, passed: false, stage: 'trigger', reason: trig.reason });
      continue;
    }
    triggerPassers.push({ entry, stage: 'trigger', reason: trig.reason, text });
  }

  // —— 第 3 步（条件）：用"全部触发通过者"作为互相引用的范围 ——
  for (const rec of triggerPassers) activated.add(rec.entry.id);

  const afterWhen = [];
  const flowWrites = {};
  const requested = [];
  for (const rec of triggerPassers) {
    const when = evalWhenArray(rec.entry.when, { text: rec.text ?? baseText, activated, vars });
    if (!when.passed) {
      diagnostics.push({ entryId: rec.entry.id, passed: false, stage: 'when', reason: when.reason });
      continue;
    }
    // —— 逻辑流程（ILB-4.11）：用户自己的判定树，追加在关键词与条件之后 ——
    const flow = runEntryFlow(rec.entry, {
      text: rec.text ?? baseText,
      messages,
      userInput,
      messageCount: msgCount,
      vars,
      activated,
    });
    if (!flow.passed) {
      diagnostics.push({ entryId: rec.entry.id, passed: false, stage: 'logic', reason: flow.reason });
      continue;
    }
    if (flow.extraText) rec.extraText = flow.extraText;
    // 流程里"记住"的值与"激活条目"的请求，收集起来统一处理。
    if (flow.writes && typeof flow.writes === 'object') Object.assign(flowWrites, flow.writes);
    for (const id of Array.isArray(flow.activations) ? flow.activations : []) {
      if (!requested.includes(id)) requested.push(id);
    }
    afterWhen.push(rec);
  }

  // —— 第 4.5 步：流程点名的条目（"激活条目"节点）——
  // 它们跳过关键词与条件，因为"被点名"本身就是出现的原因；但仍然参与预算、分组与概率。
  const activatedByFlow = [];
  for (const id of requested) {
    if (activated.has(id)) continue;
    const entry = pool.find((e) => e && e.id === id && e.enabled !== false);
    if (!entry) {
      diagnostics.push({ entryId: id, passed: false, stage: 'activate', reason: '流程点名的条目不存在或已关闭' });
      continue;
    }
    activated.add(id);
    activatedByFlow.push({ entry, stage: 'activate', reason: '被流程激活' });
    diagnostics.push({ entryId: id, passed: true, stage: 'activate', reason: '被流程激活' });
  }

  // —— 第 5 步：连锁触发（ILB-4.6）——
  const chained = [];
  const maxChain = Math.max(0, Math.trunc(num(settings.maxChainDepth, 3)));
  if (maxChain > 0) {
    // 第 0 层 = 已被关键词/条件带出来的条目。第 k 层能"看见"的文字 =
    // 基础文本 + 前 k−1 层已注入的正文（不含同层，避免同层顺序影响结果）。
    const layerContents = afterWhen.map(
      (rec) => String(rec.entry.content ?? '') + (rec.extraText ?? ''),
    );
    for (let depth = 1; depth <= maxChain; depth += 1) {
      const layerText = `${baseText}\n${layerContents.join('\n')}`;
      const newlyAdded = [];
      for (const entry of pool) {
        if (!entry || !entry.id || entry.enabled === false) continue;
        if (activated.has(entry.id)) continue;
        if (entry.chain?.participate !== true) continue;
        if (entry.always === true) continue;

        const flowOnly = hasFlow(entry) && entry.logic?.mode === 'only';
        const trig = flowOnly ? { passed: true, reason: '由判定流程决定' } : evalTrigger(entry.trigger, layerText);
        if (!trig.passed) continue;
        const when = evalWhenArray(entry.when, { text: layerText, activated, vars });
        if (!when.passed) {
          diagnostics.push({ entryId: entry.id, passed: false, stage: 'when', reason: `连锁第 ${depth} 层：${when.reason}` });
          continue;
        }
        // 连锁时"最近的文本"就是这一层累积出来的文本，所以不传 messages。
        const flow = runEntryFlow(entry, {
          text: layerText,
          messages: [],
          userInput: '',
          messageCount: msgCount,
          vars,
          activated,
        });
        if (!flow.passed) {
          diagnostics.push({ entryId: entry.id, passed: false, stage: 'logic', reason: `连锁第 ${depth} 层：${flow.reason}` });
          continue;
        }
        const chainedContent = String(entry.content ?? '') + (flow.extraText ?? '');
        activated.add(entry.id);
        newlyAdded.push(chainedContent);
        chained.push({ entry, stage: 'chain', reason: `第 ${depth} 层连锁带出`, extraText: flow.extraText ?? '' });
        diagnostics.push({ entryId: entry.id, passed: true, stage: 'chain', reason: `被第 ${depth} 层连锁带出`, estimatedTokens: estimateTokens(chainedContent) });
      }
      if (newlyAdded.length === 0) break;
      layerContents.push(...newlyAdded);
    }
  }

  // —— 第 6 步：概率（只在用户明确打开时生效，且可复现）——
  const candidates = [];
  for (const rec of [...afterWhen, ...activatedByFlow, ...chained]) {
    const entry = rec.entry;
    if (entry.useProbability !== true) {
      candidates.push(rec);
      continue;
    }
    const p = clamp(num(entry.probability, 100), 0, 100);
    if (p >= 100) {
      candidates.push(rec);
      continue;
    }
    if (p <= 0) {
      diagnostics.push({ entryId: entry.id, passed: false, stage: 'probability', reason: '概率设为 0' });
      continue;
    }
    if (hashToUnit(`${seed}:${entry.id}`) * 100 < p) candidates.push(rec);
    else diagnostics.push({ entryId: entry.id, passed: false, stage: 'probability', reason: `抽签没中（概率 ${p}%）` });
  }

  // —— 第 7 步：同组只留一个（权重最高）——
  const groupBest = new Map();
  const grouped = [];
  for (const rec of candidates) {
    const group = rec.entry.group;
    if (!group) {
      grouped.push(rec);
      continue;
    }
    const current = groupBest.get(group);
    if (!current) {
      groupBest.set(group, rec);
      continue;
    }
    const recWins = comparePreference(rec.entry, current.entry) < 0;
    const winner = recWins ? rec : current;
    const loser = recWins ? current : rec;
    groupBest.set(group, winner);
    diagnostics.push({ entryId: loser.entry.id, passed: false, stage: 'group', reason: `同一个组里输给了「${winner.entry.title ?? winner.entry.id}」` });
  }
  grouped.push(...groupBest.values());

  // —— 第 8 步：排序 ——
  grouped.sort((a, b) => comparePreference(a.entry, b.entry));

  // —— 第 9 步：预算 ——
  const contextSize = num(request.contextSize, FALLBACK_CONTEXT_SIZE) > 0 ? num(request.contextSize, FALLBACK_CONTEXT_SIZE) : FALLBACK_CONTEXT_SIZE;
  const limit = budgetLimit(settings, contextSize);
  let used = 0;
  const dropped = [];
  const finalList = [];
  for (const rec of grouped) {
    const fullContent = String(rec.entry.content ?? '') + (rec.extraText ?? '');
    const cost = estimateTokens(fullContent);
    if (used + cost > limit) {
      dropped.push(rec.entry.id);
      diagnostics.push({ entryId: rec.entry.id, passed: false, stage: 'budget', reason: `超出预算（已用 ${used} / ${limit}）`, estimatedTokens: cost });
      continue;
    }
    used += cost;
    finalList.push(rec);
  }

  // —— 第 10 步：状态更新 ——
  const stateUpdates = [];
  for (const rec of finalList) {
    const entry = rec.entry;
    const state = history[entry.id] ?? {};
    const sticky = Math.max(0, num(entry.timed?.sticky, 0));
    let activeSince = null;
    if (sticky > 0) {
      const continuing = state.activeSince != null && msgCount - state.activeSince < sticky;
      activeSince = continuing ? state.activeSince : msgCount;
    }
    stateUpdates.push({ entryId: entry.id, lastActiveAt: msgCount, activeSince });
  }
  for (const id of Object.keys(history)) {
    if (finalList.some((rec) => rec.entry.id === id)) continue;
    const state = history[id];
    if (state.activeSince == null) continue;
    const entry = pool.find((e) => e && e.id === id);
    const sticky = Math.max(0, num(entry?.timed?.sticky, 0));
    if (sticky > 0 && msgCount - state.activeSince < sticky) continue;
    stateUpdates.push({ entryId: id, lastActiveAt: state.lastActiveAt ?? null, activeSince: null });
  }

  return {
    activated: finalList.map((rec) => ({
      entryId: rec.entry.id,
      content: String(rec.entry.content ?? '') + (rec.extraText ?? ''),
      injection: normalizeInjection(rec.entry.injection, settings),
      weight: num(rec.entry.weight, 100),
    })),
    stateUpdates,
    diagnostics,
    /** 本轮流程里"记住"的值；由调用方决定怎么落盘。 */
    varWrites: flowWrites,
    basedOnMessageCount: msgCount,
    budget: { limit, used, dropped },
    books: {
      active: resolved.activeBooks,
      inactive: resolved.inactiveBooks,
      reasons: resolved.reasons,
      warnings: resolved.warnings,
    },
    poolSize: pool.length,
  };
}

function budgetLimit(settings, contextSize) {
  const ratio = num(settings.budgetRatio, 0.15);
  const cap = num(settings.budgetCap, 2000);
  return clamp(Math.min(contextSize * ratio, cap), 200, 8000);
}

/**
 * 单条规则的"试一句"（ILB-6.10.6）。
 * 只回答一个问题：这句话会让这条规则出现吗？为什么？
 * 不做预算、不做同组、不写任何状态，所以可以随便点，不会影响真正的对话。
 *
 * @param {object} entry
 * @param {{text?: string, activated?: string[], vars?: object, messageCount?: number,
 *          state?: {lastActiveAt?: number|null, activeSince?: number|null}}} options
 * @returns {{passed: boolean, reason: string, steps: Array<{stage: string, passed: boolean, reason: string}>}}
 */
export function previewEntry(entry, options = {}) {
  const steps = [];
  const step = (stage, result) => {
    steps.push({ stage, passed: result.passed, reason: result.reason });
    return { passed: result.passed, reason: result.reason, steps };
  };

  if (!entry || typeof entry !== 'object') {
    return step('input', { passed: false, reason: '没有这条规则' });
  }
  if (entry.enabled === false) {
    return step('enabled', { passed: false, reason: '这条规则被停用了（停用的规则不参与判定）' });
  }

  const text = String(options.text ?? '');
  const msgCount = Math.max(0, Math.trunc(num(options.messageCount, 0)));
  const state = options.state && typeof options.state === 'object' ? options.state : {};
  const ctx = {
    text,
    activated: new Set((Array.isArray(options.activated) ? options.activated : []).map(String)),
    vars: options.vars && typeof options.vars === 'object' ? options.vars : {},
  };

  const sticky = Math.max(0, num(entry.timed?.sticky, 0));
  const cooldown = Math.max(0, num(entry.timed?.cooldown, 0));
  const delay = Math.max(0, num(entry.timed?.delay, 0));

  if (sticky > 0 && state.activeSince != null && msgCount - num(state.activeSince, 0) < sticky) {
    return step('timed', { passed: true, reason: `还在持续期内，还剩 ${sticky - (msgCount - num(state.activeSince, 0))} 条` });
  }
  if (delay > 0 && msgCount < delay) {
    return step('timed', { passed: false, reason: `要等够 ${delay} 条消息才会出现（现在第 ${msgCount} 条）` });
  }
  if (cooldown > 0 && state.lastActiveAt != null && msgCount - num(state.lastActiveAt, 0) < cooldown) {
    return step('timed', { passed: false, reason: `冷却中，还要 ${cooldown - (msgCount - num(state.lastActiveAt, 0))} 条` });
  }

  const flowOnly = hasFlow(entry) && entry.logic?.mode === 'only';

  if (entry.always && !flowOnly) {
    return step('trigger', { passed: true, reason: '常驻条目，不需要触发词' });
  }

  if (!flowOnly) {
    const trigger = evalTrigger(entry.trigger ?? {}, text);
    if (!trigger.passed) return step('trigger', trigger);
    steps.push({ stage: 'trigger', passed: true, reason: trigger.reason });
  } else {
    steps.push({ stage: 'trigger', passed: true, reason: '这条规则设成「只看流程」，关键词不参与判定' });
  }

  const when = evalWhenArray(entry.when, ctx);
  if (!when.passed) return step('when', when);
  steps.push({ stage: 'when', passed: true, reason: when.reason });

  if (hasFlow(entry)) {
    const flow = evaluateFlow(entry.logic, {
      text,
      messages: [],
      userInput: '',
      messageCount: msgCount,
      vars: ctx.vars,
      activated: ctx.activated,
    });
    for (const s of flow.steps) steps.push(s);
    if (!flow.passed) return { passed: false, reason: flow.reason, steps };
    if (flow.extra.length > 0) {
      steps.push({ stage: 'logic', passed: true, reason: `流程还追加了 ${flow.extra.length} 段正文` });
    }
  }

  return { passed: true, reason: '这句话会让它出现', steps };
}
