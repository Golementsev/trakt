import type {
  AgentSettings,
  AppSettings,
  Board,
  BoardEvent,
  CreateFieldInput,
  CreateStatusInput,
  CreateTaskInput,
  CreateTypeInput,
  Field,
  MoveTaskInput,
  Project,
  ProjectSummary,
  Status,
  Subtask,
  TaskCard,
  TaskDetail,
  TaskType,
  UpdateAgentSettingsInput,
  UpdateFieldInput,
  UpdateProjectInput,
  UpdateStatusInput,
  UpdateSubtaskInput,
  UpdateTaskInput,
  UpdateTypeInput,
} from '@trakt/shared';

/** Ошибка от сервера: сообщение уже человекочитаемое, показываем как есть. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${url}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Сервер доски не отвечает');
  }
  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error ?? `Ошибка ${res.status}`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

const get = <T>(url: string) => request<T>('GET', url);
const post = <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {});
const patch = <T>(url: string, body: unknown) => request<T>('PATCH', url, body);
const put = <T>(url: string, body: unknown) => request<T>('PUT', url, body);
const del = <T>(url: string) => request<T>('DELETE', url);

export const api = {
  settings: () => get<AppSettings>('/settings'),
  updateSettings: (b: Partial<AppSettings>) => put<AppSettings>('/settings', b),

  projects: () => get<ProjectSummary[]>('/projects'),
  createProject: (name: string) => post<Project>('/projects', { name }),
  updateProject: (id: string, b: UpdateProjectInput) => patch<Project>(`/projects/${id}`, b),
  board: (id: string) => get<Board>(`/projects/${id}/board`),
  events: (id: string, limit = 50) => get<BoardEvent[]>(`/projects/${id}/events?limit=${limit}`),

  createStatus: (projectId: string, b: CreateStatusInput) =>
    post<Status>(`/projects/${projectId}/statuses`, b),
  updateStatus: (id: string, b: UpdateStatusInput) => patch<Status>(`/statuses/${id}`, b),
  moveStatus: (id: string, toIndex: number) => post<Status[]>(`/statuses/${id}/move`, { toIndex }),
  deleteStatus: (id: string) => del<{ movedTo: string; moved: number }>(`/statuses/${id}`),

  createType: (projectId: string, b: CreateTypeInput = {}) =>
    post<TaskType>(`/projects/${projectId}/types`, b),
  updateType: (id: string, b: UpdateTypeInput) => patch<TaskType>(`/types/${id}`, b),
  deleteType: (id: string) => del<{ movedTo: string; moved: number }>(`/types/${id}`),
  createField: (typeId: string, b: CreateFieldInput = {}) => post<Field>(`/types/${typeId}/fields`, b),
  updateField: (id: string, b: UpdateFieldInput) => patch<Field>(`/fields/${id}`, b),
  deleteField: (id: string) => del<{ ok: true }>(`/fields/${id}`),

  setWorkflow: (projectId: string, transitions: Array<[string, string]>) =>
    put<Array<[string, string]>>(`/projects/${projectId}/workflow`, { transitions }),
  updateAgentSettings: (projectId: string, b: UpdateAgentSettingsInput) =>
    put<AgentSettings>(`/projects/${projectId}/agent-settings`, b),

  task: (id: string) => get<TaskDetail>(`/tasks/${id}`),
  createTask: (projectId: string, b: CreateTaskInput) => post<TaskDetail>(`/projects/${projectId}/tasks`, b),
  updateTask: (id: string, b: UpdateTaskInput) => patch<TaskDetail>(`/tasks/${id}`, b),
  moveTask: (id: string, b: MoveTaskInput) => post<TaskCard>(`/tasks/${id}/move`, b),
  deleteTask: (id: string) => del<{ ok: true }>(`/tasks/${id}`),

  addSubtask: (taskId: string, title: string) => post<Subtask>(`/tasks/${taskId}/subtasks`, { title }),
  updateSubtask: (id: string, b: UpdateSubtaskInput) => patch<Subtask>(`/subtasks/${id}`, b),
};
