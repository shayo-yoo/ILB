// core/vars.js —— 聊天变量与条目宏（v0.8.0）。
//
// 这一层只做三件事，保持"笨蛋也能预测"：
//   1. 变量表的读写（按聊天隔离，值只允许 数字 / 文本 / 开关）；
//   2. 宏展开：把条目正文里的 {{ILB:chat.名字}} 换成当前值；
//   3. 找不到就留下醒目的标记，绝不静默变成空字符串。
//
// 为什么不支持表达式：这是"记忆/状态"的读接口，不是脚本引擎（D-0006、D-0043）。
// 复杂的判断交给条目的逻辑流程图，宏只负责"把一个值填进去"。

export const MACRO_RE = /\{\{\s*ILB\s*:\s*([^{}]+?)\s*\}\}/g;
export const CHAT_PREFIX = 'chat.';

/** 把宿主 / 设置里读到的变量洗成"名字 → 标量"的平表。 */
export function normalizeVars(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    const name = String(key ?? '').trim();
    if (!name) continue;
    if (typeof value === 'number' || typeof value === 'boolean') out[name] = value;
    else if (typeof value === 'string') out[name] = value;
    else if (value !== null && typeof value === 'object') {
      // 只展开一层：chat 命名空间下的对象。
      for (const [childKey, childValue] of Object.entries(value)) {
        const childName = String(childKey ?? '').trim();
        if (!childName) continue;
        if (['number', 'boolean', 'string'].includes(typeof childValue)) out[childName] = childValue;
      }
    }
  }
  return out;
}

/** 用户输入的字符串 → 变量值：能当数字就当数字，"true/false" 当开关，其余是文本。 */
export function coerceValue(raw) {
  if (typeof raw === 'number' || typeof raw === 'boolean') return raw;
  const text = String(raw ?? '').trim();
  if (text === '') return '';
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    const num = Number(text);
    if (Number.isFinite(num)) return num;
  }
  return text;
}

/** 读一个宏路径：兼容带 `chat.` 前缀与不带的写法。 */
export function readPath(vars, path) {
  const name = String(path ?? '').trim();
  if (!name) return undefined;
  const plain = name.startsWith(CHAT_PREFIX) ? name.slice(CHAT_PREFIX.length) : name;
  return Object.prototype.hasOwnProperty.call(vars ?? {}, plain) ? vars[plain] : undefined;
}

/** 值的显示形式：布尔给人话，其余原样转字符串。 */
export function displayValue(value) {
  if (value === true) return '开';
  if (value === false) return '关';
  return String(value ?? '');
}

/** 找不到时的标记：故意做得显眼，方便在提示词里一眼看到"这里缺值"。 */
export function missingMarker(path) {
  return `⟨未定义:${String(path ?? '').trim() || '?'}⟩`;
}

/**
 * 展开一段文本里的 `{{ILB:...}}`。
 * @param {string} text
 * @param {{vars?: object, onMissing?: Function}} options
 * @returns {string}
 */
export function expandMacros(text, { vars = {}, onMissing = null } = {}) {
  const source = String(text ?? '');
  if (!source.includes('{{')) return source;
  return source.replace(MACRO_RE, (whole, path) => {
    const value = readPath(vars, path);
    if (value === undefined) {
      const marker = missingMarker(path);
      try {
        onMissing?.(path, marker);
      } catch {
        /* 回调出错不影响展开 */
      }
      return marker;
    }
    return displayValue(value);
  });
}

/** 列出文本里引用到的宏路径（去重），给"未定义检查"用。 */
export function macroNames(text) {
  const names = [];
  const seen = new Set();
  for (const match of String(text ?? '').matchAll(MACRO_RE)) {
    const path = match[1].trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    names.push(path);
  }
  return names;
}

/** 哪些宏在给定的变量表里找不到。 */
export function missingMacros(text, vars = {}) {
  return macroNames(text).filter((path) => readPath(vars, path) === undefined);
}

/** 当前聊天的标识：和仓库的 chatStates 用同一套键，换聊天不串。 */
export function resolveChatId(ctx) {
  try {
    const direct = ctx?.chatId ?? ctx?.chat_metadata?.chat_id ?? ctx?.chatMetadata?.chat_id;
    if (direct) return String(direct);
  } catch {
    /* 掉到默认 */
  }
  return 'default';
}
