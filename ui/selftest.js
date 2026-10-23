// ui/selftest.js —— 一键自检。
// 起因：用户报告"点按钮没有界面弹出"。这种情况下最缺的不是推测，而是事实：
// 样式有没有加载、浮层能不能开、宿主有没有接上。把这些做成一个按钮，
// 用户点一下就能把"到底哪一环断了"复制给我，比来回猜快得多。

import { openOverlay, closeOverlay } from './help.js';
import { el } from './dom.js';

/**
 * 跑一组只读检查。不写存档、不改设置、失败不抛。
 * @returns {Array<{ok:boolean, text:string}>}
 */
export function runSelfTest() {
  const lines = [];
  const add = (ok, text) => lines.push({ ok, text });

  // 1) 样式表是否真的加载了
  let links = [];
  try {
    links = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).filter((l) => /style\.css/i.test(l.href ?? ''));
  } catch {
    /* ignore */
  }
  add(links.length > 0, links.length > 0 ? `找到 ${links.length} 个 style.css` : '页面里没有找到 style.css 的 <link>，样式肯定没生效');
  add(links.some((l) => l.sheet), links.some((l) => l.sheet) ? '样式表已解析（能读到规则）' : '样式表没有解析出来（文件缺失或被拦截）');

  // 2) 关键规则是否真的生效：插一个 .ilb-overlay 探针，量它的定位方式
  let cssOk = false;
  try {
    const probe = el('div', { class: 'ilb-overlay', style: 'display:none' });
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    cssOk = cs.position === 'fixed';
    probe.remove();
    add(cssOk, cssOk ? '浮层规则生效（position: fixed）' : `浮层规则没生效（position: ${cs.position}），可能是缓存了旧 style.css`);
  } catch (err) {
    add(false, `量样式时出错：${err?.message ?? err}`);
  }

  // 3) 浮层能不能真的开出来并且铺满屏幕
  try {
    openOverlay({ title: '自检', nodes: [el('p', { text: '如果你看到了这层浮层，说明打开浮层这条路是通的。' })] });
    const overlay = document.querySelector('.ilb-overlay');
    if (!overlay) {
      add(false, '浮层没能插进页面');
    } else {
      const r = overlay.getBoundingClientRect();
      const full = r.width >= window.innerWidth - 1 && r.height >= window.innerHeight - 1;
      add(full, full ? `浮层已铺满视口（${Math.round(r.width)}×${Math.round(r.height)}）` : `浮层开了但尺寸不对（${Math.round(r.width)}×${Math.round(r.height)}）`);
      const x = overlay.querySelector('.ilb-modal-x');
      add(Boolean(x), x ? '关闭按钮存在' : '关闭按钮不存在（样式或结构被改过）');
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
        text: bad === 0 ? '界面和宿主看起来都正常。如果按钮还是没反应，把下面这段和浏览器控制台里 [ILB] 开头的行一起发给我。' : '下面打 ✗ 的就是断掉的地方，请整段复制给我。',
      }),
      el('pre', { class: 'ilb-selftest', text: lines.map((l) => `${l.ok ? '✓' : '✗'} ${l.text}`).join('\n') }),
    ],
    wide: true,
  });
  return lines;
}
