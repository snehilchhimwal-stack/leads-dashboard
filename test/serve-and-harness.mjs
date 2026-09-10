/**
 * serve-and-harness.mjs — start a tiny static server on the repo root,
 * run run-frontend-harness.mjs against it, exit with its code.
 * Forensic audit P2 item 13 (t-tf-5ad22d8e4c2e).
 *
 * Pure Node so it works on any image that has Node (the Playwright
 * container included) with no python3 / curl / seq dependency. The
 * harness page fetch()es ../dashboard.html, so it must be served over
 * http, not opened as a file://.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 8123;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.md': 'text/plain',
};

const server = createServer(async (req, res) => {
  try {
    const clean = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    const fp = join(ROOT, clean === '/' ? 'dashboard.html' : clean);
    if (!fp.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
    const buf = await readFile(fp);
    res.writeHead(200, { 'content-type': MIME[extname(fp)] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404).end('not found');
  }
});

await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
console.log(`[serve] static server on http://127.0.0.1:${PORT} (root ${ROOT})`);

const child = spawn(
  process.execPath,
  [join(ROOT, 'test', 'run-frontend-harness.mjs'), `http://127.0.0.1:${PORT}`],
  { stdio: 'inherit' },
);
child.on('exit', (code) => {
  server.close();
  process.exit(code == null ? 1 : code);
});
