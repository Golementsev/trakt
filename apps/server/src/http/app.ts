import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
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
  type LiveMessage,
} from '@trakt/shared';
import * as d from '../domain';
import { serveWeb } from './static';

export interface AppOptions {
  ctx: d.Ctx;
  /** Папка собранного фронта. Если нет — статику не отдаём (dev, тесты). */
  webDist?: string;
}

async function body<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  const raw: unknown = await c.req.json().catch(() => ({}));
  return schema.parse(raw);
}

export function createApp({ ctx, webDist }: AppOptions) {
  const app = new Hono();
  const api = new Hono();
  const you = ACTOR_YOU;

  api.onError((err, c) => {
    if (err instanceof d.DomainError) return c.json({ error: err.message }, err.status);
    if (err instanceof ZodError) return c.json({ error: err.issues[0]?.message ?? 'Неверные данные' }, 400);
    console.error(err);
    return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
  });

  api.get('/health', (c) => c.json({ ok: true }));

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
  api.post('/projects/:id/tasks', async (c) =>
    c.json(d.createTask(ctx, c.req.param('id'), await body(c, createTaskInput), you), 201),
  );
  api.get('/tasks/:id', (c) => c.json(d.getTaskDetail(ctx, c.req.param('id'))));
  api.patch('/tasks/:id', async (c) =>
    c.json(d.updateTask(ctx, c.req.param('id'), await body(c, updateTaskInput), you)),
  );
  api.post('/tasks/:id/move', async (c) =>
    c.json(d.moveTask(ctx, c.req.param('id'), await body(c, moveTaskInput), you)),
  );
  api.delete('/tasks/:id', (c) => {
    d.deleteTask(ctx, c.req.param('id'), you);
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

  if (webDist) app.get('*', serveWeb(webDist));

  return app;
}
