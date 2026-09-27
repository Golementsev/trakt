import type { FieldValue } from '@trakt/shared';
import { DomainError, bool, conflict, invalid, type Actor, type Ctx } from './context';
import { listTaskEvents, notify, record } from './events';
import { getAgentSettings, getProjectRow } from './projects';
import { getAppSettings } from './settings';
import { getStatusRow, listStatuses } from './statuses';
import { addSubtask, getSubtaskRow } from './subtasks';
import {
  createTask,
  getTaskRow,
  listSubtasks,
  listTaskCards,
  moveTask,
  readFieldValues,
  taskKey,
  updateTask,
  type TaskRow,
} from './tasks';
import { listFields, listTypes } from './taskTypes';
import { allowedTargets } from './workflow';
import {
  DEFAULT_CLAIM_MINUTES,
  activeClaim,
  agentMoveProblem,
  agentMoveRuleProblem,
  agentWorkProblem,
} from './agentPolicy';

/**
 * Операции агента (их вызывают MCP-инструменты). Ссылки человеческие: проект — ключ или id,
 * задача — «PAY-12» или id, статус и тип — название или id, поля — по названию.
 * Все правила — те же доменные функции, что и у UI.
 */

// ---------- ссылки ----------

interface ProjectRef {
  id: string;
  key: string;
  name: string;
  repo_path: string | null;
  dod: string;
}

export function resolveProject(ctx: Ctx, ref: string): ProjectRef {
  const r = ctx.db.get<ProjectRef>(
    'SELECT * FROM projects WHERE id = ? OR UPPER(key) = UPPER(?)',
    ref.trim(),
    ref.trim(),
  );
  if (!r) {
    const keys = ctx.db.all<{ key: string }>('SELECT key FROM projects ORDER BY position').map((p) => p.key);
    throw new DomainError(404, `Проект «${ref}» не найден. Есть: ${keys.join(', ') || 'проектов нет'}.`);
  }
  return r;
}

export function resolveTask(ctx: Ctx, ref: string): TaskRow {
  const m = /^\s*([A-Za-z]{2,5})-(\d+)\s*$/.exec(ref);
  if (m) {
    const r = ctx.db.get<TaskRow>(
      'SELECT t.* FROM tasks t JOIN projects p ON p.id = t.project_id WHERE UPPER(p.key) = UPPER(?) AND t.number = ?',
      m[1]!,
      Number(m[2]),
    );
    if (r) return r;
  }
  const r = ctx.db.get<TaskRow>('SELECT * FROM tasks WHERE id = ?', ref.trim());
  if (!r)
    throw new DomainError(
      404,
      `Задача «${ref}» не найдена. Номера задач выглядят как PAY-12 — см. list_tasks.`,
    );
  return r;
}

export function resolveStatus(ctx: Ctx, projectId: string, ref: string) {
  const list = listStatuses(ctx, projectId);
  const s =
    list.find((x) => x.id === ref) ?? list.find((x) => x.name.toLowerCase() === ref.trim().toLowerCase());
  if (!s) throw invalid(`Статус «${ref}» не найден. Есть: ${list.map((x) => `«${x.name}»`).join(', ')}.`);
  return s;
}

function resolveType(ctx: Ctx, projectId: string, ref: string) {
  const list = listTypes(ctx, projectId);
  const t =
    list.find((x) => x.id === ref) ?? list.find((x) => x.name.toLowerCase() === ref.trim().toLowerCase());
  if (!t) throw invalid(`Тип «${ref}» не найден. Есть: ${list.map((x) => `«${x.name}»`).join(', ')}.`);
  return t;
}

/** Поля по названию → по id. Агенту доступны только поля с visibleToAgent. */
function fieldsByName(ctx: Ctx, typeId: string, byName: Record<string, FieldValue>) {
  const fields = listFields(ctx, typeId).filter((f) => f.visibleToAgent);
  const out: Record<string, FieldValue> = {};
  for (const [name, v] of Object.entries(byName)) {
    const f = fields.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
    if (!f)
      throw invalid(
        `Поля «${name}» нет у этого типа. Доступные поля: ${fields.map((x) => `«${x.name}»`).join(', ') || 'нет'}.`,
      );
    out[f.id] = v;
  }
  return out;
}

