import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { DEFAULT_AGENT_NAME, fieldValue } from '@trakt/shared';
import * as d from '../domain';

export const MCP_INSTRUCTIONS = `Тракт — локальная канбан-доска. Ты работаешь на ней как агент: берёшь задачи, пишешь прогресс, двигаешь по статусам.

Рекомендованный цикл:
1. list_tasks(project, onlyAvailable=true) — или возьми номер задачи у человека (например, PAY-12).
2. get_task — прочитай описание, поля, условие готовности (definitionOfDone) и сабтаски.
3. claim_task — возьми задачу, чтобы другой агент её не взял.
4. Для каждой сабтаски: start_subtask → работа → log_progress по ходу → complete_subtask (с коротким отчётом).
   Когда закрыта последняя сабтаска, доска сама переведёт задачу дальше (обычно в «Ревью»), если позволяют правила.
5. Когда условие готовности выполнено — move_task в следующий разрешённый статус (allowedNextStatuses) с note-отчётом.
6. Застрял или нужен человек — add_comment с вопросом и release_task.

Правила перехода (воркфлоу, «не дальше статуса», пауза) проверяет доска; ошибка всегда объясняет, что делать.
Рабочая папка проекта — repoPath в get_task/list_projects.`;

type Json = Record<string, unknown> | unknown[];

const ok = (data: Json): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 1) }],
});

const fail = (e: unknown): CallToolResult => ({
  isError: true,
  content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
});

const agentArg = z.string().optional().describe('Имя агента для ленты. По умолчанию — имя MCP-клиента.');

