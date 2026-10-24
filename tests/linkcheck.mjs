// 临时工具：检查所有模块能否被加载（链接期错误会在这里暴露）。
// 用法：node tests/_linkcheck.mjs
import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

async function walk(dir, out = []) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, item.name);
    if (item.isDirectory()) {
      // tests/ 是测试工具自己；lab/ 是**隔离子项目**（叙事引擎），有自己的测试命令
      // （node --test lab/tests/*.test.mjs），不参与"扩展能不能加载"这项发布前检查。
      if (item.name === 'node_modules' || item.name === 'tests' || item.name === 'lab') continue;
      await walk(full, out);
    } else if (item.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

const files = await walk(root);
let bad = 0;
let skipped = 0;

// index.js 是自启动入口：一被 import 就会抓宿主、找 DOM。直接 import 会在
// "宿主还没准备好"上失败，掩盖真正的语法错误。所以给它一个最小的 document 桩，
// 让 `document.readyState === 'loading'` 成立——它会把 start 挂到 DOMContentLoaded 上，
// 于是只被解析、不会真的启动。这一步能抓住"入口文件有语法错误"这种会整个扩展不显示的毛病。
async function checkEntry() {
  const previous = globalThis.document;
  const noop = () => {};
  const stub = {
    readyState: 'loading',
    addEventListener: noop,
    removeEventListener: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    createElement: () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop }, appendChild: noop, setAttribute: noop }),
    body: { classList: { add: noop, remove: noop, toggle: noop }, appendChild: noop, style: {} },
    head: { appendChild: noop },
  };
  try {
    if (typeof globalThis.document === 'undefined') globalThis.document = stub;
    await import(pathToFileURL(join(root, 'index.js')).href);
    console.log('ok    index.js（入口能被解析）');
    return true;
  } catch (error) {
    const kind = error instanceof SyntaxError ? '语法错误' : '运行期错误';
    console.log(`FAIL  index.js  [${kind}] ${error.message}`);
    return false;
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
}

for (const file of files.sort()) {
  const rel = relative(root, file).replace(/\\/g, '/');
  if (rel === 'index.js') continue;
  try {
    await import(pathToFileURL(file).href);
    console.log(`ok    ${rel}`);
  } catch (error) {
    bad += 1;
    const kind = error instanceof SyntaxError ? '语法/链接错误' : '运行期错误';
    console.log(`FAIL  ${rel}  [${kind}] ${error.message}`);
  }
}

const entryOk = await checkEntry();
if (!entryOk) bad += 1;

console.log(`\n共 ${files.length} 个模块：通过 ${files.length - bad}、失败 ${bad}`);
process.exitCode = bad > 0 ? 1 : 0;
