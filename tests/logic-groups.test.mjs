// 逻辑组（v0.23.0）：逻辑不再必须以一本书为前提。
// 这里测两件事：运行时的筛选规则，以及存档里组的增删改查。

import test from 'node:test';
import assert from 'node:assert/strict';

import { runnableStandaloneLogics, uniqueGroupName } from '../core/logic-groups.js';
import { createRepository } from '../adapters/repository.js';

function makeRepo() {
  const bucket = { settings: {}, books: [], manualState: {}, chatStates: {}, importLog: [], ui: {}, snapshots: [] };
  const ctx = { extensionSettings: { independent_lorebook: bucket } };
  return { repo: createRepository({ getContext: () => ctx }), bucket };
}

const logic = (id, groupId, enabled = true) => ({ id: `L::${id}`, groupId, enabled, name: id });

test('运行时筛选：组停用、逻辑停用、没有组，都不跑', () => {
  const groups = [
    { id: 'g1', name: '开', enabled: true, followBookId: '' },
    { id: 'g2', name: '关', enabled: false, followBookId: '' },
  ];
  const logics = [logic('a', 'g1'), logic('b', 'g2'), logic('c', 'g-missing'), logic('d', 'g1', false)];
  const out = runnableStandaloneLogics(groups, logics, []);
  assert.deepEqual(out.map((l) => l.id), ['L::a']);
});

test('运行时筛选：组填了 followBookId，只在书启用时跑', () => {
  const groups = [{ id: 'g1', name: '跟书', enabled: true, followBookId: 'book-x' }];
  const logics = [logic('a', 'g1')];
  assert.deepEqual(runnableStandaloneLogics(groups, logics, []), []);
  assert.deepEqual(runnableStandaloneLogics(groups, logics, ['book-y']), []);
  assert.deepEqual(runnableStandaloneLogics(groups, logics, ['book-x']).map((l) => l.id), ['L::a']);
  assert.deepEqual(runnableStandaloneLogics(groups, logics, new Set(['book-x'])).map((l) => l.id), ['L::a']);
});

test('运行时筛选：输入乱七八糟也不炸', () => {
  assert.deepEqual(runnableStandaloneLogics(null, null, null), []);
  assert.deepEqual(runnableStandaloneLogics([], [logic('a', 'g1')], []), []);
});

test('组名去重：重名补序号', () => {
  assert.equal(uniqueGroupName('独立逻辑', []), '独立逻辑');
  assert.equal(uniqueGroupName('战斗', [{ name: '战斗' }]), '战斗 2');
  assert.equal(uniqueGroupName('战斗', [{ name: '战斗' }, { name: '战斗 2' }]), '战斗 3');
  assert.equal(uniqueGroupName('  ', []), '独立逻辑');
});

test('存档：逻辑组能建、能改、能删；删组会把组里的逻辑一起删', () => {
  const { repo } = makeRepo();
  const g = repo.saveLogicGroup({ name: '战斗', enabled: true, followBookId: '' });
  assert.ok(g.id);
  assert.equal(repo.listLogicGroups().length, 1);
  assert.equal(repo.listLogicGroups()[0].enabled, true);

  const g2 = repo.saveLogicGroup({ ...g, enabled: false, followBookId: 'book-x' });
  assert.equal(g2.id, g.id);
  assert.equal(repo.listLogicGroups()[0].enabled, false);
  assert.equal(repo.listLogicGroups()[0].followBookId, 'book-x');

  repo.saveStandaloneLogic({ ...logic('a', g.id), flow: { mode: 'and', nodes: [] } });
  repo.saveStandaloneLogic({ ...logic('b', g.id) });
  assert.equal(repo.listStandaloneLogics(g.id).length, 2);
  assert.equal(repo.listStandaloneLogics().length, 2);

  const removed = repo.deleteLogicGroup(g.id);
  assert.equal(removed.removedLogics, 2);
  assert.equal(repo.listLogicGroups().length, 0);
  assert.equal(repo.listStandaloneLogics().length, 0);
});

test('存档：独立逻辑必须指定组；保存后 id 不变、更新不新增', () => {
  const { repo } = makeRepo();
  const g = repo.saveLogicGroup({ name: '独立逻辑' });
  assert.throws(() => repo.saveStandaloneLogic({ id: 'L::x', name: 'x' }), /逻辑组/);

  const saved = repo.saveStandaloneLogic({ id: 'L::x', name: '抽卡', groupId: g.id, trigger: { any: ['抽卡'] } });
  assert.equal(saved.id, 'L::x');
  assert.equal(saved.groupId, g.id);
  assert.equal(repo.listStandaloneLogics(g.id).length, 1);
  const again = repo.saveStandaloneLogic({ ...saved, name: '抽卡 2' });
  assert.equal(again.id, 'L::x');
  assert.equal(repo.listStandaloneLogics(g.id).length, 1);
  assert.equal(repo.listStandaloneLogics(g.id)[0].name, '抽卡 2');

  assert.equal(repo.deleteStandaloneLogic('L::x'), true);
  assert.equal(repo.listStandaloneLogics(g.id).length, 0);
});

test('存档：导出/导入带上逻辑组和独立逻辑', () => {
  const { repo } = makeRepo();
  const g = repo.saveLogicGroup({ name: '开箱', enabled: true, followBookId: '' });
  repo.saveStandaloneLogic({ id: 'L::k', name: '开箱', groupId: g.id, trigger: { any: ['开箱'] } });
  const blob = repo.exportAll();
  assert.equal(blob.logicGroups.length, 1);
  assert.equal(blob.logics.length, 1);

  const { repo: fresh } = makeRepo();
  fresh.importAll(blob);
  assert.equal(fresh.listLogicGroups()[0].name, '开箱');
  assert.equal(fresh.listStandaloneLogics()[0].name, '开箱');
  assert.equal(fresh.listStandaloneLogics()[0].groupId, fresh.listLogicGroups()[0].id);
});
