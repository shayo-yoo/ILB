// runtime/api.js —— 给别的扩展（以及用户脚本）用的稳定接口（ILB-9.x）
//
// 为什么要有这一层：别的扩展不该直接读 ILB 内部对象（repository / pipeline /
// 书的字段结构都会变）。它只认下面这几个入口，入口的版本号写清楚；内部怎么改，
// 是 ILB 自己的事。契约文档：docs/UI扩展接口.md。
//
// 原则：
//   1. 只暴露"读快照、改变量、调用逻辑、订阅变化"四件事，不暴露宿主对象。
//   2. 任何失败都返回 { ok:false, outcome, reason }，不把异常抛进调用方。
//   3. 只改变量，不改扩展设置、不改书本身——和 AI 调用的边界一致。
//
// 版本：1.1（在 1.0 上只加字段与可选参数，旧调用不受影响）
//   - call 返回 outcome: 'ok' | 'blocked' | 'error'、ran、passed、vars、unusedArgs、missingParams
//   - call 支持传逻辑 id、opts.nonce / text / messages / userInput / strict
//   - 同一楼层重复调用默认仍给同一随机结果；要"再抽一次"请传新的 nonce
//   - snapshot 的 logics[] 带 params
//   - set 拒绝 NaN / Infinity
//   - subscribe(非函数) 不再抛异常

import { evaluateFlow } from '../core/flow.js';
import { coerceValue, normalizeVars } from '../core/vars.js';

/** 接口契约版本。加字段不算破坏性变更，改字段语义才算。 */
export const API_VERSION = '1.2';

/** 供 UI 扩展判断"这版有哪些能力"，比 version 字符串更好用。 */
export const API_CAPS = [
  'snapshot',
  'set',
  'remove',
  'call',
  'callAsync',
  'ui',
  'subscribe',
  'outcome',
  'byId',
  'nonce',
  'context',
  'strict',
  'vars',
  'caps',
];

const NAME_MAX = 40;
const CALL_DEPTH_MAX = 3;

function scalarError(raw) {
  if (typeof raw === 'number' && !Number.isFinite(raw)) return '数字不合法（不能是 NaN / Infinity）';
  if (typeof raw === 'number' || typeof raw === 'boolean' || typeof raw === 'string') return '';
  return '只支持数字、文字、开关三种值';
}

function fail(reason, extra = {}) {
  return { ok: false, outcome: 'error', ran: false, passed: false, reason, ...extra };
}

