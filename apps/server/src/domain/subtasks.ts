import type { Subtask, UpdateSubtaskInput } from '@trakt/shared';
import { bool, notFound, verb, type Actor, type Ctx } from './context';
import { notify, record } from './events';
import { getTaskRow, listSubtasks, taskKey } from './tasks';

interface SubtaskRow {
  id: string;
  task_id: string;
  title: string;
  done: number;
  state: Subtask['state'];
  position: number;
}

export function getSubtaskRow(ctx: Ctx, id: string): SubtaskRow {
  const r = ctx.db.get<SubtaskRow>('SELECT * FROM subtasks WHERE id = ?', id);
  if (!r) throw notFound('Сабтаска');
  return r;
}

const one = (ctx: Ctx, s: SubtaskRow) => listSubtasks(ctx, s.task_id).find((x) => x.id === s.id)!;

export function addSubtask(ctx: Ctx, taskId: string, title: string, actor: Actor = 'you'): Subtask {
  const t = getTaskRow(ctx, taskId);
  const id = ctx.newId();
  const pos = ctx.db.get<{ p: number }>(
    'SELECT COALESCE(MAX(position), -1) + 1 AS p FROM subtasks WHERE task_id = ?',
    taskId,
  )!.p;
  ctx.db.run(
    'INSERT INTO subtasks (id, task_id, title, done, state, position) VALUES (?, ?, ?, 0, ?, ?)',
    id,
    taskId,
    title.trim(),
    'idle',
    pos,
  );
  notify(ctx, { projectId: t.project_id, taskId, actor, kind: 'subtask.added' });
  return one(ctx, getSubtaskRow(ctx, id));
}

export function updateSubtask(
  ctx: Ctx,
  id: string,
  input: UpdateSubtaskInput,
  actor: Actor = 'you',
): Subtask {
  const s = getSubtaskRow(ctx, id);
  const t = getTaskRow(ctx, s.task_id);
  ctx.db.tx(() => {
    if (input.title !== undefined) ctx.db.run('UPDATE subtasks SET title = ? WHERE id = ?', input.title, id);
    if (input.done !== undefined && input.done !== bool(s.done)) {
      ctx.db.run(
        'UPDATE subtasks SET done = ?, state = ? WHERE id = ?',
        input.done ? 1 : 0,
        input.done ? 'done' : 'idle',
        id,
      );
      if (input.done)
        record(ctx, {
          projectId: t.project_id,
          taskId: t.id,
          actor,
          kind: 'subtask.done',
          summary: `${verb(actor, 'закрыли', 'закрыл')} сабтаску в ${taskKey(ctx, t)}`,
          note: s.title,
        });
    }
  });
  notify(ctx, { projectId: t.project_id, taskId: t.id, actor, kind: 'subtask.updated' });
  return one(ctx, getSubtaskRow(ctx, id));
}

export function deleteSubtask(ctx: Ctx, id: string, actor: Actor = 'you') {
  const s = getSubtaskRow(ctx, id);
  const t = getTaskRow(ctx, s.task_id);
  ctx.db.run('DELETE FROM subtasks WHERE id = ?', id);
  notify(ctx, { projectId: t.project_id, taskId: t.id, actor, kind: 'subtask.deleted' });
}

/** Несколько сабтасок разом (например, «✦ Разбить с AI») — одним событием в ленте. */
export function addSubtasks(ctx: Ctx, taskId: string, titles: string[], actor: Actor) {
  const t = getTaskRow(ctx, taskId);
  ctx.db.tx(() => {
    for (const title of titles) addSubtask(ctx, taskId, title, actor);
    record(ctx, {
      projectId: t.project_id,
      taskId,
      actor,
      kind: 'subtask.split',
      summary: `разбил ${taskKey(ctx, t)} на сабтаски`,
      note: titles.join(' · '),
    });
  });
}
