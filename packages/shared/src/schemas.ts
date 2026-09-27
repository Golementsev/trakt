import { z } from 'zod';
import { FIELD_KINDS, STATUS_CATEGORIES } from './constants';

/** Входные данные REST (и позже MCP). Валидация формы; правила — в домене сервера. */

const name = z.string().trim().min(1, 'Название не может быть пустым').max(200);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Цвет в формате #RRGGBB');
export const fieldValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const createProjectInput = z.object({ name });
export const updateProjectInput = z.object({
  name: name.optional(),
  dod: z.string().max(4000).optional(),
  repoPath: z.string().max(1000).nullable().optional(),
});

export const createStatusInput = z.object({
  name,
  /** null — в начало; не задано — перед первым статусом «Готово». */
  afterStatusId: z.string().nullable().optional(),
});
export const updateStatusInput = z.object({
  name: name.optional(),
  color: color.optional(),
  category: z.enum(STATUS_CATEGORIES).optional(),
});
export const moveStatusInput = z.object({ toIndex: z.number().int().min(0) });

export const createTypeInput = z.object({ name: name.optional(), color: color.optional() });
export const updateTypeInput = z.object({ name: name.optional(), color: color.optional() });

export const createFieldInput = z.object({
  name: name.optional(),
  kind: z.enum(FIELD_KINDS).optional(),
  required: z.boolean().optional(),
  visibleToAgent: z.boolean().optional(),
});
export const updateFieldInput = createFieldInput;

export const setWorkflowInput = z.object({
  transitions: z.array(z.tuple([z.string(), z.string()])),
});

export const updateAgentSettingsInput = z.object({
  canMove: z.boolean().optional(),
  maxStatusId: z.string().nullable().optional(),
  autoTake: z.boolean().optional(),
  canCreate: z.boolean().optional(),
  runCommand: z.string().max(2000).nullable().optional(),
  useWorktree: z.boolean().optional(),
  maxParallel: z.number().int().min(1).max(8).optional(),
});

const fields = z.record(z.string(), fieldValue);

export const createTaskInput = z.object({
  title: z.string().trim().min(1, 'Напишите, что нужно сделать').max(500),
  typeId: z.string(),
  statusId: z.string().optional(),
  description: z.string().max(20000).optional(),
  fields: fields.optional(),
  subtasks: z.array(z.string().trim().min(1).max(500)).optional(),
  agentOwned: z.boolean().optional(),
});
export const updateTaskInput = z.object({
  title: z.string().trim().min(1, 'Название задачи не может быть пустым').max(500).optional(),
  description: z.string().max(20000).optional(),
  fields: fields.optional(),
  agentOwned: z.boolean().optional(),
});
export const moveTaskInput = z.object({
  statusId: z.string(),
  /** Поставить перед этой задачей; null/не задано — в конец колонки. */
  beforeTaskId: z.string().nullable().optional(),
  /** Перенос в другую дорожку «Тип». */
  typeId: z.string().optional(),
  /** Перенос в другую дорожку «Агент». */
  agentOwned: z.boolean().optional(),
});

export const createSubtaskInput = z.object({ title: z.string().trim().min(1).max(500) });
export const updateSubtaskInput = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  done: z.boolean().optional(),
});

export const updateAppSettingsInput = z.object({ agentsPaused: z.boolean().optional() });

export type CreateProjectInput = z.infer<typeof createProjectInput>;
export type UpdateProjectInput = z.infer<typeof updateProjectInput>;
export type CreateStatusInput = z.infer<typeof createStatusInput>;
export type UpdateStatusInput = z.infer<typeof updateStatusInput>;
export type CreateTypeInput = z.infer<typeof createTypeInput>;
export type UpdateTypeInput = z.infer<typeof updateTypeInput>;
export type CreateFieldInput = z.infer<typeof createFieldInput>;
export type UpdateFieldInput = z.infer<typeof updateFieldInput>;
export type UpdateAgentSettingsInput = z.infer<typeof updateAgentSettingsInput>;
export type CreateTaskInput = z.infer<typeof createTaskInput>;
export type UpdateTaskInput = z.infer<typeof updateTaskInput>;
export type MoveTaskInput = z.infer<typeof moveTaskInput>;
export type UpdateSubtaskInput = z.infer<typeof updateSubtaskInput>;
export type UpdateAppSettingsInput = z.infer<typeof updateAppSettingsInput>;
