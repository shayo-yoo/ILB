// tests/fields.test.mjs —— 动态条目字段（ILB-4.13）
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FIELD_TYPES,
  normalizeField,
  normalizeFields,
  fieldsOf,
  withFieldDefaults,
  describeField,
} from '../core/fields.js';
import { normalizeEntry } from '../core/model.js';

test('字段：没有 key 的丢弃，类型不认识退回文本', () => {
  assert.equal(normalizeField({ label: '没有名字' }), null);
  const f = normalizeField({ key: '备注', type: '不认识' });
  assert.equal(f.type, 'text');
  assert.equal(f.label, '备注');
  assert.ok(FIELD_TYPES.includes(f.type));
});

test('字段：数字按 min/max 夹住，开关只认 true，选项不合法退第一项', () => {
  const a = normalizeField({ key: '幸运', type: 'number', value: 200, min: 0, max: 100 });
  assert.equal(a.value, 100);
  const b = normalizeField({ key: '幸运', type: 'number', min: 10, value: -5 });
  assert.equal(b.value, 10);
  const c = normalizeField({ key: '开', type: 'bool', value: 'yes' });
  assert.equal(c.value, false);
  const d = normalizeField({ key: '池', type: 'choice', value: '限定', options: ['常驻', '限定'] });
  assert.equal(d.value, '限定');
  const e = normalizeField({ key: '池', type: 'choice', value: '不存在', options: ['常驻'] });
  assert.equal(e.value, '常驻');
});

test('字段：整张表去重、最多 12 个；条目归一化后保留字段', () => {
  const list = normalizeFields([
    { key: 'a', label: 'A' },
    { key: 'a', label: '重复' },
    { key: 'b', label: 'B', type: 'number' },
  ]);
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((f) => f.key), ['a', 'b']);

  const many = normalizeFields(Array.from({ length: 20 }, (_, i) => ({ key: `k${i}` })));
  assert.equal(many.length, 12);

  const entry = normalizeEntry({ id: 'e1', title: '抽卡', fields: [{ key: '次数', type: 'number', value: 3 }] }, 'b1');
  assert.equal(fieldsOf(entry).length, 1);
  assert.equal(entry.fields[0].value, 3);
  assert.equal(describeField(entry.fields[0]), '次数（数字）');
});

test('字段：默认值只补空缺，已有值不被覆盖', () => {
  const entries = [{ fields: [{ key: '次数', value: 3 }, { key: '幸运', value: 50 }] }];
  const vars = withFieldDefaults({ 次数: 8 }, entries);
  assert.equal(vars['次数'], 8);
  assert.equal(vars['幸运'], 50);
  assert.deepEqual(withFieldDefaults({}, []), {});
});
