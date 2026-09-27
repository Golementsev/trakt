import type { CreateStatusInput, Status, UpdateStatusInput } from '@trakt/shared';
import { invalid, notFound, verb, type Actor, type Ctx } from './context';
import { notify, record } from './events';
import { getProjectRow } from './projects';

interface StatusRow {
  id: string;
  project_id: string;
  name: string;
  color: string;
  category: Status['category'];
  position: number;
}

const toStatus = (r: StatusRow): Status => ({
  id: r.id,
  name: r.name,
  color: r.color,
  category: r.category,
  position: r.position,
});

export const NEW_STATUS_COLOR = '#4A90B8';
export const MIN_STATUSES = 2;

export function listStatuses(ctx: Ctx, projectId: string): Status[] {
  return ctx.db
    .all<StatusRow>('SELECT * FROM statuses WHERE project_id = ? ORDER BY position', projectId)
    .map(toStatus);
}

export function getStatusRow(ctx: Ctx, id: string): StatusRow {
  const r = ctx.db.get<StatusRow>('SELECT * FROM statuses WHERE id = ?', id);
  if (!r) throw notFound('Статус');
  return r;
}

/** Перенумеровать позиции 0..n-1 в заданном порядке. */
function writeOrder(ctx: Ctx, ids: string[]) {
  ids.forEach((id, i) => ctx.db.run('UPDATE statuses SET position = ? WHERE id = ?', i, id));
}

/**
 * Новый статус. Место: после afterStatusId; null — в начало; не задано — перед
 * первым статусом категории «done» (или в конец). Получает переходы в/из всех статусов.
 */
export function createStatus(ctx: Ctx, projectId: string, input: CreateStatusInput, actor: Actor = 'you') {
  getProjectRow(ctx, projectId);
  return ctx.db.tx(() => {
    const list = listStatuses(ctx, projectId);
    let at: number;
    if (input.afterStatusId === null) at = 0;
    else if (input.afterStatusId !== undefined) {
      const i = list.findIndex((s) => s.id === input.afterStatusId);
      if (i < 0) throw notFound('Статус');
      at = i + 1;
    } else {
      const done = list.findIndex((s) => s.category === 'done');
      at = done < 0 ? list.length : done;
    }
    const id = ctx.newId();
    ctx.db.run(
      'INSERT INTO statuses (id, project_id, name, color, category, position) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      projectId,
      input.name,
      NEW_STATUS_COLOR,
      'doing',
      at,
    );
    const ids = list.map((s) => s.id);
    ids.splice(at, 0, id);
    writeOrder(ctx, ids);
    for (const other of list) {
      const ins =
        'INSERT INTO workflow_transitions (project_id, from_status_id, to_status_id) VALUES (?, ?, ?)';
      ctx.db.run(ins, projectId, other.id, id);
      ctx.db.run(ins, projectId, id, other.id);
    }
    record(ctx, {
      projectId,
      actor,
      kind: 'status.added',
      summary: `${verb(actor, 'добавили', 'добавил')} статус «${input.name}»`,
    });
    return toStatus(getStatusRow(ctx, id));
  });
}

export function updateStatus(ctx: Ctx, id: string, input: UpdateStatusInput): Status {
  const s = getStatusRow(ctx, id);
  if (input.name !== undefined) ctx.db.run('UPDATE statuses SET name = ? WHERE id = ?', input.name, id);
  if (input.color !== undefined) ctx.db.run('UPDATE statuses SET color = ? WHERE id = ?', input.color, id);
  if (input.category !== undefined)
    ctx.db.run('UPDATE statuses SET category = ? WHERE id = ?', input.category, id);
  notify(ctx, { projectId: s.project_id, actor: 'you', kind: 'status.updated' });
  return toStatus(getStatusRow(ctx, id));
}

export function moveStatus(ctx: Ctx, id: string, toIndex: number): Status[] {
  const s = getStatusRow(ctx, id);
  return ctx.db.tx(() => {
    const ids = listStatuses(ctx, s.project_id).map((x) => x.id);
    const from = ids.indexOf(id);
    const to = Math.min(Math.max(0, toIndex), ids.length - 1);
    if (from !== to) {
      ids.splice(from, 1);
      ids.splice(to, 0, id);
      writeOrder(ctx, ids);
      notify(ctx, { projectId: s.project_id, actor: 'you', kind: 'status.moved' });
    }
    return listStatuses(ctx, s.project_id);
  });
}

/**
 * Удалить статус. Задачи переезжают в соседний левый (или первый оставшийся),
 * туда же переносится «не дальше статуса» агента. На доске остаётся минимум два статуса.
 */
export function deleteStatus(ctx: Ctx, id: string, actor: Actor = 'you') {
  const s = getStatusRow(ctx, id);
  return ctx.db.tx(() => {
    const list = listStatuses(ctx, s.project_id);
    if (list.length <= MIN_STATUSES) throw invalid('На доске должно остаться хотя бы два статуса');
    const idx = list.findIndex((x) => x.id === id);
    const rest = list.filter((x) => x.id !== id);
    const target = rest[Math.max(0, idx - 1)]!;

    const tail = ctx.db.get<{ p: number }>(
      'SELECT COALESCE(MAX(position), 0) AS p FROM tasks WHERE status_id = ?',
      target.id,
    )!.p;
    const moving = ctx.db.all<{ id: string }>(
      'SELECT id FROM tasks WHERE status_id = ? ORDER BY position',
      id,
    );
    moving.forEach((t, i) =>
      ctx.db.run('UPDATE tasks SET status_id = ?, position = ? WHERE id = ?', target.id, tail + i + 1, t.id),
    );
    ctx.db.run('UPDATE agent_settings SET max_status_id = ? WHERE max_status_id = ?', target.id, id);
    ctx.db.run('DELETE FROM statuses WHERE id = ?', id);
    writeOrder(
      ctx,
      rest.map((x) => x.id),
    );
    record(ctx, {
      projectId: s.project_id,
      actor,
      kind: 'status.deleted',
      summary: `${verb(actor, 'удалили', 'удалил')} статус «${s.name}»`,
      note: moving.length ? `${moving.length} задач перенесено в «${target.name}»` : null,
    });
    return { movedTo: target.id, moved: moving.length };
  });
}
