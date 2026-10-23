// tests/core.test.mjs —— 判定层的规格测试（对应 ILB-4.8.2 的表）
// 运行方式：在 extension 目录下执行 `node --test tests/`
// 注意：这些测试在本机尚未运行过（开发环境无法执行 node），属于"写好了但没验证"。

import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluate, evalTrigger, evalCondition, previewEntry } from '../core/evaluate.js';
import { normalizeBook } from '../core/model.js';
import { resolveBooks } from '../core/resolve-books.js';
import { convertNativeWorld } from '../core/import-native.js';
import { mergeImportedBook } from '../core/merge-book.js';
import { exportNativeWorld } from '../core/export-native.js';

const LONG = (n) => 'a'.repeat(n);

function makeBook(entries, patch = {}) {
  // book_id 取书名，这样测试里可以直接写 'T::1' 这种 id（normalizeEntry 会加 `<book_id>::` 前缀）
  return normalizeBook({
    schema_version: 2,
    book_id: patch.name ?? 'T',
    name: 'T',
    activation: { mode: 'always', characters: [], manual: true },
    pool: { share: false },
    entries,
    ...patch,
  });
}

function run(book, requestPatch = {}, settingsPatch = {}) {
  const context = {};
  return evaluate(
    { messages: [{ role: 'user', content: '' }], userInput: '', scanDepth: 3, ...requestPatch },
    { books: [book], context, settings: { ...settingsPatch } },
  );
}

const ids = (result) => result.activated.map((a) => a.entryId);

test('触发词：出现任意一个就触发', () => {
  const book = makeBook([{ id: '1', content: '王城', trigger: { any: ['王城', '帝都'] } }]);
  const r = run(book, { userInput: '我走进帝都' });
  assert.equal(ids(r).length, 1);
});

test('触发词：一个都没出现就不触发，并给出原因', () => {
  const book = makeBook([{ id: '1', content: '王城', trigger: { any: ['王城'] } }]);
  const r = run(book, { userInput: '海边' });
  assert.equal(r.activated.length, 0);
  const diag = r.diagnostics.find((d) => d.entryId.endsWith('::1'));
  assert.equal(diag.stage, 'trigger');
  assert.match(diag.reason, /没有出现/);
});

test('触发词：没有触发词也不是常驻，永不出现', () => {
  const book = makeBook([{ id: '1', content: 'x', trigger: { any: [] } }]);
  const r = run(book, { userInput: '随便什么' });
  assert.equal(r.activated.length, 0);
});

test('触发词：排除词会否决', () => {
  const book = makeBook([{ id: '1', content: 'x', trigger: { any: ['王城'], not: ['夜晚'] } }]);
  assert.equal(run(book, { userInput: '白天的王城' }).activated.length, 1);
  assert.equal(run(book, { userInput: '夜晚的王城' }).activated.length, 0);
});

test('触发词：区分大小写按开关生效', () => {
  const base = { any: ['Dragon'], matchCase: true };
  assert.equal(evalTrigger(base, 'a DRAGON').passed, false);
  assert.equal(evalTrigger({ ...base, matchCase: false }, 'a DRAGON').passed, true);
});

test('触发词：英文整词匹配不会命中更长单词的一部分', () => {
  const trig = { any: ['cat'], wholeWords: true };
  assert.equal(evalTrigger(trig, 'the cat sat').passed, true);
  assert.equal(evalTrigger(trig, 'concatenate').passed, false);
});

test('触发词：第二组词按四选一的逻辑判定', () => {
  const t = (logic, keys, text) => evalTrigger({ any: ['王城'], secondary: { logic, keys } }, text).passed;
  assert.equal(t('AND_ANY', ['夜', '雨'], '王城下雨了'), true);
  assert.equal(t('AND_ALL', ['夜', '雨'], '王城下雨了'), false);
  assert.equal(t('NOT_ANY', ['雪'], '王城下雨了'), true);
  assert.equal(t('NOT_ALL', ['雨', '雪'], '王城下雨了'), true);
});

