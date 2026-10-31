// adapters/sillytavern-context.js —— 宿主边界（ILB-4.3 / ILB-4.4）
// 唯一知道"酒馆把原生世界书关联存在哪几个字段里"的文件。
// 它只做一件事：把宿主事实读成 core/host-context.js 认识的 HostContext；读不到就写"读不到"，不猜。
//
// 依据（SillyTavern 1.19.0 源码已核对，见 docs/决策记录.md D-0055）：
//   全局      = world-info.js 的 selected_world_info（不能读 world_info.globalSelect，那是拷贝）
//   角色主书   = character.data.extensions.world
//   角色额外书 = world_info.charLore[{name, extraBooks}]
//   Persona    = power_user.persona_description_lorebook（ctx.powerUserSettings）
//   Chat       = chat_metadata['world_info']
//   群聊成员   = groups[].members → characters[].data.extensions.world
// 这些字段酒馆没有公开的 getContext() 入口时，明确标记"当前宿主版本不支持自动识别"。

import { normalizeHostContext } from '../core/host-context.js';

export const WORLDINFO_MODULE_CANDIDATES = [
  '../../../world-info.js',
  '/scripts/world-info.js',
  '../../../../scripts/world-info.js',
];

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (v == null || v === '') return [];
  return [v];
}

function str(v) {
  if (v == null) return '';
  return typeof v === 'string' ? v : String(v);
}

function cleanName(v) {
  return str(v).trim();
}

function stemOf(value) {
  const s = cleanName(value);
  if (!s) return '';
  return s.replace(/\.(png|jpg|jpeg|webp)$/i, '');
}

/**
 * @param {object} deps
 *   getContext      —— 宿主提供（host.js 里那个）
 *   importModule    —— 可选，注入用（测试替身）；默认 (p) => import(p)
 *   logger          —— 可选
 */
