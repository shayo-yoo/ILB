// tests/bindings.test.mjs —— 角色卡关联与运行时接口（v0.28.0）
//
// 这一层给角色卡兼容扩展用：保存"哪张卡认哪本书、要不要强制开关"，并让关联真正参与启用判定。
// 全部用真 repository（内存存档）测语义：只测假实现的话，"关联到底有没有用"是测不出来的。

import test from 'node:test';
import assert from 'node:assert/strict';

import { createRepository } from '../adapters/repository.js';
import { createApi } from '../runtime/api.js';
import { normalizeBook } from '../core/model.js';
import { buildResolveInput } from '../runtime/pipeline.js';
import { bindingOpsFrom } from '../adapters/sillytavern-events.js';

function makeHarness({ host = null } = {}) {
  const bucket = {
    version: 2,
    settings: {},
    books: [],
    manualState: {},
    chatStates: {},
    importLog: [],
    ui: {},
    snapshots: [],
    stats: { entries: {}, logics: {} },
    logicGroups: [],
    logics: [],
  };
  const ctx = { chatId: 'chat-1', extensionSettings: { independent_lorebook: bucket } };
  const repository = createRepository({ getContext: () => ctx });
  let hostContext = host;
  let lastRun = null;
  const api = createApi({
    repository,
    getContext: () => ctx,
    getChatId: () => 'chat-1',
    readHostContext: () => hostContext,
    getProviders: () => [],
    getLastRun: () => lastRun,
  });
  return {
    api,
    repository,
    bucket,
    setHost: (value) => { hostContext = value; },
    setLastRun: (value) => { lastRun = value; },
  };
}

function addBook(repository, id, name, extra = {}) {
  const book = normalizeBook({
    book_id: id,
    name,
    activation: { strategy: 'auto', override: 'auto', characters: [], manual: false },
    entries: [],
    logic: [],
    ...extra,
  });
  repository.saveBook(book);
  return book;
}

function hostWith(avatars, extra = {}) {
  return {
    contextAvailable: true,
    character: { avatar: avatars[0], name: avatars[0].replace(/\.png$/, '') },
    group: null,
    ...extra,
  };
}

function groupWith(avatars) {
  return {
    contextAvailable: true,
    character: { avatar: avatars[0], name: '群主' },
    group: {
      id: 'g1',
      name: '群',
      members: avatars.map((avatar, index) => ({ index, avatar, name: avatar.replace(/\.png$/, '') })),
    },
  };
}

function bind(api, avatar, bookId, policy = 'auto', name = '') {
  const out = api.bindings.create({ character: { avatar, name: name || avatar.replace(/\.png$/, '') }, bookId, policy });
  assert.equal(out.ok, true, `建关联失败：${JSON.stringify(out)}`);
  return out.binding;
}

test('关联的基本流程：建、查、列表、改、删', () => {
  const { api, repository } = makeHarness({ host: hostWith(['A.png']) });
  addBook(repository, 'b1', '共享书');

  const created = api.bindings.create({ character: { avatar: 'A.png', name: '阿' }, bookId: 'b1' });
  assert.equal(created.ok, true);
  assert.equal(created.binding.bookId, 'b1');
  assert.equal(created.binding.policy, 'auto');
  assert.equal(created.binding.character.avatar, 'A.png');
  assert.match(created.binding.id, /^bind-[0-9a-z]+-[0-9a-z]{4}$/);
  assert.equal(created.binding.orphanedAt, null);

  const got = api.bindings.get(created.binding.id);
  assert.equal(got.ok, true);
  assert.equal(got.binding.id, created.binding.id);
  assert.equal(api.bindings.get('nope').error.code, 'NOT_FOUND');

  const list = api.bindings.list();
  assert.equal(list.ok, true);
  assert.equal(list.total, 1);

  const updated = api.bindings.update(created.binding.id, { policy: 'off', note: '停掉' });
  assert.equal(updated.ok, true);
  assert.equal(updated.binding.policy, 'off');
  assert.equal(updated.binding.note, '停掉');
  // 关联的"谁"和"哪本书"不允许改：传了也当没传
  const ignored = api.bindings.update(created.binding.id, { bookId: 'b2', character: { avatar: 'B.png' } });
  assert.equal(ignored.binding.bookId, 'b1');
  assert.equal(ignored.binding.character.avatar, 'A.png');

  const removed = api.bindings.remove(created.binding.id);
  assert.deepEqual(removed, { ok: true, removed: true });
  // 幂等：再删一次不算错
  assert.deepEqual(api.bindings.remove(created.binding.id), { ok: true, removed: false });
});