test('常驻条目不需要触发词', () => {
  const book = makeBook([{ id: '1', content: 'x', always: true, trigger: { any: [] } }]);
  assert.equal(run(book, { userInput: '任何话' }).activated.length, 1);
});

test('条件：引用别的条目是否激活', () => {
  const book = makeBook([
    { id: '1', content: 'A', trigger: { any: ['王城'] } },
    { id: '2', content: 'B', trigger: { any: ['王城'] }, when: [{ type: 'activated', entryId: 'T::1' }] },
  ]);
  assert.deepEqual(ids(run(book, { userInput: '王城' })).sort(), ['T::1', 'T::2']);
});

test('条件：文本包含与否定', () => {
  assert.equal(evalCondition({ type: 'contains', text: '雨' }, { text: '下雨了' }).passed, true);
  assert.equal(evalCondition({ type: 'contains', text: '雨', negate: true }, { text: '下雨了' }).passed, false);
});

test('条件：变量比较', () => {
  const ctx = { vars: { 好感: 30 } };
  assert.equal(evalCondition({ type: 'var', name: '好感', op: 'gt', value: 20 }, ctx).passed, true);
  assert.equal(evalCondition({ type: 'var', name: '好感', op: 'lt', value: 20 }, ctx).passed, false);
  assert.equal(evalCondition({ type: 'var', name: '没这个', op: 'missing' }, ctx).passed, true);
});

test('条件：并且 / 或者的组合', () => {
  const ctx = { text: '下雨了', vars: {} };
  assert.equal(evalCondition({ type: 'all', of: [{ type: 'contains', text: '雨' }, { type: 'contains', text: '雪' }] }, ctx).passed, false);
  assert.equal(evalCondition({ type: 'any', of: [{ type: 'contains', text: '雨' }, { type: 'contains', text: '雪' }] }, ctx).passed, true);
});

test('连锁：被带出的条目的正文可以继续触发下一条', () => {
  const book = makeBook([
    { id: '1', content: '夜巡队会出现在王城的城墙上', trigger: { any: ['王城'] } },
    { id: '2', content: '夜巡队的队长是个独眼老人', trigger: { any: ['夜巡队'] }, chain: { participate: true } },
  ]);
  assert.deepEqual(ids(run(book, { userInput: '王城' })).sort(), ['T::1', 'T::2']);
});

test('连锁：没打开参与的条目不会被带出', () => {
  const book = makeBook([
    { id: '1', content: '夜巡队', trigger: { any: ['王城'] } },
    { id: '2', content: '队长', trigger: { any: ['夜巡队'] }, chain: { participate: false } },
  ]);
  assert.deepEqual(ids(run(book, { userInput: '王城' })), ['T::1']);
});

test('连锁：层数上限生效', () => {
  const book = makeBook([
    { id: '1', content: 'words-b', trigger: { any: ['alpha'] } },
    { id: '2', content: 'words-c', trigger: { any: ['words-b'] }, chain: { participate: true } },
    { id: '3', content: 'words-d', trigger: { any: ['words-c'] }, chain: { participate: true } },
    { id: '4', content: 'end', trigger: { any: ['words-d'] }, chain: { participate: true } },
  ]);
  const r = run(book, { userInput: 'alpha' }, { maxChainDepth: 2 });
  const got = ids(r);
  assert.ok(got.includes('T::2'), '第一层应该带出 2');
  assert.ok(got.includes('T::3'), '第二层应该带出 3');
  assert.ok(!got.includes('T::4'), '第三层不该被带出');
});

test('连锁：默认深度是 3', () => {
  const book = makeBook([
    { id: '1', content: 'words-b', trigger: { any: ['alpha'] } },
    { id: '2', content: 'words-c', trigger: { any: ['words-b'] }, chain: { participate: true } },
    { id: '3', content: 'words-d', trigger: { any: ['words-c'] }, chain: { participate: true } },
    { id: '4', content: 'end', trigger: { any: ['words-d'] }, chain: { participate: true } },
  ]);
  assert.ok(ids(run(book, { userInput: 'alpha' })).includes('T::4'));
});

