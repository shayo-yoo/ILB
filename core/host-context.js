// core/host-context.js —— 纯函数（ILB-4.23）
// 「当前酒馆上下文中，哪些原生世界书是活的」这件事的**唯一**内部表示。
// 这里不读宿主、不碰 DOM：只做归一化、描述与匹配，宿主读取在 adapters/sillytavern-context.js。
//
// 为什么要这一层：以前只有"角色卡绑定了一串书名"，靠书名做字符串比较；
// 用户在酒馆里改个名、多绑一本额外书、换个 Persona，ILB 全都看不见。
// 现在把「来源」拆开记：同一个书名从哪个口子来的，说清楚，也就能解释"为什么启用"。

export const HOST_SOURCE_KINDS = [
  'global',
  'character-primary',
  'character-extra',
  'persona',
  'chat',
  'group-member',
  'unknown',
];

export const HOST_SOURCE_LABEL = {
  global: '全局世界书',
  'character-primary': '当前角色的主世界书',
  'character-extra': '当前角色的额外世界书',
  persona: 'Persona 世界书',
  chat: '当前聊天的世界书',
  'group-member': '群聊成员的世界书',
  unknown: '未知来源',
};

/** 启用策略（ILB-4.6）。顺序：强制停用 > 强制启用 > 始终启用 > 自动跟随 > 手动。 */
export const BOOK_STRATEGIES = ['auto', 'always', 'manual'];
export const STRATEGY_LABEL = {
  auto: '自动跟随酒馆',
  always: '始终启用',
  manual: '手动控制',
};
export const STRATEGY_HINT = {
  auto: '当前角色 / 聊天 / Persona / 全局关联到这本原生世界书时，自动启用',
  always: '不管当前是哪个角色、哪个聊天，一直启用',
  manual: '只看下面那个手动开关',
};

/** 三态覆盖：把"这次我想临时开/关"和"策略"分开，不再让两个开关打架。 */
export const BOOK_OVERRIDES = ['auto', 'on', 'off'];
export const OVERRIDE_LABEL = {
  auto: '自动（听策略的）',
  on: '强制启用',
  off: '强制停用',
};

