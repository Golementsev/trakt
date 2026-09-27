import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import type { Context } from 'hono';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

async function isFile(path: string) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** Отдаёт собранный фронт; неизвестные пути — index.html (SPA). */
export function serveWeb(root: string) {
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  return async (c: Context) => {
    const rel = decodeURIComponent(new URL(c.req.url).pathname);
    const file = normalize(join(root, rel));
    const target = file.startsWith(rootWithSep) && (await isFile(file)) ? file : join(root, 'index.html');
    const body = await readFile(target);
    const type = MIME[extname(target)] ?? 'application/octet-stream';
    const cache = target.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
    return c.body(body, 200, { 'Content-Type': type, 'Cache-Control': cache });
  };
}
