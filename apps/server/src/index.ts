import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { DEFAULT_HOST, DEFAULT_PORT } from '@trakt/shared';
import { Db } from './db/db';
import { createCtx, seedDemo } from './domain';
import { createApp } from './http/app';
import { Runner } from './runner/runner';
import { dbPath, repoRoot, webDist } from './paths';

const db = new Db(dbPath);
const ctx = createCtx(db);
if (process.argv.includes('--seed') && seedDemo(ctx)) console.log('Тракт: добавлены демо-проекты из макета');

const port = Number(process.env.TRAKT_PORT) || DEFAULT_PORT;
const stdioEntry = resolve(repoRoot, 'apps/server/dist/trakt-mcp.js');
const mcpUrl = `http://${DEFAULT_HOST}:${port}/mcp`;
const runner = new Runner(ctx, { mcpUrl, workDir: resolve(dirname(dbPath), 'runs'), autoTakeMs: 10_000 });
runner.start();
const app = createApp({
  ctx,
  webDist: existsSync(webDist) ? webDist : undefined,
  connect: () => ({
    httpUrl: mcpUrl,
    stdio: { command: 'node', args: [stdioEntry], built: existsSync(stdioEntry) },
  }),
  runner,
});

const server = serve({ fetch: app.fetch, hostname: DEFAULT_HOST, port }, (info) => {
  console.log(`Тракт: http://${DEFAULT_HOST}:${info.port}  MCP: http://${DEFAULT_HOST}:${info.port}/mcp`);
  console.log(`База: ${dbPath}`);
});

const shutdown = () => {
  runner.close();
  server.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
