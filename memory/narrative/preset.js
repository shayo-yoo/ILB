// narrative/preset.js —— 内置示例声明（用户可以在设置里整份替换）。
//
// 这个文件里**没有一行代码**：全是数据。它是新装用户的默认账本，同时被
// `tests/narrative.test.mjs`（当验收样本）和 `tests/narrative-demo.mjs`（当演示）使用，
// 所以"测试通过"和"演示能跑"说的是同一份东西。
// 用户替换后的声明存在 extension_settings 里，升级扩展不会覆盖。
//
// 六种玩法都只用下面的声明表达：
//   1. 背包 8 格        → `背包` 列表 + `max: 8`
//   2. 负重 20          → 目录里每件东西的 `weight` + `sumMax: { field: 'weight', value: 20 }`
//   3. 圣剑/魔剑互斥    → 两个开关 + 全局 `mutex`
//   4. 药水冷却 3 轮    → `冷却` 数值 + `tick` 规则
//   5. 关系表           → `关系` 映射 + `mapInc`
//   6. 任务状态机       → `任务` 枚举 + 两条互斥的 `use` 规则

export const PRESET = {
  schema: {
    vars: [
      // 背包：格子有上限、重量也有上限。剩余格与总重量都是**算出来的**，不存。
      { name: '背包', type: 'list', of: 'item', label: '背包', constraints: [{ kind: 'max', value: 8 }, { kind: 'sumMax', field: 'weight', value: 20 }] },
      { name: '生命', type: 'number', init: 90, label: '生命', constraints: [{ kind: 'range', min: 0, max: 100 }] },
      { name: '冷却', type: 'number', init: 0, label: '药水冷却' },
      { name: '关系', type: 'map', label: '关系' },
      { name: '任务', type: 'enum', options: ['未接', '进行', '完成'], init: '未接', label: '委托' },
      { name: '圣剑', type: 'flag', label: '持有圣剑' },
      { name: '魔剑', type: 'flag', label: '持有魔剑' },
      { name: '声望', type: 'number', init: 0, label: '声望' },
      { name: '地点', type: 'text', init: '王城', label: '所在' },
    ],
    constraints: [{ kind: 'mutex', vars: ['圣剑', '魔剑'] }],
  },

  catalog: {
    entities: [
      { name: '铜钥匙', tags: ['物品', '钥匙'], weight: 1 },
      { name: '铁钥匙', tags: ['物品', '钥匙'], weight: 1 },
      { name: '药水', tags: ['物品', '消耗品'], weight: 2 },
      { name: '圣剑', tags: ['物品', '武器'], weight: 5 },
      { name: '魔剑', tags: ['物品', '武器'], weight: 5 },
      { name: '重甲', tags: ['物品'], weight: 15 },
      { name: '艾琳', kind: 'character', tags: ['人物'] },
      { name: '王城', kind: 'place' },
      { name: '地窖', kind: 'place' },
    ],
  },

  rules: [
    // 通用：带"物品"标签的东西拿到就进背包，失去就出背包
    { id: '收进背包', on: 'gain', when: { tags: ['物品'] }, effects: [{ op: 'add', var: '背包', value: '$name' }], note: '拿到的东西进背包' },
    { id: '从背包取出', on: 'lose', when: { tags: ['物品'] }, effects: [{ op: 'remove', var: '背包', value: '$name' }] },

    // 互斥的两把剑：各自打开自己的开关，冲突交给 mutex 约束去拒
    { id: '圣剑入手', on: 'gain', when: { name: '圣剑' }, effects: [{ op: 'set', var: '圣剑', value: true }] },
    { id: '圣剑失去', on: 'lose', when: { name: '圣剑' }, effects: [{ op: 'set', var: '圣剑', value: false }] },
    { id: '魔剑入手', on: 'gain', when: { name: '魔剑' }, effects: [{ op: 'set', var: '魔剑', value: true }] },

    // 喝药：回 10 点、冷却 3 轮；冷却中再喝就被拒（拒绝原因是给玩家看的）
    {
      id: '喝药',
      on: 'use',
      when: { name: '药水', all: [{ var: '冷却', op: '==', value: 0 }] },
      effects: [
        { op: 'remove', var: '背包', value: '$name' },
        { op: 'inc', var: '生命', amount: 10 },
        { op: 'set', var: '冷却', value: 3 },
      ],
      note: '回 10 点，冷却 3 轮',
    },
    { id: '冷却中', on: 'use', when: { name: '药水', all: [{ var: '冷却', op: '>', value: 0 }] }, effects: [{ op: 'reject', reason: '药水还在冷却' }] },
    // 每轮末尾自动一次 tick：冷却逐轮递减。这条不是 AI 写的，是引擎自己发的。
    { id: '冷却递减', on: 'tick', when: { all: [{ var: '冷却', op: '>', value: 0 }] }, effects: [{ op: 'dec', var: '冷却', amount: 1 }] },

    // 关系：只报方向与幅度，数值累加由引擎做
    { id: '记关系', on: 'relation', effects: [{ op: 'mapInc', var: '关系', key: '$name', amount: '$sign' }] },

    // 地点：从 A 到 B，只记"现在在哪"，路径本身不存
    { id: '记地点', on: 'move', effects: [{ op: 'set', var: '地点', value: '$target' }] },

    // 任务状态机：三条规则互斥，靠枚举的当前值区分，没有隐含的先后要求
    { id: '接受委托', on: 'use', when: { name: '接受委托', all: [{ var: '任务', op: '==', value: '未接' }] }, effects: [{ op: 'set', var: '任务', value: '进行' }] },
    {
      id: '完成委托',
      on: 'use',
      when: { name: '完成委托', all: [{ var: '任务', op: '==', value: '进行' }] },
      effects: [{ op: 'set', var: '任务', value: '完成' }, { op: 'inc', var: '声望', amount: 5 }],
    },
    { id: '委托已完成', on: 'use', when: { name: '完成委托', all: [{ var: '任务', op: '==', value: '完成' }] }, effects: [{ op: 'reject', reason: '这个委托已经交过了' }] },
  ],
};

// 测试与演示沿用的旧名字
export const SPEC = PRESET;
export default PRESET;
