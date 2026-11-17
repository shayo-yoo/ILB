// core/regex-visibility.js —— 与 SillyTavern 正则扩展的可见性联动
// 只处理扩展明确声明“不会作用于世界书”的规则；缺少元数据时保持兼容，不过滤。

function list(v) { return Array.isArray(v) ? v : []; }

function appliesToWorldInfo(script) {
  const placement = script?.placement ?? script?.placements ?? script?.targets ?? script?.scope;
  if (Array.isArray(placement)) {
    return placement.some((x) => ['world_info', 'worldinfo', 'world-info', 'worldbook', 'world_book', 'lorebook'].includes(String(x).toLowerCase()));
  }
  if (typeof placement === 'string') return /world[_ -]?(info|book)|lorebook/i.test(placement);
  if (script?.worldInfo === true || script?.world_info === true || script?.affectsWorldInfo === true) return true;
  if (script?.worldInfo === false || script?.world_info === false || script?.affectsWorldInfo === false) return false;
  return null;
}

function hiddenFromWorldInfo(script) {
  const applies = appliesToWorldInfo(script);
  if (applies !== null) return applies === false;
  if (script?.promptOnly === true && script?.worldInfo !== true && script?.world_info !== true) return true;
  return false;
}

function compile(find, flags = 'g') {
  try { return new RegExp(String(find), String(flags || 'g').replace(/[^dgimsuvy]/g, '')); } catch { return null; }
}

/** 返回被“不作用于世界书”的正则脚本覆盖的条目 id。 */
export function hiddenEntryIdsByRegex(entries, scripts = []) {
  const hidden = new Set();
  const candidates = list(scripts).filter(hiddenFromWorldInfo);
  for (const script of candidates) {
    const find = script.find ?? script.regex ?? script.pattern;
    if (!find) continue;
    const re = compile(find, script.flags ?? 'g');
    if (!re) continue;
    for (const entry of list(entries)) {
      const text = `${entry?.title ?? ''}\n${entry?.content ?? ''}`;
      re.lastIndex = 0;
      if (re.test(text)) hidden.add(String(entry.id));
    }
  }
  return hidden;
}

export function filterHiddenEntries(activated, scripts = []) {
  const listItems = list(activated);
  const hidden = hiddenEntryIdsByRegex(listItems, scripts);
  return listItems.filter((item) => !hidden.has(String(item?.entryId ?? item?.id ?? '')));
}