// ---------- лиз ----------

const inMinutes = (ctx: Ctx, min: number) => new Date(Date.parse(ctx.now()) + min * 60_000).toISOString();

/** Любое действие агента по задаче продлевает его лиз. */
function extendClaim(ctx: Ctx, t: TaskRow, agent: Actor) {
  if (activeClaim(ctx, t) !== agent) return;
  const until = inMinutes(ctx, DEFAULT_CLAIM_MINUTES);
  if (until > (t.claim_until ?? '')) ctx.db.run('UPDATE tasks SET claim_until = ? WHERE id = ?', until, t.id);
}

function assertMayWork(ctx: Ctx, t: TaskRow, agent: Actor) {
  const problem = agentWorkProblem(ctx, t, agent, taskKey(ctx, t));
  if (problem) throw conflict(problem);
}

// ---------- чтение ----------

export function agentListProjects(ctx: Ctx) {
  return ctx.db
    .all<ProjectRef>('SELECT * FROM projects ORDER BY position')
    .map((p) => ({ id: p.id, key: p.key, name: p.name, repoPath: p.repo_path }));
}

export function agentBoard(ctx: Ctx, projectRef: string) {
  const p = resolveProject(ctx, projectRef);
  const settings = getAgentSettings(ctx, p.id);
  const statuses = listStatuses(ctx, p.id);
  return {
    project: { id: p.id, key: p.key, name: p.name, repoPath: p.repo_path },
    statuses: statuses.map((s, i) => ({ id: s.id, name: s.name, category: s.category, order: i })),
    types: listTypes(ctx, p.id).map((t) => ({
      name: t.name,
      fields: t.fields
        .filter((f) => f.visibleToAgent)
        .map((f) => ({ name: f.name, kind: f.kind, required: f.required })),
    })),
    agentSettings: {
      canMove: settings.canMove,
      maxStatus: statuses.find((s) => s.id === settings.maxStatusId)?.name ?? null,
      autoTake: settings.autoTake,
      canCreate: settings.canCreate,
      pausedByHuman: getAppSettings(ctx).agentsPaused,
    },
    definitionOfDone: p.dod,
    tasks: agentListTasks(ctx, p.id, {}, ''),
  };
}

export interface AgentTaskFilter {
  status?: string;
  onlyAvailable?: boolean;
  agentOwned?: boolean;
}

/**
 * Задачи проекта кратко. onlyAvailable — не в «готово», никем другим не заклеймлены и
 * отданы агенту (или лежат во втором статусе, если включено «сам берёт задачи»).
 */
export function agentListTasks(ctx: Ctx, projectRef: string, filter: AgentTaskFilter, agent: Actor) {
  const p = resolveProject(ctx, projectRef);
  const statuses = listStatuses(ctx, p.id);
  const types = listTypes(ctx, p.id);
  const settings = getAgentSettings(ctx, p.id);
  const takeFrom = settings.autoTake ? statuses[1]?.id : undefined;
  const statusFilter = filter.status ? resolveStatus(ctx, p.id, filter.status).id : undefined;
  return listTaskCards(ctx, p.id)
    .filter((t) => !statusFilter || t.statusId === statusFilter)
    .filter((t) => filter.agentOwned === undefined || t.agentOwned === filter.agentOwned)
    .filter((t) => {
      if (!filter.onlyAvailable) return true;
      const cat = statuses.find((s) => s.id === t.statusId)?.category;
      if (cat === 'done') return false;
      if (t.claimedBy && t.claimedBy !== agent) return false;
      return t.agentOwned || t.statusId === takeFrom;
    })
    .sort((a, b) => {
      const sa = statuses.findIndex((s) => s.id === a.statusId);
      const sb = statuses.findIndex((s) => s.id === b.statusId);
      return sa - sb || a.position - b.position;
    })
    .map((t) => ({
      id: t.key,
      title: t.title,
      type: types.find((x) => x.id === t.typeId)?.name ?? '',
      status: statuses.find((s) => s.id === t.statusId)?.name ?? '',
      subtasks: t.subtasks,
      agentOwned: t.agentOwned,
      claimedBy: t.claimedBy,
    }));
}

