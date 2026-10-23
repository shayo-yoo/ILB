// adapters/inject.js —— 注入端口（ILB-5.2）
// 主路径是 setExtensionPrompt：它是宿主给扩展用的正式接口，不碰对话、不落盘、不改历史。
// 位置映射：before_char → BEFORE_PROMPT(2)；after_char → IN_PROMPT(0)；in_chat → IN_CHAT(1) + 深度。
// 同一个位置/深度/角色的条目合并成一个 prompt 块，避免把提示词切得太碎（ILB-7.9）。

const POSITION_ENUM = { before_char: 2, after_char: 0, in_chat: 1 };
const ROLE_ENUM = { system: 0, user: 1, assistant: 2 };

export function createInjector({ getContext }) {
  // 上一轮用过的 key，用来做"这一轮没用到就清空"，避免残留注入
  let lastKeys = new Map();

  function setter() {
    const ctx = getContext();
    const fn = ctx?.setExtensionPrompt;
    if (typeof fn !== 'function') {
      throw new Error('这个版本的 SillyTavern 没有 setExtensionPrompt，ILB 暂时无法注入');
    }
    return fn.bind(ctx);
  }

  function keyOf(position, depth, role) {
    return `ILB::${position}::${depth}::${role}`;
  }

  function apply(result, meta = {}) {
    const set = setter();
    const settings = meta.settings ?? {};
    const separator = settings.injectSeparator === true ? '\n\n---\n\n' : '\n\n';

    const groups = new Map();
    for (const item of result?.activated ?? []) {
      const position = item?.injection?.position ?? 'after_char';
      const depth = Number(item?.injection?.depth ?? 4);
      const role = item?.injection?.role ?? 'system';
      const key = keyOf(position, depth, role);
      if (!groups.has(key)) {
        groups.set(key, {
          position,
          depth,
          role,
          pos: POSITION_ENUM[position] ?? 0,
          posRole: ROLE_ENUM[role] ?? 0,
          parts: [],
        });
      }
      const content = String(item?.content ?? '').trim();
      if (content) groups.get(key).parts.push(content);
    }

    // 先把这一轮要留下的写进去
    for (const [key, group] of groups) {
      const text = group.parts.join(separator);
      try {
        set(key, text, group.pos, group.depth, 0, group.posRole);
      } catch (err) {
        throw new Error(`写入注入内容失败（${key}）：${err?.message ?? err}`);
      }
    }

    // 再把上一轮有、这一轮没有的清掉
    for (const [key, prev] of lastKeys) {
      if (groups.has(key)) continue;
      try {
        set(key, '', prev.pos, prev.depth, 0, prev.posRole);
      } catch {
        // 清不掉不影响结果：空字符串本身不会注入内容
      }
    }

    lastKeys = new Map(
      [...groups.entries()].map(([key, g]) => [key, { pos: g.pos, depth: g.depth, posRole: g.posRole }]),
    );

    return true;
  }

  /** 出错时兜底：把所有已知 key 清空，宁可没有世界书，也不留半截提示词（ILB-1.2.3） */
  function clear() {
    let set;
    try {
      set = setter();
    } catch {
      return false;
    }
    for (const [key, prev] of lastKeys) {
      try {
        set(key, '', prev.pos, prev.depth, 0, prev.posRole);
      } catch {
        /* ignore */
      }
    }
    lastKeys = new Map();
    return true;
  }

  return { apply, clear, keyOf };
}
