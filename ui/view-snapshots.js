// ui/view-snapshots.js —— 快照页（ILB-6.11）
// 快照记的是"这一轮想用哪些条目"，不是"这些条目写了什么"。

import {
  createSnapshot, applySnapshot, describeSnapshot, listNamed, listQuick,
  NAMED_SNAPSHOT_LIMIT, QUICK_SNAPSHOT_LIMIT,
} from '../core/snapshot.js';
import { el, button, badge, hint, emptyText, card, actionRow, metaLine } from './widgets.js';

export function renderSnapshots(ctx) {
  const { repository } = ctx;
  const snapshots = repository.listSnapshots();
  const named = listNamed(snapshots).sort((a, b) => Number(b.at) - Number(a.at));
  const quick = listQuick(snapshots).sort((a, b) => Number(b.at) - Number(a.at));

  const nameInput = el('input', {
    class: 'ilb-input',
    type: 'text',
    placeholder: '给这份快照起个名字（留空就是临时快照）',
  });

  function save(name) {
    const books = repository.listBooks();
    if (books.length === 0) {
      ctx.toast('还没有书，先导入或新建一本', 'warn');
      return;
    }
    const snapshot = createSnapshot(books, repository.getManualState(), { name });
    repository.saveSnapshot(snapshot);
    ctx.toast(name ? `已保存常用快照「${name}」` : '已保存一份临时快照');
    ctx.render();
  }

  function restore(snapshot) {
    const label = snapshot.name || '临时快照';
    if (!window.confirm(`回到「${label}」？当前的开/关状态会先被自动备份一份，弄错了还能回来。`)) return;
    const books = repository.listBooks();
    const manual = repository.getManualState();
    const backup = createSnapshot(books, manual, { name: '', auto: true, note: '恢复前自动备份' });
    repository.saveSnapshot(backup);

    const result = applySnapshot(snapshot, books, manual);
    for (const book of result.books) repository.saveBook(book);
    for (const [bookId, on] of Object.entries(result.manualState)) repository.setManualState(bookId, on === true);

    const bits = [`已回到「${label}」`, `${result.report.booksTouched} 本书`];
    if (result.report.entriesTouched) bits.push(`开关变化 ${result.report.entriesTouched} 条`);
    if (result.report.missingBooks.length) bits.push(`${result.report.missingBooks.length} 本已不存在`);
    if (result.report.missingEntries) bits.push(`${result.report.missingEntries} 条后来删掉的没恢复`);
    ctx.toast(bits.join(' · '));
    ctx.render();
  }

  function rename(snapshot) {
    const name = window.prompt('改成什么名字？（清空 = 退回临时快照）', snapshot.name ?? '');
    if (name === null) return;
    repository.renameSnapshot(snapshot.id, name);
    ctx.render();
  }

  function remove(snapshot) {
    if (!window.confirm(`删除快照「${snapshot.name || '临时快照'}」？`)) return;
    repository.deleteSnapshot(snapshot.id);
    ctx.render();
  }

  function row(snapshot) {
    const badges = [badge(snapshot.name ? '常用' : '临时', snapshot.name ? 'ok' : '')];
    if (snapshot.auto) badges.push(badge('自动备份'));
    return card([
      el('div', { class: 'ilb-rule-head' }, [
        el('div', { class: 'ilb-rule-titles' }, [
          el('div', { class: 'ilb-title', text: snapshot.name || (snapshot.auto ? '（自动备份）' : '（未命名）') }),
          metaLine([el('span', { class: 'ilb-sub', text: describeSnapshot(snapshot) })]),
        ]),
        el('div', { class: 'ilb-badges' }, badges),
      ]),
      snapshot.note ? el('div', { class: 'ilb-sub', text: snapshot.note }) : null,
      actionRow([
        button('回到这个状态', () => restore(snapshot), { primary: true }),
        button(snapshot.name ? '改名' : '命名', () => rename(snapshot), { ghost: true }),
        button('删除', () => remove(snapshot), { ghost: true }),
      ]),
    ]);
  }

  return el('div', {}, [
    el('div', { class: 'ilb-toolbar' }, [
      nameInput,
      button('保存当前状态', () => {
        const name = nameInput.value.trim();
        nameInput.value = '';
        save(name);
      }, { primary: true }),
      button('保存为临时快照', () => save(''), { ghost: true }),
      button('?', () => ctx.showHelp('snapshots'), { ghost: true, title: '这一页怎么用' }),
    ]),
    hint(`常用快照最多 ${NAMED_SNAPSHOT_LIMIT} 份、临时快照最多 ${QUICK_SNAPSHOT_LIMIT} 份。满了以后，最旧的那份会被新的顶掉。`),
    hint('快照只记「哪些条目开着、哪几本书在场」。它不会改正文和触发词，所以在两个风格之间来回切是安全的。'),

    el('h4', { text: `常用快照（${named.length}）` }),
    named.length === 0 ? emptyText('还没有常用快照。在上面输入名字再点「保存当前状态」。') : el('div', { class: 'ilb-cardlist' }, named.map(row)),

    el('h4', { text: `临时快照（${quick.length}）` }),
    quick.length === 0 ? emptyText('还没有临时快照。不填名字直接保存，就会存在这里。') : el('div', { class: 'ilb-cardlist' }, quick.map(row)),
  ]);
}
