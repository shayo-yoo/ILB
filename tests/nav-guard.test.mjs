// tests/nav-guard.test.mjs —— Phase 3 的两块纯逻辑：导航模型（ui/nav.js）与未保存守卫（ui/guard.js）。
// 这里不造 DOM：导航是纯数据，守卫在没有 document 时也必须能用（不弹层、但绝不假装没改过）。

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TABS, NAV_GROUPS, TAB_LABEL, DESKTOP_PRIMARY, MOBILE_TABS, MOBILE_MORE,
  desktopNav, mobileEntryOf, moreItems, describeBookContext, bookOptionLabel, navSignature,
} from '../ui/nav.js';
import * as guard from '../ui/guard.js';

test('七个页面都有名字和分组，分组覆盖全部页面', () => {
  assert.equal(TABS.length, 7);
  for (const tab of TABS) {
    assert.ok(tab.id && tab.label, `页面缺 id/label：${JSON.stringify(tab)}`);
    assert.ok(tab.group, `页面「${tab.label}」没有分组`);
    assert.equal(TAB_LABEL[tab.id], tab.label);
  }
  const inGroups = NAV_GROUPS.flatMap((g) => g.tabs);
  assert.deepEqual([...inGroups].sort(), TABS.map((t) => t.id).sort());
});

test('电脑导航按档位换形态：宽屏侧栏、标准顶部、紧凑下拉', () => {
  const wide = desktopNav('wide');
  assert.equal(wide.mode, 'sidenav');
  assert.equal(wide.groups.length, NAV_GROUPS.length);

  const standard = desktopNav('standard');
  assert.equal(standard.mode, 'topbar');
  assert.deepEqual(standard.primary.map((t) => t.id), DESKTOP_PRIMARY);
  assert.ok(standard.overflow.length > 0, '标准档位应该有低频页面收进「更多」');
  for (const tab of standard.primary) {
    assert.ok(!standard.overflow.some((t) => t.id === tab.id), `「${tab.label}」同时出现在常显和更多里`);
  }

  const compact = desktopNav('compact');
  assert.equal(compact.mode, 'select');
  assert.equal(compact.items.length, TABS.length, '紧凑档位的下拉要能到所有页面');
});

test('未知档位按标准处理，不瞎猜', () => {
  assert.equal(desktopNav(undefined).mode, 'topbar');
  assert.equal(desktopNav('huge').mode, 'topbar');
});

test('手机四个入口：书架 / 规则 / 逻辑 / 更多，更多页归到「更多」', () => {
  assert.deepEqual(MOBILE_TABS.map((t) => t.id), ['shelf', 'rules', 'logic', 'more']);
  for (const tab of MOBILE_TABS) assert.ok(tab.glyph, `「${tab.label}」没有图标`);
  assert.equal(mobileEntryOf('shelf'), 'shelf');
  assert.equal(mobileEntryOf('rules'), 'rules');
  assert.equal(mobileEntryOf('logic'), 'logic');
  for (const id of MOBILE_MORE) assert.equal(mobileEntryOf(id), 'more');
  assert.equal(mobileEntryOf('nope'), 'shelf', '坏数据要退回一个有效入口');
});

test('「更多」里不再重复主入口', () => {
  const ids = moreItems().map((t) => t.id);
  for (const primary of ['shelf', 'rules', 'logic']) {
    assert.ok(!ids.includes(primary), `「更多」里不该再有 ${primary}`);
  }
  assert.ok(ids.includes('settings'));
  assert.ok(ids.includes('diagnostics'));
});

test('书籍上下文显示书名与条目/逻辑数量', () => {
  const book = { name: '王城志', entries: [{}, {}, {}], logic: [{}] };
  const text = describeBookContext(book);
  assert.ok(text.includes('王城志'));
  assert.ok(text.includes('3 条规则'), text);
  assert.ok(text.includes('1 条逻辑'), text);
  assert.equal(describeBookContext({ name: '空书' }), '空书（0 条规则 · 0 条逻辑）');
  assert.ok(bookOptionLabel(book).includes('3 条规则'));
});