export function emptyHostContext() {
  return {
    contextAvailable: false,
    chatId: '',
    character: { index: null, name: '', avatar: '', primaryWorld: '', additionalWorlds: [] },
    group: { id: null, name: '', members: [] },
    personaWorld: '',
    chatWorlds: [],
    globalWorlds: [],
    sources: [],
    unsupported: [],
    warnings: [],
    updatedAt: 0,
  };
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function str(v, fallback = '') {
  return typeof v === 'string' ? v : v == null ? fallback : String(v);
}

function cleanNames(list) {
  const out = [];
  for (const item of asArray(list)) {
    const name = str(item).trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * 把一个 Adapter 交来的 HostContext 洗成固定形状。
 * 缺什么就写"空"，并把"为什么缺"放进 warnings —— 绝不猜。
 */
export function normalizeHostContext(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const base = emptyHostContext();
  const sources = [];
  const seen = new Set();
  const addSource = (kind, name, extra = {}) => {
    const n = str(name).trim();
    if (!n) return;
    const key = `${kind}::${n}::${str(extra.characterName)}::${str(extra.characterIndex)}`;
    if (seen.has(key)) return;
    seen.add(key);
    sources.push({
      kind,
      name: n,
      characterName: str(extra.characterName),
      characterIndex: Number.isFinite(Number(extra.characterIndex)) ? Number(extra.characterIndex) : null,
    });
  };
  for (const item of asArray(src.sources)) {
    if (!item || typeof item !== 'object') continue;
    const kind = HOST_SOURCE_KINDS.includes(item.kind) ? item.kind : 'unknown';
    addSource(kind, item.name, item);
  }
  // 适配层没给 sources 时，从命名字段推导：命名列表是唯一事实来源，sources 是它们的展开视图。
  if (sources.length === 0) {
    for (const name of cleanNames(src.globalWorlds)) addSource('global', name);
    addSource('character-primary', src.character?.primaryWorld);
    for (const name of cleanNames(src.character?.additionalWorlds)) addSource('character-extra', name);
    addSource('persona', src.personaWorld);
    for (const name of cleanNames(src.chatWorlds)) addSource('chat', name);
    for (const member of asArray(src.group?.members)) {
      if (!member || typeof member !== 'object') continue;
      const who = { characterName: str(member.name), characterIndex: member.index };
      addSource('character-primary', member.primaryWorld, who);
      for (const name of cleanNames(member.additionalWorlds)) addSource('character-extra', name, who);
    }
  }
  return {
    contextAvailable: src.contextAvailable === true,
    chatId: str(src.chatId),
    character: {
      index: Number.isFinite(Number(src.character?.index)) ? Number(src.character.index) : null,
      name: str(src.character?.name),
      avatar: str(src.character?.avatar),
      primaryWorld: str(src.character?.primaryWorld),
      additionalWorlds: cleanNames(src.character?.additionalWorlds),
    },
    group: {
      id: src.group?.id == null || src.group?.id === '' ? null : str(src.group.id),
      name: str(src.group?.name),
      members: asArray(src.group?.members)
        .filter((m) => m && typeof m === 'object')
        .map((m) => ({
          index: Number.isFinite(Number(m.index)) ? Number(m.index) : null,
          name: str(m.name),
          avatar: str(m.avatar),
          primaryWorld: str(m.primaryWorld),
          additionalWorlds: cleanNames(m.additionalWorlds),
        })),
    },
    personaWorld: str(src.personaWorld),
    chatWorlds: cleanNames(src.chatWorlds),
    globalWorlds: cleanNames(src.globalWorlds),
    sources,
    unsupported: cleanNames(src.unsupported),
    warnings: asArray(src.warnings)
      .filter((w) => w && typeof w === 'object')
      .map((w) => ({ source: str(w.source, 'unknown'), message: str(w.message) }))
      .filter((w) => w.message),
    updatedAt: Math.max(0, Math.trunc(Number(src.updatedAt) || 0)),
  };
}

export function describeHostSource(source) {
  if (!source) return '未知来源';
  const label = HOST_SOURCE_LABEL[source.kind] ?? HOST_SOURCE_LABEL.unknown;
  if (source.kind === 'group-member' && source.characterName) return `${label}（${source.characterName}）`;
  return label;
}

/** 诊断页顶上那一行字：当前到底读到了什么。 */
export function summarizeHostContext(raw) {
  const host = raw && typeof raw === 'object' && raw.sources ? raw : normalizeHostContext(raw);
  if (!host.contextAvailable) {
    return {
      ok: false,
      line: '还没读到酒馆上下文（状态未知）',
      detail: host.warnings.map((w) => w.message).join('；'),
    };
  }
  if (host.sources.length === 0) {
    const who = host.character.name ? `（角色：${host.character.name}）` : '';
    return {
      ok: true,
      line: `当前没有关联任何原生世界书${who}`,
      detail: host.group.id ? '当前是群聊，按群成员读取' : '',
    };
  }
  const kinds = [];
  for (const source of host.sources) {
    const label = describeHostSource(source);
    if (!kinds.includes(label)) kinds.push(label);
  }
  return {
    ok: true,
    line: `读到 ${host.sources.length} 个原生来源${whoLine(host)}：${kinds.join('、')}`,
    detail: host.sources.map((s) => s.name).join('、'),
  };
}

function whoLine(host) {
  if (host.group.id) return host.group.name ? `（群聊：${host.group.name}）` : '（群聊）';
  if (host.character.name) return `（角色：${host.character.name}）`;
  return '';
}

/**
 * 一本书在原生来源里的"身份钥匙"。
 * 顺序就是匹配优先级（ILB-4.5）：显式映射 > 导入时的来源文件 > 名称快照。
 */
export function nativeKeysOf(book) {
  const keys = [];
  const push = (value, via) => {
    const v = str(value).trim();
    if (!v) return;
    if (keys.some((k) => k.value.toLowerCase() === v.toLowerCase())) return;
    keys.push({ value: v, via });
  };
  for (const name of asArray(book?.host?.nativeNames)) push(name, 'mapping');
  push(book?._source?.book_file, 'file');
  push(book?._source?.native_name, 'file');
  for (const name of asArray(book?.host?.aliases)) push(name, 'alias');
  return keys;
}

/**
 * 一本书和当前宿主上下文对上几处？
 * - `matched` 只收"有据可依"的命中（显式映射 / 导入来源 / 别名）。
 * - 只靠**显示名称相同**的，单独记在 `candidate` 里：不自动启用，等用户确认（ILB-4.5）。
 */
export function matchBookToHost(book, host) {
  const ctx = host && Array.isArray(host.sources) ? host : normalizeHostContext(host);
  const keys = nativeKeysOf(book);
  const matched = [];
  const candidate = [];
  for (const source of ctx.sources) {
    const hit = keys.find((k) => k.value.toLowerCase() === source.name.toLowerCase());
    if (hit) {
      matched.push({ name: source.name, kind: source.kind, label: describeHostSource(source), via: hit.via });
      continue;
    }
    const displayName = str(book?.name).trim();
    if (displayName && displayName.toLowerCase() === source.name.toLowerCase()) {
      candidate.push({ name: source.name, kind: source.kind, label: describeHostSource(source), via: 'name' });
    }
  }
  return { matched, candidate, sources: matched.length > 0 ? matched : candidate };
}

/** 一句人话：这本书为什么是现在这个状态。 */
export function describeMatch(match) {
  if (!match) return '没有匹配';
  if (match.matched.length > 0) {
    const labels = [];
    for (const m of match.matched) if (!labels.includes(m.label)) labels.push(m.label);
    return `${labels.join('、')}关联了这本书`;
  }
  if (match.candidate.length > 0) {
    return `有一条同名世界书（${match.candidate[0].name}），但只凭名字不自动启用`;
  }
  return '当前角色 / 聊天没有关联这本书';
}
