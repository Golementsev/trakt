import type { FieldKind, StatusCategory } from './constants';

/** Ответы сервера. Одни и те же для UI и (позже) MCP. */

export interface ProjectSummary {
  id: string;
  key: string;
  name: string;
  taskCount: number;
  /** Незакрытые задачи, которые ведёт агент. */
  agentTaskCount: number;
}

export interface Project {
  id: string;
  key: string;
  name: string;
  repoPath: string | null;
  dod: string;
  /** Номер, который получит следующая задача. */
  nextNumber: number;
}

export interface Status {
  id: string;
  name: string;
  color: string;
  category: StatusCategory;
  position: number;
}

export interface Field {
  id: string;
  typeId: string;
  name: string;
  kind: FieldKind;
  required: boolean;
  visibleToAgent: boolean;
  position: number;
}

export interface TaskType {
  id: string;
  name: string;
  color: string;
  position: number;
  fields: Field[];
  taskCount: number;
}

export interface AgentSettings {
  canMove: boolean;
  maxStatusId: string | null;
  autoTake: boolean;
  canCreate: boolean;
  /** Шаблон команды запуска агента (кнопка «▶ Агент»). Промпт приходит в stdin. */
  runCommand: string | null;
  /** Каждой задаче — свой git worktree. */
  useWorktree: boolean;
  /** Сколько агентов одновременно работают в проекте. */
  maxParallel: number;
}

export type FieldValue = string | number | boolean | null;

export interface TaskCard {
  id: string;
  /** PAY-12 */
  key: string;
  number: number;
  title: string;
  typeId: string;
  statusId: string;
  position: number;
  agentOwned: boolean;
  claimedBy: string | null;
  subtasks: { done: number; total: number };
  /** Есть сабтаска в состоянии running. */
  running: boolean;
}

export interface Board {
  project: Project;
  statuses: Status[];
  types: TaskType[];
  /** Разрешённые переходы [from, to]. */
  transitions: Array<[string, string]>;
  agent: AgentSettings;
  tasks: TaskCard[];
}

export type SubtaskState = 'idle' | 'running' | 'done' | 'failed';

export interface LogLine {
  text: string;
  at: string;
}

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
  state: SubtaskState;
  position: number;
  log: LogLine[];
}

export interface BoardEvent {
  id: number;
  projectId: string;
  taskId: string | null;
  /** 'you' или имя агента */
  actor: string;
  kind: string;
  summary: string;
  note: string | null;
  at: string;
}

/** Прогон агента, запущенный доской (push). */
export interface RunInfo {
  id: string;
  subtaskId: string | null;
  status: 'queued' | 'running';
  agentName: string;
}

export interface TaskDetail extends Omit<TaskCard, 'subtasks'> {
  projectId: string;
  description: string;
  fields: Record<string, FieldValue>;
  subtasks: Subtask[];
  /** Лог прогонов агента по задаче целиком (без сабтаски). */
  taskLog: LogLine[];
  /** Активные и ожидающие прогоны (заполняет сервер). */
  runs: RunInfo[];
  history: BoardEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface AppSettings {
  agentsPaused: boolean;
}

/** Сообщение в SSE-потоке /api/events: что-то поменялось, перечитай. */
export interface LiveMessage {
  projectId: string | null;
  taskId?: string | null;
  actor: string;
  kind: string;
}

export interface ApiError {
  error: string;
}

export interface Idea {
  id: string;
  projectId: string | null;
  text: string;
  aiText: string | null;
  createdAt: string;
}

export interface AiStatus {
  available: boolean;
  /** Чем генерируем: «Anthropic API (…)» или «Claude Code CLI (…)». */
  provider: string | null;
  /** Что сделать, чтобы включить AI. */
  hint: string | null;
}
