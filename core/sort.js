/**
 * 列表排序（v0.22.0，v0.23.0 起双排序）。
 *
 * 规则：排序只影响"看"，不改数据、不改判定。每种列表各记一份选择（收录/注入/手动/名称/
 * 创建/上次修改/触发次数），选择存在存档的 ui.listSort 里，下次打开还是这个排法。
 *
 * 两层排序：
 * 1. **启用优先**：启用的在前、停用的在后。这一层永远生效，不用任何设置。
 * 2. 主排序 + 次排序：主键相等时看次键；都相等时保持原来的先后。
 *
 * 手动排序用的是 `ui.order` 这个权重（数字越大越靠前），不是"上移/下移"。
 * 触发次数来自 `stats`（见 adapters/repository.js），可以按当前聊天或全局看。
 */

/** 每个列表支持哪些排序键。books 没有触发次数；注入顺序只对规则有意义。 */
export const SORT_KEYS = {
  shelf: ['imported', 'name', 'created', 'updated'],
  rules: ['imported', 'inject', 'manual', 'name', 'created', 'updated', 'hits'],
  logic: ['imported', 'manual', 'name', 'created', 'updated', 'hits'],
};

export const SORT_LABEL = {
  imported: '收录顺序',
  inject: '注入顺序',
  manual: '手动权重',
  name: '名称',
  created: '创建时间',
  updated: '上次修改',
  hits: '触发次数',
};

export const SORT_HINT = {
  imported: '按导入/新建时的先后，最老的在前。',
  inject: '按注入到上下文里的先后：位置（先/后…）、深度、同层权重。',
  manual: '按你给每条填的排序权重，数字越大越靠前。和注入权重无关。',
  name: '按名称排（中文按拼音）。',
  created: '按创建时间，新的在前。老数据没有记录时间的排在最后。',
  updated: '按上次修改时间，刚改过的在前。',
  hits: '按被触发（真正出现/逻辑跑通）的次数，多的在前。',
};

/** 次排序的 "不设" 选项。 */
export const SECOND_NONE = 'none';

/** 没写过排序设置时的默认值：保持老版本的收录顺序；次排序不设。 */
export function defaultSorts() {
  const base = { key: 'imported', dir: 'asc', secondKey: SECOND_NONE, secondDir: 'asc' };
  return { shelf: { ...base }, rules: { ...base }, logic: { ...base } };
}

const DIR_LABEL = { asc: '正序', desc: '倒序' };

/** 把存档里读到的排序设置洗成可信形状；keys 不支持就退回收录顺序。 */
export function normalizeSort(raw, list) {
  const allowed = SORT_KEYS[list] ?? SORT_KEYS.rules;
  const src = raw && typeof raw === 'object' ? raw : {};
  const ok = allowed.includes(src.key);
  const key = ok ? src.key : 'imported';
  // 键被换掉时方向也跟着回到这个键的默认方向，避免出现「收录顺序（倒序）」这种半截状态。
  const dir = ok ? (src.dir === 'desc' ? 'desc' : src.dir === 'asc' ? 'asc' : defaultDir(key)) : defaultDir(key);
  const secondOk = allowed.includes(src.secondKey) && src.secondKey !== key;
  const secondKey = secondOk ? src.secondKey : SECOND_NONE;
  const secondDir = secondOk
    ? (src.secondDir === 'desc' ? 'desc' : src.secondDir === 'asc' ? 'asc' : defaultDir(secondKey))
    : 'asc';
  return { key, dir, secondKey, secondDir };
}

export function normalizeSorts(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    shelf: normalizeSort(src.shelf, 'shelf'),
    rules: normalizeSort(src.rules, 'rules'),
    logic: normalizeSort(src.logic, 'logic'),
  };
}

export function defaultDir(key) {
  if (key === 'imported' || key === 'name' || key === 'inject') return 'asc';
  return 'desc';
}

export function sortLabel(spec) {
  const key = SORT_LABEL[spec?.key] ?? spec?.key ?? '';
  const base = `${key}（${DIR_LABEL[spec?.dir] ?? '正序'}）`;
  const second = spec?.secondKey && spec.secondKey !== SECOND_NONE ? SORT_LABEL[spec.secondKey] : '';
  return second
    ? `${base}，再看${second}（${DIR_LABEL[spec?.secondDir] ?? '正序'}）`
    : `${base}，启用的在前`;
}

