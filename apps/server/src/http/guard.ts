import type { MiddlewareHandler } from 'hono';

const LOCAL = new Set(['127.0.0.1', 'localhost', '[::1]']);

function hostnameOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value.includes('://') ? value : `http://${value}`).hostname;
  } catch {
    return null;
  }
}

/**
 * Доска без авторизации, поэтому защищаемся от чужих веб-страниц в браузере:
 * - Host только локальный (защита от DNS rebinding);
 * - Origin, если есть, тоже локальный (чужой сайт не отправит запрос от вашего имени);
 * - изменения только с JSON-телом (формы и «простые» запросы без CORS не пройдут).
 */
export const localOnly: MiddlewareHandler = async (c, next) => {
  const host = hostnameOf(c.req.header('host')) ?? new URL(c.req.url).hostname;
  if (!LOCAL.has(host)) return c.json({ error: 'Доска доступна только с этого компьютера' }, 403);

  const origin = c.req.header('origin');
  if (origin && origin !== 'null' && !LOCAL.has(hostnameOf(origin) ?? '')) {
    return c.json({ error: 'Запросы с других сайтов запрещены' }, 403);
  }

  const method = c.req.method;
  const mutating = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
  if (mutating && method !== 'DELETE') {
    const type = c.req.header('content-type') ?? '';
    if (!type.includes('application/json'))
      return c.json({ error: 'Нужен Content-Type: application/json' }, 415);
  }
  await next();
};