test('建关联的四种失败：缺角色、书不存在、表态非法、重复', () => {
  const { api, repository } = makeHarness({ host: hostWith(['A.png']) });
  addBook(repository, 'b1', '共享书');

  const noAvatar = api.bindings.create({ character: { avatar: '  ' }, bookId: 'b1' });
  assert.equal(noAvatar.ok, false);
  assert.equal(noAvatar.error.code, 'BAD_PAYLOAD');

  const noBookId = api.bindings.create({ character: { avatar: 'A.png' } });
  assert.equal(noBookId.error.code, 'BAD_PAYLOAD');

  const missingBook = api.bindings.create({ character: { avatar: 'A.png' }, bookId: 'nope' });
  assert.equal(missingBook.error.code, 'NOT_FOUND');
  assert.equal(missingBook.error.field, 'bookId');

  const badPolicy = api.bindings.create({ character: { avatar: 'A.png' }, bookId: 'b1', policy: 'maybe' });
  assert.equal(badPolicy.error.code, 'BAD_PAYLOAD');
  assert.equal(badPolicy.error.field, 'policy');

  const first = bind(api, 'A.png', 'b1');
  const again = api.bindings.create({ character: { avatar: 'A.png' }, bookId: 'b1' });
  assert.equal(again.ok, false);
  assert.equal(again.error.code, 'CONFLICT');
  // 报错要带上已有的那条 id，扩展才能直接改它而不是又建一条
  assert.equal(again.error.id, first.id);

  // 同一本书、不同角色卡不算重复
  assert.equal(api.bindings.create({ character: { avatar: 'B.png' }, bookId: 'b1' }).ok, true);
});

test('列表过滤：按角色、按书、要不要孤儿', () => {
  const { api, repository } = makeHarness({ host: hostWith(['A.png']) });
  addBook(repository, 'b1', '一');
  addBook(repository, 'b2', '二');
  bind(api, 'A.png', 'b1');
  bind(api, 'A.png', 'b2');
  const b1 = bind(api, 'B.png', 'b1');
  api.bindings.remove(b1.id);
  repository.markBindingsOrphaned(['B.png']);

  assert.equal(api.bindings.list().total, 2);
  assert.equal(api.bindings.list({ character: 'A.png' }).total, 2);
  assert.equal(api.bindings.list({ bookId: 'b1' }).total, 1);
  assert.equal(api.bindings.list({ character: { avatar: 'B.png' } }).total, 0);

  // 孤儿默认也列出来：用户需要看到"这张卡已经没了"，才能清理
  const orphan = bind(api, 'C.png', 'b1');
  repository.markBindingsOrphaned(['C.png']);
  assert.equal(api.bindings.list({ bookId: 'b1' }).total, 2);
  assert.equal(api.bindings.list({ bookId: 'b1', includeOrphaned: false }).total, 1);
  assert.ok(api.bindings.list().bindings.some((one) => one.id === orphan.id && one.orphanedAt > 0));
});

