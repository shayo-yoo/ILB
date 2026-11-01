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

test('默认排序：不认识的键退回收录顺序，方向按每个键的直觉给', () => {
  assert.deepEqual(normalizeSort({ key: '不存在' }, 'rules'), { key: 'imported', dir: 'asc' });
  assert.deepEqual(normalizeSort(null, 'rules'), { key: 'imported', dir: 'asc' });
  assert.equal(defaultDir('updated'), 'desc');
  assert.equal(defaultDir('name'), 'asc');
  assert.deepEqual(normalizeSorts({ rules: { key: 'hits', dir: 'asc' } }).rules, { key: 'hits', dir: 'asc' });
  // shelf 不支持 hits，洗掉
  assert.deepEqual(normalizeSorts({ shelf: { key: 'hits', dir: 'desc' } }).shelf, { key: 'imported', dir: 'asc' });
});

test('sortLabel 说人话', () => {
  assert.equal(sortLabel({ key: 'manual', dir: 'desc' }), '手动权重（倒序）');
  assert.equal(sortLabel({ key: 'imported', dir: 'asc' }), '收录顺序（正序）');
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
