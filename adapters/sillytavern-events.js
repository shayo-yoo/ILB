// adapters/sillytavern-events.js —— 宿主边界（ILB-4.9）
// 所有"酒馆里什么东西变了"的订阅都集中在这里：谁变了、什么时候刷新、刷新几次，都在这一处决定。
// 别的地方不许再 source.on(...) —— 不然迟早出现两个回调抢着刷同一个面板。
//
// 设计取舍（D-0056）：
//   · 只在"会影响启用状态"的事件上刷新，别的一律不订阅；
//   · 同一批事件在 debounceMs 内合并成一次刷新，避免切角色时连刷七八次；
//   · 事件名用 eventTypes 里的真名，拿不到就用字符串名兜底，再拿不到就记下来给诊断页看。

export const HOST_EVENT_GROUPS = [
  {
    key: 'character',
    label: '角色切换/编辑',
    events: ['CHARACTER_PAGE_LOADED', 'CHARACTER_EDITED', 'CHARACTER_RENAMED', 'CHARACTER_DELETED', 'CHARACTER_DUPLICATED'],
  },
  {
    key: 'chat',
    label: '聊天切换',
    events: ['CHAT_CHANGED', 'CHAT_LOADED', 'CHAT_CREATED', 'CHAT_DELETED', 'CHAT_RENAMED'],
  },
  {
    key: 'group',
    label: '群聊变化',
    events: ['GROUP_UPDATED', 'GROUP_CHAT_CREATED', 'GROUP_CHAT_DELETED'],
  },
  {
    key: 'persona',
    label: 'Persona 变化',
    events: ['PERSONA_CHANGED', 'PERSONA_CREATED', 'PERSONA_UPDATED', 'PERSONA_RENAMED', 'PERSONA_DELETED'],
  },
  {
    key: 'worldinfo',
    label: '世界书关联变化',
    events: ['WORLDINFO_UPDATED', 'WORLDINFO_SETTINGS_UPDATED', 'WORLDINFO_FORCE_ACTIVATE'],
  },
];

/**
 * @param {object} deps
 *   getEventSource —— 返回宿主 eventSource（有 on/removeListener）
 *   getEventTypes  —— 返回宿主的 event_types 表
 *   onChange       —— (payload: {reasons: string[], groups: string[], at: number}) => void
 */
export function createHostWatcher({ getEventSource, getEventTypes, onChange, logger, debounceMs = 150, timer } = {}) {
  const setTimer = timer?.set ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = timer?.clear ?? ((h) => clearTimeout(h));
  const handlers = [];
  const pending = new Set();
  let handle = null;
  let subscribed = false;
  let report = { subscribed: [], skipped: [], failures: [], at: 0 };

  function resolveName(types, name) {
    const mapped = types && typeof types === 'object' ? types[name] : undefined;
    return typeof mapped === 'string' && mapped ? mapped : name;
  }

  function flush() {
    handle = null;
    if (pending.size === 0) return;
    const groups = [...pending];
    pending.clear();
    const reasons = HOST_EVENT_GROUPS.filter((g) => groups.includes(g.key)).map((g) => g.label);
    try {
      onChange?.({ reasons, groups, at: Date.now() });
    } catch (err) {
      logger?.warn?.(`ILB 刷新回调出错（已忽略）：${err?.message ?? err}`);
    }
  }

  function schedule(groupKey) {
    pending.add(groupKey);
    if (handle != null) return;
    handle = setTimer(flush, Math.max(0, Number(debounceMs) || 0));
  }

  /** 订阅。可以重复调用：第二次直接返回上一次的报告。 */
  function subscribe() {
    if (subscribed) return report;
    subscribed = true;
    const next = { subscribed: [], skipped: [], failures: [], at: Date.now() };
    let source = null;
    try {
      source = getEventSource?.() ?? null;
    } catch (err) {
      next.failures.push({ event: '*', reason: `拿不到事件源：${err?.message ?? err}` });
    }
    if (!source || typeof source.on !== 'function') {
      next.failures.push({ event: '*', reason: '酒馆没有给出事件源，只能按"生成时刷新"兜底' });
      report = next;
      return report;
    }
    let types = null;
    try {
      types = getEventTypes?.() ?? null;
    } catch {
      types = null;
    }
    const seen = new Set();
    for (const group of HOST_EVENT_GROUPS) {
      for (const event of group.events) {
        const name = resolveName(types, event);
        if (seen.has(name)) {
          next.skipped.push({ event, reason: '和前面的事件同名，已合并' });
          continue;
        }
        seen.add(name);
        const handler = () => schedule(group.key);
        try {
          source.on(name, handler);
          handlers.push({ source, name, handler });
          next.subscribed.push({ event, as: name, group: group.key });
        } catch (err) {
          next.failures.push({ event, reason: String(err?.message ?? err) });
        }
      }
    }
    report = next;
    return report;
  }

  function dispose() {
    if (handle != null) {
      clearTimer(handle);
      handle = null;
    }
    pending.clear();
    for (const { source, name, handler } of handlers.splice(0)) {
      try {
        if (typeof source.off === 'function') source.off(name, handler);
        else if (typeof source.removeListener === 'function') source.removeListener(name, handler);
      } catch {
        /* 宿主不认就随它去，反正这个扩展要卸载了 */
      }
    }
    subscribed = false;
  }

  return { subscribe, dispose, describe: () => ({ ...report, active: subscribed, listening: handlers.length }) };
}
