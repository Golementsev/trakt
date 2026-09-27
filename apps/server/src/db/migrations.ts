/**
 * Миграции схемы. Каждая выполняется один раз, номер — индекс в массиве + 1.
 * Существующие миграции не редактировать, только добавлять новые.
 */
export const MIGRATIONS: string[] = [
  /* 1 — начальная схема (docs/schema.sql) */ `
CREATE TABLE projects (
  id            TEXT PRIMARY KEY,
  key           TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  repo_path     TEXT,
  dod           TEXT NOT NULL DEFAULT '',
  next_number   INTEGER NOT NULL DEFAULT 1,
  position      INTEGER NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE statuses (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL,
  category    TEXT NOT NULL CHECK (category IN ('todo','doing','done')),
  position    INTEGER NOT NULL
);

CREATE TABLE task_types (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL,
  position    INTEGER NOT NULL
);

CREATE TABLE template_fields (
  id                TEXT PRIMARY KEY,
  type_id           TEXT NOT NULL REFERENCES task_types(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN ('text','number','date','checkbox')),
  required          INTEGER NOT NULL DEFAULT 0,
  visible_to_agent  INTEGER NOT NULL DEFAULT 1,
  position          INTEGER NOT NULL
);

CREATE TABLE workflow_transitions (
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_status_id  TEXT NOT NULL REFERENCES statuses(id) ON DELETE CASCADE,
  to_status_id    TEXT NOT NULL REFERENCES statuses(id) ON DELETE CASCADE,
  PRIMARY KEY (from_status_id, to_status_id)
);

CREATE TABLE agent_settings (
  project_id      TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  can_move        INTEGER NOT NULL DEFAULT 1,
  max_status_id   TEXT REFERENCES statuses(id) ON DELETE SET NULL,
  auto_take       INTEGER NOT NULL DEFAULT 0,
  can_create      INTEGER NOT NULL DEFAULT 0,
  run_command     TEXT,
  use_worktree    INTEGER NOT NULL DEFAULT 0,
  max_parallel    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE tasks (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number        INTEGER NOT NULL,
  title         TEXT NOT NULL,
  type_id       TEXT NOT NULL REFERENCES task_types(id),
  status_id     TEXT NOT NULL REFERENCES statuses(id),
  position      REAL NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  agent_owned   INTEGER NOT NULL DEFAULT 0,
  claimed_by    TEXT,
  claim_until   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (project_id, number)
);

CREATE TABLE task_field_values (
  task_id   TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  field_id  TEXT NOT NULL REFERENCES template_fields(id) ON DELETE CASCADE,
  value     TEXT,
  PRIMARY KEY (task_id, field_id)
);

CREATE TABLE subtasks (
  id        TEXT PRIMARY KEY,
  task_id   TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title     TEXT NOT NULL,
  done      INTEGER NOT NULL DEFAULT 0,
  state     TEXT NOT NULL DEFAULT 'idle' CHECK (state IN ('idle','running','done','failed')),
  position  INTEGER NOT NULL
);

CREATE TABLE runs (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  subtask_id   TEXT REFERENCES subtasks(id) ON DELETE SET NULL,
  agent_name   TEXT NOT NULL,
  mode         TEXT NOT NULL CHECK (mode IN ('push','pull')),
  status       TEXT NOT NULL CHECK (status IN ('running','done','failed','stopped')),
  pid          INTEGER,
  report       TEXT,
  started_at   TEXT NOT NULL,
  finished_at  TEXT
);

CREATE TABLE run_log_lines (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id     TEXT REFERENCES runs(id) ON DELETE CASCADE,
  subtask_id TEXT REFERENCES subtasks(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  at         TEXT NOT NULL
);

CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id     TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  actor       TEXT NOT NULL,
  kind        TEXT NOT NULL,
  summary     TEXT NOT NULL,
  note        TEXT,
  at          TEXT NOT NULL
);

CREATE TABLE ideas (
  id          TEXT PRIMARY KEY,
  project_id  TEXT REFERENCES projects(id) ON DELETE SET NULL,
  text        TEXT NOT NULL,
  ai_text     TEXT,
  created_at  TEXT NOT NULL
);

-- глобальные настройки доски (пауза агентов и т.п.)
CREATE TABLE app_settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

CREATE INDEX idx_tasks_board ON tasks(project_id, status_id, position);
CREATE INDEX idx_events_project ON events(project_id, id DESC);
CREATE INDEX idx_events_task ON events(task_id, id DESC);
`,
];