export function createSillyTavernContext({ getContext, importModule, logger } = {}) {
  const importOne = importModule ?? ((path) => import(/* @vite-ignore */ path));
  let worldInfoModule = null;
  let moduleVia = '';
  let moduleError = '';
  let inited = false;

  async function init() {
    if (inited) return worldInfoModule !== null;
    inited = true;
    for (const path of WORLDINFO_MODULE_CANDIDATES) {
      try {
        const mod = await importOne(path);
        if (mod && (mod.selected_world_info !== undefined || mod.world_info !== undefined)) {
          worldInfoModule = mod;
          moduleVia = path;
          logger?.info?.(`ILB 已接上酒馆世界书模块：${path}`);
          return true;
        }
      } catch (err) {
        moduleError = `${path}: ${err?.message ?? err}`;
      }
    }
    logger?.warn?.(`ILB 读不到酒馆的世界书模块（全局/额外书会标记为"暂不支持"）：${moduleError || '候选路径都不存在'}`);
    return false;
  }

  function characterBooksOf(character, source) {
    const primary = cleanName(character?.data?.extensions?.world ?? character?.extensions?.world);
    const extra = extraBooksOf(character);
    return { primary, extra, source };
  }

  /** world_info.charLore 是按"角色文件名"存的，这里用几种可能的写法去对。 */
  function extraBooksOf(character) {
    if (!worldInfoModule) return [];
    const list = asArray(worldInfoModule.world_info?.charLore);
    if (list.length === 0) return [];
    const candidates = [character?.avatar, stemOf(character?.avatar), character?.name].map(cleanName).filter(Boolean);
    for (const row of list) {
      if (!row || typeof row !== 'object') continue;
      const key = cleanName(row.name);
      if (!key) continue;
      if (candidates.some((c) => c.toLowerCase() === key.toLowerCase())) {
        return asArray(row.extraBooks).map(cleanName).filter(Boolean);
      }
    }
    return [];
  }

  function build() {
    const unsupported = [];
    const warnings = [];
    const sources = [];

    let ctx = null;
    try {
      ctx = getContext?.();
    } catch (err) {
      ctx = null;
      warnings.push({ source: 'getContext', message: `拿不到酒馆上下文：${err?.message ?? err}` });
    }
    if (!ctx || typeof ctx !== 'object') {
      warnings.push({ source: 'getContext', message: '酒馆没有给出上下文（可能还没登录角色）' });
      return normalizeHostContext({ contextAvailable: false, warnings, unsupported: ['global', 'character', 'persona', 'chat'] });
    }

    if (!worldInfoModule) {
      unsupported.push('global', 'character-extra');
      warnings.push({ source: 'world-info', message: '读不到酒馆的世界书模块：全局选择与角色额外书暂不可识别' });
    }

    // ---- 全局 ----
    if (worldInfoModule) {
      const globalNames = asArray(worldInfoModule.selected_world_info).map(cleanName).filter(Boolean);
      for (const name of globalNames) sources.push({ kind: 'global', name });
    }

    // ---- 角色 / 群聊 ----
    const characters = Array.isArray(ctx.characters) ? ctx.characters : [];
    const groupId = ctx.groupId == null || ctx.groupId === '' ? null : str(ctx.groupId);
    let group = { id: groupId, name: '', members: [] };
    let character = { index: null, name: '', avatar: '', primaryWorld: '', additionalWorlds: [] };
    let characterPrimary = '';
    let characterExtra = [];

    if (groupId) {
      const groups = Array.isArray(ctx.groups) ? ctx.groups : [];
      const found = groups.find((g) => g && str(g.id) === groupId) ?? null;
      if (!found) {
        unsupported.push('group-member');
        warnings.push({ source: 'group', message: '当前是群聊，但读不到群成员列表' });
      } else {
        group = { id: groupId, name: cleanName(found.name), members: [] };
        const disabled = new Set(asArray(found.disabled_members).map(str));
        for (const avatar of asArray(found.members)) {
          const key = cleanName(avatar);
          if (!key || disabled.has(key)) continue;
          const idx = characters.findIndex((c) => c && (str(c.avatar) === key || stemOf(c.avatar) === stemOf(key)));
          const memberChar = idx >= 0 ? characters[idx] : null;
          const books = memberChar ? characterBooksOf(memberChar) : { primary: '', extra: [] };
          const member = {
            index: idx >= 0 ? idx : null,
            name: cleanName(memberChar?.name) || stemOf(key),
            avatar: key,
            primaryWorld: books.primary,
            additionalWorlds: books.extra,
          };
          group.members.push(member);
          if (books.primary) sources.push({ kind: 'group-member', name: books.primary, characterName: member.name, characterIndex: member.index });
          for (const name of books.extra) sources.push({ kind: 'group-member', name, characterName: member.name, characterIndex: member.index });
        }
        if (group.members.length === 0) {
          unsupported.push('group-member');
          warnings.push({ source: 'group', message: '群聊里没有可读取的成员角色卡' });
        }
      }
    } else {
      const index = Number(ctx.characterId);
      character = characters[Number.isFinite(index) ? index : -1] ?? null;
      if (!character) {
        warnings.push({ source: 'character', message: '当前还没有选角色（角色相关世界书暂不可识别）' });
      } else {
        const books = characterBooksOf(character);
        characterPrimary = books.primary;
        characterExtra = books.extra;
        character = {
          index,
          name: cleanName(character.name),
          avatar: cleanName(character.avatar),
          primaryWorld: characterPrimary,
          additionalWorlds: characterExtra,
        };
        if (characterPrimary) sources.push({ kind: 'character-primary', name: characterPrimary });
        for (const name of characterExtra) sources.push({ kind: 'character-extra', name });
        if (character.data?.character_book || character.character_book) {
          unsupported.push('character-book');
          warnings.push({ source: 'character', message: '角色卡里带着内嵌 character_book：酒馆导入时会单独生成世界书，请用「导入原生世界书」' });
        }
      }
    }

    // ---- Persona ----
    const personaWorld = cleanName(ctx.powerUserSettings?.persona_description_lorebook);
    if (personaWorld) sources.push({ kind: 'persona', name: personaWorld });

    // ---- Chat ----
    const chatWorlds = asArray(ctx.chatMetadata?.['world_info'] ?? ctx.chat_metadata?.['world_info'])
      .map(cleanName)
      .filter(Boolean);
    for (const name of chatWorlds) sources.push({ kind: 'chat', name });

    return normalizeHostContext({
      contextAvailable: true,
      chatId: str(ctx.chatId ?? ctx.chat_metadata?.chat_id),
      character,
      group,
      personaWorld,
      chatWorlds,
      globalWorlds: worldInfoModule ? asArray(worldInfoModule.selected_world_info).map(cleanName).filter(Boolean) : [],
      sources,
      unsupported,
      warnings,
      updatedAt: Date.now(),
    });
  }

  function read() {
    return build();
  }

  function describe() {
    return {
      moduleLoaded: worldInfoModule !== null,
      via: moduleVia,
      error: moduleError || null,
      supported: worldInfoModule ? ['global', 'character-primary', 'character-extra', 'persona', 'chat', 'group-member'] : ['character-primary', 'persona', 'chat'],
    };
  }

  return { init, read, describe, isAvailable: () => true };
}