/** MCP-сервер доски. Каждый инструмент — тонкая обёртка над доменом. */
export function createMcpServer(ctx: d.Ctx): McpServer {
  const server = new McpServer({ name: 'trakt', version: '0.1.0' }, { instructions: MCP_INSTRUCTIONS });

  /** Имя агента: параметр agent → clientInfo.name → «Агент». */
  const who = (agent?: string) =>
    agent?.trim() || server.server.getClientVersion()?.name?.trim() || DEFAULT_AGENT_NAME;

  const tool = <S extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: S,
    run: (args: z.infer<z.ZodObject<S>>) => Json,
    readOnly = false,
  ) =>
    server.registerTool(
      name,
      { description, inputSchema: shape, annotations: { readOnlyHint: readOnly } },
      // SDK типизирует аргументы по shape; приводим к нашему выводу zod
      ((args: z.infer<z.ZodObject<S>>) => {
        try {
          return ok(run(args));
        } catch (e) {
          return fail(e);
        }
      }) as never,
    );

  const project = z.string().describe('Проект: ключ (PAY) или id');
  const task = z.string().describe('Задача: номер вида PAY-12 или id');
  const subtask = z.string().describe('id сабтаски из get_task');

  // ---------- чтение ----------
  tool(
    'list_projects',
    'Список проектов доски: ключ, название, рабочая папка (repoPath).',
    {},
    () => d.agentListProjects(ctx),
    true,
  );

  tool(
    'get_board',
    'Доска проекта: статусы по порядку, типы и их поля, настройки агента, условие готовности, задачи кратко.',
    { project },
    ({ project }) => d.agentBoard(ctx, project),
    true,
  );

  tool(
    'list_tasks',
    'Задачи проекта кратко. onlyAvailable=true — только те, что можно взять: не закрыты, никем не заняты и отданы агенту.',
    {
      project,
      status: z.string().optional().describe('Только в этом статусе (название или id)'),
      onlyAvailable: z.boolean().optional(),
      agentOwned: z.boolean().optional().describe('true — только задачи, которые ведёт агент'),
      agent: agentArg,
    },
    ({ project, status, onlyAvailable, agentOwned, agent }) =>
      d.agentListTasks(ctx, project, { status, onlyAvailable, agentOwned }, who(agent)),
    true,
  );

  tool(
    'get_task',
    'Полная задача: описание, поля (видимые агенту), сабтаски с id и состоянием, условие готовности, разрешённые следующие статусы, последние события.',
    { task, agent: agentArg },
    ({ task, agent }) => d.agentGetTask(ctx, task, who(agent)),
    true,
  );

  // ---------- работа с задачей ----------
  tool(
    'claim_task',
    'Взять задачу: другой агент не сможет её взять, пока лиз не истечёт (продлевается любым вашим действием по задаче). Задача помечается «ведёт агент».',
    {
      task,
      ttlMinutes: z.number().int().min(1).max(1440).optional().describe('Лиз в минутах, по умолчанию 30'),
      agent: agentArg,
    },
    ({ task, ttlMinutes, agent }) => d.agentClaimTask(ctx, task, who(agent), ttlMinutes),
  );

  tool(
    'release_task',
    'Отпустить задачу (например, нужен человек). note попадёт в ленту.',
    { task, note: z.string().optional(), agent: agentArg },
    ({ task, note, agent }) => d.agentReleaseTask(ctx, task, who(agent), note),
  );

  tool(
    'move_task',
    'Перевести задачу в статус. Проверяются воркфлоу, «не дальше статуса» и пауза. note — короткий отчёт, уходит в ленту.',
    {
      task,
      status: z.string().describe('Статус: название («Ревью») или id'),
      note: z.string().describe('Что сделано / почему переводите'),
      agent: agentArg,
    },
    ({ task, status, note, agent }) => d.agentMoveTask(ctx, task, status, who(agent), note),
  );

  tool(
    'update_task',
    'Поправить описание и/или поля задачи. Поля — по названию: {"Критерии приёмки": "..."}.',
    {
      task,
      description: z.string().optional(),
      fields: z.record(z.string(), fieldValue).optional(),
      agent: agentArg,
    },
    ({ task, description, fields, agent }) =>
      d.agentUpdateTask(ctx, task, { description, fields }, who(agent)),
  );

  tool(
    'add_comment',
    'Запись в историю задачи и ленту: отчёт, вопрос человеку, ссылка на PR. Брать задачу не нужно.',
    { task, text: z.string().min(1), agent: agentArg },
    ({ task, text, agent }) => d.agentAddComment(ctx, task, text, who(agent)),
  );

  tool(
    'create_task',
    'Создать задачу (только если в настройках проекта разрешено). Обязательные поля типа нужно заполнить.',
    {
      project,
      title: z.string().min(1),
      type: z.string().describe('Тип: название («Баг») или id'),
      description: z.string().optional(),
      fields: z.record(z.string(), fieldValue).optional(),
      subtasks: z.array(z.string().min(1)).optional(),
      agent: agentArg,
    },
    ({ agent, ...input }) => d.agentCreateTask(ctx, input, who(agent)),
  );

  // ---------- сабтаски и прогресс ----------
  tool(
    'add_subtask',
    'Добавить сабтаску в задачу.',
    { task, title: z.string().min(1), agent: agentArg },
    ({ task, title, agent }) => d.agentAddSubtask(ctx, task, title, who(agent)),
  );

  tool(
    'start_subtask',
    'Начать сабтаску: на карточке появится «агент работает».',
    { subtask, agent: agentArg },
    ({ subtask, agent }) => d.agentStartSubtask(ctx, subtask, who(agent)),
  );

  tool(
    'log_progress',
    'Строка в живой лог сабтаски (или в историю задачи): «Запускаю тесты: 42 passed». Пишите по ходу работы.',
    {
      subtask: z.string().optional().describe('id сабтаски'),
      task: z.string().optional().describe('Или задача целиком, например PAY-12'),
      text: z.string().min(1),
      agent: agentArg,
    },
    ({ subtask, task, text, agent }) => d.agentLogProgress(ctx, { subtask, task }, text, who(agent)),
  );

  tool(
    'complete_subtask',
    'Закрыть сабтаску с коротким отчётом. Если это последняя — доска переведёт задачу дальше (обычно в «Ревью»), если позволяют правила.',
    { subtask, report: z.string().optional(), agent: agentArg },
    ({ subtask, report, agent }) => d.agentCompleteSubtask(ctx, subtask, who(agent), report),
  );

  tool(
    'fail_subtask',
    'Сабтаска не получилась: причина уйдёт в ленту.',
    { subtask, reason: z.string().min(1), agent: agentArg },
    ({ subtask, reason, agent }) => d.agentFailSubtask(ctx, subtask, reason, who(agent)),
  );

  // ---------- промпт ----------
  server.registerPrompt(
    'work_on_task',
    {
      description: 'Готовая инструкция: взять задачу с доски Тракт и довести её до готовности.',
      argsSchema: { task: z.string().describe('Номер задачи, например PAY-12') },
    },
    ({ task }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Возьми задачу ${task} с доски Тракт и доведи её до готовности.
1. get_task("${task}") — прочитай описание, поля и условие готовности.
2. claim_task("${task}").
3. Иди по сабтаскам: start_subtask → работа → log_progress по ходу → complete_subtask с коротким отчётом.
   Если сабтасок нет — разбей задачу через add_subtask.
4. Когда условие готовности выполнено — move_task в следующий разрешённый статус с отчётом в note.
5. Если застрял или нужен человек — add_comment с вопросом и release_task.`,
          },
        },
      ],
    }),
  );

  return server;
}
