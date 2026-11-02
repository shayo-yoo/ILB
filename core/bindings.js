// core/bindings.js —— 纯函数（ILB-4.24）
// 「角色卡 ↔ ILB 世界书」的关联记录（bindings）的唯一形状与判定处。
// 这里不读宿主、不碰存档：只做规范化、校验、投票与文案。
// 存取在 adapters/repository.js，对外形状在 runtime/api.js。
//
// 为什么要有这一层：以前"哪本书在什么角色下该出现"只能靠酒馆自己的世界书绑定
// （character.data.extensions.world），ILB 自己说了不算，也不能一个角色挂多本 ILB 书。
// 现在关联写进 ILB 存档：一个角色可以挂多本，一本也可以被多个角色挂；每条关联还能
// 单独表态「自动 / 强制启用 / 强制停用」——群聊时按成员投票，on > auto > off。
//
// 三条硬规矩：
//   1. 没有 bindings 时一切照旧（老存档、老测试、老用户看到的行为不变）；
//   2. 读到的坏记录丢掉并留一句 warn，绝不抛异常、绝不因此让整份存档读不出来；
//   3. 未知字段原样保留（别的扩展以后往里加东西，不能被这里洗掉）。

/** 一条关联对某本书的表态。顺序即优先级：on > auto > off。 */
export const BINDING_POLICIES = ['auto', 'on', 'off'];

/** 单份存档最多留多少条关联。超过就拒绝新建，不静默丢老的。 */
export const BINDING_LIMIT = 5000;

export const AVATAR_MAX = 512;
export const BINDING_NAME_MAX = 200;
export const BINDING_NOTE_MAX = 500;

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function str(v, fallback = '') {
  return typeof v === 'string' ? v : v == null ? fallback : String(v);
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 角色卡标识（avatar 文件名）有什么问题？空字符串 = 没问题。
 * 这条规则和宿主无关：只要求非空、不过长、没有控制字符，原样存（大小写都不动）。
 */
export function avatarProblem(avatar) {
  const value = str(avatar).trim();
  if (!value) return '缺少角色卡标识（avatar）';
  if (value.length > AVATAR_MAX) return `角色卡标识最长 ${AVATAR_MAX} 个字`;
  if (CONTROL_CHARS.test(value)) return '角色卡标识里不能有控制字符';
  return '';
}

/** `bind-<base36 时刻>-<4 位随机>`：可读、可排序、不撞车。 */
export function newBindingId(now = Date.now(), rand = Math.random) {
  const tail = String(Math.floor(Math.abs(num(rand(), 0)) * 36 ** 4).toString(36)).padStart(4, '0').slice(-4);
  return `bind-${Math.trunc(num(now, Date.now())).toString(36)}-${tail}`;
}

/**
 * 把存档里的一条记录洗成固定形状。
 * 缺 avatar / bookId 的丢掉（返回 null）——这种记录没有任何判定意义，留着只会让人误会。
 * @param {object} raw
 * @param {{now?: number, warn?: (message: string) => void}} [opts]
 */
export function normalizeBinding(raw, opts = {}) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  if (!src) {
    opts.warn?.('有一条角色关联不是对象，已丢弃');
    return null;
  }
  const character = src.character && typeof src.character === 'object' ? src.character : {};
  const avatar = str(character.avatar).trim();
  const bookId = str(src.bookId).trim();
  if (!avatar || !bookId) {
    opts.warn?.(`有一条角色关联缺少${!avatar ? '角色卡标识' : ' bookId'}，已丢弃`);
    return null;
  }
  const now = num(opts.now, Date.now());
  const createdAt = Math.max(0, Math.trunc(num(src.createdAt, 0))) || now;
  const updatedAt = Math.max(0, Math.trunc(num(src.updatedAt, 0))) || createdAt;
  const orphanedAt = Math.max(0, Math.trunc(num(src.orphanedAt, 0)));
  return {
    // 未知字段先铺进来，已知字段再覆盖：以后别的扩展加的键不会被洗掉
    ...src,
    id: str(src.id).trim() || newBindingId(now),
    character: {
      ...character,
      avatar,
      name: str(character.name).trim().slice(0, BINDING_NAME_MAX),
    },
    bookId,
    policy: BINDING_POLICIES.includes(src.policy) ? src.policy : 'auto',
    note: str(src.note).slice(0, BINDING_NOTE_MAX),
    createdAt,
    updatedAt,
    orphanedAt: orphanedAt > 0 ? orphanedAt : null,
  };
}

/** 整表规范化。坏记录丢掉并说一句，不会让整份存档读不出来。 */
export function normalizeBindings(list, opts = {}) {
  const out = [];
  for (const raw of asArray(list)) {
    const one = normalizeBinding(raw, opts);
    if (one) out.push(one);
  }
  return out;
}

/**
 * 这一轮"谁在场"：群聊取成员，单聊取当前角色。
 * 读不到宿主上下文（或上下文不可用）时返回 null —— 投票必须弃权，
 * 这样老存档/老环境仍然走 1.3 的老路，行为一个字都不变。
 */
export function bindingAvatarsOf(hostContext) {
  if (!hostContext || typeof hostContext !== 'object') return null;
  if (hostContext.contextAvailable !== true) return null;
  const group = hostContext.group && typeof hostContext.group === 'object' ? hostContext.group : null;
  if (group && group.id) {
    const list = [];
    for (const member of asArray(group.members)) {
      const avatar = str(member?.avatar).trim();
      if (avatar && !list.includes(avatar)) list.push(avatar);
    }
    return list;
  }
  const avatar = str(hostContext.character?.avatar).trim();
  return avatar ? [avatar] : [];
}

