// core/resolve-books.js —— 纯函数
// "这一轮到底有哪些书在场"的唯一判定处（ILB-3.5 / ILB-4.2.1 第 0 步）。
// 不做 IO、不读宿主、不抛错。读不到东西一律回退，绝不中断。
//
// v0.15（ILB-4.6）：启用策略从"两个开关 + 书名比对"改成
// 策略（自动跟随 / 始终启用 / 手动控制）+ 三态覆盖（自动 / 强制开 / 强制关），
// 优先级：强制关 > 强制开 > 始终启用 > 自动跟随 > 手动。
// 没拿到 hostContext 时（老调用方、单测）走完全一样的老路，行为不变。

import { BOOK_STRATEGIES, BOOK_OVERRIDES, STRATEGY_LABEL, describeMatch, matchBookToHost } from './host-context.js';
import { strategyOf, legacyStrategyOf } from './model.js';

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function matches(haystack, needle) {
  const n = String(needle ?? '');
  if (!n) return false;
  const h = String(haystack ?? '');
  if (!h) return false;
  return h === n || h.toLowerCase() === n.toLowerCase();
}

/**
 * @param {object[]} books 已经过 normalizeBook 的书
 * @param {object} context
 *   { characterId, characterName, boundBooks: string[]|null, manualState: Record<book_id, boolean>,
 *     hostContext?: HostContext, hostLink?: {enabled?: boolean, sources?: object} }
 *   boundBooks 为 null 表示"读不到角色卡绑定"，老路下 character 模式回退为手动
 * @param {{id: string, label?: string, test: (book: object, ctx: object) => boolean|null}[]} providers
 */
export function resolveBooks(books, context = {}, providers = []) {
  const boundRaw = context.boundBooks;
  const bound = Array.isArray(boundRaw) ? boundRaw.map((x) => String(x)) : null;
  const manualState = context.manualState && typeof context.manualState === 'object' ? context.manualState : {};
  const hostContext = context.hostContext && typeof context.hostContext === 'object' ? context.hostContext : null;
  const hostLink = context.hostLink && typeof context.hostLink === 'object' ? context.hostLink : {};
  const hostEnabled = hostLink.enabled !== false;

  const activeBooks = [];
  const inactiveBooks = [];
  const reasons = {};
  const details = {};
  const warnings = [];
  const entriesByBook = {};
  const pool = [];
  const poolIds = new Set();

  for (const book of asArray(books)) {
    if (!book || !book.book_id) continue;

    const decided = decideBook(book, { bound, manualState, context, providers, hostContext, hostEnabled });
    reasons[book.book_id] = decided.reason;
    details[book.book_id] = {
      enabled: decided.enabled,
      rule: decided.rule ?? 'manual',
      strategy: decided.strategy ?? strategyOf(book.activation),
      override: decided.override ?? 'auto',
      reason: decided.reason,
      sources: asArray(decided.sources),
      matched: asArray(decided.matched),
      candidate: asArray(decided.candidate),
    };
    if (decided.warning) warnings.push({ bookId: book.book_id, message: decided.warning });

    entriesByBook[book.book_id] = asArray(book.entries);

    const inPool = decided.enabled || book.pool?.share === true;
    if (decided.enabled) activeBooks.push(book.book_id);
    else inactiveBooks.push(book.book_id);

    if (inPool) {
      for (const entry of asArray(book.entries)) {
        if (!entry || !entry.id || poolIds.has(entry.id)) continue;
        poolIds.add(entry.id);
        pool.push(entry);
      }
    }
  }

  return {
    activeBooks,
    inactiveBooks,
    reasons,
    details,
    warnings,
    entriesByBook,
    pool,
    hostContext,
    isPooled: (id) => poolIds.has(id),
  };
}

