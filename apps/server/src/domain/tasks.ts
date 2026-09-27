import type {
  CreateTaskInput,
  FieldValue,
  MoveTaskInput,
  Subtask,
  TaskCard,
  TaskDetail,
  UpdateTaskInput,
} from '@trakt/shared';
import { bool, conflict, invalid, notFound, verb, type Actor, type Ctx } from './context';
import { listTaskEvents, notify, record } from './events';
import { missingMessage, missingRequired, normalizeFieldValue } from './fieldValues';
import { getProjectRow } from './projects';
import { getStatusRow } from './statuses';
import { getTypeRow, listFields } from './taskTypes';
import { allowedTargets, isTransitionAllowed } from './workflow';

export interface TaskRow {
  id: string;
  project_id: string;
  number: number;
  title: string;
  type_id: string;
  status_id: string;
  position: number;
  description: string;
  agent_owned: number;
  claimed_by: string | null;
  claim_until: string | null;
  created_at: string;
  updated_at: string;
}

type CardRow = TaskRow & { key: string; sub_done: number; sub_total: number; sub_running: number };

const CARD_SELECT = `
  SELECT t.*, p.key || '-' || t.number AS key,
    (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id AND s.done = 1) AS sub_done,
    (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id) AS sub_total,
    (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id AND s.state = 'running') AS sub_running
  FROM tasks t JOIN projects p ON p.id = t.project_id`;

const toCard = (r: CardRow): TaskCard => ({
  id: r.id,
  key: r.key,
  number: r.number,
  title: r.title,
  typeId: r.type_id,
  statusId: r.status_id,
  position: r.position,
  agentOwned: bool(r.agent_owned),
  claimedBy: r.claim_until && r.claim_until > new Date().toISOString() ? r.claimed_by : null,
  subtasks: { done: r.sub_done, total: r.sub_total },
  running: r.sub_running > 0,
});

export function listTaskCards(ctx: Ctx, projectId: string): TaskCard[] {
  return ctx.db
    .all<CardRow>(`${CARD_SELECT} WHERE t.project_id = ? ORDER BY t.position`, projectId)
    .map(toCard);
}

export function getTaskRow(ctx: Ctx, id: string): TaskRow {
  const r = ctx.db.get<TaskRow>('SELECT * FROM tasks WHERE id = ?', id);
  if (!r) throw notFound('Задача');
  return r;
}

export function getTaskCard(ctx: Ctx, id: string): TaskCard {
  const r = ctx.db.get<CardRow>(`${CARD_SELECT} WHERE t.id = ?`, id);
  if (!r) throw notFound('Задача');
  return toCard(r);
}

export function taskKey(ctx: Ctx, t: Pick<TaskRow, 'project_id' | 'number'>): string {
  return `${getProjectRow(ctx, t.project_id).key}-${t.number}`;
}

export function readFieldValues(ctx: Ctx, taskId: string): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  for (const r of ctx.db.all<{ field_id: string; value: string }>(
    'SELECT field_id, value FROM task_field_values WHERE task_id = ?',
    taskId,
  )) {
    out[r.field_id] = JSON.parse(r.value) as FieldValue;
  }
  return out;
}

export function listSubtasks(ctx: Ctx, taskId: string): Subtask[] {
  const rows = ctx.db.all<{
    id: string;
    title: string;
    done: number;
    state: Subtask['state'];
    position: number;
  }>('SELECT * FROM subtasks WHERE task_id = ? ORDER BY position', taskId);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    done: bool(r.done),
    state: r.state,
    position: r.position,
    log: ctx.db.all<{ text: string; at: string }>(
      'SELECT text, at FROM run_log_lines WHERE subtask_id = ? ORDER BY id',
      r.id,
    ),
  }));
}

