// ui/selftest.js —— 一键自检。
// 起因：用户报告"点按钮没有界面弹出"。这种情况下最缺的不是推测，而是事实：
// 样式有没有加载、浮层能不能开、宿主有没有接上。把这些做成一个按钮，
// 用户点一下就能把"到底哪一环断了"复制给我，比来回猜快得多。
//
// v0.5.0：手机界面不再是"同一套 DOM 的手机变体"，而是 ui/mobile.js 的 <dialog>。
// 所以自检也要分两条路量：电脑量 .ilb-overlay，手机量 dialog.ilb-m。
// 不这样做的话，手机上自检会拿 .ilb-overlay 去量一个根本没用的节点，报出一串假失败。

import { openOverlay, closeOverlay } from './help.js';
import { el } from './dom.js';
import { mobileSkinInfo } from './mobile-skin.js';

/**
 * 跑一组只读检查。不写存档、不改设置、失败不抛。
 * @returns {Array<{ok:boolean, text:string}>}
 */
export function runSelfTest() {
  const lines = [];
  const add = (ok, text) => lines.push({ ok, text });

  // 0) 现在是哪套界面。手机和电脑的检查项不一样，先问清楚再量。
  let ui = null;
  try {
    ui = globalThis.ILB?.describeUi?.() ?? null;
  } catch {
    /* ignore */
  }
  const isMobile = ui?.layout === 'mobile';
  add(Boolean(ui), ui ? `当前界面：${ui.label}（${isMobile ? '手机' : '电脑'}）` : '问不到界面状态（扩展可能还没启动完）');

  // 1) 样式表是否真的加载了（电脑那套靠 style.css；手机那套自带 skin，见第 1.6 条）
  let links = [];
  try {
    links = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).filter((l) => /style\.css/i.test(l.href ?? ''));
  } catch {
    /* ignore */
  }
  add(links.length > 0, links.length > 0 ? `找到 ${links.length} 个 style.css` : '页面里没有找到 style.css 的 <link>，样式肯定没生效');
  add(links.some((l) => l.sheet), links.some((l) => l.sheet) ? '样式表已解析（能读到规则）' : '样式表没有解析出来（文件缺失或被拦截）');

  // 1.5) 这份样式表里到底有没有 ILB 的规则。
  // "文件在" 和 "规则在" 是两件事：缓存里可能是某个中间版本，或者被合并成了一份空的。
  // 数是数出来的，不是猜的。
  let ruleCount = 0;
  let ruleErr = '';
  try {
    for (const sheet of Array.from(document.styleSheets)) {
      if (!/style\.css/i.test(sheet.href ?? '')) continue;
      const rules = sheet.cssRules;
      for (const rule of Array.from(rules ?? [])) {
        if (rule.selectorText && /\.ilb-/.test(rule.selectorText)) ruleCount += 1;
      }
    }
  } catch (err) {
    ruleErr = err?.message ?? String(err);
  }
  if (ruleErr) add(false, `读样式规则被浏览器拦住了：${ruleErr}`);
  else add(ruleCount > 20, `style.css 里数到 ${ruleCount} 条 .ilb- 规则${ruleCount > 20 ? '' : '（偏少，可能是旧版本或被截断）'}`);

  // 1.6) 手机的样式是 JS 自带的（<style id="ilb-mobile-skin">），不赌 style.css。
  // 这条必须单独报数：手机上就算 style.css 整份没加载，界面也应该照样能看。
  const skin = mobileSkinInfo();
  if (isMobile) {
    add(skin.installed, skin.installed ? `手机皮肤已注入（${skin.rules} 条规则，版本 ${skin.version}）` : '手机皮肤没注入，界面会是一堆没有样式的文字');
  } else {
    add(true, skin.installed ? `手机皮肤也已在位（${skin.rules} 条规则），切到手机布局不会缺样式` : '手机皮肤未注入（电脑布局下不需要；切到手机时会自动注入）');
  }

  // 2) 关键规则是否真的生效：插一个 .ilb-overlay 探针，量它的定位方式
  let cssOk = false;
  try {
    const probe = el('div', { class: 'ilb-overlay', style: 'display:none' });
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    cssOk = cs.position === 'fixed';
    probe.remove();
    add(
      isMobile ? true : cssOk,
      cssOk
        ? '浮层规则生效（position: fixed）'
        : `浮层规则没生效（position: ${cs.position}），可能是缓存了旧 style.css${isMobile ? '；手机界面不依赖它，仅作记录' : ''}`,
    );
  } catch (err) {
    add(false, `量样式时出错：${err?.message ?? err}`);
  }

  // 3) 浮层能不能真的开出来并且铺满屏幕（不透明、有标题、关闭按钮在、没被盖住）
  try {
    openOverlay({ title: '自检', nodes: [el('p', { text: '如果你看到了这层浮层，说明打开浮层这条路是通的。' })] });
    // 两条路选一条量：手机是 dialog.ilb-m，电脑是 .ilb-overlay。
    const layer = document.querySelector('dialog.ilb-m[open]') ?? document.querySelector('.ilb-overlay');
    if (!layer) {
      add(false, isMobile ? '手机界面没能打开（找不到打开的 dialog.ilb-m）' : '浮层没能插进页面');
    } else {
      const r = layer.getBoundingClientRect();
      const full = r.width >= window.innerWidth - 1 && r.height >= window.innerHeight - 1;
      add(full, full ? `浮层已铺满视口（${Math.round(r.width)}×${Math.round(r.height)}）` : `浮层开了但尺寸不对（${Math.round(r.width)}×${Math.round(r.height)}）`);

      const x = layer.querySelector('.ilb-m-x, .ilb-modal-x');
      add(Boolean(x), x ? '关闭按钮存在' : '关闭按钮不存在（样式或结构被改过）');
      if (x) {
        const xr = x.getBoundingClientRect();
        const big = xr.width >= 44 && xr.height >= 44;
        add(big, `关闭按钮热区 ${Math.round(xr.width)}×${Math.round(xr.height)}${big ? '' : '（小于 44×44，手机上不好点）'}`);
      }

      // 3.5) 内容本体有多高。这是用户报的"只有很薄一排"的直接指标，
      // 所以不描述现象、只报数字：高多少、最小高度是多少、哪套布局。
      const content = layer.querySelector('.ilb-m-sheet, .ilb-modal');
      if (content) {
        const mr = content.getBoundingClientRect();
        const mcs = getComputedStyle(content);
        const tall = mr.height >= Math.min(180, window.innerHeight * 0.2);
        add(
          tall,
          `${isMobile ? '二级页' : '弹窗'}高度 ${Math.round(mr.height)}px（最小高度 ${mcs.minHeight || '未设置'}，${ui?.label ?? '布局未知'}）`,
        );
        add(
          Boolean(content.style.minHeight),
          content.style.minHeight ? `已就地固定最小高度 ${content.style.minHeight}` : '没有就地固定最小高度（只靠样式表）',
        );

        // 3.6) "看得见"不等于"尺寸对"。用户报过"不薄了，但点了什么都没显示"：
        // 尺寸全对、位置也对，只是底色是透明的。所以底色也当成一条检查。
        const layerBg = getComputedStyle(layer).backgroundColor;
        const contentBg = getComputedStyle(content).backgroundColor;
        add(!isTransparent(layerBg), `浮层底色 ${layerBg}${isTransparent(layerBg) ? '（透明，等于没开）' : ''}`);
        add(!isTransparent(contentBg), `${isMobile ? '二级页' : '弹窗'}底色 ${contentBg}${isTransparent(contentBg) ? '（透明，等于没显示）' : ''}`);
      }

      // 最容易被忽略的一种坏法：浮层开出来了，但被别的东西盖在上面。
      // 电脑上可能是 ILB 自己的浮窗；手机上是顶层的 dialog，顺便验证它真的在顶层。
      const win = document.querySelector('.ilb-window');
      const winShown = win && getComputedStyle(win).display !== 'none';
      if (winShown) {
        const wz = Number.parseInt(getComputedStyle(win).zIndex || '0', 10) || 0;
        const oz = Number.parseInt(getComputedStyle(layer).zIndex || '0', 10) || 0;
        add(oz > wz, oz > wz ? `浮层层级 ${oz} 高于浮窗 ${wz}` : `浮层层级 ${oz} 不高于浮窗 ${wz}，会被挡住`);
      } else {
        add(!isMobile, isMobile ? '电脑那套浮窗已让位（手机布局下不参与）' : '电脑浮窗没挂上（不影响浮层，仅作记录）');
      }
      if (typeof document.elementFromPoint === 'function') {
        const hit = document.elementFromPoint(Math.round(window.innerWidth / 2), Math.round(window.innerHeight / 2));
        const top = Boolean(hit) && layer.contains(hit);
        add(top, top ? '屏幕正中那一点，最上层是浮层（没被挡住）' : `屏幕正中那一点被 ${describeNode(hit)} 盖住了`);
      }
    }
    closeOverlay();
  } catch (err) {
    add(false, `打开浮层时抛错：${err?.message ?? err}`);
  }

  // 4) 宿主的接口有没有接上（有扩展对象才算接上）
  const api = globalThis.ILB;
  add(Boolean(api), api ? `扩展已启动 v${api.version}` : '找不到 window.ILB，扩展可能没加载完');
  add(Boolean(api?.pipeline), api?.pipeline ? '判定管线可用' : '判定管线不可用');
  add(Boolean(api?.repository), api?.repository ? '存档端口可用' : '存档端口不可用');

  return lines;
}

