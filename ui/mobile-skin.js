// ui/mobile-skin.js —— 手机界面自带的一套样式（v0.5.0）。
//
// 为什么手机界面不再复用 style.css：
// 从 v0.4.2 到 v0.4.8，四轮修补都在做同一件事——用媒体查询、"两把钥匙"（body.ilb-mobile）、
// 内联兜底、皮肤自愈，去把"给电脑写的那套 UI"掰成手机形状。这条路反复失败，原因也清楚：
// ① 手机 WebView 常常按桌面宽度排版（例如 980px），`@media (max-width: 768px)` 根本不该被信任；
// ② 手机上的可见性还取决于宿主样式表有没有加载、谁把它盖住、底色是不是透明，越兜越复杂。
// 现在的做法：手机界面的样式**不写在 style.css 里**，由这里在运行时注入 <style>。
// 好处是手机界面只依赖自己：style.css 丢了、旧了、被主题覆盖，手机照样是对的。
// 注意：这不是"兜底"，是唯一的一份手机样式——下面这些选择器只属于手机界面（都以 .ilb-m 开头）。

export const MOBILE_SKIN_VERSION = '0.6.2';
export const MOBILE_SKIN_ID = 'ilb-mobile-skin';

// 皮肤只做"手机界面需要的那些事"：
//  - 整屏长在顶层（<dialog> 的 top layer），不跟宿主的 z-index 抢；
//  - 44px 起的点击热区（ILB-6.14.3 / §9.3）；
//  - 刘海与底部手势区留白；
//  - 一切横排容器都允许换行、子元素 min-width:0（ILB-6.10.7 / 7.15：375px 不许横向滚）；
//  - 底色写死不透明（ILB-6.18.1）。
export const MOBILE_SKIN_CSS = `
dialog.ilb-m {
  position: fixed;
  inset: 0;
  margin: 0;
  padding: 0;
  border: 0;
  width: 100%;
  height: 100%;
  max-width: none;
  max-height: none;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background-color: #15151b;
  background-image: linear-gradient(var(--SmartThemeBlurTintColor, rgba(21,21,27,0)), var(--SmartThemeBlurTintColor, rgba(21,21,27,0)));
  color: var(--SmartThemeBodyColor, #eaeaea);
  font-family: var(--SmartThemeFontFamily, system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans SC", sans-serif);
  font-size: 15px;
  line-height: 1.55;
  z-index: 2147483000;
}
dialog.ilb-m:not([open]) { display: none !important; }
dialog.ilb-m::backdrop { background: rgba(0, 0, 0, 0.62); }
dialog.ilb-m * { box-sizing: border-box; }

/* ---- 顶栏 ---- */
.ilb-m-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  padding-top: max(8px, env(safe-area-inset-top));
  background: rgba(255, 255, 255, 0.04);
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}
.ilb-m-head-text { flex: 1 1 auto; min-width: 0; }
.ilb-m-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ilb-m-sub {
  margin: 1px 0 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ilb-m-x,
.ilb-m-back {
  flex: 0 0 auto;
  width: 44px;
  height: 44px;
  min-width: 44px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.08);
  color: inherit;
  font: inherit;
  font-size: 22px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.ilb-m-back[hidden] { display: none !important; }

/* ---- 变量坞（有聊天变量时出现；点一下进「状态」页） ---- */
.ilb-m-dock {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  font-size: 12px;
  line-height: 1.4;
  background: rgba(255, 255, 255, 0.06);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}
.ilb-m-dock[hidden] { display: none !important; }
.ilb-m-dock-tag {
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.8);
}
.ilb-m-dock-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgba(255, 255, 255, 0.82);
}
.ilb-m-dock-open {
  flex: 0 0 auto;
  min-height: 32px;
  padding: 0 10px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.1);
  color: inherit;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.ilb-m-note { margin: 6px 0; font-size: 13px; line-height: 1.5; color: rgba(255, 255, 255, 0.82); }
.ilb-m-pre {
  margin: 6px 0 10px;
  padding: 10px;
  max-height: 40vh;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 12px;
  line-height: 1.5;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.28);
}
.ilb-m-list { margin: 6px 0; padding-left: 18px; font-size: 13px; line-height: 1.6; }

/* ---- 主体：面板一页 + 浮层栈 ---- */
.ilb-m-stage {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.ilb-m-panel {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  padding: 8px 12px;
  padding-bottom: max(20px, env(safe-area-inset-bottom));
}
.ilb-m-sheets {
  position: absolute;
  inset: 0;
  display: none;
  background: #181820;
  z-index: 5;
}
.ilb-m-sheets[data-open="1"] { display: block; }
.ilb-m-sheet {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: #181820;
}
.ilb-m-sheet[hidden] { display: none !important; }
.ilb-m-sheet-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.05);
}
.ilb-m-sheet-title {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ilb-m-sheet-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  padding: 12px;
  padding-bottom: max(20px, env(safe-area-inset-bottom));
}
.ilb-m-sheet-foot {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 12px;
  padding-bottom: max(10px, env(safe-area-inset-bottom));
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.03);
}

/* ---- 悬浮球（手机版：只点不拖） ---- */
.ilb-m-fab {
  position: fixed;
  right: max(12px, env(safe-area-inset-right));
  width: 56px;
  height: 56px;
  min-width: 56px;
  min-height: 56px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background-color: #2b2b36;
  background-image: linear-gradient(var(--SmartThemeBlurTintColor, rgba(43,43,54,0)), var(--SmartThemeBlurTintColor, rgba(43,43,54,0)));
  color: var(--SmartThemeBodyColor, #eaeaea);
  font: inherit;
  font-size: 19px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
  z-index: 2147482999;
  cursor: pointer;
}
.ilb-m-fab[hidden] { display: none !important; }
.ilb-m-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 1px solid rgba(0, 0, 0, 0.45);
  background: #8a8f99;
}
.ilb-m-dot.ilb-m-dot-ok { background: #4caf50; }
.ilb-m-dot.ilb-m-dot-warn { background: #e0a83c; }
.ilb-m-dot.ilb-m-dot-error { background: #e0575f; }

/* ---- 提示条：dialog 在顶层，宿主的 toastr 会被压在下面看不见，所以自带一条 ---- */
.ilb-m-toasts {
  position: fixed;
  left: 0;
  right: 0;
  bottom: max(14px, env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  pointer-events: none;
  z-index: 2147483001;
}
.ilb-m-toast {
  max-width: min(92vw, 560px);
  padding: 9px 13px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: #2b2b35;
  color: #f3f3f6;
  font-size: 13px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
}
.ilb-m-toast-error { background: #4a1f22; border-color: #a2525a; }
.ilb-m-toast-warn { background: #453a1c; border-color: #a08a3c; }
.ilb-m-toast[hidden] { display: none !important; }

/* ---- 面板里的通用控件：手机上重新量一遍（style.css 里那套是给桌面的） ---- */
dialog.ilb-m .ilb-root { display: block; max-width: 100%; }
dialog.ilb-m .ilb-root,
dialog.ilb-m .ilb-m-sheet-body * { min-width: 0; max-width: 100%; }

dialog.ilb-m .ilb-tabs {
  display: flex;
  gap: 6px;
  padding: 2px 0 8px;
  margin: 0 0 6px;
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}
dialog.ilb-m .ilb-tabs::-webkit-scrollbar { display: none; }
dialog.ilb-m .ilb-tab {
  flex: 0 0 auto;
  min-height: 44px;
  padding: 0 14px;
  border-radius: 11px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.06);
  color: inherit;
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}
dialog.ilb-m .ilb-tab-active {
  background: #3a6ea5;
  border-color: #4c86c4;
  color: #fff;
}
dialog.ilb-m .ilb-help {
  flex: 0 0 auto;
  width: 44px;
  height: 44px;
  min-width: 44px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.08);
  color: inherit;
  font: inherit;
  font-size: 16px;
  cursor: pointer;
}
dialog.ilb-m .ilb-tab-body { display: block; }

dialog.ilb-m .ilb-toolbar,
dialog.ilb-m .ilb-actions,
dialog.ilb-m .ilb-filterbar,
dialog.ilb-m .ilb-card-actions,
dialog.ilb-m .ilb-badges,
dialog.ilb-m .ilb-row,
dialog.ilb-m .ilb-inline,
dialog.ilb-m .ilb-rule-head,
dialog.ilb-m .ilb-card-head,
dialog.ilb-m .ilb-card-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
dialog.ilb-m .ilb-actions { justify-content: flex-start; }

dialog.ilb-m .ilb-btn {
  min-height: 44px;
  padding: 0 14px;
  border-radius: 11px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.09);
  color: inherit;
  font: inherit;
  font-size: 14px;
  flex: 0 1 auto;
  max-width: 100%;
  white-space: normal;
  text-align: center;
  cursor: pointer;
}
dialog.ilb-m .ilb-btn-primary { background: #3a6ea5; border-color: #4c86c4; color: #fff; }
dialog.ilb-m .ilb-btn-ghost { background: transparent; }

dialog.ilb-m .ilb-input,
dialog.ilb-m .ilb-select,
dialog.ilb-m .ilb-textarea {
  /* 16px：iOS 上小于 16px 的输入框会在聚焦时把页面放大 */
  font-size: 16px;
  min-height: 44px;
  width: 100%;
  max-width: 100%;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.07);
  color: inherit;
  font-family: inherit;
}
dialog.ilb-m .ilb-textarea { min-height: 120px; }
/* 流程的文本编辑器：手机上至少半屏，否则手写长流程根本改不动（v0.13.1） */
dialog.ilb-m .ilb-flow-area {
  min-height: 50dvh;
  font-size: 15px;
  line-height: 1.7;
  white-space: pre;
  overflow-x: auto;
}

dialog.ilb-m .ilb-card {
  display: block;
  width: 100%;
  max-width: 100%;
  margin: 0 0 10px;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.045);
}
dialog.ilb-m .ilb-rule-titles,
dialog.ilb-m .ilb-card-main,
dialog.ilb-m .ilb-card-summary,
dialog.ilb-m .ilb-title {
  flex: 1 1 160px;
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
}
dialog.ilb-m .ilb-sub,
dialog.ilb-m .ilb-meta,
dialog.ilb-m .ilb-hint,
dialog.ilb-m .ilb-empty {
  overflow-wrap: anywhere;
  word-break: break-word;
  color: rgba(255, 255, 255, 0.62);
  font-size: 13px;
}
dialog.ilb-m .ilb-book-controls { display: flex; flex-direction: column; gap: 8px; }
dialog.ilb-m .ilb-book-controls .ilb-inline { justify-content: space-between; }
dialog.ilb-m .ilb-selftest {
  white-space: pre-wrap;
  word-break: break-word;
  overflow-x: auto;
  font-size: 12px;
  margin: 0;
}
dialog.ilb-m table { display: block; max-width: 100%; overflow-x: auto; }
dialog.ilb-m .ilb-error { color: #ff9aa2; }

/* 手机上主操作优先：批量条/警告列表跟着换行，不许把页面撑宽 */
dialog.ilb-m .ilb-batchbar,
dialog.ilb-m .ilb-warn-list,
dialog.ilb-m .ilb-loglist,
dialog.ilb-m .ilb-file-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
`;

