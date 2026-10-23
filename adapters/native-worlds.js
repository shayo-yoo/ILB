// adapters/native-worlds.js —— 只读原生世界书（ILB-1.2.5：导入只读，绝不改原件）
// 走的都是 SillyTavern 现成的接口：POST /api/worldinfo/list 与 POST /api/worldinfo/get。

const LIST_URL = '/api/worldinfo/list';
const GET_URL = '/api/worldinfo/get';

export function createNativeWorlds({ getRequestHeaders } = {}) {
  let available = null;

  function headers() {
    let extra = {};
    try {
      const h = typeof getRequestHeaders === 'function' ? getRequestHeaders() : null;
      if (h && typeof h === 'object') extra = h;
    } catch {
      extra = {};
    }
    return { 'Content-Type': 'application/json', ...extra };
  }

  async function postJson(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`请求 ${url} 失败（HTTP ${res.status}）${text ? `：${text.slice(0, 200)}` : ''}`);
    }
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`请求 ${url} 没有返回 JSON，可能这个接口不存在`);
    }
  }

  /** @returns {Promise<{name: string, file_id?: string}[]>} */
  async function list() {
    const data = await postJson(LIST_URL, {});
    const arr = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
    return arr
      .filter((x) => x && typeof x === 'object')
      .map((x) => ({ name: String(x.name ?? x.file_id ?? ''), fileId: x.file_id ?? null }))
      .filter((x) => x.name.length > 0);
  }

  /** @returns {Promise<object>} 整份原生世界书文件 */
  async function get(name) {
    if (!name) throw new Error('没有给文件名');
    const data = await postJson(GET_URL, { name });
    const payload = data?.data ?? data;
    if (!payload || typeof payload !== 'object') throw new Error(`「${name}」读回来是空的`);
    if (!payload.entries) throw new Error(`「${name}」里没有 entries，不是世界书格式`);
    return payload;
  }

  async function isAvailable() {
    if (available != null) return available;
    try {
      await list();
      available = true;
    } catch {
      available = false;
    }
    return available;
  }

  return { list, get, isAvailable };
}
