import {
  DEFAULT_AGENT_MAX_STATUS_INDEX,
  DEFAULT_AGENT_SETTINGS,
  DEFAULT_DOD,
  DEFAULT_STATUSES,
  DEFAULT_TYPES,
  defaultTransitions,
  type AgentSettings,
  type Project,
  type ProjectSummary,
  type UpdateAgentSettingsInput,
  type UpdateProjectInput,
} from '@trakt/shared';
import { bool, invalid, notFound, verb, type Actor, type Ctx } from './context';
import { notify, record } from './events';

interface ProjectRow {
  id: string;
  key: string;
  name: string;
  repo_path: string | null;
  dod: string;
  next_number: number;
  position: number;
}

export const toProject = (r: ProjectRow): Project => ({
  id: r.id,
  key: r.key,
  name: r.name,
  repoPath: r.repo_path,
  dod: r.dod,
});

export function getProjectRow(ctx: Ctx, id: string): ProjectRow {
  const row = ctx.db.get<ProjectRow>('SELECT * FROM projects WHERE id = ?', id);
  if (!row) throw notFound('Проект');
  return row;
}

export function getProject(ctx: Ctx, id: string): Project {
  return toProject(getProjectRow(ctx, id));
}

export function listProjects(ctx: Ctx): ProjectSummary[] {
  return ctx.db.all<ProjectSummary>(
    `SELECT p.id, p.key, p.name,
       (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS taskCount,
       (SELECT COUNT(*) FROM tasks t JOIN statuses s ON s.id = t.status_id
          WHERE t.project_id = p.id AND t.agent_owned = 1 AND s.category <> 'done') AS agentTaskCount
     FROM projects p ORDER BY p.position`,
  );
}

const TRANSLIT: Record<string, string> = {
  а: 'A',
  б: 'B',
  в: 'V',
  г: 'G',
  д: 'D',
  е: 'E',
  ё: 'E',
  ж: 'Z',
  з: 'Z',
  и: 'I',
  й: 'I',
  к: 'K',
  л: 'L',
  м: 'M',
  н: 'N',
  о: 'O',
  п: 'P',
  р: 'R',
  с: 'S',
  т: 'T',
  у: 'U',
  ф: 'F',
  х: 'H',
  ц: 'C',
  ч: 'C',
  ш: 'S',
  щ: 'S',
  ы: 'Y',
  э: 'E',
  ю: 'U',
  я: 'A',
};

/**
 * Ключ проекта: 2–5 латинских заглавных букв. Кириллица транслитерируется,
 * чтобы номера задач (MOB-3) было удобно писать агенту и в терминале.
 */
export function makeProjectKey(name: string, taken: ReadonlySet<string>): string {
  const letters = [...name.toLowerCase()]
    .map((ch) => TRANSLIT[ch] ?? (/[a-z]/.test(ch) ? ch.toUpperCase() : ''))
    .join('');
  let base = letters.slice(0, 3);
  if (base.length < 2) base = 'PRJ';
  if (!taken.has(base)) return base;
  // ПРОЕКТ → PRO, PROE, PROEK… затем PRA, PRB…
  for (let len = 4; len <= Math.min(5, letters.length); len++) {
    const k = letters.slice(0, len);
    if (!taken.has(k)) return k;
  }
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const k = base.slice(0, 2) + ch;
    if (!taken.has(k)) return k;
  }
  for (let i = 0; ; i++) {
    const k =
      base.slice(0, 2) +
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[i % 26] +
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(i / 26) % 26];
    if (!taken.has(k)) return k;
  }
}