export function agentGetTask(ctx: Ctx, ref: string, agent: Actor) {
  const t = resolveTask(ctx, ref);
  const p = getProjectRow(ctx, t.project_id);
  const key = `${p.key}-${t.number}`;
  const status = getStatusRow(ctx, t.status_id);
  const type = listTypes(ctx, p.id).find((x) => x.id === t.type_id)!;
  const values = readFieldValues(ctx, t.id);
  const fields: Record<string, FieldValue> = {};
  for (const f of type.fields.filter((x) => x.visibleToAgent)) fields[f.name] = values[f.id] ?? null;
  const allowedNext = allowedTargets(ctx, t.status_id)
    .filter((s) => !agentMoveRuleProblem(ctx, t, s.id))
    .map((s) => s.name);
  const workProblem = agentWorkProblem(ctx, t, agent, key);
  return {
    id: key,
    project: p.key,
    repoPath: p.repo_path,
    title: t.title,
    type: type.name,
    status: status.name,
    statusCategory: status.category,
    description: t.description,
    fields,
    subtasks: listSubtasks(ctx, t.id).map((s) => ({
      id: s.id,
      title: s.title,
      state: s.state,
      done: s.done,
    })),
    definitionOfDone: p.dod,
    allowedNextStatuses: allowedNext,
    agentOwned: bool(t.agent_owned),
    claimedBy: activeClaim(ctx, t),
    claimUntil: activeClaim(ctx, t) ? t.claim_until : null,
    ...(workProblem ? { hint: workProblem } : {}),
    recentEvents: listTaskEvents(ctx, t.id, 10).map((e) => ({
      who: e.actor === 'you' ? 'человек' : e.actor,
      what: e.summary,
      note: e.note,
      at: e.at,
    })),
  };
}

// ---------- работа с задачей ----------

export function agentClaimTask(ctx: Ctx, ref: string, agent: Actor, ttlMinutes = DEFAULT_CLAIM_MINUTES) {
  const t = resolveTask(ctx, ref);
  const key = taskKey(ctx, t);
  const holder = activeClaim(ctx, t);
  if (holder && holder !== agent) throw conflict(agentWorkProblem(ctx, t, agent, key)!);
  const until = inMinutes(ctx, Math.min(Math.max(ttlMinutes, 1), 24 * 60));
  ctx.db.tx(() => {
    ctx.db.run(
      'UPDATE tasks SET claimed_by = ?, claim_until = ?, agent_owned = 1, updated_at = ? WHERE id = ?',
      agent,
      until,
      ctx.now(),
      t.id,
    );
    if (holder === agent)
      notify(ctx, { projectId: t.project_id, taskId: t.id, actor: agent, kind: 'task.claimed' });
    else
      record(ctx, {
        projectId: t.project_id,
        taskId: t.id,
        actor: agent,
        kind: 'task.claimed',
        summary: `взял ${key}`,
      });
  });
  return {
    ok: true,
    task: key,
    claimedUntil: until,
    next: 'get_task → start_subtask → log_progress → complete_subtask',
  };
}

export function agentReleaseTask(ctx: Ctx, ref: string, agent: Actor, note?: string) {
  const t = resolveTask(ctx, ref);
  const key = taskKey(ctx, t);
  const holder = activeClaim(ctx, t);
  if (holder && holder !== agent) throw conflict(`${key} держит «${holder}», отпустить её может только он.`);
  ctx.db.tx(() => {
    ctx.db.run('UPDATE tasks SET claimed_by = NULL, claim_until = NULL WHERE id = ?', t.id);
    // незаконченные «в работе» сабтаски больше никто не делает
    ctx.db.run("UPDATE subtasks SET state = 'idle' WHERE task_id = ? AND state = 'running'", t.id);
    record(ctx, {
      projectId: t.project_id,
      taskId: t.id,
      actor: agent,
      kind: 'task.released',
      summary: `отпустил ${key}`,
      note: note ?? null,
    });
  });
  return { ok: true, task: key };
}

export function agentMoveTask(ctx: Ctx, ref: string, statusRef: string, agent: Actor, note?: string) {
  const t = resolveTask(ctx, ref);
  const to = resolveStatus(ctx, t.project_id, statusRef);
  const card = moveTask(ctx, t.id, { statusId: to.id }, agent, note ?? null);
  extendClaim(ctx, getTaskRow(ctx, t.id), agent);
  return { ok: true, task: card.key, status: to.name };
}

