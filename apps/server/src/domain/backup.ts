import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Ctx } from './context';

const TABLES = [
  'projects',
  'statuses',
  'task_types',
  'template_fields',
  'workflow_transitions',
  'agent_settings',
  'tasks',
  'task_field_values',
  'subtasks',
  'runs',
  'run_log_lines',
  'events',
  'ideas',
  'app_settings',
] as const;

/** Вся доска одним JSON: таблицы как есть. Для резервной копии и переноса. */
export function exportAll(ctx: Ctx) {
  const version = (ctx.db.raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  return {
    app: 'trakt',
    schemaVersion: version,
    exportedAt: ctx.now(),
    tables: Object.fromEntries(TABLES.map((t) => [t, ctx.db.all(`SELECT * FROM ${t}`)])),
  };
}

/** Копия файла базы (согласованная, можно делать на ходу). */
export function backupTo(ctx: Ctx, path: string) {
  mkdirSync(dirname(path), { recursive: true });
  ctx.db.run('VACUUM INTO ?', path);
  return path;
}
