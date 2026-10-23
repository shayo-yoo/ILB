import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  splitQuery, entryHaystack, matchesQuery, listGroups,
  filterEntries, filterBooks, describeFilter,
} from '../core/search.js';

function entry(patch = {}) {
  return {
    id: patch.id ?? 'e-1',
    title: '王城的夜巡',
    content: '夜巡队每夜绕城一圈。',
    group: '王城',
    enabled: true,
    always: false,
    trigger: { any: ['夜巡', '巡逻'], all: [], regex: [], not: [] },
    ...patch,
  };
}

test('splitQuery：空格、全角空格、逗号都算分隔', () => {
  assert.deepEqual(splitQuery('王城 夜巡'), ['王城', '夜巡']);
  assert.deepEqual(splitQuery('王城　夜巡'), ['王城', '夜巡']);
  assert.deepEqual(splitQuery('王城,夜巡，巡逻'), ['王城', '夜巡', '巡逻']);
  assert.deepEqual(splitQuery('   '), []);
});

test('matchesQuery：多个词是"都要有"，不是"有一个就行"', () => {
  const e = entry();
  assert.equal(matchesQuery(e, '王城'), true);
  assert.equal(matchesQuery(e, '王城 夜巡'), true);
  assert.equal(matchesQuery(e, '王城 龙'), false);
  assert.equal(matchesQuery(e, ''), true);
});

test('matchesQuery：能搜到正文、分组、触发词，且不分大小写', () => {
  const e = entry({ title: 'Gate', content: 'The North Gate opens at dawn.', group: null, trigger: { any: ['dawn'] } });
  assert.equal(matchesQuery(e, 'north'), true);
  assert.equal(matchesQuery(e, 'GATE'), true);
  assert.equal(matchesQuery(e, 'dawn'), true);
});

test('matchesQuery：正则源码也能被搜到', () => {
  const e = entry({ trigger: { any: [], regex: ['夜巡\\d+'] } });
  assert.equal(matchesQuery(e, '夜巡'), true);
});

test('entryHaystack：标题不会和正文粘成一个词', () => {
  const e = entry({ title: '王城', content: '夜巡' });
  const hay = entryHaystack(e);
  assert.ok(hay.includes('王城'));
  assert.ok(hay.includes('夜巡'));
});

test('listGroups：去重、跳过空分组、按中文排序', () => {
  const list = [entry({ group: 'B' }), entry({ group: 'A' }), entry({ group: 'A' }), entry({ group: '' }), entry({ group: null })];
  assert.deepEqual(listGroups(list), ['A', 'B']);
});

test('filterEntries：按分组与状态过滤', () => {
  const list = [
    entry({ id: '1', group: '王城', enabled: true }),
    entry({ id: '2', group: '荒野', enabled: false }),
    entry({ id: '3', group: '王城', always: true }),
  ];
  assert.equal(filterEntries(list, { group: '王城' }).length, 2);
  assert.equal(filterEntries(list, { mode: 'disabled' }).length, 1);
  assert.equal(filterEntries(list, { mode: 'always' }).length, 1);
  assert.equal(filterEntries(list, { mode: 'keyword' }).length, 2);
  assert.equal(filterEntries(list, {}).length, 3);
});

test('filterEntries：搜索与筛选是"并且"关系', () => {
  const list = [
    entry({ id: '1', group: '王城', title: '夜巡' }),
    entry({ id: '2', group: '荒野', title: '夜巡' }),
  ];
  assert.equal(filterEntries(list, { q: '夜巡', group: '荒野' }).length, 1);
});

test('filterBooks：能按书名、来源文件、条目标题搜到', () => {
  const books = [
    { book_id: 'b1', name: '王城设定', _source: { book_file: 'wong.json' }, entries: [{ title: '夜巡' }] },
    { book_id: 'b2', name: '荒野设定', _source: {}, entries: [{ title: '沙暴' }] },
  ];
  assert.equal(filterBooks(books, '王城').length, 1);
  assert.equal(filterBooks(books, 'wong').length, 1);
  assert.equal(filterBooks(books, '沙暴').length, 1);
  assert.equal(filterBooks(books, '').length, 2);
  assert.equal(filterBooks(books, '不存在').length, 0);
});

test('describeFilter：没筛选时说总数，有筛选时说命中比例', () => {
  assert.equal(describeFilter({}, 5, 5), '共 5 条');
  assert.ok(describeFilter({ q: '王城' }, 2, 9).includes('2 / 9'));
  assert.ok(describeFilter({ group: 'A' }, 1, 3).includes('分组 A'));
});
