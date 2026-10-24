// narrative/catalog.js —— 实体目录："东西是什么"（不随剧情变）。
//
// 目录与状态分开，是叙事引擎能做"重量/互斥/合成"这类事的前提：
// 状态里只存名字（"铜钥匙"），重量、标签、类型都回目录查。
// 这样 AI 只报事实，不需要知道"钥匙重 1"。

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * 编译目录。
 * @param {{entities?: Array, kinds?: string[]}} spec
 * entities: [{ id?, name, kind?, tags?: string[], weight?: number, fields?: object, alias?: string[] }]
 */
export function compileCatalog(spec = {}) {
  const problems = [];
  const byName = new Map();
  const byId = new Map();
  const list = Array.isArray(spec) ? spec : (spec.entities ?? []);
  const kinds = Array.isArray(spec.kinds) ? spec.kinds : ['item', 'character', 'place', 'event'];

  for (const raw of list) {
    if (!isPlainObject(raw) || typeof raw.name !== 'string' || raw.name.trim() === '') {
      problems.push({ code: 'bad-entity', entity: raw });
      continue;
    }
    const entity = {
      id: raw.id ?? raw.name,
      name: raw.name,
      kind: raw.kind ?? 'item',
      tags: Array.isArray(raw.tags) ? [...raw.tags] : [],
      weight: typeof raw.weight === 'number' && Number.isFinite(raw.weight) ? raw.weight : 0,
      fields: isPlainObject(raw.fields) ? { ...raw.fields } : {},
      alias: Array.isArray(raw.alias) ? [...raw.alias] : [],
      note: raw.note ?? '',
    };
    if (!kinds.includes(entity.kind)) problems.push({ code: 'unknown-kind', name: entity.name, kind: entity.kind });
    if (byName.has(entity.name)) problems.push({ code: 'duplicate-name', name: entity.name });
    if (byId.has(entity.id)) problems.push({ code: 'duplicate-id', id: entity.id });

    byName.set(entity.name, entity);
    byId.set(entity.id, entity);
    for (const other of entity.alias) {
      // 别名只为查找用，指向同一个实体；重复别名不覆盖先到的
      if (!byName.has(other)) byName.set(other, entity);
      else problems.push({ code: 'duplicate-alias', name: other });
    }
  }

  function lookup(key) {
    if (typeof key !== 'string') return null;
    return byName.get(key) ?? byId.get(key) ?? null;
  }

  function hasTag(key, tag) {
    const entity = lookup(key);
    return Boolean(entity && entity.tags.includes(tag));
  }

  return { list: [...byName.values()].filter((e, i, arr) => arr.indexOf(e) === i), byName, byId, kinds, problems, lookup, hasTag };
}

/** 目录自检：给界面"原件/目录"页用的一句话结论。 */
export function describeCatalog(catalog) {
  const kinds = {};
  for (const e of catalog.list) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
  const parts = Object.entries(kinds).map(([k, n]) => `${k} ${n}`);
  return `目录共 ${catalog.list.length} 项${parts.length ? `（${parts.join('、')}）` : ''}`;
}
