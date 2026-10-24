// narrative/checkpoint.js —— 旧楼层的"状态存档"（v0.7.0）。
//
// 为什么需要它：账本平时是"按聊天记录重放"算出来的。用户如果装了楼层管理/记忆增强类
// 插件，把旧楼层隐藏或删掉，重放就会少掉那些事实——用着用着状态自己退了。
//
// 做法（与用户讨论后定下的折中）：
//   - 只把**离最新几条之外的旧楼层**折成一个"检查点"存起来：`upto` 条消息之后的状态；
//   - 最新的 `every` 条（默认 5）永远现场重算，因为用户可能正在重新生成、滑动或修改它们；
//   - 检查点只按"聊天 + 声明"匹配；旧楼层被改写/删除不会让它失效（这正是要保住的东西），
//     要重来就手动「重建账本」。
//
// 存储位置：`extension_settings.independent_lorebook.settings.narrativeCheckpoints`。
// 只保留最近 maxChats 条聊天，避免设置无限膨胀。

export const CHECKPOINT_DEFAULTS = Object.freeze({ every: 5, maxChats: 8 });

/** 判断"当前是哪条聊天"。不同 ST 版本字段不同，按可靠性从高到低取。 */
export function chatKeyOf(ctx) {
  try {
    if (!ctx || typeof ctx !== 'object') return '__default__';
    const direct = ctx.chatId ?? ctx.chatMetadata?.chat_id ?? ctx.chatMetadata?.chatId;
    if (direct) return String(direct);
    if (Array.isArray(ctx.characters) && ctx.characterId !== undefined) {
      const character = ctx.characters[ctx.characterId];
      if (character?.name) return `char:${character.name}`;
    }
    if (ctx.name2) return `char:${ctx.name2}`;
  } catch {
    /* 取不到就退回默认桶 */
  }
  return '__default__';
}

/**
 * @param {{repository: object, maxChats?: number}} options
 */
export function createCheckpointStore({ repository, maxChats = CHECKPOINT_DEFAULTS.maxChats } = {}) {
  function readAll() {
    try {
      const settings = repository.getSettings();
      const map = settings?.narrativeCheckpoints;
      return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
    } catch {
      return {};
    }
  }

  function writeAll(map) {
    try {
      repository.saveSettings({ narrativeCheckpoints: map });
      return true;
    } catch {
      return false;
    }
  }

  /** 取某条聊天的检查点；声明变了、结构坏了都当没有。 */
  function load(chatKey, declKey) {
    const entry = readAll()[chatKey];
    if (!entry || entry.decl !== declKey) return null;
    if (!entry.state || typeof entry.state !== 'object' || !entry.state.vars) return null;
    if (!Number.isInteger(entry.upto) || entry.upto < 0) return null;
    return { upto: entry.upto, state: entry.state, totals: entry.totals ?? {}, at: entry.at ?? 0 };
  }

  /** 存一个检查点（upto 条消息之后的状态）。返回写入的条目或 null。 */
  function save(chatKey, declKey, upto, state, totals = {}) {
    if (!Number.isInteger(upto) || upto < 0 || !state || !state.vars) return null;
    const map = { ...readAll() };
    map[chatKey] = { decl: declKey, upto, state, totals, at: Date.now() };
    const keys = Object.keys(map).sort((a, b) => (map[b]?.at ?? 0) - (map[a]?.at ?? 0));
    for (const key of keys.slice(maxChats)) delete map[key];
    writeAll(map);
    return map[chatKey];
  }

  function clear(chatKey) {
    const map = { ...readAll() };
    delete map[chatKey];
    writeAll(map);
  }

  function list() {
    return readAll();
  }

  return { load, save, clear, list };
}