test('角色卡改名：关联搬过去；撞车时留较新的一条', () => {
  const { api, repository } = makeHarness({ host: hostWith(['A.png']) });
  addBook(repository, 'b1', '一');
  addBook(repository, 'b2', '二');
  const one = bind(api, 'A.png', 'b1');
  bind(api, 'A.png', 'b2');

  const renamed = api.bindings.renameCharacter('A.png', 'A2.png', { name: '新名字' });
  assert.equal(renamed.ok, true);
  assert.equal(renamed.updated, 2);
  assert.equal(renamed.merged, 0);
  const list = api.bindings.list({ character: 'A2.png' });
  assert.equal(list.total, 2);
  assert.equal(list.bindings[0].character.name, '新名字');
  assert.equal(api.bindings.list({ character: 'A.png' }).total, 0);
  assert.equal(api.bindings.get(one.id).binding.character.avatar, 'A2.png');

  // 撞车：C.png 上已经有一条同书关联，把另一张卡改名成 C.png 时要合并，留 updatedAt 较新的那条。
  // 时间写死，不靠 Date.now()——否则「两次创建落在同一毫秒」还是「隔了一毫秒」会改变谁赢，测试会间歇失败。
  const base = 1_700_000_000_000;
  const settled = repository.createBinding({
    id: 'bind-settled',
    character: { avatar: 'C.png', name: 'C' },
    bookId: 'b1',
    policy: 'on',
    note: 'C 自己调的',
    createdAt: base - 5000,
    updatedAt: base - 10,
  });
  repository.createBinding({
    id: 'bind-stale',
    character: { avatar: 'D.png', name: 'D' },
    bookId: 'b1',
    policy: 'auto',
    createdAt: base - 4000,
    updatedAt: base - 1000,
  });
  const res = api.bindings.renameCharacter('D.png', 'C.png');
  assert.equal(res.ok, true);
  assert.equal(res.merged, 1);
  const merged = api.bindings.list({ character: 'C.png', bookId: 'b1' });
  assert.equal(merged.total, 1);
  assert.equal(merged.bindings[0].id, settled.id);
  // 留下的应该是"这张卡自己"的表态，不能被搬进来的那条悄悄换掉
  assert.equal(merged.bindings[0].policy, 'on');
  assert.equal(merged.bindings[0].note, 'C 自己调的');

  // 反过来也成立：被搬过来的那条本来就更新（用户刚调过），那就留它
  repository.createBinding({
    id: 'bind-target',
    character: { avatar: 'E.png', name: 'E' },
    bookId: 'b2',
    policy: 'on',
    createdAt: base - 5000,
    updatedAt: base - 9000,
  });
  repository.createBinding({
    id: 'bind-mover',
    character: { avatar: 'F.png', name: 'F' },
    bookId: 'b2',
    policy: 'off',
    createdAt: base - 4000,
    updatedAt: base - 5,
  });
  const moved = api.bindings.renameCharacter('F.png', 'E.png');
  assert.equal(moved.merged, 1);
  const afterMove = api.bindings.list({ character: 'E.png', bookId: 'b2' });
  assert.equal(afterMove.total, 1);
  assert.equal(afterMove.bindings[0].id, 'bind-mover');
  assert.equal(afterMove.bindings[0].policy, 'off');

  // 同一张卡只改显示名：old===new
  const touched = api.bindings.renameCharacter('A2.png', 'A2.png', { name: '又改了' });
  assert.equal(touched.ok, true);
  assert.ok(touched.updated >= 1);
  assert.ok(api.bindings.list({ character: 'A2.png' }).bindings.every((item) => item.character.name === '又改了'));
});

test('角色卡删除：打孤儿标记，不删数据，且不再参与判定', () => {
  const { api, repository, setHost } = makeHarness({ host: hostWith(['A.png']) });
  addBook(repository, 'b1', '只给 A 的书');
  const one = bind(api, 'A.png', 'b1', 'on');

  setHost(hostWith(['A.png']));
  assert.equal(api.runtime.preview().books[0].enabled, true);

  assert.equal(repository.markBindingsOrphaned(['A.png']), 1);
  const after = api.bindings.get(one.id);
  assert.ok(after.binding.orphanedAt > 0);

  setHost(hostWith(['A.png']));
  const preview = api.runtime.preview();
  assert.equal(preview.books[0].enabled, false);
  assert.notEqual(preview.books[0].rule, 'binding-on');

  assert.equal(api.bindings.purgeOrphans().removed, 1);
  assert.equal(api.bindings.list().total, 0);
});

