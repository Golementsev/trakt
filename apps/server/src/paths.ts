import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Этот файл лежит в apps/server/src, а в сборке вшит в apps/server/dist — глубина одинаковая.
const here = dirname(fileURLToPath(import.meta.url));

export const repoRoot = resolve(here, '../../..');
/** Собранный фронт: в проде его отдаёт сервер, в dev — Vite. */
export const webDist = resolve(repoRoot, 'apps/web/dist');
export const dbPath = process.env.TRAKT_DB || resolve(repoRoot, 'data/trakt.db');
