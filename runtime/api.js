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

// 版本：1.4（v0.28.0，在 1.3 上只加命名空间与方法）
//   - bindings：角色卡 ↔ ILB 世界书的关联（增删查改、改名迁移、清理孤儿）
//   - runtime：preview（只算不跑）与 status（上一轮真跑的结果）
//   - worldbooks.deleteBook：删书，默认拒绝"还有角色挂着"的书
//   - importBook 开始校验 schema_version（比本版新 → NOT_SUPPORTED，比本版老 → 迁移）

import { evaluateFlow } from '../core/flow.js';
import { runnableStandaloneLogics } from '../core/logic-groups.js';
import { coerceValue, normalizeVars } from '../core/vars.js';
import { BINDING_LIMIT, BINDING_POLICIES, avatarProblem, bindingWhoName, newBindingId } from '../core/bindings.js';
import { buildResolveInput } from './pipeline.js';

/** 接口契约版本。加字段不算破坏性变更，改字段语义才算。 */
export const API_VERSION = '1.4';

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
  'ready',
  'worldbooks',
  'bindings',
  'runtime',
  'bookDelete',
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

export function createApi({
  repository,
  getContext,
  getChatId,
  notify = () => {},
  openPanel = null,
  closeUi = null,
  readHostContext = null,
  getProviders = null,
  getLastRun = null,
} = {}) {
  const listeners = new Set();

  function readHostSafely() {
    if (typeof readHostContext !== 'function') return null;
    try {
      return readHostContext();
    } catch {
      return null;
    }
  }

  function providersOf() {
    if (typeof getProviders !== 'function') return [];
    try {
      const list = getProviders();
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

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
    // v0.23.0：不挂书的逻辑也能被 AI / 按钮按名字或 id 调用（组启用才进候选）。
    let standalone = [];
    try {
      const groups = repository.listLogicGroups?.() ?? [];
      const activeIds = new Set(books.map((book) => book.book_id));
      standalone = runnableStandaloneLogics(groups, repository.listStandaloneLogics?.() ?? [], activeIds);
    } catch {
      standalone = [];
    }
    for (const book of books) {
      const hit = (Array.isArray(book.logic) ? book.logic : []).find((l) => l.enabled !== false && l.id === target);
      if (hit) return { logic: hit };
    }
    const hitStandalone = standalone.find((l) => l.id === target);
    if (hitStandalone) return { logic: hitStandalone };
    const matches = [];
    for (const book of books) {
      for (const l of Array.isArray(book.logic) ? book.logic : []) {
        if (l.enabled !== false && l.name === target) matches.push({ id: l.id, name: l.name, book: book.name || book.book_id, logic: l });
      }
    }
    for (const l of standalone) {
      if (l.name === target) matches.push({ id: l.id, name: l.name, book: '逻辑组', logic: l });
    }
    if (matches.length === 0) return {};
    if (matches.length > 1) return { ambiguous: matches.map(({ id, name, book }) => ({ id, name, book })) };
    return { logic: matches[0].logic };
  }

  function callLogicResolver(seed, depth = 0) {
    return (id, args, callerVars) => {
      if (depth >= CALL_DEPTH_MAX) return null;
      const found = findLogic(String(id ?? '').trim());
      if (!found.logic) return null;
      try {
        // 参数与返回值（v0.18）：和被调用逻辑在聊天里跑时一样——
        // 参数临时盖在调用方的变量上（不落盘），跑完的变量表当 locals 交回去。
        const bound = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
        const base = callerVars && typeof callerVars === 'object' ? callerVars : {};
        const flow = evaluateFlow(found.logic.flow, {
          text: '',
          messages: [],
          userInput: '',
          messageCount: tick(),
          seed: `${seed}:${found.logic.id}`,
          vars: { ...base, ...bound },
          activated: new Set(),
          // 「界面」指令要从被调用的逻辑里冒出来，所以这里跟着外层走
          uiAllowed: true,
          callLogic: callLogicResolver(`${seed}:${found.logic.id}`, depth + 1),
        });
        return { ...flow, locals: flow.vars ?? {} };
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

  // ---- 世界书接口（v0.27.0，P0） ----
  //
  // 给角色卡兼容扩展用：列书、取书、单本导出/导入（带冲突策略）、批量导入。
  // 约定：失败不抛异常，返回 { ok:false, error:{ code, message } }；
  // 所有方法都是 async，调用方可以统一 await。

  function apiError(err) {
    const extra = err && err.extra && typeof err.extra === 'object' ? err.extra : {};
    return {
      ok: false,
      error: {
        code: String(err && err.code ? err.code : 'ERROR'),
        message: String(err && err.message ? err.message : err),
        ...(err && err.id ? { id: String(err.id) } : {}),
        ...extra,
      },
    };
  }

  /** 造一个带错误码的异常，交给 apiError 翻译成 { ok:false, error }。 */
  function apiFail(code, message, extra = {}) {
    const err = new Error(message);
    err.code = code;
    const keys = Object.keys(extra);
    if (keys.length > 0) err.extra = extra;
    return err;
  }

  function briefBook(book) {
    return {
      id: book.book_id,
      name: book.name,
      enabled: book.enabled !== false,
      entries: Array.isArray(book.entries) ? book.entries.length : 0,
      logics: Array.isArray(book.logic) ? book.logic.length : 0,
      updatedAt: Number(book.updated_at) || 0,
      schemaVersion: Number(book.schema_version) || 2,
    };
  }

  function needBookMethod(name, fn) {
    if (typeof fn !== 'function') {
      const err = new Error(`这一版 ILB 还不支持 worldbooks.${name}`);
      err.code = 'NOT_SUPPORTED';
      throw err;
    }
    return fn;
  }

  const worldbooks = {
    async list(opts = {}) {
      try {
        const books = repository.listBooks() ?? [];
        const detail = opts?.detail === true;
        return {
          ok: true,
          books: books.map((book) => (detail ? { ...briefBook(book), book } : briefBook(book))),
        };
      } catch (err) {
        return apiError(err);
      }
    },

    async get(id) {
      try {
        const book = repository.getBook(String(id ?? ''));
        if (!book) return { ok: false, error: { code: 'NOT_FOUND', message: `没有这本书：${id}` } };
        return { ok: true, book };
      } catch (err) {
        return apiError(err);
      }
    },

    async has(id) {
      try {
        const books = repository.listBooks() ?? [];
        return { ok: true, exists: books.some((b) => b && b.book_id === String(id ?? '')) };
      } catch (err) {
        return apiError(err);
      }
    },

    /** 单本完整导出：{ schema_version, exported_at, book }。 */
    async exportBook(id) {
      try {
        const fn = needBookMethod('exportBook', repository.exportBook);
        const payload = fn.call(repository, String(id ?? ''));
        if (!payload) return { ok: false, error: { code: 'NOT_FOUND', message: `没有这本书：${id}` } };
        return { ok: true, ...payload };
      } catch (err) {
        return apiError(err);
      }
    },

    /**
     * 导入一本。
     * @param {object} payload `{ book }` 或书本身
     * @param {{onConflict?:'new'|'skip'|'overwrite'|'ask', targetId?:string}} opts
     */
    async importBook(payload, opts = {}) {
      try {
        const fn = needBookMethod('importBook', repository.importBook);
        const res = fn.call(repository, payload, opts);
        return { ok: true, id: res.id, action: res.action };
      } catch (err) {
        return apiError(err);
      }
    },

    /**
     * 批量导入：{ books: [...] } 或数组。逐本返回结果，不因一本失败而中断。
     * @returns {{ok:boolean, imported:Array<{id:string,action:string}>, failed:Array<{index:number,error:object}>}}
     */
    async importMany(payload, opts = {}) {
      const list = Array.isArray(payload) ? payload : Array.isArray(payload?.books) ? payload.books : null;
      if (!list) {
        return { ok: false, error: { code: 'BAD_PAYLOAD', message: '批量导入需要数组或 { books: [...] }' } };
      }
      const imported = [];
      const failed = [];
      for (let i = 0; i < list.length; i += 1) {
        try {
          const fn = needBookMethod('importBook', repository.importBook);
          const res = fn.call(repository, list[i], opts);
          imported.push({ index: i, id: res.id, action: res.action });
        } catch (err) {
          failed.push({
            index: i,
            error: {
              code: String(err && err.code ? err.code : 'ERROR'),
              message: String(err && err.message ? err.message : err),
            },
          });
        }
      }
      return { ok: failed.length === 0, imported, failed };
    },

    /**
     * 删一本书。
     * 默认拒绝"还有角色卡挂着"的书——那会把别人的关联悄悄弄断。
     * @param {string} id
     * @param {{cascade?: boolean}} [opts] cascade:true = 连关联一起删
     * @returns {{ok:true, id:string, removedBindings:number}|{ok:false, error:object}}
     */
    async deleteBook(id, opts = {}) {
      try {
        const key = String(id ?? '').trim();
        const book = repository.getBook(key);
        if (!book) return { ok: false, error: { code: 'NOT_FOUND', message: `没有这本书：${id}` } };
        const all = bindingsOf().filter((one) => one.bookId === key);
        const boundCount = all.filter((one) => !one.orphanedAt).length;
        if (boundCount > 0 && opts?.cascade !== true) {
          return {
            ok: false,
            error: {
              code: 'CONFLICT',
              message: `还有 ${boundCount} 个角色关联这本书`,
              boundCount,
            },
          };
        }
        repository.deleteBook(key);
        emit('worldbooks.deleteBook', { id: key, removedBindings: all.length });
        return { ok: true, id: key, removedBindings: all.length };
      } catch (err) {
        return apiError(err);
      }
    },
  };

  // ---- 角色卡关联（v0.28.0，P0） ----
  //
  // 一条关联 = 某个角色卡 × 某本 ILB 书 × 表态（auto / on / off）。
  // 约定与世界书接口一致：全部同步返回，失败返回 { ok:false, error:{code,message} }，不抛异常。

  function bindingsOf() {
    if (typeof repository.listBindings !== 'function') return [];
    try {
      return repository.listBindings() ?? [];
    } catch {
      return [];
    }
  }

  function avatarOf(input) {
    if (typeof input === 'string') return input.trim();
    return String(input?.avatar ?? '').trim();
  }

  function findBinding(id) {
    const key = String(id ?? '').trim();
    if (!key) return null;
    return bindingsOf().find((one) => one.id === key) ?? null;
  }

  function uniqueBindingId(existing, at) {
    const taken = new Set(existing.map((one) => one.id));
    let id = newBindingId(at);
    let n = 0;
    while (taken.has(id)) {
      n += 1;
      id = newBindingId(at + n);
    }
    return id;
  }

  const bindings = {
    /**
     * 列关联。
     * @param {{character?: string|{avatar:string}, bookId?: string, includeOrphaned?: boolean}} [opts]
     *   includeOrphaned 默认 true（角色卡删掉后留下的关联也列出来，界面才能提示清理）
     */
    list(opts = {}) {
      try {
        const avatar = avatarOf(opts?.character);
        const bookId = String(opts?.bookId ?? '').trim();
        const includeOrphaned = opts?.includeOrphaned !== false;
        const list = bindingsOf().filter((one) => {
          if (!includeOrphaned && one.orphanedAt) return false;
          if (avatar && one.character?.avatar !== avatar) return false;
          if (bookId && one.bookId !== bookId) return false;
          return true;
        });
        // 按创建时间升序：同一天建的多条，界面上的顺序不该每次刷新都变
        list.sort((a, c) => Number(a.createdAt) - Number(c.createdAt) || String(a.id).localeCompare(String(c.id)));
        return { ok: true, bindings: list, total: list.length };
      } catch (err) {
        return apiError(err);
      }
    },

    get(id) {
      try {
        const one = findBinding(id);
        if (!one) return { ok: false, error: { code: 'NOT_FOUND', message: `没有这条关联：${id}` } };
        return { ok: true, binding: one };
      } catch (err) {
        return apiError(err);
      }
    },

    /**
     * 建一条关联。
     * @param {{character:{avatar:string,name?:string}, bookId:string, policy?:'auto'|'on'|'off', note?:string}} input
     */
    create(input = {}) {
      try {
        const character = input && typeof input === 'object' && input.character && typeof input.character === 'object'
          ? input.character
          : {};
        const avatar = avatarOf(character);
        const problem = avatarProblem(avatar);
        if (problem) throw apiFail('BAD_PAYLOAD', problem, { field: 'character.avatar' });
        const bookId = String(input?.bookId ?? '').trim();
        if (!bookId) throw apiFail('BAD_PAYLOAD', '缺少 bookId', { field: 'bookId' });
        const policy = input?.policy == null ? 'auto' : String(input.policy);
        if (!BINDING_POLICIES.includes(policy)) {
          throw apiFail('BAD_PAYLOAD', `policy 只能是 ${BINDING_POLICIES.join(' / ')}`, { field: 'policy' });
        }
        if (!booksOf().some((book) => book.book_id === bookId)) {
          throw apiFail('NOT_FOUND', `没有这本书：${bookId}`, { field: 'bookId' });
        }
        const all = bindingsOf();
        if (all.length >= BINDING_LIMIT) {
          throw apiFail('BAD_PAYLOAD', `关联最多 ${BINDING_LIMIT} 条，请先清理不用的`, { field: 'bindings' });
        }
        const dup = all.find((one) => one.bookId === bookId && one.character?.avatar === avatar);
        if (dup) throw apiFail('CONFLICT', `「${bindingWhoName(dup)}」已经关联了这本书`, { id: dup.id });
        const at = Date.now();
        const created = repository.createBinding({
          id: uniqueBindingId(all, at),
          character: { avatar, name: String(character.name ?? '').trim() },
          bookId,
          policy,
          note: String(input?.note ?? ''),
          createdAt: at,
          updatedAt: at,
          orphanedAt: null,
        });
        emit('bindings.create', { id: created.id, bookId, avatar });
        return { ok: true, binding: created };
      } catch (err) {
        return apiError(err);
      }
    },

    /** 只改表态与备注；改别的一律忽略（关联的"谁"和"哪本书"是不变的）。 */
    update(id, patch = {}) {
      try {
        const one = findBinding(id);
        if (!one) return { ok: false, error: { code: 'NOT_FOUND', message: `没有这条关联：${id}` } };
        const next = { updatedAt: Date.now() };
        if (patch && patch.policy !== undefined) {
          const policy = String(patch.policy);
          if (!BINDING_POLICIES.includes(policy)) {
            throw apiFail('BAD_PAYLOAD', `policy 只能是 ${BINDING_POLICIES.join(' / ')}`, { field: 'policy' });
          }
          next.policy = policy;
        }
        if (patch && patch.note !== undefined) next.note = String(patch.note);
        const saved = repository.updateBinding(one.id, next);
        if (!saved) return { ok: false, error: { code: 'NOT_FOUND', message: `没有这条关联：${id}` } };
        emit('bindings.update', { id: saved.id });
        return { ok: true, binding: saved };
      } catch (err) {
        return apiError(err);
      }
    },

    /** 幂等：删不存在的不算错误。 */
    remove(id) {
      try {
        const key = String(id ?? '').trim();
        const removed = typeof repository.removeBinding === 'function' ? repository.removeBinding(key) === true : false;
        if (removed) emit('bindings.remove', { id: key });
        return { ok: true, removed };
      } catch (err) {
        return apiError(err);
      }
    },

    removeForCharacter(avatar) {
      try {
        const who = avatarOf(avatar);
        if (!who) throw apiFail('BAD_PAYLOAD', '缺少角色卡标识（avatar）', { field: 'avatar' });
        const removed = typeof repository.removeBindingsForCharacter === 'function'
          ? repository.removeBindingsForCharacter(who)
          : 0;
        if (removed > 0) emit('bindings.removeForCharacter', { avatar: who, removed });
        return { ok: true, removed };
      } catch (err) {
        return apiError(err);
      }
    },

    /**
     * 角色卡改名/换文件名后，把关联一起搬过去。
     * oldAvatar === newAvatar 时只刷新显示名。
     * @param {string} oldAvatar
     * @param {string} newAvatar
     * @param {{name?: string}} [opts]
     * @returns {{ok:true, updated:number, merged:number}}
     */
    renameCharacter(oldAvatar, newAvatar, opts = {}) {
      try {
        const from = avatarOf(oldAvatar);
        const to = avatarOf(newAvatar) || from;
        if (!from) throw apiFail('BAD_PAYLOAD', '缺少角色卡标识（oldAvatar）', { field: 'oldAvatar' });
        const problem = avatarProblem(to);
        if (problem) throw apiFail('BAD_PAYLOAD', problem, { field: 'newAvatar' });
        const res = typeof repository.renameBindings === 'function'
          ? repository.renameBindings(from, to, { name: opts?.name, now: Date.now() })
          : { updated: 0, merged: 0 };
        if (res.updated > 0 || res.merged > 0) emit('bindings.renameCharacter', { from, to, ...res });
        return { ok: true, updated: res.updated, merged: res.merged };
      } catch (err) {
        return apiError(err);
      }
    },

    /** 清掉角色卡已经删掉的关联（orphanedAt 非空）。 */
    purgeOrphans() {
      try {
        const removed = typeof repository.purgeOrphanBindings === 'function' ? repository.purgeOrphanBindings() : 0;
        if (removed > 0) emit('bindings.purgeOrphans', { removed });
        return { ok: true, removed };
      } catch (err) {
        return apiError(err);
      }
    },
  };

  // ---- 运行时（v0.28.0，P1） ----
  //
  // preview：只算不跑——不跑逻辑、不注入、不写状态、不发事件。
  // status ：上一轮真跑的结果；不持久化，也不含聊天正文、提示词、条目内容。

  function hostView(hostContext) {
    const host = hostContext && typeof hostContext === 'object' ? hostContext : null;
    if (!host || host.contextAvailable !== true) return { character: null, group: null };
    const avatar = String(host.character?.avatar ?? '').trim();
    const character = avatar || host.character?.name
      ? { avatar, name: String(host.character?.name ?? '') }
      : null;
    const group = host.group && host.group.id
      ? {
        id: String(host.group.id),
        members: (Array.isArray(host.group.members) ? host.group.members : []).map((member) => ({
          avatar: String(member?.avatar ?? ''),
          name: String(member?.name ?? ''),
        })),
      }
      : null;
    return { character, group };
  }

  function briefDecisions(input) {
    const details = input?.resolved?.details ?? {};
    return (input?.books ?? []).map((book) => {
      const detail = details[book.book_id] ?? {};
      return {
        id: book.book_id,
        name: book.name,
        enabled: detail.enabled === true,
        rule: detail.rule ?? 'manual',
        reason: detail.reason ?? '',
        binding: detail.binding ?? null,
      };
    });
  }

  const runtime = {
    /**
     * 预览：按"此刻"的角色/聊天算出这一轮会启用哪些书。
     * 与真跑共用 buildResolveInput，所以两边的 activeBooks 一定一致。
     */
    preview() {
      try {
        const context = getContext();
        const settings = repository.getSettings();
        const hostContext = readHostSafely();
        const input = buildResolveInput({ repository, context, settings, hostContext, providers: providersOf() });
        const host = hostView(hostContext);
        return {
          ok: true,
          at: Date.now(),
          chatId: input.chatId,
          character: host.character,
          group: host.group,
          books: briefDecisions(input),
          activeBooks: [...(input.resolved?.activeBooks ?? [])],
        };
      } catch (err) {
        return apiError(err);
      }
    },

    /** 上一轮真跑的结果。没跑过就 ran:false，不假装有数据。 */
    status() {
      try {
        const info = typeof getLastRun === 'function' ? getLastRun() : null;
        if (!info || info.ran !== true) return { ok: true, ran: false, at: 0, error: null };
        // 用"那一轮判定时读到的"宿主上下文，别用现在的：用户可能已经换角色了，
        // 拿新角色配旧结论会让人以为"刚跑的那轮"是这个角色。读不到才退回现读。
        const captured = info.books?.hostContext && typeof info.books.hostContext === 'object' ? info.books.hostContext : null;
        const host = hostView(captured ?? readHostSafely());
        const details = info.books?.details ?? {};
        const books = booksOf().map((book) => {
          const detail = details[book.book_id] ?? {};
          return {
            id: book.book_id,
            name: book.name,
            enabled: detail.enabled === true,
            rule: detail.rule ?? 'manual',
            reason: detail.reason ?? '',
            binding: detail.binding ?? null,
          };
        });
        return {
          ok: true,
          ran: true,
          at: Number(info.at) || 0,
          chatId: String(captured?.chatId ?? '') || chatId(),
          character: host.character,
          group: host.group,
          books,
          activeBooks: Array.isArray(info.books?.active) ? [...info.books.active] : [],
          error: info.error ?? null,
        };
      } catch (err) {
        return apiError(err);
      }
    },
  };

  const api = {
    version: API_VERSION,
    caps: [...API_CAPS],
    worldbooks,
    bindings,
    runtime,
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
      methods: [
        'snapshot', 'set', 'remove', 'call', 'callAsync', 'subscribe',
        'worldbooks.list', 'worldbooks.get', 'worldbooks.has', 'worldbooks.exportBook', 'worldbooks.importBook', 'worldbooks.importMany', 'worldbooks.deleteBook',
        'bindings.list', 'bindings.get', 'bindings.create', 'bindings.update', 'bindings.remove', 'bindings.removeForCharacter', 'bindings.renameCharacter', 'bindings.purgeOrphans',
        'runtime.preview', 'runtime.status',
      ],
      worldbooks: ['list', 'get', 'has', 'exportBook', 'importBook', 'importMany', 'deleteBook'],
      bindings: ['list', 'get', 'create', 'update', 'remove', 'removeForCharacter', 'renameCharacter', 'purgeOrphans'],
      runtime: ['preview', 'status'],
      ui: ['openPanel', 'close'],
      events: ['ilb:ready', 'ilb:change'],
      callReturns: ['ok', 'outcome', 'ran', 'passed', 'id', 'name', 'reason', 'writes', 'extra', 'ui', 'durationMs', 'steps', 'vars', 'unusedArgs', 'missingParams'],
      notes: '只写聊天变量；不改设置与书。失败返回 { ok:false, outcome:"error", reason }。1.4 起 worldbooks/bindings/runtime 失败返回 { ok:false, error:{code,message} }。',
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

  // 别的扩展（例如角色卡兼容扩展）可以 await ILB.api.ready，拿到同一份 api；
  // 它加载得比 ILB 早时，先等这个 Promise，或监听 ilb:ready 事件。
  api.ready = Promise.resolve(api);

  // 提示一下：别的扩展加载得比 ILB 早时，它拿不到 window.ILB；监听这个事件即可。
  try {
    document.dispatchEvent(new CustomEvent('ilb:ready', { detail: { version: API_VERSION, caps: [...API_CAPS] } }));
  } catch {
    /* 没 document 就算了 */
  }

  return api;
}