test('判定优先级：书自己的开关压过关联，关联压过策略', () => {
  const { api, repository, setHost } = makeHarness();
  addBook(repository, 'b1', '一');
  addBook(repository, 'b2', '二', { activation: { strategy: 'always', override: 'auto', characters: [], manual: true } });
  addBook(repository, 'b3', '三', { activation: { strategy: 'auto', override: 'off', characters: [], manual: true } });
  bind(api, 'A.png', 'b1', 'on');
  bind(api, 'A.png', 'b2', 'off');
  bind(api, 'A.png', 'b3', 'on');

  setHost(hostWith(['A.png']));
  const preview = api.runtime.preview();
  const byId = Object.fromEntries(preview.books.map((book) => [book.id, book]));

  // 手关（override=off）永远赢，哪怕关联说强制启用
  assert.equal(byId.b3.enabled, false);
  assert.equal(byId.b3.rule, 'force-off');
  // 强制停用压过 always
  assert.equal(byId.b2.enabled, false);
  assert.equal(byId.b2.rule, 'binding-off');
  assert.equal(byId.b2.binding.policy, 'off');
  // 强制启用
  assert.equal(byId.b1.enabled, true);
  assert.equal(byId.b1.rule, 'binding-on');
  assert.equal(byId.b1.binding.avatar, 'A.png');
  assert.match(byId.b1.reason, /关联了这本书，并设为强制启用/);
});

test('普通关联（auto）让书启用，并且宿主联动总开关关掉也照旧生效', () => {
  const { api, repository, setHost } = makeHarness();
  addBook(repository, 'b1', '一');
  bind(api, 'A.png', 'b1', 'auto');
  setHost(hostWith(['A.png']));

  const on = api.runtime.preview();
  assert.equal(on.books[0].enabled, true);
  assert.equal(on.books[0].rule, 'binding');
  assert.match(on.books[0].reason, /当前角色「A」关联了这本书/);

  // 宿主联动总开关关掉：原生来源匹配不再算数，但"角色卡自己认了这本书"必须还算数
  repository.saveSettings({ hostLinkEnabled: false });
  const off = api.runtime.preview();
  assert.equal(off.books[0].enabled, true);
  assert.equal(off.books[0].rule, 'binding');
});

test('群聊：三名成员 on / auto / off，on 赢；没有群时只看当前角色', () => {
  const { api, repository, setHost } = makeHarness();
  addBook(repository, 'b1', '一');
  bind(api, 'A.png', 'b1', 'auto');
  bind(api, 'B.png', 'b1', 'off');
  bind(api, 'C.png', 'b1', 'on');

  setHost(groupWith(['A.png', 'B.png', 'C.png']));
  const group = api.runtime.preview();
  assert.equal(group.books[0].enabled, true);
  assert.equal(group.books[0].rule, 'binding-on');
  assert.match(group.books[0].reason, /群成员「C」/);
  assert.equal(group.group.members.length, 3);

  // 群聊里任何一个人的强制启用都算数——不是"多数票"
  setHost(groupWith(['A.png', 'B.png']));
  const autoOnly = api.runtime.preview();
  assert.equal(autoOnly.books[0].enabled, true);
  assert.equal(autoOnly.books[0].rule, 'binding');

  // 只有持 off 的成员在场：停用
  setHost(groupWith(['B.png']));
  const offOnly = api.runtime.preview();
  assert.equal(offOnly.books[0].enabled, false);
  assert.equal(offOnly.books[0].rule, 'binding-off');
});

