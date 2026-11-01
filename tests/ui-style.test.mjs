// tests/ui-style.test.mjs —— CSS 里的"隐藏"必须真的隐藏。
// 背景：.ilb-menu 之类默认写的是 display:flex，作者样式会盖过浏览器给 [hidden] 的
// display:none，结果点了才该出现的菜单在真浏览器里一直摊着（假 DOM 看不出来）。
// 这里不解析 CSS，只守住"兜底规则还在、还盖住了这些容器"。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

test('[hidden] 兜底规则存在且是 !important', () => {
  const block = css.match(/\.ilb-root \[hidden\][\s\S]*?\}/);
  assert.ok(block, '找不到 [hidden] 兜底规则');
  assert.match(block[0], /display:\s*none\s*!important/);
});

test('兜底规则盖住四个可能会藏东西的容器', () => {
  for (const host of ['.ilb-root', '.ilb-window', '.ilb-overlay', '.ilb-m']) {
    assert.ok(css.includes(`${host} [hidden]`), `${host} [hidden] 没被兜住`);
  }
});

test('需要兜底的类仍然是 display:flex/grid —— 否则这条兜底就是多余的', () => {
  for (const cls of ['.ilb-menu', '.ilb-nav-menu', '.ilb-filter-extra', '.ilb-preview-box']) {
    const rule = css.match(new RegExp(`\\${cls}\\s*\\{[^}]*\\}`));
    assert.ok(rule, `找不到 ${cls} 的样式`);
    assert.match(rule[0], /display:\s*(flex|grid)/, `${cls} 不再是 flex/grid，兜底可以撤了`);
  }
});

test('浮窗底色把同一层 tint 叠两遍（宿主 tint 半透明 + blurStrength 可能是 0）', () => {
  const rule = css.match(/\.ilb-window\s*\{[^}]*\}/);
  assert.ok(rule, '找不到 .ilb-window');
  assert.match(rule[0], /background-image:\s*linear-gradient\(/, '缺少叠层：聊天正文会透进窗子');
  const tint = rule[0].match(/var\(--SmartThemeBlurTintColor[^)]*\)/g) ?? [];
  assert.ok(tint.length >= 3, '底色与渐变应当都用同一个 tint');
  assert.doesNotMatch(rule[0], /backdrop-filter/, '不要靠 backdrop-filter：blurStrength 可能是 0');
});