function decideBook(book, { bound, manualState, context, providers, hostContext, hostEnabled }) {
  // 1) 扩展点优先：任何一个提供者表态 true/false，就听它的；null 表示不表态
  for (const provider of asArray(providers)) {
    if (!provider || typeof provider.test !== 'function') continue;
    let verdict = null;
    try {
      verdict = provider.test(book, context);
    } catch {
      verdict = null; // 提供者炸了 = 它没意见，不能因此让书消失
    }
    if (verdict === true) return { enabled: true, rule: 'provider', reason: provider.label || `由 ${provider.id} 启用` };
    if (verdict === false) {
      return { enabled: false, rule: 'provider', reason: provider.label ? `被 ${provider.label} 关闭` : `被 ${provider.id} 关闭` };
    }
  }

  const strategy = strategyOf(book.activation);
  const override = BOOK_OVERRIDES.includes(book.activation?.override) ? book.activation.override : 'auto';
  const manualOn = manualState[book.book_id] ?? book.activation?.manual !== false;
  const base = { strategy, override };

  // 2) 强制停用：比什么策略都大
  if (override === 'off') {
    return { ...base, enabled: false, rule: 'force-off', reason: '你把它设为「强制停用」（策略是' + STRATEGY_LABEL[strategy] + '，被手动覆盖）' };
  }
  // 3) 强制启用
  if (override === 'on') {
    return { ...base, enabled: true, rule: 'force-on', reason: '你把它设为「强制启用」（策略是' + STRATEGY_LABEL[strategy] + '，被手动覆盖）' };
  }

  // 4) 始终启用
  if (strategy === 'always') {
    return { ...base, enabled: true, rule: 'always', reason: '这本书设为「始终启用」' };
  }

  // 5) 自动跟随酒馆
  if (strategy === 'auto') {
    if (!hostContext) return legacyCharacterMode(book, { bound, manualState, context, base });
    if (hostContext.contextAvailable !== true) {
      return {
        ...base,
        enabled: manualOn,
        rule: 'auto-unknown',
        reason: manualOn ? '暂时读不到酒馆上下文，先按手动「开」处理' : '暂时读不到酒馆上下文，先按手动「关」处理',
        warning: '有书设为「自动跟随酒馆」，但这一轮没读到宿主上下文；已退回手动状态',
      };
    }
    if (!hostEnabled) {
      return legacyCharacterMode(book, { bound, manualState, context, base, why: '宿主联动总开关关着' });
    }
    const match = matchBookToHost(book, hostContext);
    if (match.matched.length > 0) {
      return {
        ...base,
        enabled: true,
        rule: 'auto',
        reason: describeMatch(match),
        sources: match.matched,
        matched: match.matched,
        candidate: match.candidate,
      };
    }
    if (match.candidate.length > 0) {
      return {
        ...base,
        enabled: false,
        rule: 'auto-candidate',
        reason: describeMatch(match),
        warning: '有一本同名世界书，但只凭名字相同不自动启用；确认是同一本之后，在书籍详情里「建立映射」',
        candidate: match.candidate,
      };
    }
    return { ...base, enabled: false, rule: 'auto', reason: '当前角色 / 聊天没有关联这本书', matched: [], candidate: [] };
  }

  // 6) 手动控制（含未知 strategy 的兜底）
  return {
    ...base,
    enabled: manualOn,
    rule: 'manual',
    reason: manualOn ? '你手动打开了这本书' : '你手动关掉了这本书',
  };
}

/**
 * 老路：没有宿主上下文时，"自动跟随"退回到"角色卡绑定了哪些书"。
 * 这段和 v0.14 的 character 模式一字不差，保证老数据、老测试、老用户看到的东西不变。
 */
function legacyCharacterMode(book, { bound, manualState, context, base, why = '' }) {
  const prefix = why ? `${why}，` : '';
  if (bound === null) {
    const manual = manualState[book.book_id] ?? book.activation?.manual !== false;
    return {
      ...base,
      enabled: manual,
      rule: 'legacy-unknown',
      reason: `${prefix}读不到角色卡绑定，已按手动${manual ? '开启' : '关闭'}处理`,
      warning: '未能读取角色卡的世界书绑定，这本书已回退为手动控制',
    };
  }

  const wanted = asArray(book.activation?.characters).map((x) => String(x));
  const names = [context.characterId, context.characterName].filter(Boolean).map((x) => String(x));
  const hitByCharacter = wanted.length > 0 && names.some((n) => wanted.some((w) => matches(n, w)));
  if (hitByCharacter) return { ...base, enabled: true, rule: 'legacy-character', reason: `${prefix}角色卡在白名单里` };

  const selfNames = [book.name, book._source?.book_file].filter(Boolean);
  const hitByBinding = bound.some((b) => selfNames.some((s) => matches(b, s)));
  if (hitByBinding) return { ...base, enabled: true, rule: 'legacy-character', reason: `${prefix}角色卡绑定了这本书` };

  return { ...base, enabled: false, rule: 'legacy-character', reason: `${prefix}当前角色卡没有绑定它` };
}

/** 给 UI 用的策略文案（避免每个页面各写一份）。 */
export function describeStrategy(activation) {
  return STRATEGY_LABEL[strategyOf(activation)] ?? STRATEGY_LABEL.manual;
}

export { legacyStrategyOf, BOOK_STRATEGIES };
