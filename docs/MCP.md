# MCP-контракт Тракта

MCP-сервер — единственный способ для внешних агентов работать с доской.
Точки входа: Streamable HTTP `http://127.0.0.1:4700/mcp` и stdio `trakt-mcp`.
Все инструменты вызывают доменный слой, поэтому правила воркфлоу и права агента одинаковы с UI.

Ответы — компактный JSON (агенту важны id и следующее действие). Ошибки — человекочитаемые,
с подсказкой, что делать: `"Переход «Бэклог» → «Готово» запрещён воркфлоу. Разрешено: «К работе»."`

## Инструменты

### Чтение
| Инструмент | Вход | Выход |
|---|---|---|
| `list_projects` | — | `[{id, key, name, repoPath}]` |
| `get_board` | `project` (id или key) | статусы (id, name, category, order), типы, настройки агента, DoD, задачи кратко |
| `list_tasks` | `project`, `status?`, `onlyAvailable?` (не заклеймлены и доступны агенту), `agentOwned?` | `[{id:"PAY-12", title, type, status, subtasks:{done,total}, claimedBy}]` |
| `get_task` | `task` (`PAY-12`) | полная задача: описание, поля с `visibleToAgent`, сабтаски с id и state, DoD, `allowedNextStatuses` (с учётом воркфлоу и maxStatus), последние события |

### Работа с задачей
| Инструмент | Вход | Действие |
|---|---|---|
| `claim_task` | `task`, `agent?`, `ttlMinutes?` (по умолчанию 30) | берёт задачу; ставит `agentOwned=true`; ошибка, если задачу держит другой агент |
| `release_task` | `task`, `note?` | отпускает |
| `move_task` | `task`, `status` (id или название), `note` | переводит; проверяет воркфлоу, `canMove`, `maxStatus`; `note` уходит в ленту |
| `update_task` | `task`, `description?`, `fields?` (`{название поля: значение}`) | правит описание и поля |
| `add_comment` | `task`, `text` | запись в историю и ленту: отчёт, вопрос человеку, ссылка на PR |
| `create_task` | `project`, `title`, `type`, `description?`, `fields?`, `subtasks?` | только если `canCreate`; проверяет обязательные поля |

### Сабтаски и прогресс
| Инструмент | Вход | Действие |
|---|---|---|
| `add_subtask` | `task`, `title` | новая сабтаска |
| `start_subtask` | `subtask` | `state=running` (карточка показывает «агент работает») |
| `log_progress` | `subtask` или `task`, `text` | строка в живой лог (как в макете: «Запускаю тесты: 42 passed») |
| `complete_subtask` | `subtask`, `report?` | `done=true`, `state=done`; если все сабтаски закрыты — автопереход в «Ревью» |
| `fail_subtask` | `subtask`, `reason` | `state=failed`, событие в ленту |

## Ресурсы и промпты (опционально)

- Ресурс `trakt://task/PAY-12` — markdown-представление задачи для контекста.
- Промпт `work_on_task(task)` — готовая инструкция: прочитать задачу, заклеймить,
  идти по сабтаскам, логировать, закрыть, перевести по готовности.

## Рекомендованный цикл агента (положить в описание сервера MCP)

1. `list_tasks(project, onlyAvailable=true)` или получить id задачи от пользователя.
2. `get_task` → прочитать описание, поля, DoD, сабтаски.
3. `claim_task`.
4. Для каждой сабтаски: `start_subtask` → работа → `log_progress` по ходу → `complete_subtask`.
5. Когда DoD выполнен — `move_task` в следующий разрешённый статус с `note`-отчётом.
6. Если застрял или нужен человек — `add_comment` с вопросом и `release_task`.

## Идентификация агента

Имя для ленты: параметр `agent`, иначе `clientInfo.name` MCP-сессии, иначе «Агент».
Действия пользователя из UI в ленте — «Вы».
