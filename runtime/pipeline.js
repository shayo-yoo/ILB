// runtime/pipeline.js —— 把宿主快照变成 EvalRequest，调判定层，再把结果交给注入端口。
// 这是唯一懂"顺序"的文件。它不认识 script.js，也不知道界面长什么样。
// 每一步都单独 try/catch：任何一步炸了，只会让这一轮没有注入，不会让扩展整体崩掉（ILB-2.5）。

import { evaluate } from '../core/evaluate.js';
import { resolveBooks } from '../core/resolve-books.js';
import { expandMacros, normalizeVars, resolveChatId } from '../core/vars.js';
import { notifyObservers } from './registry.js';

function safeJson(v, fallback) {
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return fallback;
  }
}

function messageRole(m) {
  return m?.is_user === true ? 'user' : 'assistant';
}

function messageText(m) {
  if (!m) return '';
  if (typeof m === 'string') return m;
  return String(m.mes ?? m.content ?? '');
}

/** 心跳：宿主把 getContext() 的结果丢进来，这里只做"翻译" */
export function buildEvalRequest(ctx, books, settings, chatState, storedVars = {}) {
  const chat = Array.isArray(ctx?.chat) ? ctx.chat : [];
  const messages = chat.map((m) => ({ role: messageRole(m), content: messageText(m) }));

  const last = chat.length > 0 ? chat[chat.length - 1] : null;
  const userInput = last && last.is_user === true ? messageText(last) : '';

  const characters = ctx?.characters ?? [];
  const characterId = ctx?.characterId;
  const character = Array.isArray(characters) ? characters[Number(characterId)] ?? null : null;

  const world = character?.data?.extensions?.world ?? character?.extensions?.world ?? null;
  const boundBooks = Array.isArray(world) ? world.map(String) : world ? [String(world)] : null;

  const chatId = String(ctx?.chatId ?? ctx?.chat_metadata?.chat_id ?? 'default');
  const history = [];
  for (const book of books) {
    const bookState = chatState?.[book.book_id];
    if (!bookState || typeof bookState !== 'object') continue;
    for (const [entryId, rec] of Object.entries(bookState)) {
      if (!rec || typeof rec !== 'object') continue;
      history.push({ entryId, lastActiveAt: rec.lastActiveAt ?? null, activeSince: rec.activeSince ?? null });
    }
  }

  return {
    messages,
    userInput,
    characterDescription: String(character?.description ?? ''),
    personaDescription: String(ctx?.powerUserSettings?.persona_description ?? ''),
    scanDepth: settings.scanDepth,
    history,
    vars: { ...normalizeVars(ctx?.chatMetadata?.variables ?? {}), ...normalizeVars(storedVars) },
    trigger: 'generation',
    seed: `${chatId}:${messages.length}`,
    contextSize: Number(ctx?.maxContext ?? ctx?.contextSize ?? 0) || undefined,
    // 以下两项不是 EvalRequest 的正式字段，只给本轮第 0 步用
    boundBooks,
    chatId,
  };
}

/**
 * @param {object} deps
 *   repository  —— 数据端口（settings 命名空间）
 *   injector    —— 注入端口
 *   registry    —— 扩展点注册表
 *   logger      —— 可选 {info,warn,error}
 */
