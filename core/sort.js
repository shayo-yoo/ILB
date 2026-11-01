/**
 * 列表排序（v0.22.0）。
 *
 * 规则：排序只影响"看"，不改数据、不改判定。每种列表各记一份选择（收录/手动/名称/
 * 创建/上次修改/触发次数），选择存在存档的 ui.listSort 里，下次打开还是这个排法。
 *
 * 手动排序用的是 `ui.order` 这个权重（数字越大越靠前），不是"上移/下移"。
 * 触发次数来自 `stats`（见 adapters/repository.js），可以按当前聊天或全局看。
 */

/** 每个列表支持哪些排序键。books 没有触发次数。 */
export const SORT_KEYS = {
  shelf: ['imported', 'name', 'created', 'updated'],
  rules: ['imported', 'manual', 'name', 'created', 'updated', 'hits'],
  logic: ['imported', 'manual', 'name', 'created', 'updated', 'hits'],
};

export const SORT_LABEL = {
  imported: '收录顺序',
  manual: '手动权重',
  name: '名称',
  created: '创建时间',
  updated: '上次修改',
  hits: '触发次数',
};

export const SORT_HINT = {
  imported: '按导入/新建时的先后，最老的在前。',
  manual: '按你给每条填的排序权重，数字越大越靠前。和注入权重无关。',
  name: '按名称排（中文按拼音）。',
  created: '按创建时间，新的在前。老数据没有记录时间的排在最后。',
  updated: '按上次修改时间，刚改过的在前。',
  hits: '按被触发（真正出现/逻辑跑通）的次数，多的在前。',
};

/** 没写过排序设置时的默认值：保持老版本的收录顺序。 */
export function defaultSorts() {
  return {
    shelf: { key: 'imported', dir: 'asc' },
    rules: { key: 'imported', dir: 'asc' },
    logic: { key: 'imported', dir: 'asc' },
  };
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
  return { key, dir };
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
  if (key === 'imported' || key === 'name') return 'asc';
  return 'desc';
}

export function sortLabel(spec) {
  const key = SORT_LABEL[spec?.key] ?? spec?.key ?? '';
  return `${key}（${DIR_LABEL[spec?.dir] ?? '正序'}）`;
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

/**
 * 排一份列表。`hitsOf(item)` 只在 key=hits 时被调用。
 * 返回新数组（不原地改），排序稳定：相等时保持原来的先后。
 */
export function sortList(items, spec, hitsOf = null) {
  const list = Array.isArray(items) ? items : [];
  const key = spec?.key ?? 'imported';
  const dir = spec?.dir === 'desc' ? -1 : 1;
  const indexed = list.map((item, index) => ({ item, index }));
  const cmp = (a, b) => {
    let d = 0;
    if (key === 'manual') d = orderOf(a.item) - orderOf(b.item);
    else if (key === 'name') d = nameOf(a.item).localeCompare(nameOf(b.item), 'zh-Hans-CN');
    else if (key === 'created') d = createdOf(a.item) - createdOf(b.item);
    else if (key === 'updated') d = updatedOf(a.item) - updatedOf(b.item);
    else if (key === 'imported') d = 0; // 由 index 决定先后，方向在下面统一处理
    else if (key === 'hits') {
      const av = typeof hitsOf === 'function' ? Number(hitsOf(a.item)) || 0 : 0;
      const bv = typeof hitsOf === 'function' ? Number(hitsOf(b.item)) || 0 : 0;
      d = av - bv;
    }
    if (d === 0) return (a.index - b.index) * (key === 'imported' ? dir : 1);
    return d * dir;
  };
  return indexed.sort(cmp).map((x) => x.item);
}
