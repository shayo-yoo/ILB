// core/export-native.js —— 纯函数
// ILB 书 → 原生格式。存在理由是可退出性（ILB-3.3.8）：用户必须能随时把书带走。
// 说明：ILB 的条件卡片、连锁开关、书级启用方式在原生格式里没有对应，导出会丢失，
// 因此每个被丢弃的特性都会进 warnings，界面必须显示。

import { deepClone } from './model.js';

const POSITION_TO_NATIVE = { before_char: 0, after_char: 1, in_chat: 4 };
const ROLE_TO_NATIVE = { system: 0, user: 1, assistant: 2 };
const LOGIC_TO_NATIVE = { AND_ANY: 0, NOT_ALL: 1, NOT_ANY: 2, AND_ALL: 3 };

export function exportNativeWorld(book) {
  const warnings = [];
  const entries = {};

  for (const entry of book?.entries ?? []) {
    const uid = entry._source?.uid ?? String(entry.localId ?? entry.id);
    if (entry.when && entry.when.length > 0) {
      warnings.push({ code: 'when-lost', message: `条目「${entry.title}」有条件卡片，原生格式没有对应字段，导出后该条件会丢失`, uid });
    }
    if (entry.chain?.participate === false) {
      warnings.push({ code: 'chain-lost', message: `条目「${entry.title}」关闭了连锁参与，原生格式没有对应字段`, uid });
    }
    if (entry.trigger?.regex?.length) {
      warnings.push({ code: 'regex-lost', message: `条目「${entry.title}」用了正则触发，原生格式没有对应字段`, uid });
    }

    const native = {
      uid: Number.isFinite(Number(uid)) ? Number(uid) : uid,
      key: deepClone(entry.trigger?.any ?? []),
      keysecondary: deepClone(entry.trigger?.secondary?.keys ?? []),
      comment: entry.title ?? '',
      content: entry.content ?? '',
      constant: entry.always === true,
      vectorized: false,
      selective: (entry.trigger?.secondary?.keys ?? []).length > 0,
      selectiveLogic: LOGIC_TO_NATIVE[entry.trigger?.secondary?.logic] ?? 0,
      addMemo: true,
      order: entry.weight ?? 100,
      position: POSITION_TO_NATIVE[entry.injection?.position] ?? 1,
      disable: entry.enabled === false,
      excludeRecursion: entry.chain?.participate === false,
      preventRecursion: entry.chain?.participate === false,
      delayUntilRecursion: 0,
      probability: entry.useProbability ? entry.probability : 100,
      useProbability: entry.useProbability === true,
      depth: entry.injection?.depth ?? 4,
      group: entry.group ?? '',
      groupOverride: false,
      groupWeight: 100,
      scanDepth: entry.scope?.within ?? null,
      caseSensitive: entry.trigger?.matchCase === true,
      matchWholeWords: entry.trigger?.wholeWords === true,
      useGroupScoring: null,
      automationId: '',
      role: ROLE_TO_NATIVE[entry.injection?.role] ?? 0,
      sticky: entry.timed?.sticky ?? 0,
      cooldown: entry.timed?.cooldown ?? 0,
      delay: entry.timed?.delay ?? 0,
    };

    // 把导入时暂存的未知字段还原回去（不覆盖已知字段）
    const unknown = entry._source?.unknown ?? {};
    for (const k of Object.keys(unknown)) {
      if (!(k in native)) native[k] = deepClone(unknown[k]);
    }

    entries[String(uid)] = native;
  }

  return {
    native: { entries },
    warnings,
  };
}
