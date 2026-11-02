// tests/live/st-v28-check.mjs —— 真实酒馆，验 v0.28.0
//
//   1) ILB.api 版本 1.4 与 caps（bindings / runtime / bookDelete）；
//   2) bindings 增删改查、冲突与错误码、改名搬运、孤儿标记与清理；
//   3) 关联参与判定：override > 关联投票 > always > auto；
//   4) runtime.preview 与真跑的 activeBooks 一致；runtime.status 没跑过就说没跑过；
//   5) worldbooks.deleteBook 默认拒绝 / cascade；importBook 版本校验；备份往返。
//
// 用法：
//   set ST_DIR=D:\1\APP\SillyTavern
//   node tests/live/st-v28-check.mjs
import { openPage, waitForIlb, sleep } from './cdp.mjs';

const ST_DIR = process.env.ST_DIR ?? 'D:/1/APP/SillyTavern';
const page = await openPage(ST_DIR);
await page.send('Runtime.enable');
await page.send('Page.enable');
await page.send('Emulation.setDeviceMetricsOverride', {
  width: 1360, height: 900, deviceScaleFactor: 1, mobile: false,
});
await page.send('Page.reload', { ignoreCache: true });
await sleep(9000);

if (!(await waitForIlb(page.evaluate))) {
  console.log('❌ 页面里没有 globalThis.ILB（扩展没加载起来）');
  page.close();
  process.exit(1);
}

