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

let failures = 0;
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

for (const tab of ['shelf', 'rules', 'snapshots', 'diagnostics', 'settings']) {
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
  const node = findByText(rootEl, text);
  if (!node) throw new Error(`找不到按钮：${text}`);
  const handlers = node._listeners?.click ?? [];
  if (handlers.length === 0) throw new Error(`「${text}」没有绑定点击事件`);
  for (const handler of handlers) {
    handler({ type: 'click', target: node, currentTarget: node, preventDefault() {}, stopPropagation() {} });
  }
  return node;
}

step('规则编辑器里展开流程编辑器并加一个节点', () => {
  const book = repository.getBook('book-t');
  panel.openEditor(book, book.entries[0]);
  clickText(body, '编辑流程');
  clickText(body, '＋ 添加一步');
  clickText(body, '＋ 添加一步');
  const kinds = walk(body).filter((n) => n.className && String(n.className).includes('ilb-flow-kind'));
  if (kinds.length < 2) throw new Error('流程节点没有画出来');
});

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


console.log(`\n界面冒烟：失败 ${failures} 个；toast 记录 ${notes.length} 条`);
if (notes.length) console.log(notes.slice(0, 8).join('\n'));
process.exitCode = failures > 0 ? 1 : 0;
