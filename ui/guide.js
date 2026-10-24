// ui/guide.js —— 「使用说明」的内容与渲染。
//
// 文案不写死在代码里：全部来自 data/guide/<locale>.json。
// 这样改文字不用碰逻辑，同一份 JSON 也被 tests/export-guide.mjs 导出成
// docs/使用指南.md，给不打开 SillyTavern 的人看（GitHub 上直接能读）。
//
// 为什么不用 Markdown：扩展里没有 Markdown 渲染依赖，而浮层的节点是 DOM。
// 用结构化的小 JSON（段落 / 步骤 / 列表 / 表格），手机和电脑都好排版。
import { el } from './dom.js';

const DEFAULT_LOCALE = 'zh-cn';

function guideUrl(locale = DEFAULT_LOCALE) {
  return new URL(`../data/guide/${locale}.json`, import.meta.url);
}

let cached = null;
let loading = null;

/**
 * 读使用说明。读不到不抛：返回 null，界面显示"说明没读到"，
 * 不影响其它页面——和 help.js 一样的取舍。
 * @returns {Promise<object|null>}
 */
export async function loadGuide(locale = DEFAULT_LOCALE) {
  if (cached) return cached;
  if (loading) return loading;
  loading = (async () => {
    try {
      const res = await fetch(guideUrl(locale), { cache: 'no-cache' });
      const data = res && res.ok ? await res.json() : null;
      cached = data && typeof data === 'object' ? data : null;
    } catch (err) {
      console.warn('[ILB] 使用说明没读出来', err);
      cached = null;
    }
    loading = null;
    return cached;
  })();
  return loading;
}

/** 测试或离线时直接把内容塞进来。 */
export function primeGuide(data) {
  cached = data && typeof data === 'object' ? data : null;
  return cached;
}

export function clearGuide() {
  cached = null;
  loading = null;
}

function paragraph(text) {
  return el('p', { class: 'ilb-guide-p', text: String(text ?? '') });
}

function list(items) {
  return el('ul', { class: 'ilb-guide-list' }, (items ?? []).map((item) => el('li', { text: String(item) })));
}

function steps(items) {
  return el('ol', { class: 'ilb-guide-steps' }, (items ?? []).map((item) => el('li', { text: String(item) })));
}

function table(spec) {
  const head = Array.isArray(spec?.head) ? spec.head : [];
  const rows = Array.isArray(spec?.rows) ? spec.rows : [];
  const thead = el('thead', {}, [
    el('tr', {}, head.map((cell) => el('th', { text: String(cell) }))),
  ]);
  const tbody = el('tbody', {}, rows.map((row) => el('tr', {}, (row ?? []).map((cell) => el('td', { text: String(cell) })))));
  return el('div', { class: 'ilb-guide-tablewrap' }, [el('table', { class: 'ilb-guide-table' }, [thead, tbody])]);
}

/** 把结构化内容画成浮层节点数组；内容缺失时给一句人话。 */
export function renderGuide(data) {
  if (!data || !Array.isArray(data.sections)) {
    return [el('p', { class: 'ilb-hint', text: '使用说明还没读到（多半是文件没跟着装上）。其它功能不受影响。' })];
  }
  const nodes = [];
  if (data.intro) nodes.push(el('div', { class: 'ilb-guide-intro' }, [paragraph(data.intro)]));
  for (const section of data.sections) {
    if (!section || typeof section !== 'object') continue;
    const block = el('section', { class: 'ilb-guide-section' });
    if (section.h) block.appendChild(el('h3', { class: 'ilb-guide-h', text: String(section.h) }));
    if (section.p) block.appendChild(paragraph(section.p));
    if (Array.isArray(section.steps) && section.steps.length) block.appendChild(steps(section.steps));
    if (Array.isArray(section.bullets) && section.bullets.length) block.appendChild(list(section.bullets));
    if (section.table) block.appendChild(table(section.table));
    if (section.note) block.appendChild(el('p', { class: 'ilb-guide-note', text: String(section.note) }));
    nodes.push(block);
  }
  return nodes;
}

/**
 * 打开使用说明。走宿主给的 openOverlay，所以电脑是居中浮层、手机是整屏二级页，
 * 这里不用判断平台。
 */
export async function openGuide(ctx) {
  let data = null;
  try {
    data = await loadGuide();
  } catch {
    data = null;
  }
  const open = ctx?.openOverlay;
  if (typeof open !== 'function') return null;
  return open('使用说明', renderGuide(data));
}
