import type { BoardEvent, LiveMessage } from '@trakt/shared';
import type { Actor, Ctx } from './context';

interface EventRow {
  id: number;
  project_id: string;
  task_id: string | null;
  actor: string;
  kind: string;
  summary: string;
  note: string | null;
  at: string;
}

const toEvent = (r: EventRow): BoardEvent => ({
  id: r.id,
  projectId: r.project_id,
  taskId: r.task_id,
  actor: r.actor,
  kind: r.kind,
  summary: r.summary,
  note: r.note,
  at: r.at,
});

export interface NewEvent {
  projectId: string;
  taskId?: string | null;
  actor: Actor;
  kind: string;
  summary: string;
  note?: string | null;
}

/** Пишет событие в ленту и сообщает живым клиентам. */
export function record(ctx: Ctx, e: NewEvent) {
  ctx.db.run(
    'INSERT INTO events (project_id, task_id, actor, kind, summary, note, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    e.projectId,
    e.taskId ?? null,
    e.actor,
    e.kind,
    e.summary,
    e.note || null,
    ctx.now(),
  );
  notify(ctx, { projectId: e.projectId, taskId: e.taskId ?? null, actor: e.actor, kind: e.kind });
}

/** Изменение без записи в ленту (правка текста, цвета) — только живое обновление. */
export function notify(ctx: Ctx, msg: LiveMessage) {
  ctx.bus.publish(msg);
}

export function listProjectEvents(ctx: Ctx, projectId: string, limit = 50): BoardEvent[] {
  return ctx.db
    .all<EventRow>('SELECT * FROM events WHERE project_id = ? ORDER BY id DESC LIMIT ?', projectId, limit)
    .map(toEvent);
}

export function listTaskEvents(ctx: Ctx, taskId: string, limit = 30): BoardEvent[] {
  return ctx.db
    .all<EventRow>('SELECT * FROM events WHERE task_id = ? ORDER BY id DESC LIMIT ?', taskId, limit)
    .map(toEvent);
}