export function createPipeline(deps) {
  const { repository, injector, registry, logger } = deps;
  const log = {
    info: (m) => logger?.info?.(m),
    warn: (m) => logger?.warn?.(m),
    error: (m, e) => logger?.error?.(m, e),
  };

  let lastResult = null;
  let lastError = null;
  let lastRunAt = 0;
  /** 这一轮"没做"的原因（例如总开关被关掉）。和"出错"分开记，避免误报红旗。 */
  let lastSkip = null;

  function readContext(getContext) {
    const ctx = getContext();
    if (!ctx || typeof ctx !== 'object') throw new Error('拿不到 SillyTavern 的上下文');
    return ctx;
  }

  /**
   * 跑一轮。@param getContext 宿主提供，返回 SillyTavern getContext() 的结果
   * @returns {boolean} 是否发生了注入
   */
  function run(getContext, reason = 'api') {
    lastRunAt = Date.now();

    let ctx;
    try {
      ctx = readContext(getContext);
    } catch (err) {
      lastError = err;
      log.error('读取上下文失败，这一轮不注入', err);
      return false;
    }

    let settings;
    try {
      settings = repository.getSettings();
    } catch (err) {
      lastError = err;
      log.error('读取设置失败，这一轮不注入', err);
      return false;
    }

    // 总开关（ILB-6.5.2）：关掉就当这个扩展不存在——不判定、不注入、连上一轮的注入也清掉。
    if (settings.enabled === false) {
      try {
        injector.clear?.();
      } catch (err) {
        log.warn(`清理上一轮注入失败: ${err?.message ?? err}`);
      }
      lastResult = null;
      lastError = null;
      lastSkip = '总开关已关闭';
      return false;
    }
    lastSkip = null;

    const currentChatId = resolveChatId(ctx);

    let books;
    try {
      books = repository.listBooks();
    } catch (err) {
      lastError = err;
      log.error('读取书架失败，这一轮不注入', err);
      return false;
    }
    let request;
    let resolved;
    try {
      const chatState = repository.getChatState(currentChatId);
      request = buildEvalRequest(ctx, books, settings, chatState, repository.getVars(currentChatId));
      resolved = resolveBooks(books, {
        characterId: ctx.characterId,
        characterName: ctx.name2,
        boundBooks: request.boundBooks ?? null,
        manualState: repository.getManualState(),
      }, registry.activationProviders.list().map(({ id, impl }) => ({ id, label: impl?.label, test: impl?.test })));
    } catch (err) {
      lastError = err;
      log.error('准备判定输入失败，这一轮不注入', err);
      return false;
    }

    let result;
    try {
      // 独立逻辑（ILB-4.14）：只取"启用的书"里的逻辑，和条目的激活范围保持一致。
      const activeIds = new Set(resolved.activeBooks ?? []);
      const logics = books.filter((book) => activeIds.has(book.book_id)).flatMap((book) => book.logic ?? []);
      result = evaluate(request, { resolved, settings, logics });
    } catch (err) {
      lastError = err;
      log.error('判定层出错，已降级为不注入', err);
      try {
        injector.clear?.();
      } catch {
        /* 清不掉就算了，下一轮会覆盖 */
      }
      return false;
    }

    // 宏在这里展开：条目正文里的 {{ILB:chat.名字}} 用当前聊天的变量表替换。
    // 找不到的宏留下显眼标记（⟨未定义:名字⟩），不静默变成空字符串（D-0043）。
    try {
      const vars = request?.vars ?? {};
      for (const item of result?.activated ?? []) {
        if (item && typeof item.content === 'string' && item.content.includes('{{')) {
          item.content = expandMacros(item.content, { vars });
        }
      }
    } catch (err) {
      log.warn(`展开条目宏失败（保留原文）: ${err?.message ?? err}`);
    }

    // 流程里"记住"的值落盘：只写本聊天，下一轮注入时生效。写不进去不影响这一轮出现。
    try {
      const writes = result?.varWrites ?? {};
      if (Object.keys(writes).length > 0) repository.mergeVars(currentChatId, writes);
    } catch (err) {
      log.warn(`保存聊天变量失败（不影响这一轮）: ${err?.message ?? err}`);
    }

    try {
      notifyObservers(registry, result, request, (id, err) => log.warn(`观察者 ${id} 出错（已忽略）: ${err?.message ?? err}`));
    } catch {
      /* 观察者整体失效不影响主流程 */
    }

    let injected = false;
    try {
      injected = injector.apply(result, {
        chatId: currentChatId,
        reason,
        settings,
      }) !== false;
    } catch (err) {
      lastError = err;
      log.error('注入失败，这一轮当作没有世界书', err);
      try {
        injector.clear?.();
      } catch {
        /* ignore */
      }
      injected = false;
    }

    try {
      const state = {};
      for (const upd of result.stateUpdates) {
        const bookId = String(upd.entryId).includes('::') ? String(upd.entryId).split('::')[0] : '_';
        state[bookId] = state[bookId] ?? {};
        state[bookId][upd.entryId] = { lastActiveAt: upd.lastActiveAt, activeSince: upd.activeSince };
      }
      repository.mergeChatState(currentChatId, state);
    } catch (err) {
      log.warn(`保存时效状态失败（不影响这一轮）: ${err?.message ?? err}`);
    }

    lastResult = result;
    lastError = null;
    return injected;
  }

  return {
    run,
    getLastResult: () => lastResult,
    getLastError: () => lastError,
    getLastRunAt: () => lastRunAt,
    /** 设置改动后清掉上一轮结果，避免界面显示过期的诊断 */
    reset() {
      lastResult = null;
      lastError = null;
      lastSkip = null;
    },
    /** 供诊断面板用：这一轮为什么没出现/为什么出现 */
    describeLastRun() {
      if (!lastResult) {
        return {
          ran: false,
          at: lastRunAt,
          error: lastError ? String(lastError.message ?? lastError) : null,
          skipped: lastSkip,
        };
      }
      return {
        ran: true,
        at: lastRunAt,
        activated: lastResult.activated.map((a) => a.entryId),
        budget: lastResult.budget,
        books: lastResult.books,
        diagnostics: lastResult.diagnostics,
        error: lastError ? String(lastError.message ?? lastError) : null,
        skipped: null,
      };
    },
  };
}
