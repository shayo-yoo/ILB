// narrative/facts.js —— 从文本里认出"事实标记"（纯函数，零依赖）。
//
// AI 只写事实，不写机制。标记长这样：
//   [[ILB:获得:铜钥匙]]        得到某物
//   [[ILB:失去:铜钥匙×1]]      失去某物（可带数量）
//   [[ILB:标记:见过国王]]      把一个开关打开
//   [[ILB:解除:见过国王]]
//   [[ILB:关系:艾琳/信任+1]]    关系变化（只报方向，不报数值机制）
//   [[ILB:地点:王城/地窖]]      从哪到哪
//   [[ILB:见过:王城地窖]]
//   [[ILB:使用:药水]]           （通常来自界面，也允许模型写）
//
// 解析失败**不丢**：进 unknowns，带原文与建议。上层必须把它显示出来（失败必须出声）。

export const FACT_OPS = {
  获得: 'gain',
  失去: 'lose',
  标记: 'mark',
  解除: 'unmark',
  关系: 'relation',
  地点: 'move',
  见过: 'seen',
  使用: 'use',
};

export const OP_LABEL = Object.fromEntries(Object.entries(FACT_OPS).map(([cn, en]) => [en, cn]));

/**
 * 把"声明里的 verbs/events"编译成"动词 → 事实类型"的查找表。
 *
 * - 八个内置动词永远在；
 * - `verbs` 是**别名**：`{ "拾取": "获得" }`，解析后仍按内置类型走；
 * - `events` 是**用户自定义事件**：`[{ id: "突破", label: "突破境界" }]`，
 *   解析成 `{ type:'event', event:'突破', name:'…' }`，由声明里的规则去处理。
 *   这样非 RPG 的玩法（战斗、经营、解谜、关系）可以自己起名字，不必硬套"获得/使用"。
 */
export function buildVerbMap({ events = [], verbs = {} } = {}) {
  const map = new Map();
  for (const [cn, en] of Object.entries(FACT_OPS)) map.set(cn, { kind: 'builtin', type: en, label: cn });
  for (const [alias, target] of Object.entries(verbs ?? {})) {
    const type = FACT_OPS[target];
    if (!type) continue; // 别名只能指向八个内置动词，写错就忽略（编译期另有校验）
    if (!map.has(alias)) map.set(alias, { kind: 'builtin', type, label: target });
  }
  for (const raw of Array.isArray(events) ? events : []) {
    const id = typeof raw === 'string' ? raw : (raw && (raw.id ?? raw.name));
    if (!id || map.has(id)) continue;
    map.set(id, { kind: 'custom', event: id, label: (raw && raw.label) || id });
  }
  return map;
}

/** 给提示/错误用的动词清单：内置在前，自定义在后。 */
export function verbNames(verbMap) {
  return [...verbMap.keys()];
}

const TOKEN_RE = /\[\[\s*ILB\s*[:：]\s*([^\[\]]*?)\s*\]\]/g;
const MAX_TEXT = 400;
const MAX_TARGET = 80;

function splitOnce(text) {
  const i = text.search(/[:：]/);
  if (i < 0) return [text.trim(), ''];
  return [text.slice(0, i).trim(), text.slice(i + 1).trim()];
}

function parseCount(text) {
  const m = /^(.*?)\s*[×xX*]\s*(\d{1,4})\s*$/.exec(text);
  if (!m) return { name: text.trim(), count: 1 };
  return { name: m[1].trim(), count: Number(m[2]) };
}

function parseRelation(text) {
  // 艾琳/信任+1 或 艾琳/信任-1 或 艾琳/信任
  const m = /^([^\/／]+)[\/／]([^+\-]+?)\s*([+-])?\s*(\d{0,2})$/.exec(text);
  if (!m) return null;
  const sign = m[3] === '-' ? -1 : 1;
  const amount = m[4] ? Number(m[4]) : 1;
  return { name: m[1].trim(), dir: m[2].trim(), sign, amount: Math.max(1, Math.min(99, amount)) };
}

