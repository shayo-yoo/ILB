// ui/widgets.js —— 界面小零件（只造 DOM，不碰数据）
// 四个视图共用这些；改样式只改 style.css，不在视图里写颜色和尺寸。

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'style' && value && typeof value === 'object') node.style = Object.assign(node.style ?? {}, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of [].concat(children)) {
    if (child === undefined || child === null || child === false) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function option(value, label, selected) {
  return el('option', { value, ...(selected ? { selected: true } : {}) }, [label]);
}

export function button(label, onClick, opts = {}) {
  const { ghost = false, primary = false, title, disabled = false } = opts;
  const cls = ['ilb-btn', ghost ? 'ilb-btn-ghost' : '', primary ? 'ilb-btn-primary' : ''].filter(Boolean).join(' ');
  return el('button', { class: cls, text: label, title, ...(disabled ? { disabled: true } : {}), onclick: onClick });
}

export function checkbox(checked, onChange, title) {
  return el('input', {
    type: 'checkbox',
    class: 'ilb-check',
    title,
    ...(checked ? { checked: true } : {}),
    onchange: (event) => onChange(event.target.checked),
  });
}

export function field(labelText, control, hintText) {
  return el('label', { class: 'ilb-field' }, [
    el('span', { text: labelText }),
    control,
    hintText ? el('small', { class: 'ilb-sub', text: hintText }) : null,
  ]);
}

export function badge(text, kind = '') {
  return el('span', { class: `ilb-badge ${kind ? `ilb-badge-${kind}` : ''}`.trim(), text });
}

export function toolbar(children) {
  return el('div', { class: 'ilb-toolbar' }, children);
}

export function filterBar(children) {
  return el('div', { class: 'ilb-filterbar' }, children);
}

export function hint(text) {
  return el('p', { class: 'ilb-hint', text });
}

export function emptyText(text) {
  return el('p', { class: 'ilb-empty', text });
}

export function counter(text) {
  return el('span', { class: 'ilb-counter', text });
}

export function card(children, extraClass = '') {
  return el('article', { class: `ilb-card ${extraClass}`.trim() }, children);
}

/**
 * 搜索框：输入停下来才筛（250ms），避免"每按一个键就重画、键盘跟着收起"。
 * key 用来在重画后把焦点与光标还回同一个搜索框（见 focusSearch）。
 */
export function searchInput(value, placeholder, onInput, opts = {}) {
  const key = opts.key || placeholder;
  let timer = 0;
  return el('input', {
    class: 'ilb-input ilb-search',
    type: 'search',
    value: value ?? '',
    placeholder,
    'data-search-key': key,
    oninput: (event) => {
      // 中文输入法组合期间不筛：候选还没落字，筛了也白筛，还会打断输入。
      if (event.isComposing) return;
      const next = event.target.value;
      clearTimeout(timer);
      timer = setTimeout(() => onInput(next), 250);
    },
    onkeydown: (event) => {
      if (event.key === 'Enter') {
        clearTimeout(timer);
        onInput(event.target.value);
      }
    },
  });
}

/** 重画之后把焦点还回搜索框，并把光标放到末尾。 */
export function focusSearch(key) {
  try {
    const node = document.querySelector(`.ilb-search[data-search-key="${key}"]`);
    if (!node) return;
    node.focus();
    const end = String(node.value ?? '').length;
    node.setSelectionRange?.(end, end);
  } catch {
    /* 没有 document 或桩不支持时忽略 */
  }
}

export function selectBox(value, items, onChange, cls = 'ilb-select') {
  return el('select', { class: cls, onchange: (event) => onChange(event.target.value) },
    items.map((item) => option(item.value, item.label, String(item.value) === String(value))));
}

export function actionRow(children) {
  return el('div', { class: 'ilb-actions' }, children);
}

export function metaLine(children) {
  return el('div', { class: 'ilb-meta' }, children);
}

export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
