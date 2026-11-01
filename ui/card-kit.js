/**
 * 卡片里的小零件：让「规则」「逻辑」「世界书」三处详情长得一样。
 *
 * 这里的约定（也是 docs/组件设计清单.md 里那条）：
 * - 一行一个设置，标签靠左、控件靠右，别让标签和控件各占一行；
 * - 两列网格，窄了自动变单列；
 * - 只做展示与布局，不碰数据。
 */
import { el, checkbox } from './widgets.js';

/** 一行设置：左边标签，右边控件。 */
export function settingRow(label, control) {
  return el('div', { class: 'ilb-set-row' }, [
    el('span', { class: 'ilb-set-label', text: label }),
    el('div', { class: 'ilb-set-control' }, [control].flat().filter(Boolean)),
  ]);
}

/** 两列网格：rows 是 `{ label, control }` 或 `[label, control]`。 */
export function settingsGrid(rows) {
  const items = (rows ?? []).map((row) => {
    if (Array.isArray(row)) return settingRow(row[0], row[1]);
    return settingRow(row.label, row.control);
  });
  return el('div', { class: 'ilb-set-grid' }, items);
}

/** 一行低视觉权重的元数据（来源、指纹、时间之类）。 */
export function metaLineText(text) {
  return el('div', { class: 'ilb-book-meta', text });
}

/** 卡片上常用的小开关：复选框 + 一句状态文字。 */
export function inlineSwitch(checked, onChange, label) {
  return el('label', { class: 'ilb-inline ilb-switch' }, [
    checkbox(checked, onChange, label),
    el('span', { class: 'ilb-sub', text: checked ? '已启用' : '已停用' }),
  ]);
}

/** 详情区的操作行（导出/复制/删除之类），和卡片主体的按钮分开。 */
export function detailActions(children) {
  return el('div', { class: 'ilb-set-actions' }, children.filter(Boolean));
}
