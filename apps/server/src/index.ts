import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { DEFAULT_HOST, DEFAULT_PORT } from '@trakt/shared';
import { createApp } from './http/app';

const here = dirname(fileURLToPath(import.meta.url));
// в сборке: apps/server/dist → apps/web/dist; в dev фронт отдаёт Vite
const webDist = resolve(here, '../../web/dist');

const port = Number(process.env.TRAKT_PORT) || DEFAULT_PORT;
const app = createApp({ webDist: existsSync(webDist) ? webDist : undefined });

serve({ fetch: app.fetch, hostname: DEFAULT_HOST, port }, (info) => {
  console.log(`Тракт: http://${DEFAULT_HOST}:${info.port}`);
});