test('导航签名只看档位与当前页：档位没变就不重画', () => {
  assert.equal(navSignature('wide', 'rules'), navSignature('wide', 'rules'));
  assert.notEqual(navSignature('wide', 'rules'), navSignature('standard', 'rules'));
  assert.notEqual(navSignature('wide', 'rules'), navSignature('wide', 'logic'));
});

test('未保存守卫：干净时直接放行，脏时拦住并等回答', () => {
  let saved = 0;
  let discarded = 0;
  let left = 0;
  const unregister = guard.registerEditor({
    label: '测试编辑器',
    dirty: () => true,
    save: () => { saved += 1; },
    discard: () => { discarded += 1; },
  });
  assert.equal(guard.hasEditor(), true);
  assert.equal(guard.isDirty(), true);
  assert.equal(guard.allowLeave(() => { left += 1; }), false, '有改动时不能直接离开');
  assert.equal(left, 0);

  assert.equal(guard.answer('keep'), false);
  assert.equal(left, 0, '「继续编辑」不该执行离开动作');

  // 「继续编辑」会把待执行的离开动作清掉（用户决定先不走了），再点离开要重新问一次。
  assert.equal(guard.allowLeave(() => { left += 1; }), false);
  assert.equal(guard.answer('discard'), true);
  assert.equal(discarded, 1);
  assert.equal(left, 1, '选了「放弃修改」之后要继续原来的离开动作');
  unregister();
  assert.equal(guard.hasEditor(), false);
});

test('未保存守卫：保存并离开会先保存，再执行离开动作', () => {
  let saved = 0;
  let left = 0;
  guard.registerEditor({ dirty: () => true, save: () => { saved += 1; } });
  guard.allowLeave(() => { left += 1; });
  assert.equal(guard.answer('save'), true);
  assert.equal(saved, 1);
  assert.equal(left, 1);
  guard.unregisterEditor();
});

test('未保存守卫：编辑器没登记或检查函数抛错时不能把人锁死', () => {
  guard.unregisterEditor();
  assert.equal(guard.isDirty(), false);
  assert.equal(guard.allowLeave(), true);
  guard.registerEditor({ dirty: () => { throw new Error('坏了'); } });
  assert.equal(guard.isDirty(), false);
  guard.unregisterEditor();
});

test('未保存守卫：保存失败就不往下走', () => {
  let left = 0;
  guard.registerEditor({ dirty: () => true, save: () => { throw new Error('存不进去'); } });
  guard.allowLeave(() => { left += 1; });
  assert.equal(guard.answer('save'), false);
  assert.equal(left, 0, '保存失败时不应该继续离开');
  guard.unregisterEditor();
});

test('确认层默认挂 body；只有手机整屏界面真的打开时才挂进 dialog', () => {
  const body = { tag: 'body' };
  const dialog = { tag: 'dialog', open: false };
  const doc = (open) => ({
    body,
    querySelector: (sel) => (sel === 'dialog.ilb-m' ? { ...dialog, open } : null),
  });
  assert.equal(guard.hostFor(doc(false)), body, '关着的 dialog 是 display:none，挂进去会变成 0×0');
  assert.equal(guard.hostFor(doc(true)).open, true, '手机整屏界面打开时确认层要进 top layer');
  assert.equal(guard.hostFor(doc(true)).tag, 'dialog');
  assert.equal(guard.hostFor(null), null, '连 document 都没有时不能假装有地方挂');
  assert.equal(guard.hostFor({ body }), body, '没有 querySelector 的宿主也不能炸');
});

test('诊断摘要不泄露编辑器内部对象', () => {
  guard.registerEditor({ label: '某编辑器', dirty: () => true });
  const d = guard.describe();
  assert.deepEqual(Object.keys(d).sort(), ['asking', 'dirty', 'editor', 'label']);
  assert.equal(d.label, '某编辑器');
  guard.unregisterEditor();
});