test('没有关联时行为与 1.3 一致：走老路，details 里 binding 是 null', () => {
  const { api, repository, setHost } = makeHarness();
  addBook(repository, 'b1', '一');
  setHost(hostWith(['A.png']));

  const preview = api.runtime.preview();
  assert.equal(preview.books[0].binding, null);
  assert.equal(preview.books[0].enabled, false);
  assert.equal(preview.books[0].rule, 'auto');

  // 读不到宿主时也不许炸：按 1.3 的老路走（整块宿主上下文都没有）
  setHost(null);
  const none = api.runtime.preview();
  assert.equal(none.character, null);
  assert.equal(none.books[0].binding, null);
  assert.equal(none.books[0].rule, 'legacy-unknown');

  // 读到了宿主上下文、但里面没给出可用的角色信息：保持 auto-unknown，关联投票不参与
  setHost({ contextAvailable: false, character: null, group: null });
  const unknown = api.runtime.preview();
  assert.equal(unknown.character, null);
  assert.equal(unknown.books[0].binding, null);
  assert.equal(unknown.books[0].rule, 'auto-unknown');
});

test('runtime.preview 与真跑共用同一段组装：activeBooks 必须一致', () => {
  const { api, repository, setHost } = makeHarness();
  addBook(repository, 'b1', '一');
  addBook(repository, 'b2', '二');
  bind(api, 'A.png', 'b1', 'on');
  setHost(hostWith(['A.png']));

  const preview = api.runtime.preview();
  const direct = buildResolveInput({
    repository,
    context: { chatId: 'chat-1', chat: [] },
    settings: repository.getSettings(),
    hostContext: hostWith(['A.png']),
  });
  assert.deepEqual(preview.activeBooks, direct.resolved.activeBooks);
  assert.deepEqual(preview.books.map((book) => book.id), direct.resolved.activeBooks.concat(['b2']));
});

test('runtime.status：没跑过就说没跑过，跑过就报上一轮的结论', () => {
  const { api, repository, setLastRun } = makeHarness();
  addBook(repository, 'b1', '一');

  const idle = api.runtime.status();
  assert.deepEqual(idle, { ok: true, ran: false, at: 0, error: null });

  setLastRun({
    ran: true,
    at: 1700000000000,
    activated: ['e1'],
    books: {
      active: ['b1'],
      inactive: [],
      reasons: {},
      warnings: [],
      details: { b1: { enabled: true, rule: 'force-on', reason: '手动强制启用' } },
    },
    error: null,
  });
  const done = api.runtime.status();
  assert.equal(done.ok, true);
  assert.equal(done.ran, true);
  assert.equal(done.at, 1700000000000);
  assert.deepEqual(done.activeBooks, ['b1']);
  assert.equal(done.books[0].rule, 'force-on');
  // 只报结论，不带聊天内容/条目正文
  assert.equal(Object.prototype.hasOwnProperty.call(done, 'messages'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(done.books[0], 'content'), false);
});

test('删书：默认拒绝、cascade 强删、书不存在', async () => {
  const { api, repository } = makeHarness({ host: hostWith(['A.png']) });
  addBook(repository, 'b1', '一');
  addBook(repository, 'b2', '二');
  bind(api, 'A.png', 'b1', 'on');
  bind(api, 'B.png', 'b1', 'off');

  const refused = await api.worldbooks.deleteBook('b1');
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, 'CONFLICT');
  assert.equal(refused.error.boundCount, 2);
  assert.match(refused.error.message, /还有 2 个角色关联这本书/);
  assert.ok(repository.getBook('b1'), '被拒绝时书必须还在');

  const missing = await api.worldbooks.deleteBook('nope');
  assert.equal(missing.error.code, 'NOT_FOUND');

  // 没有关联的书直接删
  const plain = await api.worldbooks.deleteBook('b2');
  assert.equal(plain.ok, true);
  assert.equal(plain.removedBindings, 0);

  const forced = await api.worldbooks.deleteBook('b1', { cascade: true });
  assert.equal(forced.ok, true);
  assert.equal(forced.removedBindings, 2);
  assert.equal(repository.getBook('b1'), null);
  assert.equal(api.bindings.list().total, 0);
});

