// core/resolve-books.js —— 纯函数
// "这一轮到底有哪些书在场"的唯一判定处（ILB-3.5 / ILB-4.2.1 第 0 步）。
// 不做 IO、不读宿主、不抛错。读不到东西一律回退，绝不中断。

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
 *   { characterId, characterName, boundBooks: string[]|null, manualState: Record<book_id, boolean> }
 *   boundBooks 为 null 表示"读不到角色卡绑定"，此时 character 模式回退为手动
 * @param {{id: string, label?: string, test: (book: object, ctx: object) => boolean|null}[]} providers
 */
export function resolveBooks(books, context = {}, providers = []) {
  const boundRaw = context.boundBooks;
  const bound = Array.isArray(boundRaw) ? boundRaw.map((x) => String(x)) : null;
  const manualState = context.manualState && typeof context.manualState === 'object' ? context.manualState : {};

  const activeBooks = [];
  const inactiveBooks = [];
  const reasons = {};
  const warnings = [];
  const entriesByBook = {};
  const pool = [];
  const poolIds = new Set();

  for (const book of asArray(books)) {
    if (!book || !book.book_id) continue;

    const decided = decideBook(book, { bound, manualState, context, providers });
    reasons[book.book_id] = decided.reason;
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
    warnings,
    entriesByBook,
    pool,
    isPooled: (id) => poolIds.has(id),
  };
}

function decideBook(book, { bound, manualState, context, providers }) {
  // 1) 扩展点优先：任何一个提供者表态 true/false，就听它的；null 表示不表态
  for (const provider of asArray(providers)) {
    if (!provider || typeof provider.test !== 'function') continue;
    let verdict = null;
    try {
      verdict = provider.test(book, context);
    } catch {
      verdict = null; // 提供者炸了 = 它没意见，不能因此让书消失
    }
    if (verdict === true) return { enabled: true, reason: provider.label || `由 ${provider.id} 启用` };
    if (verdict === false) return { enabled: false, reason: provider.label ? `被 ${provider.label} 关闭` : `被 ${provider.id} 关闭` };
  }

  const mode = book.activation?.mode ?? 'manual';

  if (mode === 'always') {
    return { enabled: true, reason: '这本书设为「永远启用」' };
  }

  if (mode === 'character') {
    if (bound === null) {
      const manual = manualState[book.book_id] ?? book.activation?.manual !== false;
      return {
        enabled: manual,
        reason: manual ? '读不到角色卡绑定，已按手动开启处理' : '读不到角色卡绑定，已按手动关闭处理',
        warning: '未能读取角色卡的世界书绑定，这本书已回退为手动控制',
      };
    }

    const wanted = asArray(book.activation?.characters).map((x) => String(x));
    const names = [context.characterId, context.characterName].filter(Boolean).map((x) => String(x));
    const hitByCharacter = wanted.length > 0 && names.some((n) => wanted.some((w) => matches(n, w)));
    if (hitByCharacter) return { enabled: true, reason: '角色卡在白名单里' };

    const selfNames = [book.name, book._source?.book_file].filter(Boolean);
    const hitByBinding = bound.some((b) => selfNames.some((s) => matches(b, s)));
    if (hitByBinding) return { enabled: true, reason: '角色卡绑定了这本书' };

    return { enabled: false, reason: '设为跟随角色卡，但当前角色卡没有绑定它' };
  }

  // manual（含未知 mode 的兜底）
  const manual = manualState[book.book_id] ?? book.activation?.manual !== false;
  return { enabled: manual, reason: manual ? '你手动打开了这本书' : '你手动关掉了这本书' };
}
