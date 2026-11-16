// ui/view-snapshots.js —— 快照页（ILB-6.11）
// 快照记的是"这一轮想用哪些条目"，不是"这些条目写了什么"。

import {
  createSnapshot, applySnapshot, describeSnapshot, listNamed, listQuick,
  normalizeAutoSnapshot,
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
  const host = typeof ctx.getHostContext === 'function' ? ctx.getHostContext() : null;
  const chatId = String(ctx.getChatId?.() ?? host?.chatId ?? '').trim();
  const character = host?.character
    ? { avatar: String(host.character.avatar ?? ''), name: String(host.character.name ?? '') }
    : { avatar: '', name: '' };
  const autoConfig = normalizeAutoSnapshot(repository.getAutoSnapshot?.() ?? {});
  const autoIds = new Set(autoConfig.snapshotIds);
  const currentCharacter = character;
  const currentChat = chatId;
  const hasCurrentChat = Boolean(host?.contextAvailable === true && currentChat && currentChat !== 'default');
  const hasCurrentCharacter = Boolean(host?.contextAvailable === true && currentCharacter.avatar);
  if (ctx.state?.snapshotBindingsId) {
    const target = snapshots.find((snapshot) => snapshot.id === ctx.state.snapshotBindingsId);
    if (target) return bindingsPage(target);
    ctx.state.snapshotBindingsId = null;
  }

  function save(name) {
    const books = repository.listBooks();
    if (books.length === 0) {
      ctx.toast('还没有书，先导入或新建一本', 'warn');
      return;
    }
    const snapshot = createSnapshot(books, repository.getManualState(), {
      name, chatId, character,
    });
    repository.saveSnapshot(snapshot);
    ctx.toast(name ? `已保存常用快照「${name}」` : '已保存一份临时快照');
    ctx.render();
  }

  function restore(snapshot) {
    const label = snapshot.name || '临时快照';
    if (!window.confirm(`回到「${label}」？当前的开/关状态会先被自动备份一份，弄错了还能回来。`)) return;
    const books = repository.listBooks();
    const manual = repository.getManualState();
    const backup = createSnapshot(books, manual, {
      name: '', auto: true, note: '恢复前自动备份', chatId, character,
    });
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

  function bindingsPage(snapshot) {
    const bindings = Array.isArray(snapshot.bindings) ? snapshot.bindings.slice() : [];
    const saveBindings = () => {
      repository.updateSnapshotBindings?.(snapshot.id, bindings);
      ctx.render();
    };
    const rows = bindings.map((binding, index) => el('div', { class: 'ilb-card ilb-snapshot-binding-card' }, [
      el('div', { class: 'ilb-snapshot-binding-type', text: binding.type === 'chat' ? '对话' : '角色' }),
      el('div', { class: 'ilb-snapshot-binding-name', text: binding.name || binding.id || binding.avatar || '未命名', title: binding.name || binding.id || binding.avatar || '未命名' }),
      el('div', { class: 'ilb-snapshot-binding-footer' }, [
        button('移除', () => { bindings.splice(index, 1); saveBindings(); }, { ghost: true }),
        el('label', { class: 'ilb-snapshot-binding-toggle' }, [
          el('span', { class: 'ilb-sub', text: '启用' }),
          el('input', { class: 'ilb-snapshot-binding-enabled', type: 'checkbox', checked: binding.enabled !== false, title: '启用此绑定', onchange: (event) => { binding.enabled = event.target.checked; saveBindings(); } }),
        ]),
      ]),
    ]));
    const addCurrentChat = button('添加当前对话', () => {
      if (!hasCurrentChat) { ctx.toast('当前没有打开对话，不能添加对话绑定', 'warn'); return; }
      if (bindings.some((item) => item.type === 'chat' && item.id === currentChat)) return;
      bindings.push({ type: 'chat', id: currentChat, name: currentChat, enabled: true });
      saveBindings();
    }, { ghost: true });
    const addCurrentCharacter = button('添加当前对话角色', () => {
      if (!hasCurrentCharacter) { ctx.toast('当前没有打开对话角色，不能添加角色绑定', 'warn'); return; }
      if (bindings.some((item) => item.type === 'character' && item.avatar === currentCharacter.avatar)) return;
      bindings.push({ type: 'character', avatar: currentCharacter.avatar, name: currentCharacter.name, enabled: true });
      saveBindings();
    }, { ghost: true });
    return el('div', {}, [
      el('div', { class: 'ilb-toolbar' }, [button('返回快照', () => { ctx.state.snapshotBindingsId = null; ctx.render(); }, { ghost: true })]),
      hint('绑定项只读显示名称；右侧复选框控制该绑定是否参与自动快照激活。添加按钮位于顶部“绑定”折叠栏。'),
      rows.length ? el('div', { class: 'ilb-cardlist' }, rows) : emptyText('还没有绑定对话或角色卡。'),
    ]);
  }

  function row(snapshot) {
    const badges = [badge(snapshot.name ? '常用' : '临时', snapshot.name ? 'ok' : '')];
    if (snapshot.auto) badges.push(badge('自动备份'));
    if (autoIds.has(String(snapshot.id))) badges.push(badge(`自动·${autoConfig.mode === 'only' ? '仅激活' : '正常激活'}`, 'ok'));
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
        button('绑定设置', () => { ctx.state.snapshotBindingsId = snapshot.id; ctx.render(); }, { ghost: true }),
      ]),
    ], 'ilb-snapshot-card');
  }

  const autoMode = el('select', { class: 'ilb-select' }, [
    el('option', { value: 'normal', text: '正常激活：保留其他世界书' }),
    el('option', { value: 'only', text: '仅激活：临时关闭其他世界书' }),
  ]);
  autoMode.value = autoConfig.mode;
  const autoToggle = el('input', { type: 'checkbox', checked: autoConfig.enabled, class: 'ilb-check' });
  const autoApply = () => {
    const ids = [...autoIds];
    repository.saveAutoSnapshot({ enabled: autoToggle.checked, mode: autoMode.value, snapshotIds: ids });
    ctx.toast(autoToggle.checked ? `已启用自动快照（${autoMode.value === 'only' ? '仅激活' : '正常激活'}）` : '已关闭自动快照');
    ctx.render();
  };

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
    el('div', { class: 'ilb-settings-row' }, [
      el('label', { class: 'ilb-inline' }, [autoToggle, el('span', { class: 'ilb-sub', text: '启用自动激活快照' })]),
      autoMode,
      button('应用自动设置', autoApply, { ghost: true }),
    ]),
    hint('快照数量不设上限。保存的快照会记录当前聊天和角色卡，可在自动设置中选择匹配的快照。'),
    hint('快照只记「哪些条目开着、哪几本书在场」。它不会改正文和触发词，所以在两个风格之间来回切是安全的。'),

    el('h4', { text: `常用快照（${named.length}）` }),
    named.length === 0 ? emptyText('还没有常用快照。在上面输入名字再点「保存当前状态」。') : el('div', { class: 'ilb-cardlist' }, named.map(row)),

    el('h4', { text: `临时快照（${quick.length}）` }),
    quick.length === 0 ? emptyText('还没有临时快照。不填名字直接保存，就会存在这里。') : el('div', { class: 'ilb-cardlist' }, quick.map(row)),
  ]);
}
