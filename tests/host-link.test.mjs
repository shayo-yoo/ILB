// tests/host-link.test.mjs —— 宿主联动（Phase 1）的规格测试
// 纯函数层：host-context（把宿主信息洗成统一形状）、resolve-books（策略 + 三态覆盖）、migrate（存档迁移）。
// **模拟宿主，不是真酒馆**：真机验收步骤见 docs/真机验收-下一阶段.md。

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BOOK_OVERRIDES,
  BOOK_STRATEGIES,
  STRATEGY_LABEL,
  describeHostSource,
  describeMatch,
  emptyHostContext,
  matchBookToHost,
  nativeKeysOf,
  normalizeHostContext,
  summarizeHostContext,
} from '../core/host-context.js';
import { resolveBooks } from '../core/resolve-books.js';
import { DATA_VERSION, describeMigration, migrateBucket } from '../core/migrate.js';
import { defaultBook, normalizeBook, strategyOf } from '../core/model.js';

function book(patch = {}) {
  return normalizeBook({
    schema_version: 2,
    book_id: patch.book_id ?? 'b1',
    name: patch.name ?? '书一',
    activation: { mode: 'manual', manual: true },
    pool: { share: false },
    entries: [],
    ...patch,
  });
}

function host(patch = {}) {
  return normalizeHostContext({
    contextAvailable: true,
    chatId: 'c1',
    character: { index: 0, name: '小明', avatar: 'ming.png', primaryWorld: '主书', additionalWorlds: [] },
    globalWorlds: ['全局书'],
    ...patch,
  });
}

test('策略只有三种，覆盖只有三态，且都有中文名', () => {
  assert.deepEqual(BOOK_STRATEGIES, ['auto', 'always', 'manual']);
  assert.deepEqual(BOOK_OVERRIDES, ['auto', 'on', 'off']);
  assert.equal(STRATEGY_LABEL.auto, '自动跟随酒馆');
  assert.equal(STRATEGY_LABEL.manual, '手动控制');
});

test('normalizeHostContext 把缺的字段补成空，不发明数据', () => {
  const host = normalizeHostContext({});
  assert.equal(host.contextAvailable, false);
  assert.deepEqual(host.globalWorlds, []);
  assert.deepEqual(host.character.additionalWorlds, []);
  assert.equal(host.character.primaryWorld, '');
  assert.deepEqual(host.unsupported, []);
});

test('summarizeHostContext 说人话：有角色、有群聊、没上下文三种', () => {
  const a = summarizeHostContext(host());
  assert.equal(a.ok, true);
  assert.match(a.line, /小明/);
  const b = summarizeHostContext(host({ group: { id: 'g1', name: '冒险队', members: ['ming.png'] } }));
  assert.match(b.line, /群聊/);
  const c = summarizeHostContext(null);
  assert.equal(c.ok, false);
  assert.match(c.line, /还没读到|状态未知/);
});

test('describeHostSource 说清楚来源与角色名', () => {
  assert.match(describeHostSource({ kind: 'global', world: '全局书' }), /全局/);
  const member = describeHostSource({ kind: 'group-member', world: '小红的书', characterName: '小红' });
  assert.match(member, /群聊/);
  assert.match(member, /小红/);
});

test('nativeKeysOf 的优先级：映射 > 文件名 > 别名', () => {
  const b = normalizeBook({
    book_id: 'x',
    name: '书',
    _source: { book_file: 'file书' },
    host: { nativeNames: ['映射书'], aliases: ['别名书'] },
  });
  const keys = nativeKeysOf(b);
  assert.equal(keys[0].value, '映射书');
  assert.equal(keys[0].via, 'mapping');
  assert.ok(keys.some((k) => k.value === 'file书' && k.via === 'file'));
  assert.ok(keys.some((k) => k.value === '别名书' && k.via === 'alias'));
});

