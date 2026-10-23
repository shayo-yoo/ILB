// runtime/registry.js —— 扩展点注册表（ILB-2.4）
// 新增能力时往这里注册，而不是去改已有文件。每个槽位之间互不相识。

function makeSlot(name) {
  const items = new Map();
  return {
    name,
    register(id, impl) {
      if (!id || !impl) return false;
      items.set(String(id), impl);
      return true;
    },
    unregister(id) {
      return items.delete(String(id));
    },
    get(id) {
      return items.get(String(id)) ?? null;
    },
    list() {
      return [...items.entries()].map(([id, impl]) => ({ id, impl }));
    },
    ids() {
      return [...items.keys()];
    },
    size() {
      return items.size;
    },
  };
}

export function createRegistry() {
  const slots = new Map();

  function slot(name) {
    const key = String(name);
    if (!slots.has(key)) slots.set(key, makeSlot(key));
    return slots.get(key);
  }

  return {
    /** 判定"这本书这一轮是否在场"的提供者，签名 (book, ctx) => true | false | null */
    activationProviders: slot('activationProviders'),
    /** 注入终点，签名 (activatedList, meta) => void */
    injectionSinks: slot('injectionSinks'),
    /** 判定层之外想插一脚的观察者，签名 (result, request) => void，异常会被吞掉 */
    observers: slot('observers'),
    /** 界面面板，签名 (mountPoint) => void */
    panels: slot('panels'),
    slot,
    names() {
      return [...slots.keys()];
    },
  };
}

/** 通知所有观察者；任何一个抛错都不影响其余的（ILB-2.5） */
export function notifyObservers(registry, result, request, onError) {
  for (const { id, impl } of registry.observers.list()) {
    try {
      if (typeof impl === 'function') impl(result, request);
    } catch (err) {
      if (typeof onError === 'function') onError(id, err);
    }
  }
}