/** 一本书被当前在场角色关联成了什么：'on' | 'auto' | 'off' | null（没人表态）。 */
export function bindingVote(bindings, bookId, avatars) {
  const relevant = relevantBindings(bindings, bookId, avatars);
  if (relevant.length === 0) return null;
  if (relevant.some((b) => b.policy === 'on')) return 'on';
  if (relevant.some((b) => b.policy === 'auto')) return 'auto';
  return 'off';
}

/** 参与投票的那些关联（同书、同在场角色、没被标成孤儿）。 */
export function relevantBindings(bindings, bookId, avatars) {
  if (!Array.isArray(bindings) || bindings.length === 0) return [];
  if (!Array.isArray(avatars) || avatars.length === 0) return [];
  const id = str(bookId);
  return bindings.filter(
    (b) => b && b.bookId === id && !b.orphanedAt && avatars.includes(str(b.character?.avatar).trim()),
  );
}

/**
 * 这条判定是哪条关联说了算：按 on > auto > off 找第一条。
 * 只用于"为什么启用"的展示，不参与判定本身。
 */
export function pickBinding(bindings, bookId, avatars) {
  const relevant = relevantBindings(bindings, bookId, avatars);
  if (relevant.length === 0) return null;
  const wanted = bindingVote(relevant, bookId, avatars) ?? 'auto';
  const hit = relevant.find((b) => b.policy === wanted) ?? relevant[0];
  return {
    id: hit.id,
    avatar: hit.character?.avatar ?? '',
    name: hit.character?.name ?? '',
    policy: hit.policy,
  };
}

/** 关联里的角色叫什么：没存名字时退回文件名（去掉扩展名），绝不显示空白。 */
export function bindingWhoName(binding) {
  // 既能吃完整记录（{character:{avatar,name}}），也能吃 pickBinding 给的摘要（{avatar,name}）：
  // 这两个形状都在用，少一种就会在"为什么启用"里显示成「这个角色」。
  const character = binding?.character && typeof binding.character === 'object' ? binding.character : binding;
  const name = str(character?.name).trim();
  if (name) return name;
  const avatar = str(character?.avatar).trim();
  return avatar.replace(/\.(png|jpg|jpeg|webp)$/i, '') || '这个角色';
}

/**
 * 一句人话：这本书为什么因为关联而变成现在这个状态。
 * @param {{policy: string, binding?: object, isGroup?: boolean}} args
 */
export function describeBinding({ policy, binding, isGroup = false } = {}) {
  const who = isGroup ? '群成员' : '当前角色';
  const name = bindingWhoName(binding);
  if (policy === 'on') return `${who}「${name}」关联了这本书，并设为强制启用`;
  if (policy === 'off') return `${who}「${name}」把这本书设为强制停用`;
  return `${who}「${name}」关联了这本书`;
}

/** 关联在界面上的称呼：书名由调用方补，这里只说"谁"。 */
export function describeBindingTarget(binding) {
  return `「${bindingWhoName(binding)}」`;
}

/**
 * 角色卡改名/换文件名时，关联要跟着走。纯计算，不改入参。
 *
 * 两种情形：
 *   · 只换名字（oldAvatar === newAvatar）：把同角色的记录上的名字刷新一遍；
 *   · 换了文件名（重命名角色卡）：把记录的 avatar 改成新的；改完若和已有的
 *     「同一角色 + 同一本书」撞车，保留 updatedAt 较新的一条，其余的合并掉。
 *
 * @param {object[]} bindings 已经 normalizeBinding 过的记录
 * @param {string} oldAvatar
 * @param {string} newAvatar
 * @param {{name?: string, now?: number}} [opts]
 * @returns {{bindings: object[], updated: number, merged: number, changed: boolean}}
 */
export function planRename(bindings, oldAvatar, newAvatar, opts = {}) {
  const from = str(oldAvatar).trim();
  const to = str(newAvatar).trim() || from;
  const name = str(opts.name).trim().slice(0, BINDING_NAME_MAX);
  const now = num(opts.now, Date.now());
  const list = asArray(bindings).filter(Boolean);
  const result = { bindings: list.slice(), updated: 0, merged: 0, changed: false };
  if (!from) return result;

  const renameAll = from !== to;
  const touched = new Set();
  const next = list.map((b) => {
    const avatar = str(b.character?.avatar).trim();
    if (avatar !== from) return b;
    if (!renameAll && (!name || b.character?.name === name)) return b;
    const changedOne = {
      ...b,
      character: {
        ...b.character,
        avatar: to,
        name: name || b.character?.name || '',
      },
      updatedAt: now,
    };
    touched.add(changedOne);
    return changedOne;
  });
  if (touched.size === 0) return result;

  // 合并：同一角色 + 同一本书只留一条（新的优先；时间一样时留原来就在前面的那条）
  const kept = [];
  const index = new Map();
  let merged = 0;
  for (const b of next) {
    const key = `${str(b.character?.avatar)}\u0000${str(b.bookId)}`;
    const at = index.get(key);
    if (at === undefined) {
      index.set(key, kept.length);
      kept.push(b);
      continue;
    }
    merged += 1;
    const current = kept[at];
    const curAt = num(current.updatedAt, 0);
    const nextAt = num(b.updatedAt, 0);
    if (nextAt > curAt) kept[at] = b;
  }

  // updated 只数"活下来并且真的被改过"的记录，合并掉的单独记在 merged 里
  result.bindings = kept;
  result.updated = kept.filter((b) => touched.has(b)).length;
  result.merged = merged;
  result.changed = touched.size > 0;
  return result;
}