const out = await page.evaluate(`(async () => {
  const api = ILB.api;
  const repo = ILB.repository;
  const r = {};
  const made = { books: [], bindings: [] };

  const bind = (avatar, bookId, policy) => {
    const one = api.bindings.create({ character: { avatar, name: avatar.replace(/\\.png$/i, '') }, bookId, policy });
    if (one.ok) made.bindings.push(one.binding.id);
    return one;
  };
  const drop = (id) => {
    api.bindings.remove(id);
    made.bindings = made.bindings.filter((x) => x !== id);
  };

  r.version = api.version;
  r.caps = ['bindings', 'runtime', 'bookDelete'].every((c) => api.caps.includes(c));
  r.readyIsApi = (await api.ready) === api;
  r.methods = api.describe().methods.includes('runtime.preview') && api.describe().methods.includes('bindings.renameCharacter');

  // 状态：还没跑过就说没跑过（先记下来，后面跑完再对比）
  const idle = api.runtime.status();
  r.statusIdle = idle.ok === true && idle.ran === false && idle.at === 0 && idle.error === null;

  for (const book of repo.listBooks()) {
    if (String(book.book_id).startsWith('probe-v28')) repo.deleteBook(book.book_id);
  }
  for (const id of ['probe-v28-b1', 'probe-v28-b2', 'probe-v28-b3']) {
    repo.saveBook({
      book_id: id,
      name: id,
      activation: id.endsWith('b2') ? { strategy: 'always', override: 'auto' } : id.endsWith('b3') ? { strategy: 'auto', override: 'off' } : { strategy: 'auto', override: 'auto' },
      entries: [],
      logic: [],
    });
    made.books.push(id);
  }

  const who = api.runtime.preview().character?.avatar ?? null;
  r.hasCharacter = !!who;

  // ---- 增删改查与错误码 ----
  const dupAvatar = who ?? 'probe-v28-nobody.png';
  const first = bind(dupAvatar, 'probe-v28-b1', 'on');
  r.createOk = first.ok === true && first.binding.policy === 'on' && first.binding.bookId === 'probe-v28-b1';
  const dup = api.bindings.create({ character: { avatar: dupAvatar }, bookId: 'probe-v28-b1' });
  r.conflict = dup.ok === false && dup.error.code === 'CONFLICT' && dup.error.id === first.binding?.id;
  const badPolicy = api.bindings.create({ character: { avatar: dupAvatar }, bookId: 'probe-v28-b1', policy: 'maybe' });
  r.badPolicy = badPolicy.ok === false && badPolicy.error.code === 'BAD_PAYLOAD' && badPolicy.error.field === 'policy';
  const noBook = api.bindings.create({ character: { avatar: dupAvatar }, bookId: 'probe-v28-none' });
  r.badBook = noBook.ok === false && noBook.error.code === 'NOT_FOUND';
  r.listFilters = api.bindings.list({ character: dupAvatar, bookId: 'probe-v28-b1' }).total === 1
    && api.bindings.list({ character: dupAvatar, bookId: 'probe-v28-b2' }).total === 0;
  const updated = api.bindings.update(first.binding.id, { policy: 'off', note: '探针' });
  r.updateOk = updated.ok === true && updated.binding.policy === 'off' && updated.binding.note === '探针';
  r.updateIgnoresBook = api.bindings.update(first.binding.id, { bookId: 'probe-v28-b2' }).binding.bookId === 'probe-v28-b1';

  // ---- 关联参与判定 ----
  if (who) {
    api.bindings.update(first.binding.id, { policy: 'on' });
    bind(who, 'probe-v28-b2', 'off');
    bind(who, 'probe-v28-b3', 'on');
    const view = api.runtime.preview();
    const by = Object.fromEntries(view.books.map((b) => [b.id, b]));
    r.forceOffWins = by['probe-v28-b3'].enabled === false && by['probe-v28-b3'].rule === 'force-off';
    r.bindingOffWins = by['probe-v28-b2'].enabled === false && by['probe-v28-b2'].rule === 'binding-off';
    r.bindingOn = by['probe-v28-b1'].enabled === true && by['probe-v28-b1'].rule === 'binding-on';
    r.reasonNamesCharacter = /关联了这本书/.test(by['probe-v28-b1'].reason);
    r.previewCoversAll = view.books.length >= 3;
    r.previewPure = api.snapshot().books.length === repo.listBooks().length;

    // 预览与真跑一致（书里没有条目，所以不必担心注入内容）
    const before = api.runtime.preview().activeBooks.slice().sort();
    ILB.runOnce('probe');
    const last = api.runtime.status();
    r.statusAfterRun = last.ok === true && last.ran === true && last.at > 0;
    r.previewMatchesRun = JSON.stringify(before) === JSON.stringify((last.activeBooks ?? []).slice().sort());

    // 去掉关联 → 回到 1.3 的老路
    for (const one of api.bindings.list({ character: who }).bindings) {
      if (one.bookId.startsWith('probe-v28')) api.bindings.remove(one.id);
    }
    made.bindings = [];
    const plain = api.runtime.preview();
    const plainById = Object.fromEntries(plain.books.map((b) => [b.id, b]));
    r.noBindingFallback = plainById['probe-v28-b1'].binding === null && plainById['probe-v28-b1'].rule === 'auto';
    r.alwaysStillWorks = plainById['probe-v28-b2'].enabled === true && plainById['probe-v28-b2'].rule === 'always';
  }

  // ---- 改名搬运 ----
  const mv = bind('probe-v28-old.png', 'probe-v28-b1', 'auto');
  const renamed = api.bindings.renameCharacter('probe-v28-old.png', 'probe-v28-new.png', { name: '新名' });
  r.renameMoves = renamed.ok === true && renamed.updated === 1 && api.bindings.get(mv.binding.id).binding.character.avatar === 'probe-v28-new.png';
  r.renameKeepsName = api.bindings.get(mv.binding.id).binding.character.name === '新名';
  drop(mv.binding.id);

  // ---- 孤儿标记与清理 ----
  const ghost = bind('probe-v28-ghost.png', 'probe-v28-b1', 'on');
  repo.markBindingsOrphaned(['probe-v28-ghost.png']);
  r.orphaned = api.bindings.get(ghost.binding.id).binding.orphanedAt > 0;
  r.orphanFiltered = api.bindings.list({ character: 'probe-v28-ghost.png', includeOrphaned: false }).total === 0
    && api.bindings.list({ character: 'probe-v28-ghost.png' }).total === 1;
  const purged = api.bindings.purgeOrphans();
  r.purged = purged.ok === true && purged.removed >= 1 && api.bindings.get(ghost.binding.id).ok === false;
  made.bindings = [];

  // ---- 删书 ----
  bind('probe-v28-x.png', 'probe-v28-b1', 'auto');
  const refused = await api.worldbooks.deleteBook('probe-v28-b1');
  r.deleteRefused = refused.ok === false && refused.error.code === 'CONFLICT' && refused.error.boundCount === 1;
  r.deleteKept = !!repo.getBook('probe-v28-b1');
  const gone = await api.worldbooks.deleteBook('probe-v28-b1', { cascade: true });
  r.deleteCascade = gone.ok === true && gone.removedBindings === 1 && repo.getBook('probe-v28-b1') === null;
  r.deleteNotFound = (await api.worldbooks.deleteBook('probe-v28-none')).error.code === 'NOT_FOUND';
  made.books = made.books.filter((id) => id !== 'probe-v28-b1');
  made.bindings = [];

  // ---- 导入的版本校验 ----
  r.rejectNewer = (await api.worldbooks.importBook({ schema_version: 3, book: { book_id: 'probe-v28-future', name: '未来' } })).error.code === 'NOT_SUPPORTED';
  const migrated = await api.worldbooks.importBook({
    schema_version: 1,
    book: { book_id: 'probe-v28-old', name: '老书', entries: [{ title: '一', content: '甲' }] },
  });
  r.migrateOlder = migrated.ok === true && repo.getBook(migrated.id).schema_version === 2;
  if (migrated.ok) made.books.push(migrated.id);

  // ---- 备份往返 ----
  const keep = bind('probe-v28-backup.png', 'probe-v28-b2', 'off');
  const dump = repo.exportAll();
  r.backupHasBindings = Array.isArray(dump.bindings) && dump.bindings.some((one) => one.id === keep.binding.id);
  drop(keep.binding.id);
  repo.importAll(JSON.parse(JSON.stringify(dump)));
  r.backupRoundtrip = api.bindings.get(keep.binding.id).ok === true;
  const legacyDump = JSON.parse(JSON.stringify(dump));
  delete legacyDump.bindings;
  repo.importAll(legacyDump);
  r.legacyBackupKeeps = api.bindings.get(keep.binding.id).ok === true;

  // ---- 清理：只删探针自己建的 ----
  for (const id of made.bindings) api.bindings.remove(id);
  for (const one of api.bindings.list().bindings) {
    if (String(one.character?.avatar ?? '').startsWith('probe-v28')) api.bindings.remove(one.id);
  }
  for (const book of repo.listBooks()) {
    if (String(book.book_id).startsWith('probe-v28')) repo.deleteBook(book.book_id);
  }
  r.cleaned = repo.listBooks().filter((b) => String(b.book_id).startsWith('probe-v28')).length === 0
    && api.bindings.list().bindings.filter((one) => String(one.character?.avatar ?? '').startsWith('probe-v28')).length === 0;
  return r;
})()`);

