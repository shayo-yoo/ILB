// core/sort.js 的单元测试（v0.22.0）
// 排序只影响界面，不改数据、不参与判定——所以这里只测"看起来对的顺序"。

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SORT_KEYS,
  SORT_LABEL,
  defaultSorts,
  defaultDir,
  normalizeSort,
  normalizeSorts,
  sortLabel,
  sortList,
} from '../core/sort.js';

const items = () => [
  { id: 'a', title: '丙', ui: { order: 2, createdAt: 300, updatedAt: 10 } },
  { id: 'b', title: '甲', ui: { order: 5, createdAt: 100, updatedAt: 30 } },
  { id: 'c', title: '乙', ui: { order: 1, createdAt: 200, updatedAt: 20 } },
];

test('排序键：每个列表只允许自己支持的那几个', () => {
  assert.deepEqual(SORT_KEYS.shelf, ['imported', 'name', 'created', 'updated']);
  assert.ok(SORT_KEYS.rules.includes('manual'));
  assert.ok(SORT_KEYS.rules.includes('hits'));
  assert.ok(SORT_KEYS.logic.includes('manual'));
  assert.equal(SORT_LABEL.updated, '上次修改');
});

test('默认排序：不认识的键退回收录顺序，方向按每个键的直觉给；次排序默认不设', () => {
  const base = { key: 'imported', dir: 'asc', secondKey: 'none', secondDir: 'asc' };
  assert.deepEqual(normalizeSort({ key: '不存在' }, 'rules'), base);
  assert.deepEqual(normalizeSort(null, 'rules'), base);
  assert.equal(defaultDir('updated'), 'desc');
  assert.equal(defaultDir('name'), 'asc');
  assert.deepEqual(normalizeSorts({ rules: { key: 'hits', dir: 'asc' } }).rules, {
    key: 'hits', dir: 'asc', secondKey: 'none', secondDir: 'asc',
  });
  // shelf 不支持 hits / inject，洗掉
  assert.deepEqual(normalizeSorts({ shelf: { key: 'hits', dir: 'desc' } }).shelf, base);
  assert.deepEqual(normalizeSorts({ rules: { key: 'name', secondKey: 'inject', secondDir: 'desc' } }).rules, {
    key: 'name', dir: 'asc', secondKey: 'inject', secondDir: 'desc',
  });
  // 次排序不能和主排序同一个键
  assert.equal(normalizeSort({ key: 'name', secondKey: 'name' }, 'rules').secondKey, 'none');
});

test('sortLabel 说人话', () => {
  assert.equal(sortLabel({ key: 'manual', dir: 'desc' }), '手动权重（倒序），启用的在前');
  assert.equal(sortLabel({ key: 'imported', dir: 'asc' }), '收录顺序（正序），启用的在前');
  assert.equal(
    sortLabel({ key: 'manual', dir: 'desc', secondKey: 'name', secondDir: 'asc' }),
    '手动权重（倒序），再看名称（正序）',
  );
});

test('收录顺序：不动；倒序就整体反过来', () => {
  assert.deepEqual(sortList(items(), { key: 'imported', dir: 'asc' }).map((x) => x.id), ['a', 'b', 'c']);
  assert.deepEqual(sortList(items(), { key: 'imported', dir: 'desc' }).map((x) => x.id), ['c', 'b', 'a']);
});

test('手动权重：数字大的在前；权重相同保持原顺序', () => {
  assert.deepEqual(sortList(items(), { key: 'manual', dir: 'desc' }).map((x) => x.id), ['b', 'a', 'c']);
  assert.deepEqual(sortList(items(), { key: 'manual', dir: 'asc' }).map((x) => x.id), ['c', 'a', 'b']);
  const same = [
    { id: 'x', ui: { order: 1 } },
    { id: 'y', ui: { order: 1 } },
    { id: 'z', ui: { order: 1 } },
  ];
  assert.deepEqual(sortList(same, { key: 'manual', dir: 'desc' }).map((x) => x.id), ['x', 'y', 'z']);
});

test('名称按拼音；创建/修改时间按数字；老数据缺时间算 0', () => {
  // 中文按拼音：丙(bing) < 甲(jia) < 乙(yi)
  assert.deepEqual(sortList(items(), { key: 'name', dir: 'asc' }).map((x) => x.id), ['a', 'b', 'c']);
  assert.deepEqual(sortList(items(), { key: 'created', dir: 'asc' }).map((x) => x.id), ['b', 'c', 'a']);
  assert.deepEqual(sortList(items(), { key: 'updated', dir: 'desc' }).map((x) => x.id), ['b', 'c', 'a']);
  const old = [{ id: 'old' }, { id: 'new', ui: { createdAt: 99 } }];
  assert.deepEqual(sortList(old, { key: 'created', dir: 'desc' }).map((x) => x.id), ['new', 'old']);
});

