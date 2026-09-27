import { Hono } from 'hono';
import { serveWeb } from './static';

export interface AppOptions {
  /** Папка собранного фронта. Если нет — статику не отдаём (dev, тесты). */
  webDist?: string;
}

export function createApp(opts: AppOptions = {}) {
  const app = new Hono();

  const api = new Hono();
  api.get('/health', (c) => c.json({ ok: true }));
  api.all('*', (c) => c.json({ error: 'Не найдено' }, 404));
  app.route('/api', api);

  if (opts.webDist) app.get('*', serveWeb(opts.webDist));

  return app;
}