/** 计时用。优先高精度时钟，没有就退回 Date.now()。 */
function now() {
  try {
    return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
  } catch {
    return Date.now();
  }
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

  function enabledBooks() {
    return booksOf().filter((b) => b && b.enabled !== false);
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
      caps: [...API_CAPS],
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
          params: Array.isArray(l.call?.params) ? l.call.params.slice(0, 12) : [],
        })),
      })),
    };
  }

  function set(name, value) {
    const key = String(name ?? '').trim();
    if (!key) return fail('变量名不能为空');
    if (key.length > NAME_MAX) return fail(`变量名最长 ${NAME_MAX} 个字`);
    const bad = scalarError(value);
    if (bad) return fail(bad);
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

  /**
   * 找逻辑：先按 id 精确，再按名字。
   * @returns {{logic?: object, ambiguous?: Array<{id,name,book}>}}
   */
  function findLogic(target) {
    const books = enabledBooks();
    for (const book of books) {
      const hit = (Array.isArray(book.logic) ? book.logic : []).find((l) => l.enabled !== false && l.id === target);
      if (hit) return { logic: hit };
    }
    const matches = [];
    for (const book of books) {
      for (const l of Array.isArray(book.logic) ? book.logic : []) {
        if (l.enabled !== false && l.name === target) matches.push({ id: l.id, name: l.name, book: book.name || book.book_id, logic: l });
      }
    }
    if (matches.length === 0) return {};
    if (matches.length > 1) return { ambiguous: matches.map(({ id, name, book }) => ({ id, name, book })) };
    return { logic: matches[0].logic };
  }

  function callLogicResolver(seed, depth = 0) {
    return (id, parentCtx) => {
      if (depth >= CALL_DEPTH_MAX) return null;
      const found = findLogic(String(id ?? '').trim());
      if (!found.logic) return null;
      try {
        return evaluateFlow(found.logic.flow, {
          text: '',
          messages: [],
          userInput: '',
          messageCount: tick(),
          seed: `${seed}:${found.logic.id}`,
          vars: {},
          activated: new Set(),
          // 「界面」指令要从被调用的逻辑里冒出来，所以这里跟着外层走
          uiAllowed: parentCtx?.uiAllowed === true,
          callLogic: callLogicResolver(`${seed}:${found.logic.id}`, depth + 1),
        });
      } catch {
        return null;
      }
    };
  }

  /**
   * 调用一条独立逻辑。
   * @param {string} name 逻辑名，或逻辑 id（`<书id>::L::<序号>`，推荐，跨书同名时用它）
   * @param {object} [args] 参数对象，键是 call.params 里的参数名（不是数组、不是顺序）
   * @param {{nonce?:string, text?:string, messages?:Array, userInput?:string, strict?:boolean}} [opts]
   */
  function call(name, args = {}, opts = {}) {
    const target = String(name ?? '').trim();
    const startedAt = now();
    if (!target) return fail('逻辑名不能为空');
    const found = findLogic(target);
    if (found.ambiguous) {
      const list = found.ambiguous.map((m) => `${m.book} / ${m.name}（${m.id}）`).join('、');
      return fail(`有 ${found.ambiguous.length} 条同名逻辑，请改传 id：${list}`, { candidates: found.ambiguous });
    }
    if (!found.logic) return fail(`没有叫「${target}」的已启用逻辑`);
    const logic = found.logic;
    try {
      const params = Array.isArray(logic.call?.params) ? logic.call.params : [];
      const bound = {};
      const unusedArgs = [];
      if (args && typeof args === 'object' && !Array.isArray(args)) {
        for (const key of Object.keys(args)) {
          if (!params.includes(key)) unusedArgs.push(key);
        }
      } else if (Array.isArray(args)) {
        return fail('args 要传对象（键是参数名），不是数组', { unusedArgs: [], missingParams: params.slice() });
      }
      for (const param of params) {
        const value = args && Object.prototype.hasOwnProperty.call(args, param) ? args[param] : undefined;
        if (value !== undefined) {
          const bad = scalarError(value);
          if (bad) return fail(`参数「${param}」${bad}`);
          bound[param] = coerceValue(value);
        }
      }
      const missingParams = params.filter((p) => !Object.prototype.hasOwnProperty.call(bound, p));
      if (opts && opts.strict === true && (unusedArgs.length > 0 || missingParams.length > 0)) {
        const bits = [];
        if (unusedArgs.length > 0) bits.push(`多余的参数：${unusedArgs.join('、')}`);
        if (missingParams.length > 0) bits.push(`缺少的参数：${missingParams.join('、')}`);
        return fail(`参数不对（${bits.join('；')}）`, { unusedArgs, missingParams });
      }
      const vars = { ...repository.getVars(chatId()), ...bound };
      const nonce = String(opts?.nonce ?? '').trim();
      const seed = `api:${chatId()}:${tick()}:${logic.id}${nonce ? `:${nonce}` : ''}`;
      const messages = Array.isArray(opts?.messages) ? opts.messages : [];
      const text = String(opts?.text ?? '');
      const userInput = String(opts?.userInput ?? '');
      const result = evaluateFlow(logic.flow, {
        text,
        messages,
        userInput,
        messageCount: tick(),
        seed,
        vars,
        activated: new Set(),
        // 用户点了按钮来调用 → 这次允许「界面」步骤产出指令（ILB-4.21）
        uiAllowed: true,
        callLogic: callLogicResolver(seed),
      });
      const durationMs = Math.max(0, Math.round(now() - startedAt));
      const writes = result.writes ?? {};
      if (Object.keys(writes).length > 0) {
        repository.mergeVars(chatId(), normalizeVars(writes));
      }
      const passed = result.passed !== false;
      const outcome = passed ? 'ok' : result.blocked === true ? 'blocked' : 'error';
      const out = {
        ok: passed,
        outcome,
        ran: true,
        passed,
        // 这条逻辑是谁：按 id 调用时名字可能重名，界面要分组记账就用 id（v0.14.1）
        id: logic.id,
        name: logic.name,
        reason: result.reason ?? '',
        writes,
        extra: result.extra ?? [],
        // 一次性界面指令：没有就是 null。不写聊天状态，不会在下一轮被读到。
        ui: result.ui ?? null,
        durationMs,
        steps: result.steps ?? [],
        vars: repository.getVars(chatId()),
        unusedArgs,
        missingParams,
      };
      emit('call', { name: target, id: logic.id, ok: passed, outcome, writes });
      if (out.ui) emit('ui', { name: target, id: logic.id, ui: out.ui });
      return out;
    } catch (err) {
      return fail(String(err?.message ?? err));
    }
  }

  /**
   * 和 call 一样，但**先让出一帧再跑**，并把失败也 resolve 出来。
   * 给界面用：调用前先把按钮置灰、底栏写「执行中…」，跑完再恢复。
   * 返回值与 call 完全相同（多一个 durationMs，call 里也有）。
   * @returns {Promise<object>} 永不 reject
   */
  async function callAsync(name, args = {}, opts = {}) {
    await new Promise((resolve) => {
      const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null;
      if (raf) raf(() => resolve());
      else setTimeout(resolve, 0);
    });
    try {
      return call(name, args, opts);
    } catch (err) {
      return fail(String(err?.message ?? err));
    }
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') {
      console.warn('[ILB] subscribe 需要传一个函数，已忽略');
      return () => {};
    }
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  const api = {
    version: API_VERSION,
    caps: [...API_CAPS],
    snapshot,
    set,
    remove,
    call,
    callAsync,
    subscribe,
    notify: (reason = 'manual') => emit(String(reason)),
    describe: () => ({
      version: API_VERSION,
      caps: [...API_CAPS],
      methods: ['snapshot', 'set', 'remove', 'call', 'callAsync', 'subscribe'],
      ui: ['openPanel', 'close'],
      events: ['ilb:ready', 'ilb:change'],
      callReturns: ['ok', 'outcome', 'ran', 'passed', 'id', 'name', 'reason', 'writes', 'extra', 'ui', 'durationMs', 'steps', 'vars', 'unusedArgs', 'missingParams'],
      notes: '只写聊天变量；不改设置与书。失败返回 { ok:false, outcome:"error", reason }。',
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
    document.dispatchEvent(new CustomEvent('ilb:ready', { detail: { version: API_VERSION, caps: [...API_CAPS] } }));
  } catch {
    /* 没 document 就算了 */
  }

  return api;
}