test('触发次数：hitsOf 决定每条多少次；没有统计算 0', () => {
  const hits = { a: 3, b: 1 };
  const list = sortList(items(), { key: 'hits', dir: 'desc' }, (item) => hits[item.id] ?? 0);
  assert.deepEqual(list.map((x) => x.id), ['a', 'b', 'c']);
  const asc = sortList(items(), { key: 'hits', dir: 'asc' }, (item) => hits[item.id] ?? 0);
  assert.deepEqual(asc.map((x) => x.id), ['c', 'b', 'a']);
});

test('不原地改数组，输入为空也不炸', () => {
  const source = items();
  const sorted = sortList(source, { key: 'manual', dir: 'desc' });
  assert.deepEqual(source.map((x) => x.id), ['a', 'b', 'c']);
  assert.notEqual(sorted, source);
  assert.deepEqual(sortList(null, defaultSorts().rules), []);
});

test('启用优先：不管主排序是什么，停用的都沉到后面', () => {
  const mix = [
    { id: 'off1', title: '阿', enabled: false, ui: { order: 9 } },
    { id: 'on1', title: '波', enabled: true, ui: { order: 1 } },
    { id: 'off2', title: '次', enabled: false, ui: { order: 5 } },
    { id: 'on2', title: '丁', enabled: true, ui: { order: 3 } },
  ];
  assert.deepEqual(sortList(mix, { key: 'imported', dir: 'asc' }).map((x) => x.id), ['on1', 'on2', 'off1', 'off2']);
  assert.deepEqual(sortList(mix, { key: 'manual', dir: 'desc' }).map((x) => x.id), ['on2', 'on1', 'off1', 'off2']);
  // 传 enabledOf 时以调用方为准（书用手动开关）
  const books = [
    { id: 'b1', activation: { strategy: 'manual' } },
    { id: 'b2', activation: { strategy: 'always' } },
  ];
  assert.deepEqual(
    sortList(books, { key: 'imported', dir: 'asc' }, { enabledOf: (b) => b.id !== 'b2' }).map((b) => b.id),
    ['b1', 'b2'],
  );
});

test('双重排序：主键相等时看次键；次键也不同才回到原顺序', () => {
  const list = [
    { id: 'a', title: '乙', ui: { order: 5 } },
    { id: 'b', title: '甲', ui: { order: 5 } },
    { id: 'c', title: '丙', ui: { order: 5 } },
    { id: 'd', title: '丁', ui: { order: 9 } },
  ];
  assert.deepEqual(
    sortList(list, { key: 'manual', dir: 'desc', secondKey: 'name', secondDir: 'asc' }).map((x) => x.id),
    ['d', 'c', 'b', 'a'],
  );
  assert.deepEqual(
    sortList(list, { key: 'manual', dir: 'desc', secondKey: 'name', secondDir: 'desc' }).map((x) => x.id),
    ['d', 'a', 'b', 'c'],
  );
  assert.deepEqual(sortList(list, { key: 'manual', dir: 'desc' }, null).map((x) => x.id), ['d', 'a', 'b', 'c']);
});

test('注入顺序：位置在前、深度在后；同位置同深度保持原顺序', () => {
  const list = [
    { id: 'in_chat', injection: { position: 'in_chat', depth: 0 } },
    { id: 'after_4', injection: { position: 'after_char', depth: 4 } },
    { id: 'before', injection: { position: 'before_char', depth: 0 } },
    { id: 'after_2', injection: { position: 'after_char', depth: 2 } },
    { id: 'after_2b', injection: { position: 'after_char', depth: 2 } },
  ];
  assert.deepEqual(
    sortList(list, { key: 'inject', dir: 'asc' }).map((x) => x.id),
    ['before', 'after_2', 'after_2b', 'after_4', 'in_chat'],
  );
});

test('触发次数：可以传 {hitsOf} 对象，旧写法传函数也还认', () => {
  const hits = { a: 3, b: 1 };
  const byObject = sortList(items(), { key: 'hits', dir: 'desc' }, { hitsOf: (item) => hits[item.id] ?? 0 });
  assert.deepEqual(byObject.map((x) => x.id), ['a', 'b', 'c']);
  const byFn = sortList(items(), { key: 'hits', dir: 'desc' }, (item) => hits[item.id] ?? 0);
  assert.deepEqual(byFn.map((x) => x.id), ['a', 'b', 'c']);
});