export function getTaskDetail(ctx: Ctx, id: string): TaskDetail {
  const card = getTaskCard(ctx, id);
  const row = getTaskRow(ctx, id);
  const typeFields = new Set(listFields(ctx, row.type_id).map((f) => f.id));
  const values = readFieldValues(ctx, id);
  return {
    ...card,
    projectId: row.project_id,
    description: row.description,
    // значения полей текущего типа (после смены типа старые не показываем)
    fields: Object.fromEntries(Object.entries(values).filter(([k]) => typeFields.has(k))),
    subtasks: listSubtasks(ctx, id),
    history: listTaskEvents(ctx, id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Проверить и записать значения полей шаблона (частичное обновление). */
function writeFieldValues(ctx: Ctx, taskId: string, typeId: string, values: Record<string, FieldValue>) {
  const fields = listFields(ctx, typeId);
  for (const [fieldId, raw] of Object.entries(values)) {
    const field = fields.find((f) => f.id === fieldId);
    if (!field) throw invalid('Поле не относится к типу задачи');
    const v = normalizeFieldValue(field, raw);
    if (v === null)
      ctx.db.run('DELETE FROM task_field_values WHERE task_id = ? AND field_id = ?', taskId, fieldId);
    else
      ctx.db.run(
        'INSERT INTO task_field_values (task_id, field_id, value) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET value = excluded.value',
        taskId,
        fieldId,
        JSON.stringify(v),
      );
  }
}

function tailPosition(ctx: Ctx, statusId: string, exceptTaskId?: string): number {
  return ctx.db.get<{ p: number }>(
    'SELECT COALESCE(MAX(position), 0) + 1 AS p FROM tasks WHERE status_id = ? AND id <> ?',
    statusId,
    exceptTaskId ?? '',
  )!.p;
}

/** Позиция «перед задачей before» в колонке statusId (или в конец). */
function positionBefore(
  ctx: Ctx,
  statusId: string,
  beforeTaskId: string | null | undefined,
  movingId?: string,
) {
  if (!beforeTaskId) return tailPosition(ctx, statusId, movingId);
  const before = getTaskRow(ctx, beforeTaskId);
  if (before.status_id !== statusId) throw invalid('Задача-ориентир в другой колонке');
  const prev = ctx.db.get<{ position: number }>(
    'SELECT position FROM tasks WHERE status_id = ? AND position < ? AND id <> ? ORDER BY position DESC LIMIT 1',
    statusId,
    before.position,
    movingId ?? '',
  );
  return prev ? (prev.position + before.position) / 2 : before.position - 1;
}

export interface CreateTaskOptions {
  /** Для сида: не проверять обязательные поля и задать номер вручную. */
  skipRequired?: boolean;
  number?: number;
}

export function createTask(
  ctx: Ctx,
  projectId: string,
  input: CreateTaskInput,
  actor: Actor = 'you',
  opts: CreateTaskOptions = {},
): TaskDetail {
  const project = getProjectRow(ctx, projectId);
  const type = getTypeRow(ctx, input.typeId);
  if (type.project_id !== projectId) throw invalid('Тип задачи из другого проекта');
  const statusId =
    input.statusId ??
    ctx.db.get<{ id: string }>(
      'SELECT id FROM statuses WHERE project_id = ? ORDER BY position LIMIT 1',
      projectId,
    )!.id;
  const status = getStatusRow(ctx, statusId);
  if (status.project_id !== projectId) throw invalid('Статус из другого проекта');

  const fields = listFields(ctx, type.id);
  const values: Record<string, FieldValue> = {};
  for (const [k, v] of Object.entries(input.fields ?? {})) {
    const f = fields.find((x) => x.id === k);
    if (!f) throw invalid('Поле не относится к типу задачи');
    values[k] = normalizeFieldValue(f, v);
  }
  if (!opts.skipRequired) {
    const missing = missingRequired(fields, values);
    if (missing.length) throw invalid(missingMessage(missing));
  }

  return ctx.db.tx(() => {
    const number = opts.number ?? project.next_number;
    ctx.db.run('UPDATE projects SET next_number = MAX(next_number, ?) WHERE id = ?', number + 1, projectId);
    const id = ctx.newId();
    const now = ctx.now();
    ctx.db.run(
      `INSERT INTO tasks (id, project_id, number, title, type_id, status_id, position, description,
         agent_owned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      projectId,
      number,
      input.title.trim(),
      type.id,
      statusId,
      tailPosition(ctx, statusId),
      input.description ?? '',
      input.agentOwned ? 1 : 0,
      now,
      now,
    );
    writeFieldValues(ctx, id, type.id, values);
    (input.subtasks ?? []).forEach((title, i) =>
      ctx.db.run(
        'INSERT INTO subtasks (id, task_id, title, done, state, position) VALUES (?, ?, ?, 0, ?, ?)',
        ctx.newId(),
        id,
        title,
        'idle',
        i,
      ),
    );
    const key = `${project.key}-${number}`;
    record(ctx, {
      projectId,
      taskId: id,
      actor,
      kind: 'task.created',
      summary: `${verb(actor, 'создали', 'создал')} ${key} в «${status.name}»`,
    });
    if (input.agentOwned) recordOwnership(ctx, getTaskRow(ctx, id), true, actor);
    return getTaskDetail(ctx, id);
  });
}

function touch(ctx: Ctx, id: string) {
  ctx.db.run('UPDATE tasks SET updated_at = ? WHERE id = ?', ctx.now(), id);
}

function recordOwnership(ctx: Ctx, t: TaskRow, agentOwned: boolean, actor: Actor) {
  const key = taskKey(ctx, t);
  record(ctx, {
    projectId: t.project_id,
    taskId: t.id,
    actor,
    kind: 'task.agent',
    summary: agentOwned
      ? verb(actor, `отдали ${key} агенту`, `взял ${key}`)
      : verb(actor, `забрали ${key} у агента`, `отпустил ${key}`),
  });
}

export function updateTask(ctx: Ctx, id: string, input: UpdateTaskInput, actor: Actor = 'you'): TaskDetail {
  const t = getTaskRow(ctx, id);
  ctx.db.tx(() => {
    if (input.title !== undefined)
      ctx.db.run('UPDATE tasks SET title = ? WHERE id = ?', input.title.trim(), id);
    if (input.description !== undefined)
      ctx.db.run('UPDATE tasks SET description = ? WHERE id = ?', input.description, id);
    if (input.fields) writeFieldValues(ctx, id, t.type_id, input.fields);
    if (input.agentOwned !== undefined && input.agentOwned !== bool(t.agent_owned)) {
      ctx.db.run('UPDATE tasks SET agent_owned = ? WHERE id = ?', input.agentOwned ? 1 : 0, id);
      recordOwnership(ctx, t, input.agentOwned, actor);
    }
    touch(ctx, id);
  });
  notify(ctx, { projectId: t.project_id, taskId: id, actor, kind: 'task.updated' });
  return getTaskDetail(ctx, id);
}

/**
 * Перевести задачу в статус (и/или на место в колонке, и/или в другую дорожку).
 * Переход между статусами проверяется матрицей воркфлоу — для всех акторов.
 */
export function moveTask(
  ctx: Ctx,
  id: string,
  input: MoveTaskInput,
  actor: Actor = 'you',
  note?: string | null,
): TaskCard {
  const t = getTaskRow(ctx, id);
  const to = getStatusRow(ctx, input.statusId);
  if (to.project_id !== t.project_id) throw invalid('Статус из другого проекта');
  const from = getStatusRow(ctx, t.status_id);

  if (from.id !== to.id && !isTransitionAllowed(ctx, from.id, to.id)) {
    const allowed = allowedTargets(ctx, from.id).map((s) => `«${s.name}»`);
    throw conflict(
      `Переход «${from.name}» → «${to.name}» запрещён воркфлоу.` +
        (allowed.length ? ` Разрешено: ${allowed.join(', ')}.` : ' Из этого статуса переходов нет.'),
    );
  }
  if (input.typeId !== undefined && input.typeId !== t.type_id) {
    const type = getTypeRow(ctx, input.typeId);
    if (type.project_id !== t.project_id) throw invalid('Тип задачи из другого проекта');
  }

  ctx.db.tx(() => {
    const position = positionBefore(ctx, to.id, input.beforeTaskId, id);
    ctx.db.run('UPDATE tasks SET status_id = ?, position = ? WHERE id = ?', to.id, position, id);
    const key = taskKey(ctx, t);
    if (from.id !== to.id) {
      record(ctx, {
        projectId: t.project_id,
        taskId: id,
        actor,
        kind: 'task.moved',
        summary: `${verb(actor, 'перевели', 'перевёл')} ${key} «${from.name}» → «${to.name}»`,
        note,
      });
    }
    if (input.typeId !== undefined && input.typeId !== t.type_id) {
      ctx.db.run('UPDATE tasks SET type_id = ? WHERE id = ?', input.typeId, id);
      record(ctx, {
        projectId: t.project_id,
        taskId: id,
        actor,
        kind: 'task.type',
        summary: `${verb(actor, 'сменили', 'сменил')} тип ${key} на «${getTypeRow(ctx, input.typeId).name}»`,
      });
    }
    if (input.agentOwned !== undefined && input.agentOwned !== bool(t.agent_owned)) {
      ctx.db.run('UPDATE tasks SET agent_owned = ? WHERE id = ?', input.agentOwned ? 1 : 0, id);
      recordOwnership(ctx, t, input.agentOwned, actor);
    }
    touch(ctx, id);
  });
  notify(ctx, { projectId: t.project_id, taskId: id, actor, kind: 'task.moved' });
  return getTaskCard(ctx, id);
}

export function deleteTask(ctx: Ctx, id: string, actor: Actor = 'you') {
  const t = getTaskRow(ctx, id);
  const key = taskKey(ctx, t);
  ctx.db.tx(() => {
    ctx.db.run('DELETE FROM tasks WHERE id = ?', id);
    record(ctx, {
      projectId: t.project_id,
      actor,
      kind: 'task.deleted',
      summary: `${verb(actor, 'удалили', 'удалил')} ${key} «${t.title}»`,
    });
  });
}
