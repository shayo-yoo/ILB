// narrative/guide.js —— 给人和给 AI 看的"声明写法说明"（v0.7.0）。
//
// 用途有两个：
//   1. 「叙事」页有个按钮把它复制到剪贴板，用户可以直接丢给 AI："照这个格式帮我改声明"；
//   2. 它也是这个子项目唯一一份面向外部读者的语法速查（README 里有更长的版本）。
//
// 注意：这段文字是**给模型看的提示**，不是代码；改它不需要同步任何逻辑，
// 但改逻辑（新增类型/效果/事件）时必须回来补一段，否则用户复制给 AI 的信息会过期。

export const DECLARATION_GUIDE = `你在帮我编写一个角色扮演扩展（ILB）的"账本声明"。声明是一个 JSON 对象，包含 schema、catalog、rules，可选 events 和 verbs。请只输出 JSON，不要解释。

一、整体形状
{
  "schema": { "vars": [ …变量… ], "constraints": [ …全局约束… ] },
  "catalog": { "entities": [ …名词表… ] },
  "rules": [ …规则… ],
  "events": [ { "id": "自定义事件名", "label": "中文说明" } ],
  "verbs": { "别名": "获得" }
}

二、变量（schema.vars）
每个变量：
{ "name": "背包", "type": "list", "init": [], "label": "背包",
  "of": "item", "unique": false,
  "constraints": [ { "kind": "max", "value": 8 } ] }
- type 只能是：text（文本）、number（数值）、flag（开关，true/false）、list（列表）、map（映射：键→文本或数字）、enum（枚举，必须给 options 数组）。
- init 是初值；省略时按类型给默认（空串 / 0 / false / [] / {} / options[0]）。
- list 可用 of 指定元素类型（与 catalog 的 kind 对应），unique: true 表示去重。
- 变量自带约束写在自己的 constraints 里。

三、全局约束（schema.constraints）
- { "kind": "max", "var": "背包", "value": 8 }            最多 8 项
- { "kind": "sumMax", "var": "背包", "field": "weight", "value": 20 }  总重不超过 20（查 catalog 的 weight）
- { "kind": "range", "var": "生命", "min": 0, "max": 100 }  数值范围
- { "kind": "mutex", "vars": ["圣剑", "魔剑"] }              不能同时为真
- { "kind": "require", "var": "钥匙", "when": { "var": "门", "equals": "锁着" }, "must": true }

四、名词表（catalog.entities）
{ "name": "铜钥匙", "kind": "item", "tags": ["物品", "钥匙"], "weight": 1, "alias": ["钥匙"] }
- tags 用来让规则按类别匹配（例如所有带"物品"标签的都能进背包）。
- weight 给 sumMax 用；没写按 0 算。
- 不需要把每一件物品都写进来：规则可以按标签匹配；但写了才有重量与别名。

五、规则（rules）
{ "id": "喝药", "on": "use",
  "when": { "name": "药水", "all": [ { "var": "冷却", "op": "==", "value": 0 } ] },
  "effects": [
    { "op": "remove", "var": "背包", "value": "$name" },
    { "op": "inc", "var": "生命", "amount": 10 },
    { "op": "set", "var": "冷却", "value": 3 }
  ],
  "note": "回 10 点，冷却 3 轮" }
- on 是本条规则响应的事实类型：gain（获得）、lose（失去）、use（使用）、mark（标记）、unmark（解除）、relation（关系）、move（地点）、seen（见过）、event（自定义事件）、tick（每轮自动一次）。
- when 可用字段：name、tags（数组，查 catalog）、dir、from、to、event（自定义事件名）、all（变量比较数组）、not（取反）。
  - 比较用 { "var": "生命", "op": ">", "value": 0 }；op 支持 == != > >= < <= has notHas。
- effects 的 op 只能是：add、remove、set、inc、dec、mapInc、mark、unmark、reject。
  - add/remove 用于 list；set 用于任何类型；inc/dec 用于 number；mapInc 用于 map；mark/unmark 用于 flag；reject 直接拒绝这条事实并给 reason。
  - 值可以用占位符：$name（事实对象名）、$count、$sign、$amount、$target（地点事实的"到"）、$from。
- 一条事实要么整条生效、要么整条拒绝（任何约束不过都会整条回滚），所以不要把"扣钱"和"给东西"拆到两条规则里。
- 规则的触发条件只看"这条事实发生之前"的状态，所以规则书写顺序不影响含义。

六、自定义事件与别名
- events 里声明的新名字可以直接写在正文标记里：[[ILB:突破:筑基]]，解析后是 { type:"event", event:"突破", name:"筑基" }；规则用 "on":"event", "when":{ "event":"突破", "name":"筑基" } 响应。
- verbs 是别名：{ "拾取": "获得" }，解析后仍按"获得"处理。
- 内置八个动词保持不变：获得、失去、使用、标记、解除、关系、地点、见过。

七、约定
- 变量名、事件名用中文短语；不要写函数、循环、脚本。
- 数值变化只通过规则，不要让 AI 直接设值。
- 想加"背包上限"用 list + max；想加"负重"再加 sumMax + catalog.weight；想加"互斥"用 mutex；想加"冷却"用 number + tick 规则。
- 如果某个东西没写进 catalog 也没有规则，事实会被标成"未认领"，状态不变。

请根据我的玩法描述，输出一份完整、可直接粘贴的 JSON 声明。`;

export default DECLARATION_GUIDE;
