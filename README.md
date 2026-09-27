# Тракт

Простая локальная канбан-доска, в которой AI-агенты — полноправные участники:
сами берут задачи, пишут прогресс и двигают их по статусам. Подключается любой агент через MCP.

Спека и решения — в [`docs/`](docs), утверждённый макет UI — [`mockup/trakt.html`](mockup/trakt.html),
правила для кодового агента — [`CLAUDE.md`](CLAUDE.md), план — [`docs/PLAN.md`](docs/PLAN.md).

## Запуск

Нужен Node 20+.

```
npm install
npm run dev          # сервер http://127.0.0.1:4700 + Vite http://127.0.0.1:5173
npm test
npm run typecheck
npm run lint
npm run build && npm start   # один процесс на http://127.0.0.1:4700
```

Порт сервера меняется переменной `TRAKT_PORT`. Сервер слушает только `127.0.0.1`, авторизации нет.

## Структура

```
apps/web         React + Vite (UI по макету)
apps/server      Hono: REST /api, SSE, MCP /mcp; домен в src/domain
packages/shared  общие константы, значения по умолчанию, схемы
```
