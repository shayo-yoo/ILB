// ui/dom.js —— 一点点 DOM 糖。不认识 SillyTavern，也不认识 ILB 的业务。
// 为什么单独拆出来：界面会有好几块（悬浮球、浮窗、设置卡），它们都需要"造元素"，
// 各写一份迟早会不一致；放在这里就只有一份。

function appendChildren(node, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) {
      appendChildren(node, child);
      continue;
    }
    if (typeof child === 'string' || typeof child === 'number') {
      node.appendChild(document.createTextNode(String(child)));
      continue;
    }
    if (child && typeof child === 'object' && typeof child.nodeType === 'number') {
      node.appendChild(child);
    }
  }
}

/**
 * 造一个元素。
 * 认识几个特殊键：class / text / html / style(对象) / dataset(对象) / onXxx(函数)。
 * 其余键一律当成 HTML 属性；值为 true 表示"这个属性存在但没有值"（例如 disabled）。
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = String(value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key === 'dataset' && typeof value === 'object') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  appendChildren(node, children);
  return node;
}

/** 造一个 <option>。selected 为真时带上 selected。 */
export function option(value, label, selected = false) {
  return el('option', { value: String(value), text: String(label), ...(selected ? { selected: true } : {}) });
}

/** 纯文本节点，省得写 document.createTextNode('') */
export function textNode(value) {
  return document.createTextNode(String(value));
}

/** 事件订阅，出错不影响调用方。返回取消订阅函数。 */
export function on(target, type, handler, options) {
  if (!target || typeof target.addEventListener !== 'function') return () => {};
  const wrapped = (...args) => {
    try {
      handler(...args);
    } catch (err) {
      console.error('[ILB] 界面事件出错', err);
    }
  };
  target.addEventListener(type, wrapped, options);
  return () => {
    try {
      target.removeEventListener(type, wrapped, options);
    } catch {
      /* ignore */
    }
  };
}

/** 元素在不在文档里。用来判断挂载是否还有效。 */
export function isAttached(node) {
  return Boolean(node && node.isConnected);
}

/** 到某个祖先为止找元素，找不到返回 null（不用 querySelector 的字符串，省得拼错）。 */
export function closest(node, selector) {
  try {
    return node && node.closest ? node.closest(selector) : null;
  } catch {
    return null;
  }
}
