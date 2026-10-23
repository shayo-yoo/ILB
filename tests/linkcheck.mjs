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
      if (item.name === 'node_modules' || item.name === 'tests') continue;
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

for (const file of files.sort()) {
  const rel = relative(root, file).replace(/\\/g, '/');
  // index.js 一被加载就会自己启动（要有宿主与 document），所以不在这里导入。
  if (rel === 'index.js') {
    skipped += 1;
    console.log(`skip  ${rel}（自启动入口，不参与链接检查）`);
    continue;
  }
  try {
    await import(pathToFileURL(file).href);
    console.log(`ok    ${rel}`);
  } catch (error) {
    bad += 1;
    const kind = error instanceof SyntaxError ? '语法/链接错误' : '运行期错误';
    console.log(`FAIL  ${rel}  [${kind}] ${error.message}`);
  }
}

console.log(`\n共 ${files.length} 个模块：通过 ${files.length - bad - skipped}、跳过 ${skipped}、失败 ${bad}`);
process.exitCode = bad > 0 ? 1 : 0;
