import { invalid, type Ctx } from './context';
import { notify } from './events';
import { getProjectRow } from './projects';

export function listTransitions(ctx: Ctx, projectId: string): Array<[string, string]> {
  return ctx.db
    .all<{ f: string; t: string }>(
      'SELECT from_status_id AS f, to_status_id AS t FROM workflow_transitions WHERE project_id = ?',
      projectId,
    )
    .map((r) => [r.f, r.t]);
}

export function isTransitionAllowed(ctx: Ctx, fromStatusId: string, toStatusId: string): boolean {
  if (fromStatusId === toStatusId) return true;
  return !!ctx.db.get(
    'SELECT 1 FROM workflow_transitions WHERE from_status_id = ? AND to_status_id = ?',
    fromStatusId,
    toStatusId,
  );
}

/** Статусы, в которые можно перейти из данного (по матрице воркфлоу), в порядке колонок. */
export function allowedTargets(ctx: Ctx, fromStatusId: string) {
  return ctx.db.all<{ id: string; name: string }>(
    `SELECT s.id, s.name FROM workflow_transitions w JOIN statuses s ON s.id = w.to_status_id
     WHERE w.from_status_id = ? ORDER BY s.position`,
    fromStatusId,
  );
}

/** Полностью заменить матрицу переходов проекта. */
export function setWorkflow(ctx: Ctx, projectId: string, transitions: Array<[string, string]>) {
  getProjectRow(ctx, projectId);
  const own = new Set(
    ctx.db.all<{ id: string }>('SELECT id FROM statuses WHERE project_id = ?', projectId).map((r) => r.id),
  );
  for (const [f, t] of transitions) {
    if (!own.has(f) || !own.has(t)) throw invalid('Переход ссылается на статус другого проекта');
    if (f === t) throw invalid('Переход в тот же статус не нужен');
  }
  ctx.db.tx(() => {
    ctx.db.run('DELETE FROM workflow_transitions WHERE project_id = ?', projectId);
    for (const [f, t] of transitions) {
      ctx.db.run(
        'INSERT OR IGNORE INTO workflow_transitions (project_id, from_status_id, to_status_id) VALUES (?, ?, ?)',
        projectId,
        f,
        t,
      );
    }
  });
  notify(ctx, { projectId, actor: 'you', kind: 'workflow.updated' });
  return listTransitions(ctx, projectId);
}