/**
 * 把手机皮肤注入 <head>。重复调用只会有一份。
 * @returns {HTMLStyleElement|null}
 */
export function ensureMobileSkin(doc = typeof document === 'undefined' ? null : document) {
  if (!doc || !doc.head) return null;
  try {
    const existing = doc.getElementById(MOBILE_SKIN_ID);
    if (existing) return existing;
    const style = doc.createElement('style');
    style.id = MOBILE_SKIN_ID;
    style.dataset.ilbSkin = MOBILE_SKIN_VERSION;
    style.textContent = MOBILE_SKIN_CSS;
    doc.head.appendChild(style);
    return style;
  } catch (err) {
    console.warn('[ILB] 手机皮肤没注入成功（界面仍会用内联样式撑起来）', err);
    return null;
  }
}

/** 自检用：皮肤在不在、有几条规则。 */
export function mobileSkinInfo(doc = typeof document === 'undefined' ? null : document) {
  if (!doc) return { installed: false, version: MOBILE_SKIN_VERSION, rules: 0 };
  const style = doc.getElementById(MOBILE_SKIN_ID);
  let rules = 0;
  try {
    rules = style && style.sheet && style.sheet.cssRules ? style.sheet.cssRules.length : 0;
  } catch {
    rules = 0;
  }
  return { installed: Boolean(style), version: style?.dataset?.ilbSkin ?? '', rules };
}
