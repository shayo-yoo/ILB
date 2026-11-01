// ui/nav.js —— 导航的"纯模型"：哪一页属于哪一组、电脑三档密度怎么摆、手机四个入口怎么分。
//
// 为什么要单独一层：v0.15.0 的标签栏是写死在 ui/panel.js 里的一排按钮，
// 窗子拉窄时它只会换行（手机上甚至挤出横向滚动），而需求（Phase 3 §5.2/§5.3/§6.1）
// 要求"按浮窗内部宽度换导航形态"、"电脑与手机用同一套命名"。
// 把"分几组、谁进更多、手机点哪个入口算哪一页"做成纯函数之后：
//   - 不碰 DOM，可以单独测（tests/nav.test.mjs）；
//   - panel 只负责把模型画成按钮，不再自己判断密度。
// 这个文件不读宿主、不读存档、不写 DOM。

/** 全部页面。顺序就是人找东西的顺序：先内容，再自动化，最后运行与维护。 */
export const TABS = [
  { id: 'shelf', label: '书架', group: 'content' },
  { id: 'rules', label: '规则', group: 'content' },
  { id: 'logic', label: '逻辑', group: 'automation' },
  { id: 'snapshots', label: '快照', group: 'ops' },
  { id: 'state', label: '状态', group: 'ops' },
  { id: 'diagnostics', label: '诊断', group: 'ops' },
  { id: 'settings', label: '设置', group: 'ops' },
];

/**
 * 电脑宽屏左侧固定导航的三组。
 * 分组只影响"在哪一组里"，不改变页面本身；命名与手机「更多」里的列表一致。
 */
export const NAV_GROUPS = [
  { id: 'content', label: '内容管理', tabs: ['shelf', 'rules'] },
  { id: 'automation', label: '自动化', tabs: ['logic'] },
  { id: 'ops', label: '运行与维护', tabs: ['snapshots', 'state', 'diagnostics', 'settings'] },
];

export const TAB_LABEL = { ...Object.fromEntries(TABS.map((tab) => [tab.id, tab.label])), more: '更多' };

/** 标准宽度时顶部常显的页面：平常用的三页。 */
export const DESKTOP_PRIMARY = ['shelf', 'rules', 'logic'];
/** 标准宽度时收进「更多」的低频页面。 */
export const DESKTOP_OVERFLOW = ['snapshots', 'state', 'diagnostics', 'settings'];

/** 手机底部四个入口：三页常用 + 一个「更多」。 */
export const MOBILE_PRIMARY = [
  { id: 'shelf', label: '书架', glyph: '书' },
  { id: 'rules', label: '规则', glyph: '条' },
  { id: 'logic', label: '逻辑', glyph: '流' },
];
export const MOBILE_MORE = ['snapshots', 'state', 'diagnostics', 'settings'];
export const MOBILE_TABS = [...MOBILE_PRIMARY, { id: 'more', label: '更多', glyph: '⋯' }];

export function isTab(tab) {
  return TABS.some((item) => item.id === tab);
}

export function labelOf(tab) {
  return TAB_LABEL[tab] ?? '未知页面';
}

export function groupOf(tab) {
  return TABS.find((item) => item.id === tab)?.group ?? null;
}

function items(ids) {
  return ids.map((id) => ({ id, label: labelOf(id) }));
}

/**
 * 电脑浮窗按内部宽度选导航形态（断点来自 ui/layout.js 的 pickDensity）：
 *  - wide     → 左侧固定分组导航（能同时看结构与内容）
 *  - standard → 顶部常显 + 低频收进「更多」下拉
 *  - compact  → 一个下拉框（不给窄窗塞一排会换行的按钮）
 * @param {'compact'|'standard'|'wide'} density
 * @returns {{mode:'sidenav'|'topbar'|'select', groups?:Array, primary?:Array, overflow?:Array}}
 */
export function desktopNav(density) {
  if (density === 'wide') {
    return {
      mode: 'sidenav',
      groups: NAV_GROUPS.map((group) => ({ ...group, items: items(group.tabs) })),
    };
  }
  if (density === 'compact') {
    return { mode: 'select', items: TABS.map((tab) => ({ id: tab.id, label: tab.label })) };
  }
  return {
    mode: 'topbar',
    primary: items(DESKTOP_PRIMARY),
    overflow: items(DESKTOP_OVERFLOW),
  };
}

/**
 * 手机：当前页高亮哪个入口。
 * 「更多」里的页面全部高亮「更多」，这样底栏永远只有四个位置，不会因为翻到设置页就找不到北。
 */
export function mobileEntryOf(tab) {
  if (tab === 'more') return 'more';
  if (MOBILE_PRIMARY.some((item) => item.id === tab)) return tab;
  if (MOBILE_MORE.includes(tab)) return 'more';
  return 'shelf';
}

/** 手机「更多」里要列出来的页面（含使用说明，由调用方决定加不加）。 */
export function moreItems() {
  return items(MOBILE_MORE);
}

/** 书架/规则/逻辑共用的书籍上下文文案：书名 + 两类内容各多少。 */
export function describeBookContext(book) {
  if (!book) return '还没有选择书籍';
  const entries = Array.isArray(book.entries) ? book.entries.length : 0;
  const logics = Array.isArray(book.logic) ? book.logic.length : 0;
  const name = book.name || book.book_id || '未命名书籍';
  return `${name}（${entries} 条规则 · ${logics} 条逻辑）`;
}

/**
 * 书籍下拉里每一项的文字。
 * 把数量写进选项里，是因为"当前这本书有几条规则"决定了要不要切书，
 * 而手机上切书本身是一次跳转，不该切过去再数。
 */
export function bookOptionLabel(book) {
  return describeBookContext(book);
}

/** 一次渲染里导航是否变了：变了才需要重画整页（拖动窗子宽度时会被频繁调用）。 */
export function navSignature(density, activeTab) {
  return `${density || 'standard'}:${activeTab || ''}`;
}
