// core/calls.js —— AI 在正文里"点名"调用逻辑（ILB-4.16）
//
// 语法（故意和世界书的 {{…}} 分开，免得和宿主宏打架）：
//   [[ILB:名字]]              调用一条逻辑
//   [[ILB:名字(参数一, 参数二)]]  带参数调用（按逻辑声明的参数顺序传）
//
// 三条底线：
//   1. 只认"开放给 AI"（call.exposed === true）的逻辑，其它名字当普通文字；
//   2. 一条消息里同样的名字+参数只算一次（重放/滑动窗口不会重复触发）；
//   3. 找不到名字要说出来，不能悄悄吞掉 —— 用户才知道 AI 到底调没调通。

const CALL_RE = /\[\[ILB:([^\](]{1,60}?)(?:\(([^)]*)\))?\]\]/g;

function splitArgs(raw) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 8);
}

/** 从一段正文里找出所有调用。同一段里重复的名字+参数只留第一次。 */
export function parseCalls(text, { limit = 20 } = {}) {
  const src = String(text ?? '');
  const out = [];
  const seen = new Set();
  let m;
  CALL_RE.lastIndex = 0;
  while ((m = CALL_RE.exec(src)) !== null) {
    if (out.length >= limit) break;
    const name = m[1].trim();
    if (!name) continue;
    const args = splitArgs(m[2]);
    const key = `${name}(${args.join(',')})`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, args, raw: m[0], index: m.index });
  }
  return out;
}

/** 找一条"开放给 AI"的逻辑：先按名字，再按 id 尾段（方便写短的）。 */
export function findCallable(logics, name) {
  const wanted = String(name ?? '').trim();
  if (!wanted) return null;
  const list = Array.isArray(logics) ? logics : [];
  for (const logic of list) {
    if (!logic || logic.enabled === false) continue;
    if (logic.call?.exposed !== true) continue;
    if (String(logic.name ?? '').trim() === wanted) return logic;
  }
  for (const logic of list) {
    if (!logic || logic.enabled === false) continue;
    if (logic.call?.exposed !== true) continue;
    if (String(logic.localId ?? '') === wanted) return logic;
  }
  return null;
}

/**
 * 把参数绑到逻辑声明的参数名上，跑一次，再把旧的变量值还回去。
 * 这样逻辑里可以直接用变量“参数名”，又不会污染聊天状态（除非它自己「记住」）。
 */
export function withBoundParams(logic, args, vars, run) {
  const names = Array.isArray(logic?.call?.params) ? logic.call.params : [];
  const saved = new Map();
  for (let i = 0; i < names.length; i += 1) {
    const key = String(names[i] ?? '');
    if (!key) continue;
    saved.set(key, Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : undefined);
    vars[key] = args[i] ?? '';
  }
  try {
    return run();
  } finally {
    for (const [key, value] of saved.entries()) {
      if (value === undefined) delete vars[key];
      else vars[key] = value;
    }
  }
}
