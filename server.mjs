import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.jpg':'image/jpeg', '.png':'image/png', '.woff2':'font/woff2', '.svg':'image/svg+xml', '.ttf':'font/ttf' };
createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    const relative = path.slice(root.length);
    if (!path.startsWith(root) || relative.split(sep).some(p => p.startsWith('.')) || !['.html','.js','.css','.jpg','.png','.woff2','.svg','.ttf'].includes(extname(path))) {
      res.writeHead(403).end('Forbidden'); return;
    }
    if (!(await stat(path)).isFile()) throw new Error('Not a file');
    res.writeHead(200, {'Content-Type':types[extname(path)], 'Cache-Control':'no-cache', 'X-Content-Type-Options':'nosniff'});
    res.end(await readFile(path));
  } catch { res.writeHead(404).end('Not found'); }
}).listen(Number(process.env.PORT || 8766), '127.0.0.1', () => console.log('Плёнка → http://127.0.0.1:' + (process.env.PORT || 8766)));
