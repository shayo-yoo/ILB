// narrative/adapter.js —— 叙事引擎与 SillyTavern 之间的唯一接缝（v0.6.0 并入）。
//
// 它只做四件事：
//   1. 从聊天记录里取原文（不写回、不改消息）；
//   2. 把账本写进提示词（setExtensionPrompt，独立 key，不和世界书那条混在一起）；
//   3. 在每条消息末尾画一块只读账本（失败可以看、可以不理）；
//   4. 订阅宿主事件，消息变化后重算。
//
// 三个硬约束：
//   - 总开关关掉时必须与 v0.5.0 完全一致：不注入、不画块、不清别人的东西；
//   - 这里任何异常都不许外溢（ILB-2.5）：宁可这一块不显示，也不能让聊天坏掉；
//   - 状态不存盘，永远从聊天记录重放（D-0040 第三条）。
//
// 注入位置：IN_CHAT / 深度 1 / system。放在最后一条消息旁边，而不是角色卡前面——
// 账本是"当下状态"，离当前回合越近，模型越不容易忽略。key 用 ILB_NARRATIVE，
// 与世界书注入（ILB::…）分开，避免互相清空。

import { clearBlocks, mountBlock, messageElement } from './block.js';
import { planLedger } from './plan.js';
import { NARRATIVE_VERSION } from './index.js';
import { compileDeclaration, describeDeclaration, readNarrativeSettings } from './store.js';

export const INJECT_KEY = 'ILB_NARRATIVE';
const INJECT_POSITION_IN_CHAT = 1;
const INJECT_DEPTH = 1;
const INJECT_ROLE_SYSTEM = 0;
const REFRESH_DELAY = 280;

function safe(fn, fallback = null) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function removeTimer(timer) {
  if (!timer) return;
  try {
    clearTimeout(timer);
  } catch {
    /* ignore */
  }
}

/**
 * @param {{
 *   getContext: Function,
 *   getEventSource?: Function,
 *   getEventTypes?: Function,
 *   repository: object,
 *   notify?: Function,
 * }} deps
 */
