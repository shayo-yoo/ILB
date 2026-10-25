// runtime/api.js —— 给别的扩展（以及用户脚本）用的稳定接口（ILB-9.x）
//
// 为什么要有这一层：以后做"可定制 UI"扩展时，UI 扩展不该直接读 ILB 内部对象
// （repository / pipeline / 书的字段结构都会变）。它只认下面这几个入口，
// 入口的版本号写清楚；内部怎么改，是 ILB 自己的事。
//
// 原则：
//   1. 只暴露"读快照、改变量、调用逻辑、订阅变化"四件事，不暴露宿主对象。
//   2. 任何失败都返回 { ok:false, reason }，不把异常抛进调用方的事件循环。
//   3. 只改变量，不改扩展设置、不改书本身——和 AI 调用的边界一致。

import { evaluateFlow } from '../core/flow.js';
import { coerceValue, normalizeVars } from '../core/vars.js';

/** 接口契约版本。加字段不算破坏性变更，改字段语义才算。 */
export const API_VERSION = '1.0';

const NAME_MAX = 40;

function asScalar(raw) {
  if (typeof raw === 'number' || typeof raw === 'boolean' || typeof raw === 'string') return raw;
  return null;
}

function fail(reason) {
  return { ok: false, reason };
}

export function createApi({ repository, getContext, getChatId, notify = () => {}, openPanel = null, closeUi = null } = {}) {
  const listeners = new Set();

  function chatId() {
    try {
      return getChatId();
    } catch {
      return 'default';
    }
  }

  function tick() {
    try {
      const chat = getContext()?.chat;
      return Array.isArray(chat) ? chat.length : 0;
    } catch {
      return 0;
    }
  }

  function booksOf() {
    try {
      return repository.listBooks();
    } catch {
      return [];
    }
  }

  function emit(reason, detail = {}) {
    const payload = { version: API_VERSION, reason, chatId: chatId(), tick: tick(), ...detail };
    for (const fn of [...listeners]) {
      try {
        fn(payload);
      } catch (err) {
        console.warn('[ILB] UI 订阅者报错（已忽略）', err);
      }
    }
    try {
      document.dispatchEvent(new CustomEvent('ilb:change', { detail: payload }));
    } catch {
      /* 没有 document 时（测试/脚本）只走回调 */
    }
  }

  function snapshot() {
    const vars = repository.getVars(chatId());
    return {
      version: API_VERSION,
      chatId: chatId(),
      tick: tick(),
      vars,
      books: booksOf().map((b) => ({
        id: b.book_id,
        name: b.name,
        enabled: b.enabled !== false,
        entries: Array.isArray(b.entries) ? b.entries.length : 0,
        logics: (Array.isArray(b.logic) ? b.logic : []).map((l) => ({
          id: l.id,
          name: l.name,
          enabled: l.enabled !== false,
          exposed: l.call?.exposed === true,
        })),
      })),
    };
  }

  function set(name, value) {
    const key = String(name ?? '').trim();
    if (!key) return fail('变量名不能为空');
    if (key.length > NAME_MAX) return fail(`变量名最长 ${NAME_MAX} 个字`);
    if (asScalar(value) === null) return fail('只支持数字、文字、开关三种值');
    try {
      const merged = repository.mergeVars(chatId(), normalizeVars({ [key]: coerceValue(value) }));
      emit('set', { name: key, value: merged[key] });
      return { ok: true, name: key, value: merged[key] };
    } catch (err) {
      return fail(String(err?.message ?? err));
    }
  }

  function remove(name) {
    const key = String(name ?? '').trim();
    if (!key) return fail('变量名不能为空');
    try {
      repository.deleteVar(chatId(), key);
      emit('remove', { name: key });
      return { ok: true, name: key };
    } catch (err) {
      return fail(String(err?.message ?? err));
    }
  }

  function call(name, args = {}) {
    const target = String(name ?? '').trim();
    if (!target) return fail('逻辑名不能为空');
    let found = null;
    for (const book of booksOf()) {
      if (book.enabled === false) continue;
      const hit = (Array.isArray(book.logic) ? book.logic : []).find((l) => l.enabled !== false && l.name === target);
      if (hit) {
        found = hit;
        break;
      }
    }
    if (!found) return fail(`没有叫「${target}」的已启用逻辑`);
    try {
      const vars = { ...repository.getVars(chatId()) };
      const bound = {};
      const params = Array.isArray(found.call?.params) ? found.call.params : [];
      params.forEach((param, index) => {
        const value = args && Object.prototype.hasOwnProperty.call(args, param) ? args[param] : undefined;
        if (value !== undefined) bound[param] = coerceValue(value);
      });
      Object.assign(vars, bound);
      const seed = `api:${chatId()}:${tick()}:${found.id}`;
      const result = evaluateFlow(found.flow, {
        text: '',
        messages: [],
        userInput: '',
        messageCount: tick(),
        seed,
        vars,
        activated: [],
        callLogic: null,
      });
      const writes = result.writes ?? {};
      if (Object.keys(writes).length > 0) {
        repository.mergeVars(chatId(), normalizeVars(writes));
      }
      emit('call', { name: target, ok: result.passed !== false, writes });
      return {
        ok: result.passed !== false,
        reason: result.reason ?? '',
        writes,
        extra: result.extra ?? [],
        steps: result.steps ?? [],
      };
    } catch (err) {
      return fail(String(err?.message ?? err));
    }
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') throw new TypeError('subscribe 需要传一个函数');
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  const api = {
    version: API_VERSION,
    snapshot,
    set,
    remove,
    call,
    subscribe,
    notify: (reason = 'manual') => emit(String(reason)),
    describe: () => ({
      version: API_VERSION,
      methods: ['snapshot', 'set', 'remove', 'call', 'subscribe'],
      ui: ['openPanel', 'close'],
      events: ['ilb:change'],
      notes: '只写聊天变量；不改设置与书。失败返回 { ok:false, reason }。',
    }),
    ui: {
      openPanel: (tab) => {
        if (typeof openPanel !== 'function') return fail('界面还没准备好');
        try {
          openPanel(tab);
          return { ok: true };
        } catch (err) {
          return fail(String(err?.message ?? err));
        }
      },
      close: () => {
        if (typeof closeUi !== 'function') return fail('界面还没准备好');
        try {
          closeUi();
          return { ok: true };
        } catch (err) {
          return fail(String(err?.message ?? err));
        }
      },
    },
  };

  // 提示一下：别的扩展加载得比 ILB 早时，它拿不到 window.ILB；监听这个事件即可。
  try {
    document.dispatchEvent(new CustomEvent('ilb:ready', { detail: { version: API_VERSION } }));
  } catch {
    /* 没 document 就算了 */
  }

  return api;
}
