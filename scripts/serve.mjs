import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = process.env.BOMBERMAN_SERVE_DIST === '1' ? path.join(projectRoot, 'dist') : projectRoot;
const port = Number(process.env.BOMBERMAN_PORT || 50827);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2':'font/woff2', '.txt': 'text/plain' };
http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const target = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname === '/connection-check' ? '/connection-check.html' : pathname));
    if (!target.startsWith(root + path.sep) || /(?:^|[\\/])\./.test(path.relative(root, target))) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    const content = await fs.readFile(target);
    response.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(content);
  } catch (error) {
    response.writeHead(404).end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`Bomberman: http://127.0.0.1:${port}`));
