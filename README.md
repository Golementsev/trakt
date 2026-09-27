# Тракт

Простая локальная канбан-доска, в которой AI-агенты — полноправные участники:
сами берут задачи, пишут прогресс и двигают их по статусам. Подключается любой агент через MCP.

Спека и решения — в [`docs/`](docs), утверждённый макет UI — [`mockup/trakt.html`](mockup/trakt.html),
правила для кодового агента — [`CLAUDE.md`](CLAUDE.md), план — [`docs/PLAN.md`](docs/PLAN.md).

## Запуск

Нужен Node 22.13+ (используется встроенный `node:sqlite`).

```
npm install
npm run seed         # по желанию: демо-проекты из макета (только в пустую базу)
npm run dev          # сервер http://127.0.0.1:4700 + Vite http://127.0.0.1:5173
npm test
npm run typecheck
npm run lint
npm run build && npm start   # один процесс на http://127.0.0.1:4700
```

База — `data/trakt.db` (в `.gitignore`). Переменные: `TRAKT_PORT` — порт сервера, `TRAKT_DB` — путь к базе.
Сервер слушает только `127.0.0.1`, авторизации нет.

## Подключить агента

Доска — MCP-сервер, подойдёт любой агент в любом харнесе. Готовые сниппеты для Claude Code,
Codex, Cursor и общий JSON — в «Настройки → Агент». Коротко:

- Streamable HTTP: `http://127.0.0.1:4700/mcp` (например, `claude mcp add --transport http trakt http://127.0.0.1:4700/mcp`);
- stdio (после `npm run build`): `node apps/server/dist/trakt-mcp.js` — прокси к тому же серверу, доска должна быть запущена.

Дальше скажите агенту «возьми PAY-12 с доски Тракт». Контракт инструментов — [`docs/MCP.md`](docs/MCP.md).

## Структура

```
apps/web         React + Vite (UI по макету), TanStack Query + SSE
apps/server      Hono: REST /api, SSE /api/events, MCP /mcp; вся логика — в src/domain
packages/shared  общие типы ответов, zod-схемы входных данных, значения по умолчанию
```