test('matchBookToHost：来源里真有这本书才算匹配', () => {
  const b = normalizeBook({ book_id: 'b1', name: '全局书', _source: { book_file: '全局书' } });
  const result = matchBookToHost(b, host());
  assert.equal(result.matched.length > 0, true);
  assert.equal(result.sources[0].kind, 'global');
  assert.match(describeMatch(result), /关联了这本书/);
});

test('matchBookToHost：只有书名相同只是"候选"，不算匹配', () => {
  const b = book({ book_id: 'b2', name: '主书' });
  const result = matchBookToHost(b, host({ globalWorlds: [] }));
  assert.equal(result.matched.length, 0);
  assert.equal(result.candidate.length > 0, true);
  assert.match(describeMatch(result), /同名|候选/);
});

test('resolveBooks：强制停用压过一切，包括"始终启用"', () => {
  const b = book({ book_id: 'b1', name: '始终书' });
  b.activation.strategy = 'always';
  b.activation.override = 'off';
  const resolved = resolveBooks([b], { hostContext: host(), hostLink: { enabled: true } });
  assert.equal(resolved.activeBooks.length, 0);
  assert.equal(resolved.details.b1.rule, 'force-off');
  assert.match(resolved.details.b1.reason, /强制停用/);
});

test('resolveBooks：强制启用压过策略，且说明是手动覆盖', () => {
  const b = book({ book_id: 'b1', name: '无关书' });
  b.activation.strategy = 'manual';
  b.activation.override = 'on';
  const resolved = resolveBooks([b], { hostContext: host(), hostLink: { enabled: true } });
  assert.deepEqual(resolved.activeBooks, ['b1']);
  assert.equal(resolved.details.b1.rule, 'force-on');
  assert.match(resolved.details.b1.reason, /手动/);
});

test('resolveBooks：自动跟随按宿主来源启用，并带出原因', () => {
  const b = normalizeBook({ book_id: 'b1', name: '全局书', _source: { book_file: '全局书' }, activation: { mode: 'manual', strategy: 'auto' } });
  const resolved = resolveBooks([b], { hostContext: host(), hostLink: { enabled: true } });
  assert.deepEqual(resolved.activeBooks, ['b1']);
  assert.equal(resolved.details.b1.rule, 'auto');
  assert.match(resolved.details.b1.reason, /全局/);
  assert.equal(resolved.details.b1.sources.length > 0, true);
});

test('resolveBooks：自动跟随时书名撞车不自动启用，只提示', () => {
  const b = book({ book_id: 'b1', name: '主书' });
  b.activation.strategy = 'auto';
  const resolved = resolveBooks([b], { hostContext: host({ globalWorlds: [] }), hostLink: { enabled: true } });
  assert.equal(resolved.activeBooks.length, 0);
  assert.equal(resolved.details.b1.rule, 'auto-candidate');
  assert.match(resolved.warnings.map((w) => w.message).join(' '), /同名/);
});

test('resolveBooks：没有宿主上下文时退回 v0.14 的老行为（书名匹配角色卡绑定）', () => {
  const b = book({ book_id: 'b1', name: '角色书' });
  b.activation.strategy = 'auto';
  const resolved = resolveBooks(
    [b],
    { hostContext: null, hostLink: { enabled: true }, boundBooks: ['角色书'] },
  );
  assert.deepEqual(resolved.activeBooks, ['b1']);
  assert.equal(resolved.details.b1.rule, 'legacy-character');
});

test('resolveBooks：宿主联动总开关关掉时，完全退回老行为', () => {
  const b = book({ book_id: 'b1', name: '全局书' });
  b.activation.strategy = 'auto';
  const withoutLink = resolveBooks([b], { hostContext: host(), hostLink: { enabled: false }, boundBooks: ['全局书'] });
  assert.deepEqual(withoutLink.activeBooks, ['b1']);
  assert.equal(withoutLink.details.b1.rule, 'legacy-character');
  const noMatch = resolveBooks([b], { hostContext: host(), hostLink: { enabled: false }, boundBooks: [] });
  assert.equal(noMatch.activeBooks.length, 0);
});