const checks = [
  'caps', 'readyIsApi', 'methods', 'statusIdle', 'createOk', 'conflict', 'badPolicy', 'badBook',
  'listFilters', 'updateOk', 'updateIgnoresBook', 'renameMoves', 'renameKeepsName', 'orphaned',
  'orphanFiltered', 'purged', 'deleteRefused', 'deleteKept', 'deleteCascade', 'deleteNotFound',
  'rejectNewer', 'migrateOlder', 'backupHasBindings', 'backupRoundtrip', 'legacyBackupKeeps', 'cleaned',
];
const judge = [
  'forceOffWins', 'bindingOffWins', 'bindingOn', 'reasonNamesCharacter', 'previewCoversAll',
  'previewPure', 'statusAfterRun', 'previewMatchesRun', 'noBindingFallback', 'alwaysStillWorks',
];
const failed = checks.filter((key) => out[key] !== true);
const judged = out.hasCharacter ? judge.filter((key) => out[key] !== true) : [];
const ok = out.version === '1.4' && out.hasCharacter && failed.length === 0 && judged.length === 0;

console.log('接口与关联：', JSON.stringify(out));
if (!out.hasCharacter) console.log('⚠️ 当前没有加载角色卡，判定相关的检查被跳过');
if (failed.length) console.log('❌ 没通过：', failed.join('、'));
if (judged.length) console.log('❌ 判定没通过：', judged.join('、'));
console.log(ok ? '✅ v0.28 关联与运行时检查通过' : '❌ 有项目没通过');

page.close();
process.exit(ok ? 0 : 1);
