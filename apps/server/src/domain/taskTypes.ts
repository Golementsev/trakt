import type {
  CreateFieldInput,
  CreateTypeInput,
  Field,
  TaskType,
  UpdateFieldInput,
  UpdateTypeInput,
} from '@trakt/shared';
import { bool, invalid, notFound, verb, type Actor, type Ctx } from './context';
import { notify, record } from './events';
import { getProjectRow } from './projects';

interface TypeRow {
  id: string;
  project_id: string;
  name: string;
  color: string;
  position: number;
}

interface FieldRow {
  id: string;
  type_id: string;
  name: string;
  kind: Field['kind'];
  required: number;
  visible_to_agent: number;
  position: number;
}

const toField = (r: FieldRow): Field => ({
  id: r.id,
  typeId: r.type_id,
  name: r.name,
  kind: r.kind,
  required: bool(r.required),
  visibleToAgent: bool(r.visible_to_agent),
  position: r.position,
});

export const NEW_TYPE_COLOR = '#C0567A';

export function listFields(ctx: Ctx, typeId: string): Field[] {
  return ctx.db
    .all<FieldRow>('SELECT * FROM template_fields WHERE type_id = ? ORDER BY position', typeId)
    .map(toField);
}

export function listTypes(ctx: Ctx, projectId: string): TaskType[] {
  const rows = ctx.db.all<TypeRow & { task_count: number }>(
    `SELECT tt.*, (SELECT COUNT(*) FROM tasks t WHERE t.type_id = tt.id) AS task_count
     FROM task_types tt WHERE project_id = ? ORDER BY position`,
    projectId,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    position: r.position,
    fields: listFields(ctx, r.id),
    taskCount: r.task_count,
  }));
}

export function getTypeRow(ctx: Ctx, id: string): TypeRow {
  const r = ctx.db.get<TypeRow>('SELECT * FROM task_types WHERE id = ?', id);
  if (!r) throw notFound('Тип задачи');
  return r;
}

function typeOf(ctx: Ctx, id: string): TaskType {
  const t = listTypes(ctx, getTypeRow(ctx, id).project_id).find((x) => x.id === id);
  if (!t) throw notFound('Тип задачи');
  return t;
}

/** Новый тип сразу получает одно поле «Ожидаемый результат» (как в макете). */
export function createType(ctx: Ctx, projectId: string, input: CreateTypeInput, actor: Actor = 'you') {
  getProjectRow(ctx, projectId);
  return ctx.db.tx(() => {
    const id = ctx.newId();
    const name = input.name ?? 'Новый тип';
    const pos = ctx.db.get<{ p: number }>(
      'SELECT COALESCE(MAX(position), -1) + 1 AS p FROM task_types WHERE project_id = ?',
      projectId,
    )!.p;
    ctx.db.run(
      'INSERT INTO task_types (id, project_id, name, color, position) VALUES (?, ?, ?, ?, ?)',
      id,
      projectId,
      name,
      input.color ?? NEW_TYPE_COLOR,
      pos,
    );
    createField(ctx, id, { name: 'Ожидаемый результат', kind: 'text', required: true, visibleToAgent: true });
    record(ctx, {
      projectId,
      actor,
      kind: 'type.added',
      summary: `${verb(actor, 'добавили', 'добавил')} тип задач «${name}»`,
    });
    return typeOf(ctx, id);
  });
}

export function updateType(ctx: Ctx, id: string, input: UpdateTypeInput): TaskType {
  const t = getTypeRow(ctx, id);
  if (input.name !== undefined) ctx.db.run('UPDATE task_types SET name = ? WHERE id = ?', input.name, id);
  if (input.color !== undefined) ctx.db.run('UPDATE task_types SET color = ? WHERE id = ?', input.color, id);
  notify(ctx, { projectId: t.project_id, actor: 'you', kind: 'type.updated' });
  return typeOf(ctx, id);
}

/** Удалить тип: задачи переходят в первый оставшийся тип. Минимум один тип. */
export function deleteType(ctx: Ctx, id: string, actor: Actor = 'you') {
  const t = getTypeRow(ctx, id);
  return ctx.db.tx(() => {
    const rest = ctx.db.all<TypeRow>(
      'SELECT * FROM task_types WHERE project_id = ? AND id <> ? ORDER BY position',
      t.project_id,
      id,
    );
    if (!rest.length) throw invalid('Нужен хотя бы один тип');
    const target = rest[0]!;
    const moved = ctx.db.run('UPDATE tasks SET type_id = ? WHERE type_id = ?', target.id, id).changes;
    ctx.db.run('DELETE FROM task_types WHERE id = ?', id);
    rest.forEach((r, i) => ctx.db.run('UPDATE task_types SET position = ? WHERE id = ?', i, r.id));
    record(ctx, {
      projectId: t.project_id,
      actor,
      kind: 'type.deleted',
      summary: `${verb(actor, 'удалили', 'удалил')} тип задач «${t.name}»`,
      note: moved ? `${moved} задач стали «${target.name}»` : null,
    });
    return { movedTo: target.id, moved: Number(moved) };
  });
}

export function getFieldRow(ctx: Ctx, id: string): FieldRow {
  const r = ctx.db.get<FieldRow>('SELECT * FROM template_fields WHERE id = ?', id);
  if (!r) throw notFound('Поле');
  return r;
}

export function createField(ctx: Ctx, typeId: string, input: CreateFieldInput): Field {
  const t = getTypeRow(ctx, typeId);
  const id = ctx.newId();
  const pos = ctx.db.get<{ p: number }>(
    'SELECT COALESCE(MAX(position), -1) + 1 AS p FROM template_fields WHERE type_id = ?',
    typeId,
  )!.p;
  ctx.db.run(
    `INSERT INTO template_fields (id, type_id, name, kind, required, visible_to_agent, position)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    typeId,
    input.name ?? 'Новое поле',
    input.kind ?? 'text',
    input.required ? 1 : 0,
    input.visibleToAgent === false ? 0 : 1,
    pos,
  );
  notify(ctx, { projectId: t.project_id, actor: 'you', kind: 'field.added' });
  return toField(getFieldRow(ctx, id));
}

export function updateField(ctx: Ctx, id: string, input: UpdateFieldInput): Field {
  const f = getFieldRow(ctx, id);
  const t = getTypeRow(ctx, f.type_id);
  const set = (col: string, v: string | number) =>
    ctx.db.run(`UPDATE template_fields SET ${col} = ? WHERE id = ?`, v, id);
  if (input.name !== undefined) set('name', input.name);
  if (input.kind !== undefined && input.kind !== f.kind) {
    set('kind', input.kind);
    // значения старого вида не имеют смысла для нового
    ctx.db.run('DELETE FROM task_field_values WHERE field_id = ?', id);
  }
  if (input.required !== undefined) set('required', input.required ? 1 : 0);
  if (input.visibleToAgent !== undefined) set('visible_to_agent', input.visibleToAgent ? 1 : 0);
  notify(ctx, { projectId: t.project_id, actor: 'you', kind: 'field.updated' });
  return toField(getFieldRow(ctx, id));
}

export function deleteField(ctx: Ctx, id: string) {
  const f = getFieldRow(ctx, id);
  const t = getTypeRow(ctx, f.type_id);
  ctx.db.run('DELETE FROM template_fields WHERE id = ?', id);
  notify(ctx, { projectId: t.project_id, actor: 'you', kind: 'field.deleted' });
}
