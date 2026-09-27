import { describe, expect, it } from 'vitest';
import type { Board, LiveMessage, ProjectSummary } from '@trakt/shared';
import { Db } from '../db/db';
import { createCtx, seedDemo } from '../domain';
import { createApp } from './app';

function makeApp() {
  const ctx = createCtx(new Db(':memory:'));
  return { ctx, app: createApp({ ctx }) };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const read = async <T = any>(res: Response | Promise<Response>) => (await (await res).json()) as T;

const json = (method: string, body: unknown) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

describe('http api', () => {
  it('answers health check and json 404', async () => {
    const { app } = makeApp();
    expect(await read(app.request('/api/health'))).toEqual({ ok: true });
    expect((await app.request('/api/nope')).status).toBe(404);
  });

  it('creates a project and a task, rejects bad input with a readable error', async () => {
    const { app } = makeApp();
    const p = await read(app.request('/api/projects', json('POST', { name: 'Тест' })));
    const board: Board = await read(app.request(`/api/projects/${p.id}/board`));
    expect(board.statuses).toHaveLength(5);

    const bad = await app.request(`/api/projects/${p.id}/tasks`, json('POST', { title: '', typeId: 'x' }));
    expect(bad.status).toBe(400);
    expect((await read(bad)).error).toBe('Напишите, что нужно сделать');

    const typeId = board.types[3]!.id;
    const res = await app.request(`/api/projects/${p.id}/tasks`, json('POST', { title: 'Задача', typeId }));
    expect(res.status).toBe(201);
    const task = await read(res);

    const denied = await app.request(
      `/api/tasks/${task.id}/move`,
      json('POST', { statusId: board.statuses[4]!.id }),
    );
    expect(denied.status).toBe(409);
    expect((await read(denied)).error).toContain('запрещён воркфлоу');
  });

  it('publishes live messages on mutations', async () => {
    const { app, ctx } = makeApp();
    const got: LiveMessage[] = [];
    ctx.bus.subscribe((m) => got.push(m));
    await app.request('/api/projects', json('POST', { name: 'Тест' }));
    expect(got.map((m) => m.kind)).toEqual(['project.created']);
  });

  it('seeds the demo board from the mockup', async () => {
    const { app, ctx } = makeApp();
    expect(seedDemo(ctx)).toBe(true);
    expect(seedDemo(ctx)).toBe(false);
    const projects: ProjectSummary[] = await read(app.request('/api/projects'));
    expect(projects.map((p) => [p.key, p.taskCount])).toEqual([
      ['PAY', 11],
      ['MOB', 4],
      ['OPS', 2],
    ]);
    const board: Board = await read(app.request(`/api/projects/${projects[0]!.id}/board`));
    const pay12 = board.tasks.find((t) => t.key === 'PAY-12')!;
    expect(pay12.subtasks).toEqual({ done: 1, total: 4 });
    const events = await read(app.request(`/api/projects/${projects[0]!.id}/events`));
    expect(events.map((e: { actor: string }) => e.actor)).toEqual(['Агент', 'Агент']);
  });
});