export function agentUpdateTask(
  ctx: Ctx,
  ref: string,
  input: { description?: string; fields?: Record<string, FieldValue> },
  agent: Actor,
) {
  const t = resolveTask(ctx, ref);
  assertMayWork(ctx, t, agent);
  updateTask(
    ctx,
    t.id,
    {
      description: input.description,
      fields: input.fields ? fieldsByName(ctx, t.type_id, input.fields) : undefined,
    },
    agent,
  );
  extendClaim(ctx, getTaskRow(ctx, t.id), agent);
  return { ok: true, task: taskKey(ctx, t) };
}

/** Комментарий в историю и ленту: отчёт, вопрос человеку, ссылка на PR. Брать задачу не нужно. */
export function agentAddComment(ctx: Ctx, ref: string, text: string, agent: Actor) {
  const t = resolveTask(ctx, ref);
  const key = taskKey(ctx, t);
  record(ctx, {
    projectId: t.project_id,
    taskId: t.id,
    actor: agent,
    kind: 'task.comment',
    summary: `написал в ${key}`,
    note: text,
  });
  extendClaim(ctx, t, agent);
  return { ok: true, task: key };
}

export function agentCreateTask(
  ctx: Ctx,
  input: {
    project: string;
    title: string;
    type: string;
    description?: string;
    fields?: Record<string, FieldValue>;
    subtasks?: string[];
  },
  agent: Actor,
) {
  const p = resolveProject(ctx, input.project);
  if (!getAgentSettings(ctx, p.id).canCreate)
    throw conflict(
      'В настройках проекта агенту запрещено создавать задачи. Предложите задачу человеку через add_comment.',
    );
  const type = resolveType(ctx, p.id, input.type);
  const t = createTask(
    ctx,
    p.id,
    {
      title: input.title,
      typeId: type.id,
      description: input.description,
      fields: input.fields ? fieldsByName(ctx, type.id, input.fields) : undefined,
      subtasks: input.subtasks,
    },
    agent,
  );
  return { ok: true, task: t.key, status: getStatusRow(ctx, t.statusId).name };
}

// ---------- сабтаски и прогресс ----------

export function agentAddSubtask(ctx: Ctx, ref: string, title: string, agent: Actor) {
  const t = resolveTask(ctx, ref);
  assertMayWork(ctx, t, agent);
  const s = addSubtask(ctx, t.id, title, agent);
  extendClaim(ctx, t, agent);
  return { ok: true, subtask: { id: s.id, title: s.title } };
}

function subtaskWithTask(ctx: Ctx, subtaskId: string, agent: Actor) {
  const s = getSubtaskRow(ctx, subtaskId);
  const t = getTaskRow(ctx, s.task_id);
  assertMayWork(ctx, t, agent);
  return { s, t, key: taskKey(ctx, t) };
}

function logLine(ctx: Ctx, subtaskId: string, text: string) {
  ctx.db.run('INSERT INTO run_log_lines (subtask_id, text, at) VALUES (?, ?, ?)', subtaskId, text, ctx.now());
}

export function agentStartSubtask(ctx: Ctx, subtaskId: string, agent: Actor) {
  const { s, t, key } = subtaskWithTask(ctx, subtaskId, agent);
  ctx.db.tx(() => {
    ctx.db.run("UPDATE subtasks SET state = 'running', done = 0 WHERE id = ?", s.id);
    logLine(ctx, s.id, `${agent} начал работу`);
    record(ctx, {
      projectId: t.project_id,
      taskId: t.id,
      actor: agent,
      kind: 'subtask.started',
      summary: `начал сабтаску в ${key}`,
      note: s.title,
    });
  });
  extendClaim(ctx, t, agent);
  return { ok: true, subtask: s.id, state: 'running' };
}