export function createNarrativeRuntime(deps = {}) {
  const { getContext, getEventSource, getEventTypes, repository } = deps;
  const hostNotify = typeof deps.notify === 'function' ? deps.notify : (message) => console.info(`[ILB] ${message}`);

  let mounted = false;
  let cache = { key: '', narrative: null, error: '' };
  let plan = null;
  let timer = null;
  let lastError = '';
  const warned = new Set();
  const subscriptions = [];

  function warnOnce(message) {
    lastError = message;
    console.warn(`[ILB] ${message}`);
    if (warned.has(message)) return;
    warned.add(message);
    try {
      hostNotify(message, 'warn');
    } catch {
      /* 提示失败不影响功能 */
    }
  }

  function say(message) {
    console.info(`[ILB] ${message}`);
  }

  function settings() {
    return readNarrativeSettings(repository.getSettings());
  }

  /** 聊天记录 → 纯文本数组。索引必须与 mesid 对齐，所以系统消息也保留（它们没有标记）。 */
  function entries() {
    const ctx = safe(() => getContext(), null);
    const chat = ctx?.chat;
    if (!Array.isArray(chat)) return [];
    return chat.map((message) => (message && typeof message.mes === 'string' ? message.mes : ''));
  }

  function compiled() {
    const s = settings();
    const key = JSON.stringify(s.declaration ?? null);
    if (key === cache.key && (cache.narrative || cache.error)) return { s, ...cache };
    const { narrative, error } = compileDeclaration(s.declaration);
    cache = { key, narrative, error };
    if (error) warnOnce(`账本声明编译失败：${error}`);
    return { s, ...cache };
  }

  function writePrompt(text) {
    const ctx = safe(() => getContext(), null);
    const fn = ctx?.setExtensionPrompt;
    if (typeof fn !== 'function') {
      throw new Error('这个版本的 SillyTavern 没有 setExtensionPrompt，账本无法注入');
    }
    fn.call(ctx, INJECT_KEY, String(text ?? ''), INJECT_POSITION_IN_CHAT, INJECT_DEPTH, 0, INJECT_ROLE_SYSTEM);
  }

  function clearPrompt() {
    try {
      writePrompt('');
    } catch {
      /* 清不掉不影响：开关关掉后我们也不会再写；空字符串本身不注入内容 */
    }
  }

  function removeBlockAt(index) {
    const host = messageElement(index);
    if (!host) return;
    try {
      for (const old of host.querySelectorAll('.ilb-narr')) old.remove();
    } catch {
      /* ignore */
    }
  }

  function clearAll() {
    try {
      clearBlocks();
    } catch {
      /* ignore */
    }
    clearPrompt();
    plan = null;
  }

  /** 全量重算：注入 + 所有消息块。 */
  function refreshNow(reason = 'refresh') {
    if (!mounted) return null;
    const { s, narrative, error } = compiled();
    if (!s.enabled) {
      clearAll();
      if (reason === 'enable') say('账本已关闭：不再注入，也不再画块');
      return null;
    }
    if (!narrative) {
      clearAll();
      return null;
    }
    const list = entries();
    try {
      plan = planLedger(narrative, list, { budget: s.budget, inject: s.inject });
    } catch (err) {
      plan = null;
      warnOnce(`账本重放失败：${err?.message ?? err}`);
      return null;
    }
    try {
      writePrompt(plan.prompt);
    } catch (err) {
      warnOnce(`账本注入失败：${err?.message ?? err}`);
    }
    clearBlocks();
    let drawn = 0;
    for (const block of plan.blocks) {
      if (mountBlock(block)) drawn += 1;
    }
    lastError = error || '';
    say(`账本已更新：${list.length} 条消息，${plan.totals.facts} 条事实，画了 ${drawn} 块，注入 ${plan.prompt.length} 字（${reason}）`);
    return plan;
  }

  /** 只补一条消息的块：宿主重画某条消息时用，避免整页闪一下。 */
  function renderOne(mesid) {
    if (!mounted) return;
    const { s, narrative } = compiled();
    if (!s.enabled || !narrative) return;
    const index = Number(mesid);
    if (!Number.isInteger(index) || index < 0) return;
    const list = entries();
    if (index >= list.length) return;
    try {
      const partial = planLedger(narrative, list.slice(0, index + 1), { budget: s.budget, inject: false });
      const block = partial.blocks.find((row) => row.index === index);
      if (block) mountBlock(block);
      else removeBlockAt(index);
    } catch (err) {
      warnOnce(`这一条消息的账本没画出来：${err?.message ?? err}`);
    }
  }

  function schedule(reason = 'change') {
    removeTimer(timer);
    timer = setTimeout(() => {
      timer = null;
      try {
        refreshNow(reason);
      } catch (err) {
        warnOnce(`账本刷新失败：${err?.message ?? err}`);
      }
    }, REFRESH_DELAY);
  }

  function bindEvents() {
    const source = safe(() => (typeof getEventSource === 'function' ? getEventSource() : null), null);
    if (!source || typeof source.on !== 'function') {
      warnOnce('拿不到事件源：账本不会跟着消息自动更新（仍可在设置里手动重放）');
      return 0;
    }
    const types = safe(() => (typeof getEventTypes === 'function' ? getEventTypes() : {}), {}) ?? {};
    const eventName = (key) => types[key] ?? String(key).toLowerCase();

    const sub = (key, handler) => {
      const name = eventName(key);
      const wrapped = (...args) => {
        try {
          handler(...args);
        } catch (err) {
          warnOnce(`处理 ${key} 事件时出错：${err?.message ?? err}`);
        }
      };
      try {
        source.on(name, wrapped);
        subscriptions.push({ source, name, wrapped });
      } catch {
        /* 单个事件订阅失败不影响其它事件 */
      }
    };

    // 一条消息渲染完：只补这一条
    for (const key of ['MESSAGE_RENDERED', 'CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED']) {
      sub(key, (mesid) => {
        if (typeof mesid === 'number') renderOne(mesid);
        else schedule('rendered');
      });
    }
    // 内容变了：后面的状态都可能变，整段重算
    for (const key of ['MESSAGE_EDITED', 'MESSAGE_SWIPED', 'MESSAGE_DELETED', 'MESSAGE_UPDATED', 'CHAT_CHANGED']) {
      sub(key, () => schedule(key));
    }
    // 生成开始前刷新一次注入，确保账本包含最新一条消息
    sub('GENERATION_STARTED', () => refreshNow('generation'));
    // 生成结束（消息落盘后）也刷一次，块不用等下一次事件
    sub('GENERATION_ENDED', () => schedule('generation-ended'));

    return subscriptions.length;
  }

  function unbindEvents() {
    for (const { source, name, wrapped } of subscriptions.splice(0)) {
      try {
        if (typeof source.removeListener === 'function') source.removeListener(name, wrapped);
        else if (typeof source.off === 'function') source.off(name, wrapped);
      } catch {
        /* ignore */
      }
    }
  }

  function mount() {
    if (mounted) return true;
    mounted = true;
    const bound = bindEvents();
    // 首屏的消息可能在我们订阅之前就渲染完了；先整体画一遍
    refreshNow('mount');
    say(`账本接上了（${bound} 个事件；${settings().enabled ? '已启用' : '开关关着，不介入'}）`);
    return true;
  }

  function unmount() {
    mounted = false;
    removeTimer(timer);
    timer = null;
    unbindEvents();
    clearAll();
  }

  function setEnabled(next) {
    const on = next === true;
    try {
      repository.saveSettings({ narrativeEnabled: on });
    } catch (err) {
      warnOnce(`开关没存下来：${err?.message ?? err}`);
    }
    cache = { key: '', narrative: null, error: '' };
    if (!on) {
      clearAll();
      say('账本已关闭：不再注入，也不再画块');
      return false;
    }
    refreshNow('enable');
    return true;
  }

  function isEnabled() {
    return settings().enabled;
  }

  function ledger() {
    const { s } = compiled();
    const declaration = describeDeclaration(s.declaration);
    return {
      settings: s,
      declaration,
      plan,
    };
  }

  function describe() {
    const { s } = compiled();
    const declaration = describeDeclaration(s.declaration);
    return {
      version: NARRATIVE_VERSION,
      mounted,
      enabled: s.enabled,
      inject: s.inject,
      budget: s.budget,
      usingPreset: s.usingPreset,
      declaration: {
        ok: declaration.ok,
        variables: declaration.variables,
        rules: declaration.rules,
        problems: declaration.problems.length,
        problemText: declaration.problemText,
      },
      entries: entries().length,
      totals: plan?.totals ?? null,
      blocks: plan?.blocks.length ?? 0,
      promptChars: plan?.prompt.length ?? 0,
      lines: plan?.lines ?? [],
      summary: plan?.summary ?? '',
      error: lastError,
    };
  }

  return {
    mount,
    unmount,
    refresh: refreshNow,
    renderOne,
    setEnabled,
    isEnabled,
    recordPrompt: (text) => writePrompt(text),
    ledger,
    describe,
    get plan() {
      return plan;
    },
  };
}