/** Новый проект со стандартным набором статусов, типов, шаблонов и воркфлоу. */
export function createProject(
  ctx: Ctx,
  input: { name: string; key?: string },
  actor: Actor = 'you',
): Project {
  const { db } = ctx;
  return db.tx(() => {
    const taken = new Set(db.all<{ key: string }>('SELECT key FROM projects').map((r) => r.key));
    const key = input.key ?? makeProjectKey(input.name, taken);
    if (taken.has(key)) throw invalid(`Ключ ${key} уже занят`);
    const id = ctx.newId();
    const pos = db.get<{ p: number }>('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM projects')!.p;
    db.run(
      'INSERT INTO projects (id, key, name, dod, next_number, position, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
      id,
      key,
      input.name.trim(),
      DEFAULT_DOD,
      pos,
      ctx.now(),
    );

    const statusIds = DEFAULT_STATUSES.map((s, i) => {
      const sid = ctx.newId();
      db.run(
        'INSERT INTO statuses (id, project_id, name, color, category, position) VALUES (?, ?, ?, ?, ?, ?)',
        sid,
        id,
        s.name,
        s.color,
        s.category,
        i,
      );
      return sid;
    });
    for (const [from, to] of defaultTransitions(DEFAULT_STATUSES)) {
      db.run(
        'INSERT INTO workflow_transitions (project_id, from_status_id, to_status_id) VALUES (?, ?, ?)',
        id,
        statusIds[from]!,
        statusIds[to]!,
      );
    }
    DEFAULT_TYPES.forEach((t, i) => {
      const tid = ctx.newId();
      db.run(
        'INSERT INTO task_types (id, project_id, name, color, position) VALUES (?, ?, ?, ?, ?)',
        tid,
        id,
        t.name,
        t.color,
        i,
      );
      t.fields.forEach((f, j) => {
        db.run(
          `INSERT INTO template_fields (id, type_id, name, kind, required, visible_to_agent, position)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ctx.newId(),
          tid,
          f.name,
          f.kind,
          f.required ? 1 : 0,
          f.visibleToAgent ? 1 : 0,
          j,
        );
      });
    });
    db.run(
      'INSERT INTO agent_settings (project_id, can_move, max_status_id, auto_take, can_create) VALUES (?, ?, ?, ?, ?)',
      id,
      DEFAULT_AGENT_SETTINGS.canMove ? 1 : 0,
      statusIds[DEFAULT_AGENT_MAX_STATUS_INDEX] ?? null,
      DEFAULT_AGENT_SETTINGS.autoTake ? 1 : 0,
      DEFAULT_AGENT_SETTINGS.canCreate ? 1 : 0,
    );

    record(ctx, {
      projectId: id,
      actor,
      kind: 'project.created',
      summary: `${verb(actor, 'создали', 'создал')} проект «${input.name.trim()}»`,
    });
    return getProject(ctx, id);
  });
}

export function updateProject(ctx: Ctx, id: string, input: UpdateProjectInput): Project {
  getProjectRow(ctx, id);
  if (input.name !== undefined) ctx.db.run('UPDATE projects SET name = ? WHERE id = ?', input.name, id);
  if (input.dod !== undefined) ctx.db.run('UPDATE projects SET dod = ? WHERE id = ?', input.dod, id);
  if (input.repoPath !== undefined)
    ctx.db.run('UPDATE projects SET repo_path = ? WHERE id = ?', input.repoPath?.trim() || null, id);
  notify(ctx, { projectId: id, actor: 'you', kind: 'project.updated' });
  return getProject(ctx, id);
}

interface AgentRow {
  can_move: number;
  max_status_id: string | null;
  auto_take: number;
  can_create: number;
}

export function getAgentSettings(ctx: Ctx, projectId: string): AgentSettings {
  const r = ctx.db.get<AgentRow>('SELECT * FROM agent_settings WHERE project_id = ?', projectId);
  if (!r) throw notFound('Проект');
  return {
    canMove: bool(r.can_move),
    maxStatusId: r.max_status_id,
    autoTake: bool(r.auto_take),
    canCreate: bool(r.can_create),
  };
}

export function updateAgentSettings(ctx: Ctx, projectId: string, input: UpdateAgentSettingsInput) {
  getAgentSettings(ctx, projectId);
  const { db } = ctx;
  if (input.maxStatusId) {
    const s = db.get('SELECT 1 FROM statuses WHERE id = ? AND project_id = ?', input.maxStatusId, projectId);
    if (!s) throw notFound('Статус');
  }
  const set = (col: string, v: number | string | null) =>
    db.run(`UPDATE agent_settings SET ${col} = ? WHERE project_id = ?`, v, projectId);
  if (input.canMove !== undefined) set('can_move', input.canMove ? 1 : 0);
  if (input.maxStatusId !== undefined) set('max_status_id', input.maxStatusId);
  if (input.autoTake !== undefined) set('auto_take', input.autoTake ? 1 : 0);
  if (input.canCreate !== undefined) set('can_create', input.canCreate ? 1 : 0);
  notify(ctx, { projectId, actor: 'you', kind: 'agent.settings' });
  return getAgentSettings(ctx, projectId);
}
