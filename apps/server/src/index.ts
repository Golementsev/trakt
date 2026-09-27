import { existsSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { DEFAULT_HOST, DEFAULT_PORT } from '@trakt/shared';
import { Db } from './db/db';
import { createCtx, seedDemo } from './domain';
import { createApp } from './http/app';
import { dbPath, webDist } from './paths';

const db = new Db(dbPath);
const ctx = createCtx(db);
if (process.argv.includes('--seed') && seedDemo(ctx)) console.log('Тракт: добавлены демо-проекты из макета');

const port = Number(process.env.TRAKT_PORT) || DEFAULT_PORT;
const app = createApp({ ctx, webDist: existsSync(webDist) ? webDist : undefined });

const server = serve({ fetch: app.fetch, hostname: DEFAULT_HOST, port }, (info) => {
  console.log(`Тракт: http://${DEFAULT_HOST}:${info.port}  (база: ${dbPath})`);
});

const shutdown = () => {
  server.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
