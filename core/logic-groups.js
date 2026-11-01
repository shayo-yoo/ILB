/**
 * 逻辑组（v0.23.0）：把「不挂在世界书上的逻辑」组织成可以整体启停的组。
 *
 * 规则：
 * - 组停用 → 组里所有逻辑都不跑；
 * - 组填了 followBookId → 只有那本书这一轮启用时才跑；
 * - 逻辑自己停用也不跑（这条在 evaluate 里还会再挡一次）。
 *
 * 纯函数，不读存档；pipeline 只负责把三样东西递进来。
 */

export const DEFAULT_GROUP_NAME = '独立逻辑';

/**
 * @param {Array} groups 逻辑组（repository.listLogicGroups）
 * @param {Array} logics 不挂书的逻辑（repository.listStandaloneLogics）
 * @param {Iterable<string>} activeBookIds 这一轮启用的书
 * @returns {Array} 这一轮该参与判定的独立逻辑
 */
export function runnableStandaloneLogics(groups, logics, activeBookIds) {
  const active = activeBookIds instanceof Set ? activeBookIds : new Set(activeBookIds ?? []);
  const groupMap = new Map((Array.isArray(groups) ? groups : []).map((group) => [String(group?.id ?? ''), group]));
  return (Array.isArray(logics) ? logics : []).filter((logic) => {
    if (!logic || logic.enabled === false) return false;
    const group = groupMap.get(String(logic.groupId ?? ''));
    if (!group) return false; // 没有组 = 不知道该不该跑，宁可不跑也不乱跑
    if (group.enabled === false) return false;
    const follow = String(group.followBookId ?? '');
    if (follow && !active.has(follow)) return false;
    return true;
  });
}

/** 组名重复时补个序号，给界面新建/复制用。 */
export function uniqueGroupName(base, groups) {
  const used = new Set((groups ?? []).map((group) => String(group?.name ?? '')));
  const name = String(base || DEFAULT_GROUP_NAME).trim() || DEFAULT_GROUP_NAME;
  if (!used.has(name)) return name;
  let n = 2;
  while (used.has(`${name} ${n}`)) n += 1;
  return `${name} ${n}`;
}