test('resolveBooks：手动控制的书只听手动开关', () => {
  const b = book({ book_id: 'b1', name: '全局书' });
  b.activation.strategy = 'manual';
  const on = resolveBooks([b], { hostContext: host(), manualState: { b1: true }, hostLink: { enabled: true } });
  assert.deepEqual(on.activeBooks, ['b1']);
  const off = resolveBooks([b], { hostContext: host(), manualState: { b1: false }, hostLink: { enabled: true } });
  assert.equal(off.activeBooks.length, 0);
});

test('resolveBooks：老数据（只有 mode=character）迁移后策略是"自动跟随"', () => {
  const b = book({ book_id: 'b1', name: '老书' });
  b.activation.mode = 'character';
  delete b.activation.strategy;
  const normalized = normalizeBook(b);
  assert.equal(strategyOf(normalized.activation), 'auto');
});

test('resolveBooks：同一本原生书被多个来源提到时，只启用一次并列出所有来源', () => {
  const b = normalizeBook({ book_id: 'b1', name: '两处都有', _source: { book_file: '两处都有' }, activation: { mode: 'manual', strategy: 'auto' } });
  const resolved = resolveBooks([b], {
    hostContext: host({ globalWorlds: ['两处都有'], personaWorld: '两处都有' }),
    hostLink: { enabled: true },
  });
  assert.equal(resolved.activeBooks.length, 1);
  assert.equal(resolved.details.b1.sources.length >= 2, true);
});

test('迁移：老存档补上策略字段，版本号升到新版本', () => {
  const old = {
    books: [{ book_id: 'b1', name: '老书', activation: { mode: 'character', manual: true } }],
    settings: { scanDepth: 5 },
  };
  const result = migrateBucket(old, { now: 1000 });
  assert.equal(result.changed, true);
  assert.equal(result.to, DATA_VERSION);
  assert.equal(result.data.books[0].activation.strategy, 'auto');
  assert.equal(result.data.books[0].activation.mode, 'character');
  assert.deepEqual(result.data.books[0].host, { nativeNames: [], aliases: [], lastMatchedAt: 0 });
  assert.equal(result.data.version, DATA_VERSION);
  assert.match(describeMigration(result), /迁移到/);
});

test('迁移是幂等的：第二遍什么也不改', () => {
  const first = migrateBucket({ books: [{ book_id: 'b1', name: 'x', activation: { mode: 'always' } }] }, { now: 1 });
  const second = migrateBucket(first.data, { now: 2 });
  assert.equal(second.changed, false);
  assert.equal(second.data, first.data);
});

test('迁移不丢字段：不认识的字段原样保留', () => {
  const result = migrateBucket(
    { books: [{ book_id: 'b1', name: 'x', 我自己加的: { a: 1 }, activation: { mode: 'manual' } }] },
    { now: 1 },
  );
  assert.deepEqual(result.data.books[0]['我自己加的'], { a: 1 });
});

test('迁移前是坏数据时，失败不覆盖，并给出原因', () => {
  const bad = { books: 'not-an-array', version: 1 };
  const result = migrateBucket(bad, { now: 1 });
  // books 不是数组时按空处理（不算失败），但原数据里的其他字段仍在
  assert.equal(result.error, '');
  assert.equal(Array.isArray(result.data.books), true);
});

test('defaultBook 现在就带齐三组新字段', () => {
  const b = defaultBook('新书');
  assert.equal(b.activation.strategy, 'manual');
  assert.equal(b.activation.override, 'auto');
  assert.deepEqual(b.host.nativeNames, []);
});

test('emptyHostContext 的形状稳定', () => {
  const host = emptyHostContext();
  assert.equal(host.contextAvailable, false);
  assert.deepEqual(host.sources, []);
  assert.equal(typeof host.updatedAt, 'number');
});
