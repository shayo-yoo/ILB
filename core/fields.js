// core/fields.js —— 条目字段（"动态条目"）：纯数据与归一化，无依赖、无 DOM
//
// 条目可以声明几个"玩家能在面板上改的字段"。字段不是新的存储：它们的值就是
// 当前聊天的变量（`core/vars.js`），所以流程图判断与 {{ILB:名字}} 宏天然能用。
//
// 形状：
//   fields: [
//     { key:'抽卡次数', label:'剩余次数', type:'number', value:3, min:0, max:10 },
//     { key:'幸运',     label:'幸运',     type:'number', value:50, min:0, max:100 },
//     { key:'连抽',     label:'十连',     type:'bool',   value:false },
//     { key:'卡池',     label:'卡池',     type:'choice', value:'常驻', options:['常驻','限定'] },
//     { key:'备注',     label:'备注',     type:'text',   value:'' },
//   ]

export const FIELD_TYPES = Object.freeze(['number', 'bool', 'text', 'choice']);

const MAX_FIELDS = 12;

function str(v) {
  return v === undefined || v === null ? '' : String(v);
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 归一化一个字段；不合法（没有 key/label、类型不认识）时返回 null。
 * key 是变量名，也是面板写回的目标；同一个条目里重复的 key 只保留第一个。
 */
export function normalizeField(raw, index = 0) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const key = str(src.key).trim();
  if (!key) return null;
  const type = FIELD_TYPES.includes(src.type) ? src.type : 'text';
  const label = str(src.label).trim() || key;
  const field = { key, label, type };
  if (type === 'number') {
    field.min = src.min === undefined ? null : num(src.min);
    field.max = src.max === undefined ? null : num(src.max);
    field.step = src.step === undefined ? 1 : Math.max(0.01, num(src.step, 1));
    field.value = num(src.value, 0);
    if (field.min !== null) field.value = Math.max(field.min, field.value);
    if (field.max !== null) field.value = Math.min(field.max, field.value);
  } else if (type === 'bool') {
    field.value = src.value === true;
  } else if (type === 'choice') {
    field.options = Array.isArray(src.options)
      ? src.options.map((o) => str(o)).filter(Boolean).slice(0, 20)
      : [];
    field.value = field.options.includes(str(src.value)) ? str(src.value) : field.options[0] ?? '';
  } else {
    field.value = str(src.value);
  }
  field.order = index;
  return field;
}

/** 归一化整张字段表：最多 12 个，key 去重，非法项丢弃（不报错，不让书加载失败）。 */
export function normalizeFields(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const field = normalizeField(raw, out.length);
    if (!field || seen.has(field.key)) continue;
    seen.add(field.key);
    out.push(field);
    if (out.length >= MAX_FIELDS) break;
  }
  return out;
}

/** 这条条目声明的字段（已归一化的副本）。 */
export function fieldsOf(entry) {
  return Array.isArray(entry?.fields) ? entry.fields : [];
}

/** 给"还没设置过"的字段补上默认值；已有值一律不动。返回新的变量表。 */
export function withFieldDefaults(vars, entries) {
  const base = vars && typeof vars === 'object' ? { ...vars } : {};
  for (const entry of entries ?? []) {
    for (const field of fieldsOf(entry)) {
      if (Object.prototype.hasOwnProperty.call(base, field.key)) continue;
      base[field.key] = field.value;
    }
  }
  return base;
}

/** 面板上显示一行用的文字。 */
export function describeField(field) {
  if (!field) return '';
  const t = field.type === 'number' ? '数字' : field.type === 'bool' ? '开关' : field.type === 'choice' ? '选项' : '文本';
  return `${field.label || field.key}（${t}）`;
}