function orderOf(item) {
  const n = Number(item?.ui?.order);
  return Number.isFinite(n) ? n : 0;
}

function createdOf(item) {
  const n = Number(item?.ui?.createdAt ?? item?.created_at);
  return Number.isFinite(n) ? n : 0;
}

function updatedOf(item) {
  const n = Number(item?.ui?.updatedAt ?? item?.updated_at);
  return Number.isFinite(n) ? n : 0;
}

function nameOf(item) {
  return String(item?.name ?? item?.title ?? '');
}

/** 注入位置按「越靠前越先」排：来自 core/settings-defaults.js 的 POSITIONS。 */
const POSITION_RANK = {
  before_char: 0,
  after_char: 1,
  in_chat: 2,
};

function injectOf(item) {
  const rank = POSITION_RANK[item?.injection?.position] ?? 9;
  const depth = Number(item?.injection?.depth) || 0;
  return [rank, depth];
}

/** 默认的"启用"判断：条目/逻辑看 enabled，书看手动开关（调用方可覆盖）。 */
function defaultEnabled(item) {
  if (item && typeof item.enabled === 'boolean') return item.enabled;
  if (item?.activation?.manual === false) return false;
  return true;
}

/**
 * 排一份列表。
 * @param {Array} items
 * @param {{key?:string,dir?:string,secondKey?:string,secondDir?:string}} spec
 * @param {Function|{hitsOf?:Function,enabledOf?:Function}} [opts]
 *   旧调用可传 `hitsOf` 函数；新调用传 `{hitsOf, enabledOf}`。
 * 返回新数组（不原地改），排序稳定：相等时保持原来的先后。
 */
export function sortList(items, spec, opts = null) {
  const list = Array.isArray(items) ? items : [];
  const hitsOf = typeof opts === 'function' ? opts : opts?.hitsOf ?? null;
  const enabledOf = typeof opts === 'object' && opts?.enabledOf ? opts.enabledOf : defaultEnabled;
  const key = spec?.key ?? 'imported';
  const dir = spec?.dir === 'desc' ? -1 : 1;
  const secondKey = spec?.secondKey && spec.secondKey !== SECOND_NONE ? spec.secondKey : null;
  const secondDir = spec?.secondDir === 'desc' ? -1 : 1;

  const valueOf = (item, k) => {
    if (k === 'manual') return orderOf(item);
    if (k === 'created') return createdOf(item);
    if (k === 'updated') return updatedOf(item);
    if (k === 'hits') return typeof hitsOf === 'function' ? Number(hitsOf(item)) || 0 : 0;
    if (k === 'inject') return injectOf(item);
    return 0;
  };

  const compareBy = (a, b, k) => {
    if (k === 'name') return nameOf(a).localeCompare(nameOf(b), 'zh-Hans-CN');
    if (k === 'inject') {
      const av = valueOf(a, k);
      const bv = valueOf(b, k);
      for (let i = 0; i < av.length; i += 1) {
        if (av[i] !== bv[i]) return av[i] - bv[i];
      }
      return 0;
    }
    return valueOf(a, k) - valueOf(b, k);
  };

  const indexed = list.map((item, index) => ({ item, index }));
  indexed.sort((a, b) => {
    // 第一层：启用的永远在前（停用的不参与主/次排序的跨组比较）
    const ea = enabledOf(a.item) ? 0 : 1;
    const eb = enabledOf(b.item) ? 0 : 1;
    if (ea !== eb) return ea - eb;
    // 第二层：主排序
    let d = key === 'imported' ? 0 : compareBy(a.item, b.item, key);
    if (d !== 0) return d * dir;
    // 第三层：次排序
    if (secondKey) {
      d = compareBy(a.item, b.item, secondKey);
      if (d !== 0) return d * secondDir;
    }
    // 第四层：原顺序（收录顺序的正/倒由主键方向决定）
    return (a.index - b.index) * (key === 'imported' ? dir : 1);
  });
  return indexed.map((x) => x.item);
}