export function agentLogProgress(
  ctx: Ctx,
  target: { subtask?: string; task?: string },
  text: string,
  agent: Actor,
) {
  if (target.subtask) {
    const { s, t } = subtaskWithTask(ctx, target.subtask, agent);
    logLine(ctx, s.id, text);
    notify(ctx, { projectId: t.project_id, taskId: t.id, actor: agent, kind: 'subtask.log' });
    extendClaim(ctx, t, agent);
    return { ok: true };
  }
  if (target.task) {
    const t = resolveTask(ctx, target.task);
    assertMayWork(ctx, t, agent);
    record(ctx, {
      projectId: t.project_id,
      taskId: t.id,
      actor: agent,
      kind: 'task.progress',
      summary: `пишет по ${taskKey(ctx, t)}`,
      note: text,
    });
    extendClaim(ctx, t, agent);
    return { ok: true };
  }
  throw invalid('Укажите subtask (id сабтаски) или task (например, PAY-12).');
}

/**
 * Автопереход: когда агент закрыл последнюю сабтаску — перевести задачу в первый статус
 * «в процессе» после текущего (обычно «Ревью»), если это разрешают воркфлоу и права агента.
 */
function autoAdvance(ctx: Ctx, t: TaskRow, agent: Actor): { moved?: string; reason?: string } {
  const counts = ctx.db.get<{ total: number; done: number }>(
    'SELECT COUNT(*) AS total, COALESCE(SUM(done), 0) AS done FROM subtasks WHERE task_id = ?',
    t.id,
  )!;
  if (!counts.total || counts.done < counts.total) return {};
  const statuses = listStatuses(ctx, t.project_id);
  const cur = statuses.findIndex((s) => s.id === t.status_id);
  const target = statuses.slice(cur + 1).find((s) => s.category === 'doing');
  if (!target)
    return {
      reason: 'Все сабтаски закрыты. Дальше «в процессе»-статусов нет — решите сами через move_task.',
    };
  const key = taskKey(ctx, t);
  const allowed = allowedTargets(ctx, t.status_id).some((s) => s.id === target.id);
  const problem = allowed
    ? agentMoveProblem(ctx, t, target.id, agent, key)
    : `Переход в «${target.name}» запрещён воркфлоу.`;
  if (problem)
    return { reason: `Все сабтаски закрыты, но в «${target.name}» задача не переведена: ${problem}` };
  moveTask(ctx, t.id, { statusId: target.id }, agent, 'Все сабтаски закрыты, передаю дальше');
  return { moved: target.name };
}

export function agentCompleteSubtask(ctx: Ctx, subtaskId: string, agent: Actor, report?: string) {
  const { s, t, key } = subtaskWithTask(ctx, subtaskId, agent);
  ctx.db.tx(() => {
    ctx.db.run("UPDATE subtasks SET state = 'done', done = 1 WHERE id = ?", s.id);
    logLine(ctx, s.id, report ? `Готово: ${report}` : 'Готово');
    record(ctx, {
      projectId: t.project_id,
      taskId: t.id,
      actor: agent,
      kind: 'subtask.done',
      summary: `закрыл сабтаску в ${key}`,
      note: report ? `${s.title} — ${report}` : s.title,
    });
  });
  const advance = autoAdvance(ctx, getTaskRow(ctx, t.id), agent);
  extendClaim(ctx, getTaskRow(ctx, t.id), agent);
  return {
    ok: true,
    subtask: s.id,
    state: 'done',
    ...(advance.moved ? { taskMovedTo: advance.moved } : {}),
    ...(advance.reason ? { note: advance.reason } : {}),
  };
}

export function agentFailSubtask(ctx: Ctx, subtaskId: string, reason: string, agent: Actor) {
  const { s, t, key } = subtaskWithTask(ctx, subtaskId, agent);
  ctx.db.tx(() => {
    ctx.db.run("UPDATE subtasks SET state = 'failed', done = 0 WHERE id = ?", s.id);
    logLine(ctx, s.id, `Не получилось: ${reason}`);
    record(ctx, {
      projectId: t.project_id,
      taskId: t.id,
      actor: agent,
      kind: 'subtask.failed',
      summary: `не справился с сабтаской в ${key}`,
      note: `${s.title} — ${reason}`,
    });
  });
  extendClaim(ctx, t, agent);
  return {
    ok: true,
    subtask: s.id,
    state: 'failed',
    next: 'Если нужен человек — add_comment с вопросом и release_task.',
  };
}
