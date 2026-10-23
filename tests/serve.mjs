// tests/serve.mjs —— 起一个只读静态服务器，专门给 browser-probe.html 用。
// 为什么需要它：探针用 ESM 与相对路径加载 style.css 和 ui/help.js，file:// 会被浏览器拦。
// 用法：node tests/serve.mjs [端口]   （默认 8792，只监听 127.0.0.1）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.argv[2] || 8792);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);

  // 探针把量到的数字 POST 回来，落成文件。
  // 为什么要这一步：无头浏览器在这台机器上不往 stdout 写任何东西（--dump-dom 拿到空串），
  // 所以"把结果画在页面上再截图"或"POST 回来"才拿得到数据。
  if (req.method === 'POST' && url === '/report') {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const out = path.join(root, 'tests', 'last-report.json');
      try {
        fs.writeFileSync(out, body, 'utf8');
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, bytes: body.length }));
      } catch (err) {
        res.writeHead(500).end(String(err));
      }
    });
    return;
  }

  const file = path.join(root, url === '/' ? '/' : url);
  if (!file.startsWith(root)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[serve] http://127.0.0.1:${port}/tests/browser-probe.html`);
});
