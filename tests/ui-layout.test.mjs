// tests/ui-layout.test.mjs —— 只测纯计算部分。
// 布局算错的表现很隐蔽：手机上窗口跑到屏幕外、悬浮球被输入框挡住。
// 这些都能用"给一组屏幕尺寸，看算出来的坐标"来测，不需要浏览器。

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  pickLayout,
  defaultWindowGeometry,
  clampGeometry,
  pickDensity,
  describeDensity,
  maximizeGeometry,
  COMPACT_DENSITY_WIDTH,
  WIDE_DENSITY_WIDTH,
  defaultFabPosition,
  clampFabPosition,
  describeLayout,
  isMobileLayout,
  MOBILE_BREAKPOINT,
  FAB_SIZE,
  MIN_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
} from '../ui/layout.js';

test('窄屏就是手机布局', () => {
  assert.equal(pickLayout({ width: 375, height: 812 }), 'mobile');
  assert.equal(pickLayout({ width: MOBILE_BREAKPOINT - 1, height: 900 }), 'mobile');
});

test('够宽又不是触屏，就是电脑布局', () => {
  assert.equal(pickLayout({ width: 1440, height: 900, touch: false }), 'desktop');
});

test('触屏平板竖握（够宽但偏窄）用手机布局', () => {
  assert.equal(pickLayout({ width: 900, height: 1200, touch: true }), 'mobile');
  // 同样宽度但不是触屏，仍然给电脑布局
  assert.equal(pickLayout({ width: 900, height: 1200, touch: false }), 'desktop');
});

test('屏幕很矮（手机横过来）也用手机布局', () => {
  assert.equal(pickLayout({ width: 900, height: 420, touch: false }), 'mobile');
});

test('手机上窗口铺满，且不受上次拖拽位置影响', () => {
  const geo = defaultWindowGeometry('mobile', { width: 400, height: 800 });
  assert.deepEqual(geo, { x: 0, y: 0, w: 400, h: 800 });
  const clamped = clampGeometry({ x: 999, y: 999, w: 100, h: 100 }, 'mobile', { width: 400, height: 800 });
  assert.deepEqual(clamped, { x: 0, y: 0, w: 400, h: 800 });
});

test('电脑上窗口不会超出屏幕，也不会小到看不清', () => {
  const viewport = { width: 1440, height: 900 };
  const geo = defaultWindowGeometry('desktop', viewport);
  assert.ok(geo.w >= MIN_WINDOW_WIDTH);
  assert.ok(geo.h >= MIN_WINDOW_HEIGHT);
  assert.ok(geo.x + geo.w <= viewport.width);
  assert.ok(geo.y + geo.h <= viewport.height);
});

test('窗口被拖到屏幕外之后能被拉回来', () => {
  const viewport = { width: 1200, height: 800 };
  const clamped = clampGeometry({ x: -500, y: -500, w: 900, h: 700 }, 'desktop', viewport);
  assert.ok(clamped.x >= 0);
  assert.ok(clamped.y >= 0);
  assert.ok(clamped.x + clamped.w <= viewport.width);
  assert.ok(clamped.y + clamped.h <= viewport.height);
});

test('换到更小的显示器时，窗口尺寸会跟着缩小', () => {
  const clamped = clampGeometry({ x: 0, y: 0, w: 5000, h: 5000 }, 'desktop', { width: 1000, height: 700 });
  assert.ok(clamped.w <= 1000);
  assert.ok(clamped.h <= 700);
});

test('悬浮球默认在右下、并且完整落在屏幕里', () => {
  const viewport = { width: 1440, height: 900 };
  const pos = defaultFabPosition('desktop', viewport);
  assert.ok(pos.x + FAB_SIZE <= viewport.width);
  assert.ok(pos.y + FAB_SIZE <= viewport.height);
  // 不能贴着最底边：SillyTavern 的输入框在那儿
  assert.ok(pos.y + FAB_SIZE < viewport.height);
});

test('悬浮球被拖出去之后也能被拉回来', () => {
  const viewport = { width: 800, height: 600 };
  const clamped = clampFabPosition({ x: -100, y: 9999 }, viewport);
  assert.ok(clamped.x >= 0);
  assert.ok(clamped.y + FAB_SIZE <= viewport.height);
});

test('布局描述是人话，不是内部代号', () => {
  assert.match(describeLayout('mobile'), /手机/);
  assert.match(describeLayout('desktop'), /电脑/);
  assert.equal(isMobileLayout('mobile'), true);
  assert.equal(isMobileLayout('desktop'), false);
});

test('密度看的是窗子内部宽度，不是屏幕宽度', () => {
  assert.equal(pickDensity(480), 'compact');
  assert.equal(pickDensity(COMPACT_DENSITY_WIDTH - 1), 'compact');
  assert.equal(pickDensity(COMPACT_DENSITY_WIDTH), 'standard');
  assert.equal(pickDensity(WIDE_DENSITY_WIDTH - 1), 'standard');
  assert.equal(pickDensity(WIDE_DENSITY_WIDTH), 'wide');
  assert.equal(pickDensity(1600), 'wide');
});

test('还没量出宽度时按标准处理，不瞎猜紧凑', () => {
  assert.equal(pickDensity(0), 'standard');
  assert.equal(pickDensity(undefined), 'standard');
  assert.equal(pickDensity('abc'), 'standard');
});

test('密度描述是人话，不是内部代号', () => {
  assert.match(describeDensity('compact'), /紧凑/);
  assert.match(describeDensity('wide'), /宽屏/);
  assert.equal(describeDensity('不知道'), describeDensity('standard'));
});

test('最大化铺满屏幕但留着边距，且不小于最小尺寸', () => {
  const big = maximizeGeometry({ width: 1600, height: 900 });
  assert.equal(big.w, 1600 - 24);
  assert.equal(big.h, 900 - 24);
  assert.equal(big.x, 12);
  assert.ok(big.y >= 0);

  const tiny = maximizeGeometry({ width: 300, height: 200 });
  assert.ok(tiny.w >= MIN_WINDOW_WIDTH);
  assert.ok(tiny.h >= MIN_WINDOW_HEIGHT);
});

test('最大化之后仍然能被子窗口的普通夹取接受', () => {
  const viewport = { width: 1600, height: 900 };
  const geo = maximizeGeometry(viewport);
  const clamped = clampGeometry(geo, 'desktop', viewport);
  assert.ok(clamped.w <= viewport.width && clamped.h <= viewport.height);
  assert.ok(clamped.x >= 0 && clamped.y >= 0);
});