test('同组：只留权重最高的那个', () => {
  const book = makeBook([
    { id: '1', content: '普通王城', trigger: { any: ['王城'] }, group: 'g', weight: 100 },
    { id: '2', content: '夜巡王城', trigger: { any: ['王城'] }, group: 'g', weight: 200 },
  ]);
  assert.deepEqual(ids(run(book, { userInput: '王城' })), ['T::2']);
});

test('排序：权重高的在前，同权重按用户位次', () => {
  const book = makeBook([
    { id: '1', content: 'a', always: true, weight: 50, ui: { order: 0 } },
    { id: '2', content: 'b', always: true, weight: 90, ui: { order: 5 } },
    { id: '3', content: 'c', always: true, weight: 90, ui: { order: 1 } },
  ]);
  assert.deepEqual(ids(run(book)), ['T::3', 'T::2', 'T::1']);
});

test('预算：超出的条目整条丢掉，正文不被截断', () => {
  const book = makeBook([
    { id: '1', content: LONG(600), always: true, weight: 200 },
    { id: '2', content: LONG(600), always: true, weight: 100 },
  ]);
  const r = run(book, {}, { budgetCap: 200 });
  assert.equal(r.activated.length, 1);
  assert.equal(r.activated[0].content.length, 600);
  assert.deepEqual(r.budget.dropped, ['T::2']);
  assert.ok(r.budget.used <= r.budget.limit);
});

test('概率：同一个 seed 结果可复现', () => {
  const book = makeBook([{ id: '1', content: 'x', always: true, useProbability: true, probability: 50 }]);
  const a = run(book, { seed: 'chat-1:7' });
  const b = run(book, { seed: 'chat-1:7' });
  assert.deepEqual(ids(a), ids(b));
});

test('概率：0% 永不出现，100% 一定出现', () => {
  const never = makeBook([{ id: '1', content: 'x', always: true, useProbability: true, probability: 0 }]);
  const always = makeBook([{ id: '2', content: 'y', always: true, useProbability: true, probability: 100 }]);
  assert.equal(run(never).activated.length, 0);
  assert.equal(run(always).activated.length, 1);
});

test('时效：持续期内不需要触发词', () => {
  const book = makeBook([{ id: '1', content: 'x', trigger: { any: ['不存在的词'] }, timed: { sticky: 5 } }]);
  const r = run(book, {
    messages: Array.from({ length: 5 }, () => ({ role: 'user', content: '话' })),
    history: [{ entryId: 'T::1', lastActiveAt: 2, activeSince: 2 }],
  });
  assert.equal(r.activated.length, 1);
});

test('时效：持续期结束后恢复正常判定', () => {
  const book = makeBook([{ id: '1', content: 'x', trigger: { any: ['不存在的词'] }, timed: { sticky: 2 } }]);
  const r = run(book, {
    messages: Array.from({ length: 6 }, () => ({ role: 'user', content: '话' })),
    history: [{ entryId: 'T::1', lastActiveAt: 2, activeSince: 2 }],
  });
  assert.equal(r.activated.length, 0);
});

test('时效：延迟与冷却', () => {
  const delayed = makeBook([{ id: '1', content: 'x', always: true, timed: { delay: 10 } }]);
  assert.equal(run(delayed, { messages: [{ role: 'user', content: 'a' }] }).activated.length, 0);

  const cooled = makeBook([{ id: '2', content: 'y', always: true, timed: { cooldown: 3 } }]);
  const r = run(cooled, {
    messages: Array.from({ length: 5 }, () => ({ role: 'user', content: '话' })),
    history: [{ entryId: 'T::2', lastActiveAt: 4, activeSince: null }],
  });
  assert.equal(r.activated.length, 0);
});

