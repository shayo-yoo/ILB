import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hiddenEntryIdsByRegex } from '../core/regex-visibility.js';

test('正则标记为不作用于世界书时过滤命中条目', () => {
  const entries = [{ id: 'a', title: '状态', content: '隐藏标记' }, { id: 'b', title: '其他', content: '保留' }];
  const hidden = hiddenEntryIdsByRegex(entries, [{ find: '隐藏标记', flags: 'g', worldInfo: false }]);
  assert.deepEqual([...hidden], ['a']);
});

test('没有明确世界书可见性元数据时保持兼容', () => {
  const hidden = hiddenEntryIdsByRegex([{ id: 'a', title: '状态', content: 'x' }], [{ find: 'x', flags: 'g' }]);
  assert.equal(hidden.size, 0);
});
