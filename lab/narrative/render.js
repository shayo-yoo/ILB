// lab/narrative/render.js —— 把状态渲染成"给模型看的自然语言"与"给人看的行"（纯函数）。
//
// 两个用途要分开：
//   - 注入：只给必要的事实，带容量/上限这种"约束现状"，让模型不会写出必然被拒的剧情；
//   - 显示：界面上的行，给人看，包含派生值（剩余格、总重量）。
//
// 预算按字符算（中文 1 字 ≈ 1 token 上下，留足余量），超了先截列表，再整行省略，
// 并在末尾说明"还有 N 项未显示"——不许静默丢。

const MAX_ITEM_CHARS = 24;

function listText(items, limit = 8) {
  const shown = [];
  let used = 0;
  for (const item of items) {
    const text = String(item).slice(0, MAX_ITEM_CHARS);
    if (shown.length >= limit || used + text.length > 60) break;
    shown.push(text);
    used += text.length + 1;
  }
  const rest = items.length - shown.length;
  return `${shown.join('、')}${rest > 0 ? ` 等 ${items.length} 项` : ''}`;
}

/** 单行渲染（不带预算控制）。 */
export function lineOf(decl, value, derived = null) {
  const label = decl.label ?? decl.name;
  if (decl.type === 'list') {
    if (!Array.isArray(value) || value.length === 0) {
      const cap = derived?.上限;
      return cap ? `${label}（0/${cap}）：空` : `${label}：空`;
    }
    const parts = [];
    if (derived?.上限) parts.push(`${value.length}/${derived.上限}`);
    if (derived?.总重量 !== undefined) parts.push(`重 ${derived.总重量}`);
    const suffix = parts.length ? `（${parts.join('，')}）` : '';
    return `${label}${suffix}：${listText(value)}`;
  }
  if (decl.type === 'map') {
    const keys = Object.keys(value ?? {});
    if (keys.length === 0) return `${label}：无`;
    return `${label}：${keys.map((k) => `${k} ${value[k]}`).join('、')}`;
  }
  if (decl.type === 'flag') return value ? `${label}` : '';
  if (decl.type === 'number') return `${label}：${value}`;
  if (decl.type === 'enum') return `${label}：${value}`;
  return `${label}：${value === '' ? '（空）' : value}`;
}

/**
 * 渲染成"给模型看"的一段文本。
 * @param {object} state
 * @param {{schema, catalog, budgetChars?: number, includeEmpty?: boolean}} ctx
 */
export function renderPrompt(state, ctx) {
  const { schema, derived = {}, budgetChars = 900 } = ctx ?? {};
  if (!schema) return '';
  const lines = [];
  let used = 0;
  let skipped = 0;

  for (const name of schema.order) {
    const decl = schema.vars.get(name);
    if (decl.private) continue;
    const line = lineOf(decl, state.vars[name], derived[name]);
    if (!line) continue;
    if (used + line.length + 1 > budgetChars) {
      skipped += 1;
      continue;
    }
    lines.push(line);
    used += line.length + 1;
  }

  if (lines.length === 0) return '';
  const tail = skipped > 0 ? `\n（另有 ${skipped} 项状态未显示）` : '';
  return `${lines.join('\n')}${tail}`;
}

/** 渲染成界面用的行（带变量名，便于点击定位）。 */
export function renderLines(state, ctx) {
  const { schema, derived = {} } = ctx ?? {};
  if (!schema) return [];
  const rows = [];
  for (const name of schema.order) {
    const decl = schema.vars.get(name);
    if (decl.private) continue;
    const text = lineOf(decl, state.vars[name], derived[name]);
    if (!text) continue;
    rows.push({ var: name, label: decl.label ?? name, text, type: decl.type });
  }
  return rows;
}

/** 把一次应用的改动写成"甲 → 乙"的一行，用于诊断与界面徽章。 */
export function describeChanges(changes = []) {
  return changes.map((change) => {
    const before = Array.isArray(change.before) ? change.before.join('、') || '空' : String(change.before ?? '空');
    const after = Array.isArray(change.after) ? change.after.join('、') || '空' : String(change.after ?? '空');
    return `${change.var}：${before} → ${after}${change.note ? `（${change.note}）` : ''}`;
  });
}

/** 状态摘要：一行，给"状态坞"或消息徽章用。 */
export function summarize(state, ctx) {
  const rows = renderLines(state, ctx);
  const lists = rows.filter((row) => row.type === 'list' || row.type === 'map');
  const scalars = rows.filter((row) => row.type === 'number' || row.type === 'enum');
  const bits = [...scalars.map((r) => r.text), ...(lists.length ? [`${lists.length} 个容器`] : [])];
  return bits.join(' · ') || '暂无状态';
}