test('多书：手动开关决定书在不在场', () => {
  const on = makeBook([{ id: '1', content: 'x', always: true }], {
    name: 'A',
    activation: { mode: 'manual', characters: [], manual: true },
  });
  const off = makeBook([{ id: '1', content: 'y', always: true }], {
    name: 'B',
    activation: { mode: 'manual', characters: [], manual: false },
  });
  const r = evaluate({ messages: [], scanDepth: 3 }, { books: [on, off], context: {} });
  assert.equal(r.activated.length, 1);
  assert.equal(r.books.active.length, 1);
  assert.match(r.books.reasons[off.book_id], /手动关掉/);
});

test('多书：总条目池可以收录未启用但共享的书', () => {
  const shared = makeBook([{ id: '1', content: 'x', trigger: { any: ['王城'] } }], {
    name: 'Share',
    activation: { mode: 'manual', characters: [], manual: false },
    pool: { share: true },
  });
  const r = evaluate({ userInput: '王城' }, { books: [shared], context: {} });
  assert.equal(r.poolSize, 1);
  assert.equal(r.activated.length, 1);
});

test('多书：跟随角色卡但读不到绑定时回退为手动，并给出提示', () => {
  const book = makeBook([{ id: '1', content: 'x', always: true }], {
    name: 'C',
    activation: { mode: 'character', characters: [], manual: true },
  });
  const resolved = resolveBooks([book], { boundBooks: null, manualState: {} });
  assert.equal(resolved.activeBooks.length, 1);
  assert.equal(resolved.warnings.length, 1);
});

test('多书：扩展点提供的启用者优先于内置规则', () => {
  const book = makeBook([{ id: '1', content: 'x', always: true }], {
    name: 'D',
    activation: { mode: 'manual', characters: [], manual: false },
  });
  const resolved = resolveBooks([book], {}, [{ id: 'test', label: '测试用的开关', test: () => true }]);
  assert.equal(resolved.activeBooks.length, 1);
});

test('导入：未知字段被无损暂存，导出时还原', () => {
  const raw = {
    entries: {
      0: {
        uid: 0,
        key: ['王城'],
        keysecondary: [],
        content: '城门口有两名卫兵',
        comment: '城门',
        constant: false,
        selective: false,
        selectiveLogic: 0,
        position: 1,
        depth: 4,
        role: 0,
        order: 120,
        useProbability: false,
        probability: 100,
        customFlag: 7,
        someFutureField: { a: 1 },
      },
    },
  };
  const { book, warnings } = convertNativeWorld(raw, { fileName: 'test.json', bookName: '测试' });
  assert.ok(book);
  assert.equal(book.entries.length, 1);
  assert.equal(book.entries[0]._source.unknown.customFlag, 7);
  assert.equal(book.entries[0].weight, 120);
  assert.equal(warnings.length, 0);

  const { native } = exportNativeWorld(book);
  assert.equal(native.entries['0'].customFlag, 7);
  assert.deepEqual(native.entries['0'].someFutureField, { a: 1 });
  assert.deepEqual(native.entries['0'].key, ['王城']);
});

test('导入：位置降级会告警而不是静默丢弃', () => {
  const raw = { entries: { 0: { uid: 0, key: ['a'], content: 'x', position: 5, role: 0 } } };
  const { warnings } = convertNativeWorld(raw, { fileName: 't.json' });
  assert.ok(warnings.some((w) => w.code === 'position-downgraded'));
});

test('输出：结构符合规范要求的字段', () => {
  const book = makeBook([{ id: '1', content: 'x', trigger: { any: ['王城'] } }]);
  const r = run(book, { userInput: '王城' });
  const item = r.activated[0];
  assert.equal(typeof item.entryId, 'string');
  assert.equal(typeof item.content, 'string');
  assert.ok(['before_char', 'after_char', 'in_chat'].includes(item.injection.position));
  assert.equal(typeof item.injection.depth, 'number');
  assert.ok(['system', 'user', 'assistant'].includes(item.injection.role));
  assert.equal(typeof r.basedOnMessageCount, 'number');
  assert.ok(Array.isArray(r.stateUpdates));
  assert.ok(Array.isArray(r.diagnostics));
});

