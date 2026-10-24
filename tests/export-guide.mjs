// tests/export-guide.mjs —— 把扩展里的使用说明导出成 docs/使用指南.md。
//
// 为什么要有这一步：说明的正文只写一份（data/guide/zh-cn.json），
// 扩展里读它、GitHub 上也读它（由这个脚本生成），避免两处文字慢慢走散。
// 改了 JSON 就跑一次：node tests/export-guide.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../data/guide/zh-cn.json');
const target = resolve(here, '../../docs/使用指南.md');

const data = JSON.parse(readFileSync(source, 'utf8'));

function cell(text) {
  return String(text ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

const lines = [];
lines.push(`# ${data.title ?? '使用说明'}`);
lines.push('');
lines.push('> 这份文件由 `extension/tests/export-guide.mjs` 从 `extension/data/guide/zh-cn.json` 生成，不要手改；改 JSON 后重跑脚本。');
lines.push('> 扩展里点标签栏最右边的「使用说明」看到的就是同一份内容。');
lines.push('');
if (data.intro) {
  lines.push(data.intro);
  lines.push('');
}

for (const section of data.sections ?? []) {
  lines.push(`## ${section.h ?? ''}`);
  lines.push('');
  if (section.p) {
    lines.push(section.p);
    lines.push('');
  }
  if (Array.isArray(section.steps) && section.steps.length) {
    section.steps.forEach((step, i) => lines.push(`${i + 1}. ${step}`));
    lines.push('');
  }
  if (Array.isArray(section.bullets) && section.bullets.length) {
    section.bullets.forEach((item) => lines.push(`- ${item}`));
    lines.push('');
  }
  if (section.table?.head && Array.isArray(section.table.rows)) {
    lines.push(`| ${section.table.head.map(cell).join(' | ')} |`);
    lines.push(`| ${section.table.head.map(() => '---').join(' | ')} |`);
    section.table.rows.forEach((row) => lines.push(`| ${(row ?? []).map(cell).join(' | ')} |`));
    lines.push('');
  }
  if (section.note) {
    lines.push(`> ${section.note}`);
    lines.push('');
  }
}

const markdown = lines.join('\n').replace(/\n+$/, '\n');
if (!existsSync(dirname(target))) mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, markdown, 'utf8');
console.log(`已导出：${target}（${markdown.length} 字符，${(data.sections ?? []).length} 节）`);