test('书架自己的删除路径也要把关联一起清掉', () => {
  const { api, repository } = makeHarness({ host: hostWith(['A.png']) });
  addBook(repository, 'b1', '一');
  bind(api, 'A.png', 'b1');
  assert.equal(repository.countBindingsForBook('b1'), 1);
  // 书架走的是 repository.deleteBook（不是 api.worldbooks.deleteBook）
  assert.equal(repository.deleteBook('b1'), true);
  assert.equal(api.bindings.list().total, 0);
});

test('单本导入：版本太新拒绝，版本旧的就地迁移', async () => {
  const { api, repository } = makeHarness();
  addBook(repository, 'b1', '占位');

  const tooNew = await api.worldbooks.importBook({ schema_version: 3, book: { book_id: 'x', name: '未来的书' } });
  assert.equal(tooNew.ok, false);
  assert.equal(tooNew.error.code, 'NOT_SUPPORTED');

  const old = await api.worldbooks.importBook({
    schema_version: 1,
    book: {
      book_id: 'old-one',
      name: '老书',
      // 1.0 的条目没有 id：迁移会补
      entries: [{ title: '一条', content: '内容' }],
    },
  });
  assert.equal(old.ok, true);
  assert.equal(old.action, 'created');
  const book = repository.getBook(old.id);
  assert.equal(book.schema_version, 2);
  assert.equal(book.name, '老书');
  assert.equal(book.entries.length, 1);
  assert.ok(book.entries[0].id);
});

test('整份备份往返：带关联导出、导入后回来', () => {
  const { api, repository, bucket } = makeHarness({ host: hostWith(['A.png']) });
  addBook(repository, 'b1', '一');
  bind(api, 'A.png', 'b1', 'on', '阿');

  const dump = repository.exportAll();
  assert.ok(Array.isArray(dump.bindings));
  assert.equal(dump.bindings.length, 1);
  assert.equal(dump.bindings[0].policy, 'on');

  // 清空后再导入
  api.bindings.remove(dump.bindings[0].id);
  assert.equal(api.bindings.list().total, 0);
  repository.importAll(dump);
  const back = api.bindings.list();
  assert.equal(back.total, 1);
  assert.equal(back.bindings[0].character.name, '阿');
  assert.equal(back.bindings[0].policy, 'on');
  assert.ok(bucket.bindings.length === 1);

  // 不带 bindings 的老备份：保留现有，不许把关联清空
  const legacy = JSON.parse(JSON.stringify(dump));
  delete legacy.bindings;
  repository.importAll(legacy);
  assert.equal(api.bindings.list().total, 1);
});

test('宿主事件翻译：改名 / 编辑 / 删除，复制不继承', () => {
  assert.deepEqual(bindingOpsFrom([{ event: 'CHARACTER_RENAMED', args: ['Old.png', 'New.png'] }]), [
    { kind: 'rename', from: 'Old.png', to: 'New.png' },
  ]);
  assert.deepEqual(bindingOpsFrom([{ event: 'CHARACTER_EDITED', args: [{ detail: { id: 0, character: { avatar: 'A.png', name: '新名' } } }] }]), [
    { kind: 'rename', from: 'A.png', to: 'A.png', name: '新名' },
  ]);
  assert.deepEqual(bindingOpsFrom([{ event: 'CHARACTER_DELETED', args: [{ id: 0, character: { avatar: 'A.png' } }] }]), [
    { kind: 'orphan', avatar: 'A.png' },
  ]);
  // 复制出来的卡不继承关联
  assert.deepEqual(bindingOpsFrom([{ event: 'CHARACTER_DUPLICATED', args: [{ oldAvatar: 'A.png', newAvatar: 'A 复制.png' }] }]), []);
  // 事件参数缺了也不能炸
  assert.deepEqual(bindingOpsFrom([{ event: 'CHARACTER_RENAMED', args: [] }, { event: 'X' }]), []);
});