// —— 重复导入的合并（ILB-3.3.3）——

function nativeOf(entries) {
  return { entries: Object.fromEntries(entries.map((e, i) => [String(e.uid ?? i), e])) };
}

test('合并：同一份原件导入两次只有一本，第二次全部算"没变"', () => {
  const raw = nativeOf([{ uid: 0, key: ['王城'], content: '城门', position: 1, role: 0, order: 100 }]);
  const first = convertNativeWorld(raw, { fileName: 'a.json', bookName: 'A' });
  const created = mergeImportedBook(null, first.book, 1);
  const again = convertNativeWorld(raw, { fileName: 'a.json', bookName: 'A' });
  const merged = mergeImportedBook(created.book, again.book, 2);

  assert.equal(merged.book.book_id, created.book.book_id);
  assert.equal(merged.book._source.import_count, 2);
  assert.equal(merged.stats.unchanged, 1);
  assert.equal(merged.stats.added, 0);
  assert.equal(merged.book.entries.length, 1);
});

test('合并：原件新增条目会补进来，原条目 id 不变', () => {
  const base = nativeOf([{ uid: 0, key: ['王城'], content: '城门', position: 1, role: 0, order: 100 }]);
  const first = convertNativeWorld(base, { fileName: 'a.json', bookName: 'A' });
  const created = mergeImportedBook(null, first.book, 1);
  const oldId = created.book.entries[0].id;

  const grown = nativeOf([
    { uid: 0, key: ['王城'], content: '城门', position: 1, role: 0, order: 100 },
    { uid: 1, key: ['海边'], content: '港口', position: 1, role: 0, order: 90 },
  ]);
  const second = convertNativeWorld(grown, { fileName: 'a.json', bookName: 'A' });
  const merged = mergeImportedBook(created.book, second.book, 2);

  assert.equal(merged.stats.added, 1);
  assert.equal(merged.book.entries.length, 2);
  assert.equal(merged.book.entries[0].id, oldId, '原有条目的 id 必须保持不变');
});

test('合并：用户在 ILB 改过正文的条目不被原件覆盖', () => {
  const base = nativeOf([{ uid: 0, key: ['王城'], content: '城门', position: 1, role: 0, order: 100 }]);
  const first = convertNativeWorld(base, { fileName: 'a.json', bookName: 'A' });
  const created = mergeImportedBook(null, first.book, 1);

  // 模拟用户改正文：content 变了，content_hash 还是导入时的
  created.book.entries[0].content = '我自己改过的城门';

  const changed = nativeOf([{ uid: 0, key: ['王城'], content: '城门（作者修订版）', position: 1, role: 0, order: 100 }]);
  const second = convertNativeWorld(changed, { fileName: 'a.json', bookName: 'A' });
  const merged = mergeImportedBook(created.book, second.book, 2);

  assert.equal(merged.stats.conflicts, 1);
  assert.equal(merged.book.entries[0].content, '我自己改过的城门');
  assert.equal(merged.conflicts.length, 1);
});

test('合并：源头删掉的条目保留，书的启用方式不被重导入改掉', () => {
  const two = nativeOf([
    { uid: 0, key: ['王城'], content: '城门', position: 1, role: 0, order: 100 },
    { uid: 1, key: ['海边'], content: '港口', position: 1, role: 0, order: 90 },
  ]);
  const first = convertNativeWorld(two, { fileName: 'a.json', bookName: 'A' });
  const created = mergeImportedBook(null, first.book, 1);
  created.book.activation = { mode: 'character', characters: ['爱丽丝'], manual: false };
  created.book.pool = { share: true };

  const shrunk = nativeOf([{ uid: 0, key: ['王城'], content: '城门', position: 1, role: 0, order: 100 }]);
  const second = convertNativeWorld(shrunk, { fileName: 'a.json', bookName: 'A' });
  const merged = mergeImportedBook(created.book, second.book, 2);

  assert.equal(merged.stats.kept, 1);
  assert.equal(merged.book.entries.length, 2, '源头删掉的条目必须保留');
  assert.equal(merged.book.activation.mode, 'character');
  assert.deepEqual(merged.book.activation.characters, ['爱丽丝']);
  assert.equal(merged.book.pool.share, true);
});