/**
 * 解析一段文本里的全部事实标记。
 * @param {string} text
 * @param {Map} [verbMap] 由 buildVerbMap 得到的动词表（省略时只有八个内置动词）
 * @returns {{facts: Array, unknowns: Array, duplicates: number, found: number}}
 */
export function parseFacts(text, verbMap = buildVerbMap()) {
  const facts = [];
  const unknowns = [];
  let duplicates = 0;
  let found = 0;
  if (typeof text !== 'string' || text === '') return { facts, unknowns, duplicates, found };

  const seen = new Set();
  for (const match of text.matchAll(TOKEN_RE)) {
    found += 1;
    const body = match[1].trim();
    const [rawOp, rawTarget] = splitOnce(body);
    const hit = verbMap.get(rawOp);
    const target = (rawTarget ?? '').slice(0, MAX_TARGET).trim();

    if (!hit) {
      unknowns.push({
        raw: match[0],
        body,
        code: 'unknown-op',
        hint: `认不出「${rawOp}」，可用的有：${[...verbMap.keys()].join(' / ')}`,
      });
      continue;
    }
    const type = hit.kind === 'custom' ? 'event' : hit.type;
    if (!target) {
      unknowns.push({ raw: match[0], body, code: 'empty-target', hint: `「${rawOp}」后面没写对象` });
      continue;
    }
    if (target.length > MAX_TEXT) {
      unknowns.push({ raw: match[0], body, code: 'too-long', hint: '对象名太长（超过 80 字），疑似把整段话写进了标记' });
      continue;
    }

    let fact;
    if (type === 'gain' || type === 'lose' || type === 'use') {
      const { name, count } = parseCount(target);
      if (!name) {
        unknowns.push({ raw: match[0], body, code: 'empty-target', hint: '数量前面没有对象名' });
        continue;
      }
      fact = { type, name, count };
    } else if (type === 'event') {
      const { name, count } = parseCount(target);
      if (!name) {
        unknowns.push({ raw: match[0], body, code: 'empty-target', hint: '事件后面没有写对象' });
        continue;
      }
      fact = { type: 'event', event: hit.event, name, count };
    } else if (type === 'relation') {
      const rel = parseRelation(target);
      if (!rel) {
        unknowns.push({ raw: match[0], body, code: 'bad-relation', hint: '关系的写法是「人物/方向+1」，例如 艾琳/信任+1' });
        continue;
      }
      fact = { type, ...rel };
    } else if (type === 'move') {
      const m = /^([^\/／]+)[\/／](.+)$/.exec(target);
      if (!m) {
        unknowns.push({ raw: match[0], body, code: 'bad-move', hint: '地点的写法是「从/到」，例如 王城/地窖' });
        continue;
      }
      fact = { type, from: m[1].trim(), to: m[2].trim() };
    } else {
      fact = { type, name: target };
    }

    const key = JSON.stringify(fact);
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    facts.push(fact);
  }

  return { facts, unknowns, duplicates, found };
}

/** 把标记从文本里剥掉（显示与注入用；存档原文必须保留）。 */
export function stripFacts(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(TOKEN_RE, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/** 事实 → 一句人话（界面上"本轮已记录"的徽章就用它）。 */
export function describeFact(fact) {
  switch (fact.type) {
    case 'gain':
      return `获得 ${fact.name}${fact.count > 1 ? `×${fact.count}` : ''}`;
    case 'lose':
      return `失去 ${fact.name}${fact.count > 1 ? `×${fact.count}` : ''}`;
    case 'use':
      return `使用 ${fact.name}${fact.count > 1 ? `×${fact.count}` : ''}`;
    case 'mark':
      return `标记 ${fact.name}`;
    case 'unmark':
      return `解除 ${fact.name}`;
    case 'relation':
      return `${fact.name} 的「${fact.dir}」${fact.sign > 0 ? '上升' : '下降'} ${fact.amount}`;
    case 'move':
      return `从 ${fact.from} 到 ${fact.to}`;
    case 'seen':
      return `见过 ${fact.name}`;
    case 'event':
      return `${fact.event} ${fact.name}${fact.count > 1 ? `×${fact.count}` : ''}`;
    default:
      return '未知事实';
  }
}
