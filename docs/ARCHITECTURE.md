# Архитектура

Это предложение, а не закон: если по ходу найдётся причина сделать иначе — обсудить с пользователем.

## Принципы

1. **Один сервис — одна правда.** Вся логика (воркфлоу, права агента, события) живёт
   в доменном слое сервера. UI (REST) и агенты (MCP) вызывают одни и те же функции.
2. **Агент — такой же клиент, как UI.** Никаких особых путей в обход правил.
3. **Любой агент.** Доска не зависит от конкретного харнеса: интеграция через MCP,
   запуск — через настраиваемую команду.
4. **Локально и просто.** Один процесс, SQLite-файл, никакой авторизации, слушаем `127.0.0.1`.

## Стек

| Слой | Выбор | Почему |
|---|---|---|
| Язык | TypeScript везде | общие типы между фронтом, сервером и MCP |
| Фронт | React + Vite | макет переносится в компоненты напрямую |
| Состояние на фронте | TanStack Query + SSE-инвалидация | просто и живо |
| Сервер | Node 20+, Hono (или Fastify) | лёгкий, TS-friendly |
| БД | SQLite: better-sqlite3 + Drizzle ORM | один файл, миграции, типы |
| Валидация | zod (общие схемы в `packages/shared`) | те же схемы для REST и MCP |
| Живые обновления | Server-Sent Events `/api/events` | проще WebSocket, хватает для одного пользователя |
| MCP | `@modelcontextprotocol/sdk` | Streamable HTTP на `/mcp` + stdio-вход |
| Drag&drop | dnd-kit | колонки и карточки |
| Тесты | Vitest (домен и API), Playwright (пара e2e) | |

## Структура репозитория

```
trakt/
  CLAUDE.md
  package.json               # npm workspaces
  apps/
    web/                     # React + Vite
      src/components/        # Board, Column, Card, TaskModal, Settings/*, Feed, IdeaFab…
      src/api/               # клиент REST + подписка на SSE
    server/
      src/domain/            # сервисы: projects, statuses, types, templates, workflow,
                             #   tasks, subtasks, runs, events, agentPolicy
      src/db/                # drizzle schema + migrations
      src/http/              # REST-роуты (тонкие, зовут domain)
      src/mcp/               # MCP-сервер (тонкий, зовёт domain)
      src/runner/            # запуск агентов
      src/bin/trakt-mcp.ts   # stdio-вход для харнесов, которые умеют только stdio
  packages/
    shared/                  # zod-схемы, типы, константы
  data/trakt.db              # в .gitignore
```

Один процесс сервера отдаёт: REST `/api/*`, SSE `/api/events`, MCP `/mcp`, статику фронта (в проде).
Порт по умолчанию `4700`. В dev — Vite с прокси на сервер.

## Модель данных

Черновик — `docs/schema.sql`. Ключевое:
- `projects`, `statuses`, `task_types`, `template_fields`, `workflow_transitions`
  (строка = разрешённый переход), `agent_settings` (1:1 с проектом).
- `tasks` (`number` уникален в проекте; `position` — дробный или целый ранг в колонке),
  `task_field_values`, `subtasks`.
- `runs` + `run_log_lines`, `events`, `ideas`.
- Удаление статуса/типа — в транзакции с переносом задач.

## Доменные правила (сервер)

- `moveTask(taskId, toStatusId, actor, note?)`:
  - переход разрешён матрицей воркфлоу;
  - если actor — агент: `agent_settings.canMove`, позиция `toStatus` ≤ позиции `maxStatus`,
    задача `agentOwned` или заклеймлена этим агентом;
  - пишет событие, шлёт SSE.
- `claimTask(taskId, agentName, ttl)`: лиз, чтобы два агента не взяли одно и то же.
  Истекает сам; продлевается любым действием агента по задаче.
- Автопереход: когда все сабтаски `done` и последнюю закрыл агент → перевод в статус «Ревью»
  (первый `doing`-статус после текущего, не дальше `maxStatus`), если разрешено.
- Обязательные поля шаблона проверяются при создании задачи из UI и из MCP.
- Каждая мутация → запись в `events` → SSE `{type, projectId, taskId?}`; фронт инвалидирует кэш.