// —— "试一句"（previewEntry）：只回答这一句会不会让它出现，不碰预算与同组 ——

test('试一句：命中触发词就说会，并列出走过的步骤', () => {
  const r = previewEntry({ content: '王城', trigger: { any: ['王城'] } }, { text: '我走进王城' });
  assert.equal(r.passed, true);
  assert.equal(r.steps[0].stage, 'trigger');
  assert.equal(r.steps[0].passed, true);
});

test('试一句：没命中就说不会，并指出卡在哪一步', () => {
  const r = previewEntry({ trigger: { any: ['王城'] } }, { text: '海边' });
  assert.equal(r.passed, false);
  assert.equal(r.steps[r.steps.length - 1].stage, 'trigger');
  assert.match(r.reason, /没有出现/);
});

test('试一句：停用的规则直接说明白', () => {
  const r = previewEntry({ enabled: false, trigger: { any: ['王城'] } }, { text: '王城' });
  assert.equal(r.passed, false);
  assert.equal(r.steps[0].stage, 'enabled');
});

test('试一句：常驻不需要触发词', () => {
  const r = previewEntry({ always: true }, { text: '随便什么' });
  assert.equal(r.passed, true);
  assert.match(r.reason, /常驻/);
});

test('试一句：附加条件不满足时卡在 when，而不是 trigger', () => {
  const r = previewEntry({
    trigger: { any: ['王城'] },
    when: [{ type: 'contains', within: 'text', text: '夜巡' }],
  }, { text: '王城白天很热闹' });
  assert.equal(r.passed, false);
  assert.equal(r.steps[r.steps.length - 1].stage, 'when');
});

test('试一句：条件满足就能通过', () => {
  const r = previewEntry({
    trigger: { any: ['王城'] },
    when: [{ type: 'contains', within: 'text', text: '夜巡' }],
  }, { text: '王城今晚开始夜巡' });
  assert.equal(r.passed, true);
  assert.equal(r.steps.length, 2);
});

test('试一句：持续期内不再要求触发词', () => {
  const r = previewEntry({ trigger: { any: ['王城'] }, timed: { sticky: 3 } }, {
    text: '完全无关的一句',
    messageCount: 5,
    state: { activeSince: 4 },
  });
  assert.equal(r.passed, true);
  assert.equal(r.steps[0].stage, 'timed');
});

test('试一句：还没到延迟条数就说明还要等', () => {
  const r = previewEntry({ trigger: { any: ['王城'] }, timed: { delay: 10 } }, {
    text: '王城',
    messageCount: 3,
  });
  assert.equal(r.passed, false);
  assert.match(r.reason, /等够 10 条/);
});

test('试一句：冷却期内不出现', () => {
  const r = previewEntry({ trigger: { any: ['王城'] }, timed: { cooldown: 5 } }, {
    text: '王城',
    messageCount: 7,
    state: { lastActiveAt: 5 },
  });
  assert.equal(r.passed, false);
  assert.match(r.reason, /冷却中/);
});

test('试一句：不做预算与同组判断（那两件事要真实对话才看得到）', () => {
  const r = previewEntry({ trigger: { any: ['王城'] }, group: 'G', weight: 1 }, { text: '王城' });
  assert.equal(r.passed, true);
  assert.equal(r.steps.some((s) => s.stage === 'budget' || s.stage === 'group'), false);
});
