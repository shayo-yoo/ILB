// ui/layout.js —— 纯计算：屏幕上有多大地方，就用哪套布局。
// 这个文件不碰 DOM、不碰宿主、不碰存档，所以可以单独测（tests/ui-layout.test.mjs）。
// 两个关注点分开：pickLayout 决定"手机还是电脑"，其余函数算"窗子和悬浮球放哪"。

/** 小于这个宽度就当手机（CSS 像素）。 */
export const MOBILE_BREAKPOINT = 768;
/** 触屏设备在这个宽度以下也当手机：平板竖握时鼠标布局很难点。 */
export const COMPACT_BREAKPOINT = 1024;
/** 窗口拖动时允许的最小尺寸，再小表格就没法看了。 */
export const MIN_WINDOW_WIDTH = 420;
export const MIN_WINDOW_HEIGHT = 360;
/** 悬浮球直径与它离屏幕边缘的安全距离（CSS 里 .ilb-fab 的宽高必须是这个数）。 */
export const FAB_SIZE = 52;
export const FAB_MARGIN = 12;
/** 悬浮球默认离底边这么高：给 SillyTavern 底部输入框让位，否则会被挡住。 */
export const FAB_BOTTOM_OFFSET = 96;
export const FAB_BOTTOM_OFFSET_MOBILE = 84;
/** 窗口最大尺寸，避免在大屏上拉得像全屏对话框。 */
export const MAX_WINDOW_WIDTH = 820;
export const MAX_WINDOW_HEIGHT = 720;

function num(value, fallback) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  const lo = num(min, 0);
  const hi = num(max, lo);
  const v = num(value, lo);
  if (hi < lo) return hi;
  return Math.min(Math.max(v, lo), hi);
}

/**
 * 用哪套布局。
 * 屏幕窄、或者屏幕很矮（手机横过来）、或者明确是触屏且不够宽 → 手机布局。
 * @param {{width?:number,height?:number,touch?:boolean}} viewport
 * @returns {'desktop'|'mobile'}
 */
export function pickLayout(viewport = {}) {
  const width = num(viewport.width, 1024);
  const height = num(viewport.height, 768);
  const touch = viewport.touch === true;
  if (width < MOBILE_BREAKPOINT) return 'mobile';
  if (touch && width < COMPACT_BREAKPOINT) return 'mobile';
  if (height < 520) return 'mobile';
  return 'desktop';
}

export function isMobileLayout(layout) {
  return layout === 'mobile';
}

/** 给日志/诊断看的人话。 */
export function describeLayout(layout) {
  return isMobileLayout(layout) ? '手机布局（整屏）' : '电脑布局（可拖动窗口）';
}

/**
 * 第一次打开时窗口放哪。
 * 手机上没得选：整屏。电脑上靠右下、垂直居中，离悬浮球远一点。
 */
export function defaultWindowGeometry(layout, viewport = {}) {
  const width = num(viewport.width, 1024);
  const height = num(viewport.height, 768);
  if (isMobileLayout(layout)) return { x: 0, y: 0, w: width, h: height };

  const maxW = Math.max(MIN_WINDOW_WIDTH, width - FAB_MARGIN * 2);
  const w = clamp(Math.round(width * 0.6), MIN_WINDOW_WIDTH, Math.min(MAX_WINDOW_WIDTH, maxW));
  const maxH = Math.max(MIN_WINDOW_HEIGHT, height - FAB_MARGIN * 2);
  const h = clamp(Math.round(height * 0.78), MIN_WINDOW_HEIGHT, Math.min(MAX_WINDOW_HEIGHT, maxH));
  const x = Math.max(FAB_MARGIN, width - w - FAB_MARGIN);
  const y = Math.max(FAB_MARGIN, Math.round((height - h) / 2));
  return { x, y, w, h };
}

/**
 * 把窗口位置/尺寸收进屏幕里。
 * 用户上次把窗口拖到屏幕外、或者换了更小的显示器，都要靠这一步救回来。
 */
export function clampGeometry(geometry, layout, viewport = {}) {
  const width = num(viewport.width, 1024);
  const height = num(viewport.height, 768);
  if (isMobileLayout(layout)) return { x: 0, y: 0, w: width, h: height };

  const geo = geometry && typeof geometry === 'object' ? geometry : {};
  const maxW = Math.max(MIN_WINDOW_WIDTH, width - FAB_MARGIN * 2);
  const maxH = Math.max(MIN_WINDOW_HEIGHT, height - FAB_MARGIN * 2);
  const w = clamp(geo.w, MIN_WINDOW_WIDTH, Math.min(MAX_WINDOW_WIDTH, maxW));
  const h = clamp(geo.h, MIN_WINDOW_HEIGHT, Math.min(MAX_WINDOW_HEIGHT, maxH));
  const x = clamp(geo.x, 0, Math.max(0, width - w));
  const y = clamp(geo.y, 0, Math.max(0, height - h));
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/** 悬浮球第一次出现时放在右下角、输入框上方。返回左上角坐标。 */
export function defaultFabPosition(layout, viewport = {}) {
  const width = num(viewport.width, 1024);
  const height = num(viewport.height, 768);
  const bottom = isMobileLayout(layout) ? FAB_BOTTOM_OFFSET_MOBILE : FAB_BOTTOM_OFFSET;
  return {
    x: Math.round(width - FAB_SIZE - FAB_MARGIN - 6),
    y: Math.round(height - FAB_SIZE - bottom),
  };
}

/** 悬浮球也要能被收回屏幕里，否则用户拖出去就再也点不到了。 */
export function clampFabPosition(position, viewport = {}) {
  const width = num(viewport.width, 1024);
  const height = num(viewport.height, 768);
  const pos = position && typeof position === 'object' ? position : {};
  const maxX = Math.max(0, width - FAB_SIZE);
  const maxY = Math.max(0, height - FAB_SIZE);
  return {
    x: Math.round(clamp(pos.x, 0, maxX)),
    y: Math.round(clamp(pos.y, 0, maxY)),
  };
}

/** 界面上要显示"当前是什么布局"时用它。 */
export function viewportOf(win) {
  const source = win && typeof win === 'object' ? win : globalThis;
  return {
    width: num(source.innerWidth, 1024),
    height: num(source.innerHeight, 768),
    touch: Boolean(source.matchMedia && source.matchMedia('(pointer: coarse)').matches),
  };
}