## REST API (для UI)

```
GET    /api/projects
POST   /api/projects                         {name}
PATCH  /api/projects/:id                     {name, repoPath, ...}
DELETE /api/projects/:id                     проект со всеми задачами; прогоны останавливаются
GET    /api/projects/:id/board               → статусы, типы, шаблоны, воркфлоу, задачи (кратко)
POST   /api/projects/:id/statuses            {name, afterStatusId?}
PATCH  /api/statuses/:id                     {name?, color?, category?}
POST   /api/statuses/:id/move                {toIndex}
DELETE /api/statuses/:id
POST   /api/projects/:id/types  PATCH /api/types/:id  DELETE /api/types/:id
POST   /api/types/:id/fields    PATCH /api/fields/:id DELETE /api/fields/:id
PUT    /api/projects/:id/workflow            {transitions: [[from,to],...]}
PUT    /api/projects/:id/agent-settings      {...}
GET    /api/tasks/:id
POST   /api/projects/:id/tasks               {title, typeId, statusId?, description, fields, subtasks[], agentOwned}
PATCH  /api/tasks/:id                        {title?, description?, fields?, agentOwned?}
POST   /api/tasks/:id/move                   {statusId, position?}
DELETE /api/tasks/:id
POST   /api/tasks/:id/subtasks   PATCH /api/subtasks/:id   DELETE /api/subtasks/:id
POST   /api/subtasks/:id/run     POST /api/runs/:id/stop    GET /api/runs/:id
POST   /api/tasks/:id/split                  → AI предлагает сабтаски
GET    /api/projects/:id/events?limit=
GET    /api/events                            (SSE)
GET/POST/DELETE /api/ideas   POST /api/ideas/generate (стрим)
```

## Агенты: два режима

### А. Pull — агент сам приходит на доску
Любой агент в любом харнесе (Claude Code, Codex, Cursor, свой скрипт) подключает MCP:
- HTTP: `http://127.0.0.1:4700/mcp`
- stdio: `npx trakt-mcp` (прокси к тому же серверу)

Дальше он сам: `list_tasks` → `claim_task` → работает → `log_progress` → `complete_subtask` →
`move_task`. Контракт — `docs/MCP.md`. В «Настройках → Агент» показать готовые сниппеты
конфигурации для популярных харнесов.

### Б. Push — кнопка «▶ Агент» в доске
Сервер запускает агента сам через **раннер**:
- В настройках проекта: рабочая папка (`repoPath`) и **команда запуска** — шаблон с плейсхолдерами.
  Пресеты: Claude Code, Codex CLI, «своя команда». Пример для Claude Code:
  `claude -p "$(cat {promptFile})" --mcp-config {mcpConfigFile} --permission-mode acceptEdits`
- Сервер собирает промпт: задача, описание, поля с `visibleToAgent`, сабтаска, DoD,
  id сабтаски и инструкция «отчитывайся через MCP-инструменты trakt».
- Опционально — отдельный git worktree на прогон (`trakt/PAY-12-s3`), чтобы параллельные
  агенты не мешали друг другу.
- stdout/stderr процесса пишутся в лог прогона и стримятся в UI. «■ Стоп» убивает процесс.
- Агент внутри прогона ходит в ту же доску через MCP, поэтому статусы и отчёты
  обновляются теми же правилами, что и в pull-режиме.

Имя агента для ленты берётся из `clientInfo.name` MCP-сессии (или параметра `agent`), по умолчанию «Агент».

## AI-функции самой доски («Разбить с AI», идеи из «+»)

Нужна модель. Варианты (выбрать с пользователем на этапе 4):
1. Anthropic API по ключу из `.env` (`ANTHROPIC_API_KEY`) — проще всего, стриминг из коробки.
2. Через тот же раннер: короткий неинтерактивный вызов CLI агента.
Без ключа эти кнопки показывают понятное сообщение, остальная доска работает.

## Что пока не делаем

Авторизация, многопользовательность, деплой, мобильная версия, импорт из Jira/Trello.