/** 把自检结果做成浮层，附一句"可以整段复制给我"。 */
export function showSelfTest() {
  const lines = runSelfTest();
  const bad = lines.filter((l) => !l.ok).length;
  openOverlay({
    title: bad === 0 ? '自检通过' : `自检发现 ${bad} 处问题`,
    nodes: [
      el('p', {
        class: bad === 0 ? 'ilb-hint' : 'ilb-error',
        text:
          bad === 0
            ? '界面和宿主看起来都正常。如果按钮还是没反应，把下面这段和浏览器控制台里 [ILB] 开头的行一起发给我。'
            : '下面打 ✗ 的就是断掉的地方，请整段复制给我。',
      }),
      el('pre', { class: 'ilb-selftest', text: lines.map((l) => `${l.ok ? '✓' : '✗'} ${l.text}`).join('\n') }),
    ],
    wide: true,
  });
  return lines;
}

/** 背景是不是"什么都没有"。透明色在不同浏览器里写法不同，不比较字符串相等。 */
function isTransparent(value) {
  if (!value) return true;
  if (value === 'transparent') return true;
  const m = /rgba?\(([^)]+)\)/.exec(value);
  if (!m) return false;
  const parts = m[1].split(',').map((s) => Number.parseFloat(s.trim()));
  if (parts.length < 3) return false;
  return parts.length === 4 ? !(parts[3] > 0.01) : false;
}

/** 把"盖住浮层的那个东西"描述成人能看懂的样子，便于用户回报。 */
function describeNode(node) {
  if (!node || node.nodeType !== 1) return '未知元素';
  const id = node.id ? `#${node.id}` : '';
  const cls =
    typeof node.className === 'string' && node.className.trim()
      ? `.${node.className.trim().split(/\s+/).slice(0, 3).join('.')}`
      : '';
  let z = '';
  try {
    const cs = getComputedStyle(node);
    if (cs && cs.zIndex && cs.zIndex !== 'auto') z = `（z-index ${cs.zIndex}）`;
  } catch {
    /* ignore */
  }
  return `${node.tagName.toLowerCase()}${id}${cls}${z}`;
}
