import { Hono, type Context } from 'hono';
import { stream as streamBody, streamSSE } from 'hono/streaming';
import { ZodError, type z } from 'zod';
import {
  ACTOR_YOU,
  createFieldInput,
  createProjectInput,
  createStatusInput,
  createSubtaskInput,
  createTaskInput,
  createTypeInput,
  moveStatusInput,
  moveTaskInput,
  setWorkflowInput,
  updateAgentSettingsInput,
  updateAppSettingsInput,
  updateFieldInput,
  updateProjectInput,
  updateStatusInput,
  updateSubtaskInput,
  updateTaskInput,
  updateTypeInput,
  aiGenerateInput,
  checkAgentInput,
  updateAgentsInput,
  aiSplitInput,
  createIdeaInput,
  type LiveMessage,
  type TaskDetail,
} from '@trakt/shared';
import * as d from '../domain';
import { mcpHandler } from '../mcp/http';
import type { Runner } from '../runner/runner';
import { statusOf, type AiProvider } from '../ai/provider';
import type { AgentsService } from '../agents/service';
import type { McpRegistry } from '../mcp/registry';
import { ideaPrompt, parseSubtasks, splitPrompt } from '../ai/prompts';
import { localOnly } from './guard';
import { serveWeb } from './static';

export interface AppOptions {
  ctx: d.Ctx;
  /** Папка собранного фронта. Если нет — статику не отдаём (dev, тесты). */
  webDist?: string;
  /** Как подключить агента: адрес MCP и команда stdio-входа (для «Настройки → Агент»). */
  connect?: () => AgentConnectInfo;
  /** Запуск агентов кнопкой «▶ Агент». Без него (тесты) — только ручная доска и MCP. */
  runner?: Runner;
  /** Источник модели для «✦ Разбить с AI» и идей. null — AI недоступен. */
  ai?: () => AiProvider | null;
  /** Источники агентов (страница «Агенты»). */
  agents?: AgentsService;
  /** Кто подключён по MCP. */
  registry?: McpRegistry;
}

export interface AgentConnectInfo {
  httpUrl: string;
  stdio: { command: string; args: string[]; built: boolean };
}

async function body<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  const raw: unknown = await c.req.json().catch(() => ({}));
  return schema.parse(raw);
}

