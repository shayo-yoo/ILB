// 临时工具：用极简 DOM 桩把界面跑一遍，抓"点了才炸"的那种错。
// 用法：node tests/_smoke-dom.mjs
// 注意：这不是浏览器，只验证「函数会不会抛」，不验证「长得对不对」。

function makeClassList() {
  const set = new Set();
  return {
    add: (...names) => names.forEach((n) => set.add(n)),
    remove: (...names) => names.forEach((n) => set.delete(n)),
    toggle: (name, force) => {
      if (force === undefined) {
        if (set.has(name)) set.delete(name);
        else set.add(name);
      } else if (force) set.add(name);
      else set.delete(name);
    },
    contains: (name) => set.has(name),
  };
}

function makeElement(tag = 'div') {
  const isText = tag === '#text';
  const node = {
    nodeType: isText ? 3 : 1,
    tagName: String(tag).toUpperCase(),
    children: [],
    childNodes: [],
    style: {},
    dataset: {},
    classList: makeClassList(),
    attributes: {},
    parentNode: null,
    _listeners: {},
    value: '',
    checked: false,
    disabled: false,
    textContent: '',
    title: '',
    onclick: null,
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === 'value') this.value = String(value);
      if (name === 'class') this.className = String(value);
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    addEventListener(type, handler) {
      const key = String(type).toLowerCase();
      this._listeners[key] = this._listeners[key] ?? [];
      this._listeners[key].push(handler);
    },
    removeEventListener(type, handler) {
      const key = String(type).toLowerCase();
      this._listeners[key] = (this._listeners[key] ?? []).filter((fn) => fn !== handler);
    },
    dispatch(type, event = {}) {
      const key = String(type).toLowerCase();
      const payload = { type: key, target: this, currentTarget: this, preventDefault() {}, stopPropagation() {}, ...event };
      for (const handler of this._listeners[key] ?? []) handler(payload);
      return payload;
    },
    get firstChild() {
      return this.children[0] ?? null;
    },
    cloneNode() {
      return makeElement(tag);
    },
    focus() {},
    blur() {},
    scrollIntoView() {},
    getBoundingClientRect() {
      return { top: 0, left: 0, right: 100, bottom: 100, width: 100, height: 100 };
    },
    get innerHTML() {
      return this._html ?? '';
    },
    set innerHTML(value) {
      // 清空语义足够：真正渲染在测试里不需要
      this.children = [];
      this.childNodes = [];
      this._html = value;
    },
    appendChild(child) {
      if (!child) throw new Error(`appendChild 收到了 ${child}`);
      this.children.push(child);
      this.childNodes.push(child);
      child.parentNode = this;
      return child;
    },
    insertBefore(child) {
      return this.appendChild(child);
    },
    removeChild(child) {
      this.children = this.children.filter((c) => c !== child);
      this.childNodes = this.childNodes.filter((c) => c !== child);
      return child;
    },
    remove() {
      if (this.parentNode) this.parentNode.removeChild(this);
    },
    replaceChildren(...nodes) {
      this.children = [];
      this.childNodes = [];
      nodes.forEach((n) => this.appendChild(n));
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  node.className = '';
  return node;
}

const body = makeElement('body');
const head = makeElement('head');

globalThis.window = globalThis;
globalThis.document = {
  body,
  head,
  documentElement: makeElement('html'),
  createElement: (tag) => makeElement(tag),
  createElementNS: (_ns, tag) => makeElement(tag),
  createTextNode: (text) => {
    const node = makeElement('#text');
    node.textContent = text;
    node.nodeValue = text;
    return node;
  },
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
};
globalThis.localStorage = {
  _data: {},
  getItem(k) {
    return this._data[k] ?? null;
  },
  setItem(k, v) {
    this._data[k] = String(v);
  },
  removeItem(k) {
    delete this._data[k];
  },
};
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.innerWidth = 1280;
globalThis.innerHeight = 800;
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const { createRepository } = await import('../adapters/repository.js');
const { createPipeline } = await import('../runtime/pipeline.js');
const { createRegistry } = await import('../runtime/registry.js');
const { createPanel } = await import('../ui/panel.js');
const { openOverlay } = await import('../ui/help.js');
// step() 是同步的：异步步骤里的断言不会被等到，所以这里先拿好模块，步骤本身写成同步的。
const mobileModule = await import('../ui/mobile.js');
const { renderFlowEditor } = await import('../ui/flow-editor.js');
const { normalizeFlow, makeNode } = await import('../core/flow.js');

let failures = 0;
/** 没被接住的异步错误也算失败：浏览器里表现为"未处理的异步错误"，用户会看到红字 */
const unhandled = [];
process.on('unhandledRejection', (reason) => unhandled.push(reason));
function step(name, fn) {
  try {
    fn();
    console.log(`ok    ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${name}\n      ${error && error.message}`);
    if (error && error.stack) {
      console.log(String(error.stack).split('\n').slice(1, 4).join('\n'));
    }
  }
}

const settings = {};
const buckets = { settings, books: {}, manualState: {}, chatStates: {}, importLog: [], snapshots: [], ui: {} };
const repository = createRepository({
  getContext: () => ({ extensionSettings: { independent_lorebook: buckets } }),
});
const nativeWorlds = { list: async () => [], get: async () => null, isAvailable: () => true };
const registry = createRegistry();
const pipeline = createPipeline({ repository, injector: { apply: () => true, clear() {} }, registry });
const notes = [];
const panel = createPanel({ repository, nativeWorlds, pipeline, notify: (t, kind) => notes.push(`${kind}:${t}`) });

const hostEl = makeElement('div');

step('panel.mount', () => {
  const ok = panel.mount(hostEl);
  if (ok === false) throw new Error('mount 返回 false');
});

step('新建一本书', () => {
  repository.saveBook({
    book_id: 'book-t',
    name: '测试书',
    activation: { mode: 'always', characters: [], manual: true },
    pool: { share: true },
    entries: [
      { id: 'e1', title: '王城', content: '王城的钟声', enabled: true, trigger: { any: ['王城'] } },
      { id: 'e2', title: '夜巡', content: '夜巡开始', enabled: false, trigger: { any: ['夜晚'] } },
    ],
  });
});

for (const tab of ['shelf', 'rules', 'snapshots', 'state', 'diagnostics', 'settings']) {
  step(`切到 ${tab} 并渲染`, () => {
    panel.setTab(tab);
  });
}

step('打开规则编辑器', () => {
  panel.setTab('rules');
  const book = repository.getBook('book-t');
  panel.openEditor(book, book.entries[0]);
});

step('打开「试一句」', () => {
  const book = repository.getBook('book-t');
  panel.openPreview(book, book.entries[0]);
});

step('规则页搜索与筛选', () => {
  panel.setTab('rules');
  panel.state.ruleQuery = '王城';
  panel.render();
  panel.state.ruleMode = 'disabled';
  panel.render();
  panel.state.ruleQuery = '';
  panel.state.ruleMode = 'all';
  panel.render();
});

step('书架搜索', () => {
  panel.setTab('shelf');
  panel.state.bookQuery = '测';
  panel.render();
  panel.state.bookQuery = '';
});

step('书架卡片：默认紧凑摘要、详情可展开、⋯菜单可开可关、模式能切', () => {
  panel.setTab('shelf');
  const rootEl = panel.element ?? hostEl;
  const klass = (n) => String(n.className ?? '');
  const findCard = () => walk(rootEl).find((n) => klass(n).includes('ilb-book-card'));
  let card = findCard();
  if (!card) throw new Error('书架上没有书籍卡片');
  if (!klass(card).includes('ilb-book-card-compact')) throw new Error('默认不是紧凑模式');
  if (walk(card).some((n) => klass(n).includes('ilb-book-controls'))) throw new Error('默认就展开了管理详情');

  const menu = walk(card).find((n) => klass(n).includes('ilb-book-menu'));
  if (!menu) throw new Error('卡片没有「⋯」菜单');
  if (menu.hidden !== true) throw new Error('「⋯」菜单默认是展开的');
  const moreBtn = walk(card).find((n) => n.textContent === '⋯' && (n._listeners?.click ?? []).length > 0);
  if (!moreBtn) throw new Error('找不到「⋯」按钮');
  moreBtn.dispatch('click');
  if (menu.hidden !== false) throw new Error('点「⋯」没有展开菜单');
  moreBtn.dispatch('click');
  if (menu.hidden !== true) throw new Error('再点「⋯」没有收起菜单');

  clickText(card, '展开详情');
  card = findCard();
  if (!walk(card).some((n) => klass(n).includes('ilb-set-grid'))) throw new Error('展开后没有设置网格');
  for (const label of ['酒馆关联', '启用策略', '强制覆盖', '手动开关', '进总条目池']) {
    if (!walk(card).some((n) => n.textContent === label)) throw new Error(`展开后缺设置项：${label}`);
  }
  if (!walk(card).some((n) => n.textContent === '收起详情 ▴')) throw new Error('展开后按钮没有变成「收起详情」');

  clickText(rootEl, '舒适');
  card = findCard();
  if (!klass(card).includes('ilb-book-card-comfort')) throw new Error('切到舒适模式后卡片没有换样式');
  clickText(rootEl, '紧凑');
  card = findCard();
  if (!klass(card).includes('ilb-book-card-compact')) throw new Error('切回紧凑没有生效');
  // 收起详情，别把展开状态留给后面的步骤
  clickText(card, '收起详情');
});

step('逻辑页：有逻辑组容器，独立逻辑不依赖当前书籍', () => {
  panel.setTab('logic');
  const rootEl = panel.element ?? hostEl;
  const all = walk(rootEl);
  const groupSelect = all.find((n) => String(n.className ?? '').includes('ilb-group-select'));
  if (!groupSelect) throw new Error('逻辑页没有逻辑组选择器');
  if ((repository.listLogicGroups?.() ?? []).length === 0) throw new Error('打开逻辑页没有默认逻辑组');
  if (!all.some((n) => n.textContent === '新增逻辑')) throw new Error('逻辑页没有「新增逻辑」按钮');
  // 没选书时也应该能正常渲染（逻辑组不依赖书）
  panel.state.activeBookId = null;
  panel.render();
  const after = walk(panel.element ?? hostEl);
  if (!after.some((n) => String(n.className ?? '').includes('ilb-group-select'))) throw new Error('没选书时逻辑页崩了');
});

step('快照保存与恢复', () => {
  panel.setTab('snapshots');
  panel.render();
});

function walk(node, out = []) {
  out.push(node);
  for (const child of node.children ?? []) walk(child, out);
  return out;
}

function findByText(rootEl, text) {
  return walk(rootEl).find((n) => typeof n.textContent === 'string' && n.textContent.includes(text));
}

function clickText(rootEl, text) {
  const hits = walk(rootEl).filter((n) => typeof n.textContent === 'string' && n.textContent.includes(text));
  if (hits.length === 0) throw new Error(`找不到按钮：${text}`);
  // 说明文字里也可能出现同样的词（例如 hint 里写了「清空」），优先点真正绑了事件的元素
  const node = hits.find((n) => (n._listeners?.click ?? []).length > 0) ?? hits[0];
  const handlers = node._listeners?.click ?? [];
  if (handlers.length === 0) throw new Error(`「${text}」没有绑定点击事件`);
  for (const handler of handlers) {
    handler({ type: 'click', target: node, currentTarget: node, preventDefault() {}, stopPropagation() {} });
  }
  return node;
}

step('流程编辑器能在表单和文本之间来回切', () => {
  const book = repository.getBook('book-t');
  panel.openEditor(book, book.entries[0]);
  clickText(body, '编辑流程');
  clickText(body, '＋ 添加一步');
  clickText(body, '＋ 检测');
  clickText(body, '＋ 检测');
  const kinds = walk(body).filter((n) => n.className && String(n.className).includes('ilb-flow-kind'));
  if (kinds.length < 2) throw new Error('流程节点没有画出来');

  // 切到文本模式：应该看到刚才那两个节点被写成文字（v0.13.0）
  clickText(body, '文本模式');
  const area = walk(body).find((n) => n.className && String(n.className).includes('ilb-flow-area'));
  if (!area) throw new Error('文本模式没有文本框');
  if (!area.value || !area.value.includes('检测')) throw new Error('文本里没有把节点写出来');
  const typed = `${area.value}\n添加 "测试时写进去的一句话"\n`;
  area.value = typed;
  area.dispatch('input');
  clickText(body, '收下这段文本');

  // 切回表单：多出来的那个「添加」要能在表单里看见
  clickText(body, '切回表单');
  const addNodes = walk(body).filter((n) => n.className && String(n.className).includes('ilb-flow-kind'));
  if (addNodes.length < 3) throw new Error(`文本加的一行没有回到表单（现在 ${addNodes.length} 个节点）`);
});

// 「界面」步骤：v0.14.0 新节点，表单里要有它那几格，空着要当场提示（ILB-4.21）
step('流程里能加「界面」步骤，空着会当场提示', () => {
  clickText(body, '＋ 添加一步');
  clickText(body, '＋ 界面');
  const kinds = walk(body).filter((n) => n.className && String(n.className).includes('ilb-flow-kind'));
  if (!kinds.some((n) => String(n.textContent ?? '').includes('界面'))) throw new Error('「界面」节点没有出现在流程里');
  const rows = walk(body).filter((n) => n.className && String(n.className).includes('ilb-flow-ui-row'));
  if (rows.length < 6) throw new Error(`界面节点的输入框不全（现在 ${rows.length} 个）`);
  const warns = walk(body).filter((n) => n.className && String(n.className).includes('ilb-warn'));
  if (!warns.some((n) => String(n.textContent ?? '').includes('这一步是空的'))) throw new Error('空着的界面步骤没有提示');
});

// 条件组：v0.15.0 的「条件组」节点（ILB-4.22）。v0.17 文本语法已经装得下一层条件组，
// 所以这里断言的是「能原样带走」；嵌套组仍然只能表单编辑（下一步专门检查只读）。
step('流程里能加条件组，文本模式能原样带走它', () => {
  clickText(body, '＋ 添加一步');
  clickText(body, '＋ 条件组');
  const groups = walk(body).filter((n) => n.className && String(n.className).includes('ilb-flow-group-cond'));
  if (groups.length === 0) throw new Error('条件组没有画出来');
  const tools = walk(body).filter((n) => n.className && String(n.className).includes('ilb-flow-group-tools'));
  if (tools.length === 0) throw new Error('条件组里没有「添加条件 / 添加条件组」的入口');

  clickText(body, '文本模式');
  const area = walk(body).find((n) => n.className && String(n.className).includes('ilb-flow-area'));
  if (!area) throw new Error('文本模式没有文本框');
  if (area.readOnly === true) throw new Error('一层条件组已经能写进文本，不该再只读');
  if (!String(area.value).includes('条件组')) throw new Error('文本里没有条件组那一行');
  clickText(body, '收下这段文本');
  clickText(body, '切回表单');
  const after = walk(body).filter((n) => n.className && String(n.className).includes('ilb-flow-group-cond'));
  if (after.length === 0) throw new Error('在文本里收了一次，条件组就丢了');
});

step('嵌套条件组装不进文本：文本模式只读，硬收也不会覆盖', () => {
  // 单独搭一棵树：组里再套组，文本语法装不下（两层以上只能表单编辑）
  const host = makeElement('div');
  const flow = normalizeFlow({
    mode: 'and',
    nodes: [{
      ...makeNode('if'),
      when: {
        what: 'group',
        op: 'and',
        negate: false,
        children: [
          { what: 'contains', text: 'x', within: 3, negate: false },
          { what: 'group', op: 'or', negate: false, children: [] },
        ],
      },
    }],
  });
  host.appendChild(renderFlowEditor({
    flow,
    entries: [],
    logics: [],
    ctx: { toast() {}, density: () => 'standard' },
    onChange() {},
  }));
  const before = walk(host).filter((n) => n.className && String(n.className).includes('ilb-flow-group-cond')).length;
  clickText(host, '文本模式');
  const area = walk(host).find((n) => n.className && String(n.className).includes('ilb-flow-area'));
  if (!area) throw new Error('文本模式没有文本框');
  if (area.readOnly !== true) throw new Error('嵌套条件组装不下，文本模式却是可写的');
  const warns = walk(host).filter((n) => n.className && String(n.className).includes('ilb-warn'));
  if (!warns.some((n) => String(n.textContent ?? '').includes('只读'))) throw new Error('没有说明文本模式为什么只读');
  clickText(host, '收下这段文本');
  clickText(host, '切回表单');
  const after = walk(host).filter((n) => n.className && String(n.className).includes('ilb-flow-group-cond')).length;
  if (after !== before) throw new Error(`点了一下「收下」就把嵌套条件组改坏了（${before} → ${after}）`);
});

step('文本模式里看不懂的行会当场列出来', () => {
  clickText(body, '文本模式');
  const area = walk(body).find((n) => n.className && String(n.className).includes('ilb-flow-area'));
  if (!area) throw new Error('没有文本框');
  area.value = `${area.value}\n这一行不是任何关键字\n`;
  area.dispatch('input');
  const bad = walk(body).filter((n) => n.className && String(n.className).includes('ilb-bad'));
  if (bad.length === 0) throw new Error('坏行没有被列出来');
  clickText(body, '清空');
  clickText(body, '切回表单');
});

// 复制给 AI 的说明：v0.13.1 真机上点它报过 "ctx is not defined"（假 DOM 没抓到，因为没有 navigator.clipboard
// 就没人走到那段）。这里点一次，然后等一个 tick，看有没有未处理的异步错误。
clickText(body, '文本模式');
clickText(body, '复制给 AI 的说明');
await new Promise((resolve) => setTimeout(resolve, 50));
step('「复制给 AI 的说明」点了不抛错，并且给了提示', () => {
  if (unhandled.length > 0) {
    throw new Error(`有未处理的异步错误：${unhandled[0] && unhandled[0].message}`);
  }
  if (!notes.some((n) => n.includes('复制'))) throw new Error('点了复制但没有任何提示');
});
clickText(body, '切回表单');

step('导入选择浮层能打开并渲染', async () => {
  const { openImportDialog } = await import('../ui/importer.js');
  const ctx = {
    repository,
    nativeWorlds: {
      list: async () => [
        { name: 'a.json', fileId: 'a' },
        { name: 'b.json', fileId: 'b' },
      ],
      get: async () => null,
      isAvailable: () => true,
    },
    pipeline,
    state: {},
    toast: (t) => notes.push(`toast:${t}`),
    render: () => {},
    setTab: () => {},
    saveEntries: () => {},
    validateBook: () => [],
    openOverlay: (title, nodes) => {
      const wrap = makeElement('div');
      nodes.forEach((n) => wrap.appendChild(n));
      body.appendChild(wrap);
      return wrap;
    },
    closeOverlay: () => {},
    showHelp: () => {},
    helpButton: () => makeElement('button'),
    openEditor: () => {},
    openPreview: () => {},
  };
  const el = openImportDialog(ctx, { preselect: 'new' });
  if (!el) throw new Error('导入浮层没有返回元素');
  body.appendChild(el);
});

step('浮层有关闭按钮，点一下能关掉', () => {
  openOverlay({ title: '测试浮层', nodes: [makeElement('p')] });
  const overlay = body.children[body.children.length - 1];
  if (!String(overlay.className).includes('ilb-overlay')) throw new Error('浮层没有挂到 body 上');
  const modal = overlay.children[0];
  const head = modal.children[0];
  if (!String(head.className).includes('ilb-modal-head')) throw new Error('标题栏不是第一块，滚动时关闭按钮会被卷走');
  const x = head.children.find((n) => String(n.className).includes('ilb-modal-x'));
  if (!x) throw new Error('找不到关闭按钮');
  if (x.getAttribute('aria-label') !== '关闭') throw new Error('关闭按钮缺少 aria-label');
  if (x.textContent !== '×') throw new Error('关闭按钮不是 ×');
  x.dispatch('click');
  if (body.children.includes(overlay)) throw new Error('点了关闭按钮，浮层还在');
  if (body.classList.contains('ilb-overlay-open')) throw new Error('关掉浮层之后浮窗还让着位（ilb-overlay-open 没摘）');
});

step('设置卡片能挂载', async () => {
  const { createSettingsCard } = await import('../ui/settings-card.js');
  const card = createSettingsCard({
    repository,
    pipeline,
    openWindow: () => {},
    notify: (t) => notes.push(`card:${t}`),
  });
  const host = makeElement('div');
  card.mount(host);
  if (!host.children.length) throw new Error('卡片没有挂上任何东西');
});

step('悬浮球与浮窗能开关', async () => {
  const { createFloatingWindow } = await import('../ui/floating.js');
  const floating = createFloatingWindow({ repository, notify: (t) => notes.push(`float:${t}`) });
  floating.mount();
  floating.open();
  floating.close();
  floating.toggle();
  floating.close();
  floating.setVisible(false);
  floating.setVisible(true);
});

step('浮窗能最小化 / 最大化 / 还原，密度跟着窗子宽度走', async () => {
  const { createFloatingWindow } = await import('../ui/floating.js');
  const floating = createFloatingWindow({ repository, notify: (t) => notes.push(`float:${t}`) });
  floating.mount();
  floating.open();
  const start = floating.describe();
  if (!start.density) throw new Error('describe() 没报密度');
  if (start.minimized || start.maximized) throw new Error('刚打开的窗子不该是最小/最大化');

  floating.toggleMaximize();
  const maxed = floating.describe();
  if (!maxed.maximized) throw new Error('最大化了却没生效');
  if (maxed.geometry.w <= start.geometry.w && maxed.geometry.h <= start.geometry.h) {
    throw new Error('最大化之后窗口没有变大');
  }
  if (maxed.density !== 'wide') throw new Error(`最大化之后密度还是「${maxed.density}」`);

  floating.toggleMaximize();
  const back = floating.describe();
  if (back.maximized) throw new Error('还原没生效');
  if (back.geometry.w !== start.geometry.w || back.geometry.h !== start.geometry.h) {
    throw new Error('还原之后尺寸没回到原来的样子');
  }

  floating.minimize();
  if (!floating.describe().minimized) throw new Error('最小化没生效');
  if (floating.describe().open !== true) throw new Error('最小化把窗口关掉了（应该只是收起来）');
  floating.toggle();
  if (floating.describe().minimized) throw new Error('点悬浮球没能把窗子收回来');
  floating.close();
});

step('手机界面能开关，二级页能弹能关', async () => {
  const { createMobileUi } = await import('../ui/mobile.js');
  const ui = createMobileUi({ repository, notify: (t) => notes.push(`mobile:${t}`) });
  ui.mount();
  ui.open();
  if (!ui.isOpen()) throw new Error('手机界面没打开');
  ui.openOverlay({ title: '测试二级页', nodes: [makeElement('p')] });
  if (!ui.isOverlayOpen()) throw new Error('二级页没弹出来');
  ui.openOverlay({ title: '第二层', nodes: [makeElement('p')] });
  ui.closeOverlay();
  if (!ui.isOverlayOpen()) throw new Error('关掉上面一层时，下面那层也跟着没了（栈没管好）');
  ui.closeOverlay();
  if (ui.isOverlayOpen()) throw new Error('二级页没关干净');
  ui.close();
  if (ui.isOpen()) throw new Error('手机界面没关掉');
});

step('外壳按布局挑一套界面，另一套让位', async () => {
  const { createShell } = await import('../ui/shell.js');
  const shell = createShell({ repository, notify: (t) => notes.push(`shell:${t}`) });
  shell.mount();
  await shell.attachPanel(panel);
  shell.open();
  shell.close();
  shell.setStatus('ok', '这一轮有内容');
  const d = shell.describe();
  if (!d.layout) throw new Error('describe() 没报布局');
  if (!d.desktop || !d.mobile) throw new Error('describe() 没报两套壳');
});

step('手机布局：两套壳都能装，挑手机那套且不炸', async () => {
  // 真实手机上走的就是这条分支：把视口宽度改成手机尺寸，让 layout 选 mobile。
  // v0.20.0 前这里会调 desktop.closeForce()（浮窗根本没这个方法），整个壳都挂不上。
  const { createShell } = await import('../ui/shell.js');
  const savedW = globalThis.innerWidth;
  const savedH = globalThis.innerHeight;
  globalThis.innerWidth = 420;
  globalThis.innerHeight = 820;
  try {
    const shell = createShell({ repository, notify: (t) => notes.push(`shell-m:${t}`) });
    if (!shell.mount()) throw new Error('手机布局下 mount() 返回 false');
    await shell.attachPanel(panel);
    shell.open();
    shell.close();
    shell.setStatus('wait', '手机这一轮没内容');
    if (shell.layout() !== 'mobile') throw new Error(`布局应为 mobile，实际 ${shell.layout()}`);
    if (shell.density() !== 'compact') throw new Error(`手机密度应为 compact，实际 ${shell.density()}`);
    const d = shell.describe();
    if (d.layout !== 'mobile') throw new Error('describe() 的布局不对');
  } finally {
    globalThis.innerWidth = savedW;
    globalThis.innerHeight = savedH;
  }
});
step('标签栏有「使用说明」，内容能画出来', async () => {
  const { readFileSync } = await import('node:fs');
  const { primeGuide, renderGuide } = await import('../ui/guide.js');
  panel.setTab('shelf');
  const tabTexts = walk(hostEl).map((n) => String(n.textContent ?? ''));
  if (!tabTexts.some((t) => t === '使用说明')) throw new Error('标签栏里找不到「使用说明」入口');
  // 假 DOM 里 fetch 永远失败，所以直接把同一份 JSON 塞进去，验证渲染部分。
  const data = JSON.parse(readFileSync(new URL('../data/guide/zh-cn.json', import.meta.url), 'utf8'));
  primeGuide(data);
  const nodes = renderGuide(data);
  if (nodes.length < 5) throw new Error(`说明只画出 ${nodes.length} 块，太少`);
  const wrap = makeElement('div');
  nodes.forEach((n) => wrap.appendChild(n));
  const text = walk(wrap).map((n) => String(n.textContent ?? '')).join('\n');
  for (const must of ['五分钟上手', '变量和宏', '数据存在哪']) {
    if (!text.includes(must)) throw new Error(`说明里缺少「${must}」`);
  }
});


// ===== v0.16.0：Phase 3 的导航 / 书籍上下文 / 选择模式 / 未保存守卫 =====
// 这一组用独立的面板实例：主面板的 deps 没有 getLayout/getDensity（默认 desktop/standard），
// 这里换成可以随时改的假实现，专门验证"按浮窗内部宽度换导航形态"。

function makePanelWith(getLayout, getDensity) {
  const p = createPanel({
    repository,
    nativeWorlds,
    pipeline,
    notify: (t, kind) => notes.push(`${kind}:${t}`),
    getLayout,
    getDensity,
  });
  const host = makeElement('div');
  // 不用 p.mount()：mount 是 async（要先读说明文案），同步的 step() 等不到它。
  host.appendChild(p.element);
  p.render();
  return { panel: p, host };
}

step('导航按浮窗内部宽度换形态：宽屏左侧分组、标准顶部、紧凑下拉', () => {
  let layoutNow = 'desktop';
  let densityNow = 'wide';
  const { panel: p, host } = makePanelWith(() => layoutNow, () => densityNow);
  p.setTab('shelf');

  const wide = walk(host);
  if (!wide.some((n) => String(n.className ?? '').includes('ilb-nav-side'))) {
    throw new Error('宽屏没有左侧导航');
  }
  const groupLabels = wide
    .filter((n) => String(n.className ?? '').includes('ilb-nav-group-label'))
    .map((n) => String(n.textContent ?? ''));
  for (const must of ['内容管理', '自动化', '运行与维护']) {
    if (!groupLabels.includes(must)) throw new Error(`左侧导航缺少分组「${must}」`);
  }

  densityNow = 'standard';
  p.render();
  if (!walk(host).some((n) => String(n.className ?? '').includes('ilb-nav-top'))) {
    throw new Error('标准宽度没有顶部导航');
  }
  if (walk(host).some((n) => String(n.className ?? '').includes('ilb-nav-side'))) {
    throw new Error('标准宽度还在用左侧导航');
  }

  densityNow = 'compact';
  p.render();
  const compact = walk(host);
  if (!compact.some((n) => String(n.className ?? '').includes('ilb-nav-select'))) {
    throw new Error('紧凑宽度没有换成下拉');
  }
  // 紧凑宽度不该再把 7 个按钮排成两行
  const compactButtons = compact.filter((n) => String(n.className ?? '') === 'ilb-nav-btn');
  if (compactButtons.length > 3) throw new Error(`紧凑宽度仍画了 ${compactButtons.length} 个导航按钮`);
  // 下拉的 option 值必须是真 id：值退化成文字时，<select> 选了也切不动页面
  const navSelect = compact.find((n) => String(n.className ?? '').includes('ilb-nav-select'));
  const optionValues = (navSelect.children ?? []).map((n) => String(n.value ?? ''));
  if (!optionValues.includes('logic') || !optionValues.includes('rules')) {
    throw new Error(`导航下拉的 option 值不是页面 id：${optionValues.join(' / ')}`);
  }
  navSelect.value = 'logic';
  navSelect.dispatch('change');
  if (!String(walk(host).map((n) => String(n.textContent ?? '')).join('')).includes('逻辑')) {
    throw new Error('在下拉里选了「逻辑」但没有切过去');
  }
  p.setTab('rules');

  layoutNow = 'mobile';
  p.render();
  const mobileNav = walk(host).find((n) => String(n.className ?? '') === 'ilb-m-nav');
  if (!mobileNav) throw new Error('手机上找不到底部四个入口');
  const entries = mobileNav.children.map((n) => walk(n).map((x) => String(x.textContent ?? '')).join(''));
  const must = ['书架', '规则', '逻辑', '更多'];
  for (const label of must) {
    if (!entries.some((e) => e.includes(label))) throw new Error(`手机底部缺少「${label}」`);
  }
  if (entries.length !== 4) throw new Error(`手机底部入口有 ${entries.length} 个（应为 4 个）`);
});

step('统一书籍上下文：没选书就不偷偷选第一本', () => {
  const { panel: p, host } = makePanelWith(() => 'desktop', () => 'standard');
  p.setTab('rules');
  const text = walk(host).map((n) => String(n.textContent ?? '')).join(' ');
  if (!text.includes('还没有选择书籍')) throw new Error('没选书时规则页没有给出提示');
  if (text.includes('王城')) throw new Error('没选书却把第一本书的规则画出来了');

  p.state.activeBookId = 'book-t';
  p.render();
  const picked = walk(host).map((n) => String(n.textContent ?? '')).join(' ');
  if (!picked.includes('王城')) throw new Error('选了书之后规则没有画出来');
  if (!picked.includes('2 条规则')) throw new Error('书籍上下文没有显示规则数量');
});

step('规则页：勾选框与批量栏只在选择模式出现，次要操作收进「⋯」', () => {
  const { panel: p, host } = makePanelWith(() => 'desktop', () => 'standard');
  p.setTab('rules');
  p.state.activeBookId = 'book-t';
  p.render();
  let all = walk(host);
  if (all.some((n) => String(n.className ?? '').includes('ilb-batchbar'))) {
    throw new Error('没进选择模式就出现了批量栏');
  }
  if (!all.some((n) => String(n.className ?? '') === 'ilb-more')) {
    throw new Error('卡片上没有「⋯」菜单');
  }
  // 卡片上直接可见的按钮只留「编辑」；「往前排 / 复制 / 删除」只能在「⋯」菜单里（菜单默认关闭）。
  const actionRows = all.filter((n) => String(n.className ?? '').trim() === 'ilb-actions');
  const visibleBtns = actionRows.flatMap((row) => walk(row).filter((n) => String(n.className ?? '').includes('ilb-btn')));
  for (const label of ['往前排', '往后排', '复制一条', '删除']) {
    if (visibleBtns.some((b) => b.textContent === label)) throw new Error(`「${label}」还画在卡片上，应该收进「⋯」`);
  }
  // v0.22.0：试一句留在卡片外面（常用），编辑也留在外面
  for (const label of ['编辑', '试一句']) {
    if (!visibleBtns.some((b) => b.textContent === label)) throw new Error(`卡片上应该能看到「${label}」`);
  }
  const menus = all.filter((n) => String(n.className ?? '') === 'ilb-menu');
  if (menus.length === 0) throw new Error('没有「⋯」菜单');
  if (!menus.some((m) => walk(m).some((n) => n.textContent === '删除'))) {
    throw new Error('「⋯」菜单里没有删除');
  }

  p.state.ruleSelectMode = true;
  p.render();
  all = walk(host);
  if (!all.some((n) => String(n.className ?? '').includes('ilb-batchbar'))) {
    throw new Error('进了选择模式却没有批量栏');
  }
  const checks = all.filter((n) => String(n.className ?? '') === 'ilb-check');
  if (checks.length === 0) throw new Error('选择模式下卡片上没有勾选框');
  p.state.ruleSelectMode = false;
  p.state.selected.clear();
});

step('未保存守卫：切页先问，选「放弃修改」才真的切', () => {
  const { panel: p, host } = makePanelWith(() => 'desktop', () => 'standard');
  p.setTab('rules');
  p.state.activeBookId = 'book-t';
  p.render();
  const book = repository.getBook('book-t');
  p.openEditor(book, book.entries[0]);

  const editor = walk(body).find((n) => String(n.className ?? '') === 'ilb-editor');
  if (!editor) throw new Error('编辑器没打开');
  // 改一下就算"脏"了
  editor.dispatch('input');
  p.setTab('shelf');
  if (p.state.activeTab !== 'rules') throw new Error('有未保存修改时不该直接切走');
  const box = walk(body).find((n) => String(n.className ?? '') === 'ilb-guard');
  if (!box) throw new Error('没有弹「有未保存的修改」');
  const boxText = walk(box).map((n) => String(n.textContent ?? '')).join(' ');
  for (const must of ['保存并离开', '放弃修改', '继续编辑']) {
    if (!boxText.includes(must)) throw new Error(`确认层缺少「${must}」`);
  }
  // 用按钮本身点：说明文字里也含有「放弃修改」几个字，按文本找会点到段落上。
  const giveUp = walk(box).find((n) => String(n.className ?? '').includes('ilb-btn') && n.textContent === '放弃修改');
  if (!giveUp) throw new Error('找不到「放弃修改」按钮');
  giveUp.dispatch('click');
  if (p.state.activeTab !== 'shelf') throw new Error('选了「放弃修改」之后没有切页');
  if (walk(body).some((n) => String(n.className ?? '') === 'ilb-guard')) {
    throw new Error('选完之后确认层还挂着');
  }
});

step('未保存守卫：点编辑器右上角 × 不会绕过确认', () => {
  const { panel: p } = makePanelWith(() => 'desktop', () => 'standard');
  p.setTab('rules');
  p.state.activeBookId = 'book-t';
  p.render();
  const book = repository.getBook('book-t');
  p.openEditor(book, book.entries[1]);
  const editor = walk(body).find((n) => String(n.className ?? '') === 'ilb-editor');
  editor.dispatch('input');
  const x = walk(body).find((n) => String(n.className ?? '') === 'ilb-modal-x');
  x.dispatch('click');
  if (!walk(body).some((n) => String(n.className ?? '') === 'ilb-editor')) {
    throw new Error('点了 × 就把编辑器关了（改动会丢）');
  }
  if (!walk(body).some((n) => String(n.className ?? '') === 'ilb-guard')) {
    throw new Error('点了 × 没有问「有未保存的修改」');
  }
  clickText(body, '保存并离开');
  if (walk(body).some((n) => String(n.className ?? '') === 'ilb-editor')) {
    throw new Error('选了「保存并离开」之后编辑器还开着');
  }
});

step('宽屏流程编辑：左大纲 / 中分支树 / 右属性，点一步就选中', () => {
  const { panel: p } = makePanelWith(() => 'desktop', () => 'wide');
  p.setTab('rules');
  p.state.activeBookId = 'book-t';
  p.render();
  const book = repository.getBook('book-t');
  const entry = {
    ...JSON.parse(JSON.stringify(book.entries[0])),
    id: 'e-wide',
    logic: {
      mode: 'edit',
      nodes: [
        { kind: 'test', id: 'n1', condition: { what: 'keyword', text: '王城' } },
        { kind: 'compare', id: 'n2', left: { type: 'number', value: 1 }, op: '>=', right: { type: 'number', value: 1 } },
      ],
    },
  };
  const wideBook = { ...book, entries: [entry] };
  p.openEditor(wideBook, entry);
  const editorCols = walk(body).find((n) => String(n.className ?? '').includes('ilb-editor-cols'));
  if (!editorCols) throw new Error('宽屏编辑规则没有分成两栏');
  const summary = walk(editorCols).find((n) => String(n.className ?? '') === 'ilb-editor-summary');
  const summaryText = summary ? walk(summary).map((n) => String(n.textContent ?? '')).join(' ') : '';
  if (!summaryText.includes('这条规则的样子')) throw new Error('宽屏右侧没有摘要');
  if (!summaryText.includes('流程：')) throw new Error('摘要里没有流程概况');
  clickText(body, '编辑流程');

  const ws = walk(body).find((n) => String(n.className ?? '').includes('ilb-flow-workspace'));
  if (!ws) throw new Error('宽屏没有出现三栏布局');
  const cols = ws.children.map((n) => String(n.className ?? ''));
  for (const must of ['ilb-flow-outline', 'ilb-flow-canvas', 'ilb-flow-props']) {
    if (!cols.some((c) => c.includes(must))) throw new Error(`三栏里缺少 ${must}`);
  }
  const outline = walk(ws).filter((n) => String(n.className ?? '').includes('ilb-flow-outline-item'));
  if (outline.length < 2) throw new Error(`大纲只列出 ${outline.length} 步`);
  const propsText = () => {
    const props = walk(ws).filter((n) => String(n.className ?? '').includes('ilb-flow-props'));
    return props.flatMap((n) => walk(n)).map((n) => String(n.textContent ?? '')).join(' ');
  };
  if (!propsText().includes('先在左边')) throw new Error('没选中时右栏没有说明');

  outline[1].dispatch('click');
  const ws2 = walk(body).find((n) => String(n.className ?? '').includes('ilb-flow-workspace'));
  if (!walk(ws2).some((n) => String(n.className ?? '').includes('ilb-flow-node-selected'))) {
    throw new Error('点了大纲里的步骤，中间没有选中标记');
  }
  const props = walk(ws2).find((n) => String(n.className ?? '') === 'ilb-flow-props');
  const pickedText = props ? walk(props).map((n) => String(n.textContent ?? '')).join(' ') : '';
  if (!props || !pickedText.includes('第 2 步')) {
    throw new Error(`右栏没有显示选中步骤的属性（${pickedText.slice(0, 40)}）`);
  }
  // 中间的卡片在宽屏只画结构，参数表单只在右栏出现一次（避免两处同时改同一步）
  const bodies = walk(ws2).filter((n) => String(n.className ?? '') === 'ilb-flow-body');
  if (bodies.length !== 1) throw new Error(`宽屏里参数表单出现了 ${bodies.length} 次（应只在右栏）`);
  clickText(body, '取消');
  if (walk(body).some((n) => String(n.className ?? '') === 'ilb-editor')) {
    throw new Error('取消之后编辑器还开着');
  }
});

step('流程表单：随机选有权重、调用有参数与返回值', () => {
  const { panel: p } = makePanelWith(() => 'desktop', () => 'standard');
  p.setTab('rules');
  p.state.activeBookId = 'book-t';
  p.render();
  const book = repository.getBook('book-t');
  const entry = {
    ...JSON.parse(JSON.stringify(book.entries[0])),
    id: 'e-p4',
    logic: {
      mode: 'edit',
      nodes: [
        { kind: 'choose', id: 'c1', candidates: ['甲', '乙'], weights: [3, 1], target: '签' },
        {
          kind: 'call',
          id: 'k1',
          logicId: 'b1::L::l1',
          args: [{ name: 'hp', value: { type: 'number', value: 5 } }],
          returns: [{ name: 'gold', target: '钱' }],
          persist: true,
        },
      ],
    },
  };
  p.openEditor({ ...book, entries: [entry] }, entry);
  clickText(body, '编辑流程');

  const weightRow = walk(body).find((n) => String(n.className ?? '').includes('ilb-flow-weights'));
  if (!weightRow) throw new Error('随机选没有权重输入');
  const weightInputs = walk(weightRow).filter((n) => String(n.tagName ?? '').toLowerCase() === 'input');
  if (weightInputs.length !== 2) throw new Error(`权重输入有 ${weightInputs.length} 个（应与 2 条候选一一对应）`);
  if (weightInputs[0].value !== '3' && weightInputs[0].value !== 3) throw new Error(`第一条权重显示成了 ${weightInputs[0].value}`);

  const argRows = walk(body).filter((n) => String(n.className ?? '').includes('ilb-call-arg'));
  if (argRows.length !== 1) throw new Error(`参数行有 ${argRows.length} 行（应为 1）`);
  const returnRows = walk(body).filter((n) => String(n.className ?? '').includes('ilb-call-return'));
  if (returnRows.length !== 1) throw new Error(`返回值行有 ${returnRows.length} 行（应为 1）`);
  if (!walk(body).some((n) => String(n.textContent ?? '').includes('返回值也写进这张聊天'))) {
    throw new Error('有返回值时没有「写进聊天」的选项');
  }
  if (!walk(body).some((n) => String(n.textContent ?? '').includes('参数算不出来'))) {
    throw new Error('没有说明参数算不出来会怎样');
  }
  clickText(body, '取消');
});

step('流程表单：列表变量、按列表循环、分支选择都能编辑', () => {
  const { panel: p } = makePanelWith(() => 'desktop', () => 'standard');
  p.setTab('rules');
  p.state.activeBookId = 'book-t';
  p.render();
  const book = repository.getBook('book-t');
  const entry = {
    ...JSON.parse(JSON.stringify(book.entries[0])),
    id: 'e-p4b',
    logic: {
      mode: 'edit',
      nodes: [
        { kind: 'list', id: 'l1', name: '名单', op: 'set', value: { type: 'text', value: 'a,b' }, separator: ',' },
        { kind: 'repeat', id: 'r1', mode: 'list', listName: '名单', itemName: '项', body: [] },
        {
          kind: 'switch',
          id: 'sw1',
          value: { type: 'var', name: '结果' },
          cases: [
            { id: 'c1', match: { type: 'text', value: 'a' }, body: [] },
            { id: 'c2', match: { type: 'text', value: 'b' }, body: [] },
          ],
          else: [],
        },
      ],
    },
  };
  p.openEditor({ ...book, entries: [entry] }, entry);
  clickText(body, '编辑流程');

  const caseRows = () => walk(body).filter((n) => String(n.className ?? '').includes('ilb-flow-case'));
  if (caseRows().length !== 2) throw new Error(`分支行有 ${caseRows().length} 条（应为 2）`);
  if (!walk(body).some((n) => String(n.textContent ?? '').includes('按列表，每项做一遍'))) {
    throw new Error('重复那一步没有「按列表」的选项');
  }
  if (!walk(body).some((n) => String(n.textContent ?? '').includes('最多 8 条分支'))) {
    throw new Error('分支选择没有说明条数上限');
  }
  clickText(body, '＋ 加一条分支');
  if (caseRows().length !== 3) throw new Error(`点「加一条分支」之后是 ${caseRows().length} 条（应为 3）`);
  const sep = walk(body).find((n) => String(n.tagName ?? '').toLowerCase() === 'input' && String(n.value ?? '') === ',');
  if (!sep) throw new Error('列表变量没有显示分隔符');
  clickText(body, '取消');
});

step('手机：顶部不再显示视口尺寸，二级页关闭会先问它自己', () => {
  const { createMobileUi } = mobileModule;
  const ui = createMobileUi({ repository, notify: () => {} });
  ui.mount();
  ui.open();
  // v0.22.0：顶部只留标题 + 关闭，副标题（含视口尺寸）整行删掉
  const sub = walk(ui.dialog).find((n) => String(n.className ?? '') === 'ilb-m-sub');
  if (sub) throw new Error(`顶部副标题应该删掉，却还在：${sub.textContent}`);
  const head = walk(ui.dialog).find((n) => String(n.className ?? '') === 'ilb-m-head');
  if (!head) throw new Error('找不到手机头部');
  // 底栏必须在滚动区外面：nav 的祖先里不能有 .ilb-m-stage
  const nav = walk(ui.dialog).find((n) => String(n.className ?? '').includes('ilb-m-nav'));
  if (!nav) throw new Error('手机底栏没画出来');
  let anc = nav.parentNode;
  while (anc) {
    if (String(anc.className ?? '').includes('ilb-m-stage')) throw new Error('底栏还画在滚动区里，会跟着内容上下浮');
    anc = anc.parentNode;
  }
  let blocked = 0;
  ui.openOverlay({
    title: '有未保存修改的层',
    nodes: [makeElement('p')],
    onBeforeClose: () => {
      blocked += 1;
      return false;
    },
  });
  ui.closeOverlay();
  if (blocked !== 1) throw new Error('关二级页时没有问 onBeforeClose');
  if (!ui.isOverlayOpen()) throw new Error('onBeforeClose 说别关，二级页却被关掉了');
  ui.clearOverlays();
  ui.close();
});

step('手机：顶部操作区默认收起、能展开排序；底栏挂在滚动区外；手动排序有权重输入框', () => {
  const navHost = makeElement('div');
  const p = createPanel({
    repository,
    nativeWorlds,
    pipeline,
    notify: (msg, kind) => notes.push(`${kind}:${msg}`),
    getLayout: () => 'mobile',
    getDensity: () => 'compact',
    getNavRoot: () => navHost,
  });
  const host = makeElement('div');
  host.appendChild(p.element);
  p.state.activeTab = 'rules';
  p.state.activeBookId = 'book-t';
  p.render();

  const cls = (n) => String(n.className ?? '');
  let all = walk(host);
  const top = all.find((n) => cls(n) === 'ilb-m-chips');
  if (!top) throw new Error('手机上没有顶部常驻操作区');
  const rows = all.filter((n) => cls(n) === 'ilb-m-top-row');
  if (rows.length < 3) throw new Error(`顶部操作区只有 ${rows.length} 组`);
  if (rows.some((r) => r.hidden !== true)) throw new Error('顶部操作区不是默认收起');

  const chip = all.find((n) => cls(n) === 'ilb-m-chip' && walk(n).some((x) => x.textContent === '排序'));
  if (!chip) throw new Error('没有「排序」展开按钮');
  chip.dispatch('click');
  all = walk(host);
  const shown = all.filter((n) => cls(n) === 'ilb-m-top-row' && n.hidden !== true);
  if (shown.length !== 1) throw new Error(`点开排序后应该有 1 组展开，实际 ${shown.length}`);
  if (!walk(shown[0]).some((n) => cls(n).includes('ilb-sort-key'))) throw new Error('排序组里没有排序键下拉');

  // 再点同一个按钮要能收起（之前内联与委托各改一半，收起时被委托又展开）
  chip.dispatch('click');
  all = walk(host);
  const afterSecond = all.filter((n) => cls(n) === 'ilb-m-top-row' && n.hidden !== true);
  if (afterSecond.length !== 0) throw new Error(`再点一次应全部收起，实际还有 ${afterSecond.length} 组展开`);

  // 点开 A 再点 B：只留 B
  chip.dispatch('click');
  const filterChip = walk(host).find((n) => cls(n) === 'ilb-m-chip' && walk(n).some((x) => x.textContent === '筛选'));
  if (!filterChip) throw new Error('没有「筛选」展开按钮');
  filterChip.dispatch('click');
  const onlyFilter = walk(host).filter((n) => cls(n) === 'ilb-m-top-row' && n.hidden !== true);
  if (onlyFilter.length !== 1) throw new Error(`切到筛选后应只剩 1 组，实际 ${onlyFilter.length}`);
  if (!walk(onlyFilter[0]).some((n) => cls(n).includes('ilb-m-filter'))) throw new Error('留下的不是筛选组');

  // 手动排序：卡片上要出现权重输入框
  p.state.listSort.rules = { key: 'manual', dir: 'desc' };
  p.render();
  const weights = walk(host).filter((n) => cls(n).includes('ilb-sort-weight'));
  if (weights.length === 0) throw new Error('手动排序时卡片上没有排序权重输入框；inputs='+JSON.stringify(walk(host).filter(n=>String(n.tagName||'').toLowerCase()==='input').map(n=>String(n.className))));

  // 底栏必须挂在 navHost（滚动区外），不在面板树里
  if (!walk(navHost).some((n) => cls(n) === 'ilb-m-nav')) throw new Error('底栏没有挂到 navHost');
  if (walk(host).some((n) => cls(n) === 'ilb-m-nav')) throw new Error('底栏还画在面板里');

  // 顶部折叠条整体收起（v0.24.0）：chips 消失、再展开回来
  p.toggleTopFold(true);
  if (walk(host).some((n) => cls(n) === 'ilb-m-chips')) throw new Error('收起后折叠条还在');
  if (walk(host).some((n) => cls(n) === 'ilb-m-top-row' && n.hidden !== true)) throw new Error('收起后还有展开的行');
  p.toggleTopFold(false);
  if (!walk(host).some((n) => cls(n) === 'ilb-m-chips')) throw new Error('再展开后折叠条没回来');
});

console.log(`\n界面冒烟：失败 ${failures} 个；toast 记录 ${notes.length} 条`);
if (notes.length) console.log(notes.slice(0, 8).join('\n'));
if (unhandled.length > 0) {
  failures += unhandled.length;
  console.log(`未处理的异步错误 ${unhandled.length} 个（在浏览器里会显示成红字）：`);
  unhandled.slice(0, 3).forEach((e) => console.log(`  ${e && (e.message || e)}`));
}
process.exitCode = failures > 0 ? 1 : 0;