export function createApp({ ctx, webDist, connect, runner, ai, agents, registry }: AppOptions) {
  /** AI выбирается на каждый запрос: источник можно сменить в UI без перезапуска. */
  const currentAi = (): AiProvider | null => (ai ? ai() : (agents?.aiProvider() ?? null));
  const app = new Hono();
  app.use('*', localOnly);
  const api = new Hono();
  const you = ACTOR_YOU;

  api.onError((err, c) => {
    if (err instanceof d.DomainError) return c.json({ error: err.message }, err.status);
    if (err instanceof ZodError) return c.json({ error: err.issues[0]?.message ?? 'Неверные данные' }, 400);
    console.error(err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  });

  api.get('/health', (c) => c.json({ ok: true }));
  api.get('/agent/connect', (c) => c.json(connect?.() ?? null));
  api.get('/export', (c) => {
    const date = new Date().toLocaleDateString('sv-SE'); // ГГГГ-ММ-ДД по местному времени
    c.header('Content-Disposition', 'attachment; filename="trakt-' + date + '.json"');
    return c.json(d.exportAll(ctx));
  });

  // глобальные настройки
  api.get('/settings', (c) => c.json(d.getAppSettings(ctx)));
  api.put('/settings', async (c) => c.json(d.updateAppSettings(ctx, await body(c, updateAppSettingsInput))));

  // проекты
  api.get('/projects', (c) => c.json(d.listProjects(ctx)));
  api.post('/projects', async (c) =>
    c.json(d.createProject(ctx, await body(c, createProjectInput), you), 201),
  );
  api.patch('/projects/:id', async (c) =>
    c.json(d.updateProject(ctx, c.req.param('id'), await body(c, updateProjectInput))),
  );
  api.delete('/projects/:id', (c) => {
    runner?.stopProject(c.req.param('id'));
    d.deleteProject(ctx, c.req.param('id'), you);
    return c.json({ ok: true });
  });
  api.get('/projects/:id/board', (c) => c.json(d.getBoard(ctx, c.req.param('id'))));
  api.get('/projects/:id/events', (c) => {
    const limit = Math.min(Number(c.req.query('limit')) || 50, 500);
    return c.json(d.listProjectEvents(ctx, c.req.param('id'), limit));
  });

  // статусы
  api.post('/projects/:id/statuses', async (c) =>
    c.json(d.createStatus(ctx, c.req.param('id'), await body(c, createStatusInput), you), 201),
  );
  api.patch('/statuses/:id', async (c) =>
    c.json(d.updateStatus(ctx, c.req.param('id'), await body(c, updateStatusInput))),
  );
  api.post('/statuses/:id/move', async (c) =>
    c.json(d.moveStatus(ctx, c.req.param('id'), (await body(c, moveStatusInput)).toIndex)),
  );
  api.delete('/statuses/:id', (c) => c.json(d.deleteStatus(ctx, c.req.param('id'), you)));

  // типы и поля шаблона
  api.post('/projects/:id/types', async (c) =>
    c.json(d.createType(ctx, c.req.param('id'), await body(c, createTypeInput), you), 201),
  );
  api.patch('/types/:id', async (c) =>
    c.json(d.updateType(ctx, c.req.param('id'), await body(c, updateTypeInput))),
  );
  api.delete('/types/:id', (c) => c.json(d.deleteType(ctx, c.req.param('id'), you)));
  api.post('/types/:id/fields', async (c) =>
    c.json(d.createField(ctx, c.req.param('id'), await body(c, createFieldInput)), 201),
  );
  api.patch('/fields/:id', async (c) =>
    c.json(d.updateField(ctx, c.req.param('id'), await body(c, updateFieldInput))),
  );
  api.delete('/fields/:id', (c) => {
    d.deleteField(ctx, c.req.param('id'));
    return c.json({ ok: true });
  });

  // воркфлоу и агент
  api.put('/projects/:id/workflow', async (c) =>
    c.json(d.setWorkflow(ctx, c.req.param('id'), (await body(c, setWorkflowInput)).transitions)),
  );
  api.put('/projects/:id/agent-settings', async (c) =>
    c.json(d.updateAgentSettings(ctx, c.req.param('id'), await body(c, updateAgentSettingsInput))),
  );

  // задачи
  /** Задачу отдали агенту / забрали — раннер запускает или останавливает прогоны. */
  const ownershipChanged = (taskId: string, before: boolean, after: boolean | undefined) => {
    if (!runner || after === undefined || after === before) return;
    if (after) runner.handOver(taskId);
    else runner.stopTask(taskId);
  };
  const withRuns = (t: TaskDetail): TaskDetail => ({ ...t, runs: runner?.runsForTask(t.id) ?? [] });

  api.post('/projects/:id/tasks', async (c) => {
    const t = d.createTask(ctx, c.req.param('id'), await body(c, createTaskInput), you);
    ownershipChanged(t.id, false, t.agentOwned);
    return c.json(withRuns(d.getTaskDetail(ctx, t.id)), 201);
  });
  api.get('/tasks/:id', (c) => c.json(withRuns(d.getTaskDetail(ctx, c.req.param('id')))));
  api.patch('/tasks/:id', async (c) => {
    const id = c.req.param('id');
    const before = d.getTaskCard(ctx, id).agentOwned;
    const input = await body(c, updateTaskInput);
    d.updateTask(ctx, id, input, you);
    ownershipChanged(id, before, input.agentOwned);
    return c.json(withRuns(d.getTaskDetail(ctx, id)));
  });
  api.post('/tasks/:id/move', async (c) => {
    const id = c.req.param('id');
    const before = d.getTaskCard(ctx, id).agentOwned;
    const input = await body(c, moveTaskInput);
    const card = d.moveTask(ctx, id, input, you);
    ownershipChanged(id, before, input.agentOwned);
    return c.json(card);
  });
  api.delete('/tasks/:id', (c) => {
    runner?.stopTask(c.req.param('id'));
    d.deleteTask(ctx, c.req.param('id'), you);
    return c.json({ ok: true });
  });

  // прогоны агента (push)
  const needRunner = () => {
    if (!runner) throw d.invalid('Запуск агентов недоступен');
    return runner;
  };
  api.post('/tasks/:id/run', (c) => c.json(needRunner().runTask(c.req.param('id'))));
  api.post('/subtasks/:id/run', (c) => c.json(needRunner().runSubtask(c.req.param('id'))));
  api.post('/runs/:id/stop', (c) => {
    needRunner().stopRun(c.req.param('id'));
    return c.json({ ok: true });
  });

  // сабтаски
  api.post('/tasks/:id/subtasks', async (c) =>
    c.json(d.addSubtask(ctx, c.req.param('id'), (await body(c, createSubtaskInput)).title, you), 201),
  );
  api.patch('/subtasks/:id', async (c) =>
    c.json(d.updateSubtask(ctx, c.req.param('id'), await body(c, updateSubtaskInput), you)),
  );
  api.delete('/subtasks/:id', (c) => {
    d.deleteSubtask(ctx, c.req.param('id'), you);
    return c.json({ ok: true });
  });

  // AI-функции доски
  const needAi = () => {
    const provider = currentAi();
    if (!provider) throw d.invalid(statusOf(null).hint!);
    return provider;
  };
  const suggestSubtasks = async (task: { title: string; description: string; fields?: string[] }) => {
    const titles = parseSubtasks(await needAi().generate(splitPrompt(task)));
    if (!titles.length) throw d.invalid('AI не предложил сабтаски — попробуйте ещё раз');
    return titles;
  };
  api.get('/ai', (c) => c.json(statusOf(currentAi())));

  // источники агентов
  const needAgents = () => {
    if (!agents) throw d.invalid('Настройка агентов недоступна');
    return agents;
  };
  api.get('/agents', async (c) => c.json(await needAgents().overview()));
  api.put('/agents', async (c) => {
    d.updateAgentsConfig(ctx, await body(c, updateAgentsInput));
    return c.json(await needAgents().overview());
  });
  api.post('/agents/check', async (c) =>
    c.json(await needAgents().check((await body(c, checkAgentInput)).target)),
  );
  api.post('/ai/split', async (c) => {
    const input = await body(c, aiSplitInput);
    return c.json({
      subtasks: await suggestSubtasks({ title: input.title, description: input.description ?? '' }),
    });
  });
  api.post('/tasks/:id/split', async (c) => {
    const t = d.getTaskDetail(ctx, c.req.param('id'));
    const fields = d
      .listFields(ctx, t.typeId)
      .filter((f) => f.visibleToAgent && t.fields[f.id])
      .map((f) => `${f.name}: ${String(t.fields[f.id])}`);
    const titles = await suggestSubtasks({ title: t.title, description: t.description, fields });
    d.addSubtasks(ctx, t.id, titles, 'AI');
    return c.json(withRuns(d.getTaskDetail(ctx, t.id)));
  });
  /** Идея из «+»: поток NDJSON {t: дельта} … {done: true} | {error}. */
  api.post('/ai/generate', async (c) => {
    const input = await body(c, aiGenerateInput);
    const provider = needAi();
    const p = d.getProject(ctx, input.projectId);
    const board = d.getBoard(ctx, p.id);
    const tasks = board.tasks.map(
      (t) => `${t.key} [${board.statuses.find((s) => s.id === t.statusId)?.name ?? ''}] ${t.title}`,
    );
    c.header('Content-Type', 'application/x-ndjson; charset=utf-8');
    return streamBody(c, async (out) => {
      const abort = new AbortController();
      out.onAbort(() => abort.abort());
      let sent = 0;
      const write = (obj: unknown) => out.write(JSON.stringify(obj) + '\n');
      try {
        const text = await provider.generate(ideaPrompt(p.name, tasks, input.text), {
          signal: abort.signal,
          onText: (full) => {
            if (full.length > sent) void write({ t: full.slice(sent) });
            sent = full.length;
          },
        });
        if (text.length > sent) await write({ t: text.slice(sent) });
        await write({ done: true });
      } catch (e) {
        if (!abort.signal.aborted) await write({ error: e instanceof Error ? e.message : String(e) });
      }
    });
  });

  // идеи
  api.get('/projects/:id/ideas', (c) => c.json(d.listIdeas(ctx, c.req.param('id'))));
  api.post('/projects/:id/ideas', async (c) =>
    c.json(d.createIdea(ctx, c.req.param('id'), await body(c, createIdeaInput)), 201),
  );
  api.delete('/ideas/:id', (c) => {
    d.deleteIdea(ctx, c.req.param('id'));
    return c.json({ ok: true });
  });

  // живые обновления
  api.get('/events', (c) =>
    streamSSE(c, async (stream) => {
      const queue: LiveMessage[] = [];
      let wake: (() => void) | null = null;
      const unsubscribe = ctx.bus.subscribe((m) => {
        queue.push(m);
        wake?.();
      });
      stream.onAbort(unsubscribe);
      await stream.writeSSE({ event: 'hello', data: '{}' });
      while (!stream.aborted) {
        const m = queue.shift();
        if (m) {
          await stream.writeSSE({ event: 'change', data: JSON.stringify(m) });
          continue;
        }
        // ждём событие или 25 секунд для пинга, чтобы соединение не засыпало
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 25_000);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        wake = null;
        if (!queue.length && !stream.aborted) await stream.writeSSE({ event: 'ping', data: '{}' });
      }
      unsubscribe();
    }),
  );

  api.all('*', (c) => c.json({ error: 'Не найдено' }, 404));
  app.route('/api', api);

  // MCP для агентов (Streamable HTTP)
  app.all('/mcp', mcpHandler(ctx, registry));

  if (webDist) app.get('*', serveWeb(webDist));

  return app;
}
