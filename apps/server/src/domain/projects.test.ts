import { describe, expect, it } from 'vitest';
import { createProject, deleteProject, getAgentSettings, listProjects, makeProjectKey } from './projects';
import { createTask } from './tasks';
import { addSubtask } from './subtasks';
import { createIdea, listIdeas } from './ideas';
import { listStatuses } from './statuses';
import { listTypes } from './taskTypes';
import { isTransitionAllowed, listTransitions } from './workflow';
import { setup } from './testing';
import { listProjectEvents } from './events';

describe('makeProjectKey', () => {
  it('takes first three latin letters', () => {
    expect(makeProjectKey('Checkout 2.0', new Set())).toBe('CHE');
  });
  it('transliterates cyrillic', () => {
    expect(makeProjectKey('Мобильное приложение', new Set())).toBe('MOB');
  });
  it('avoids taken keys', () => {
    expect(makeProjectKey('Мобильное', new Set(['MOB']))).toBe('MOBI');
    expect(makeProjectKey('Моб', new Set(['MOB']))).toBe('MOA');
  });
  it('falls back for names without letters', () => {
    expect(makeProjectKey('42', new Set())).toBe('PRJ');
  });
});

describe('createProject', () => {
  it('creates the default set from the spec', () => {
    const { ctx, projectId } = setup();
    const statuses = listStatuses(ctx, projectId);
    expect(statuses.map((s) => s.name)).toEqual(['Бэклог', 'К работе', 'В работе', 'Ревью', 'Готово']);
    expect(statuses.map((s) => s.category)).toEqual(['todo', 'todo', 'doing', 'doing', 'done']);

    const types = listTypes(ctx, projectId);
    expect(types.map((t) => t.name)).toEqual(['Фича', 'Баг', 'Исследование', 'Техдолг']);
    const research = types[2]!.fields;
    expect(research.map((f) => [f.name, f.kind, f.required, f.visibleToAgent])).toEqual([
      ['Главный вопрос', 'text', true, true],
      ['Срок', 'date', false, false],
    ]);

    const agent = getAgentSettings(ctx, projectId);
    expect(agent).toEqual({
      canMove: true,
      maxStatusId: statuses[3]!.id,
      autoTake: false,
      canCreate: false,
      runCommand: null,
      useWorktree: false,
      maxParallel: 1,
    });
  });

  it('forbids jumping from the first two statuses straight to done', () => {
    const { ctx, projectId, statuses: s } = setup();
    expect(isTransitionAllowed(ctx, s[0]!, s[4]!)).toBe(false);
    expect(isTransitionAllowed(ctx, s[1]!, s[4]!)).toBe(false);
    expect(isTransitionAllowed(ctx, s[3]!, s[4]!)).toBe(true);
    expect(listTransitions(ctx, projectId)).toHaveLength(18);
  });

  it('gives unique keys and logs an event', () => {
    const { ctx, projectId } = setup();
    const second = createProject(ctx, { name: 'Checkout 3.0' });
    expect(second.key).toBe('CHEC');
    expect(listProjects(ctx).map((p) => p.key)).toEqual(['CHE', 'CHEC']);
    expect(listProjectEvents(ctx, projectId)[0]?.kind).toBe('project.created');
  });
});

describe('deleteProject', () => {
  it('removes the project with its tasks, ideas and events, other projects stay', () => {
    const { ctx, projectId, types } = setup();
    const other = createProject(ctx, { name: 'Другой' });
    const t = createTask(ctx, projectId, { title: 'x', typeId: types[3]!.id });
    addSubtask(ctx, t.id, 'шаг');
    createIdea(ctx, projectId, { text: 'мысль' });

    deleteProject(ctx, projectId);

    expect(listProjects(ctx).map((p) => p.id)).toEqual([other.id]);
    expect(listIdeas(ctx, projectId)).toEqual([]);
    const count = (sql: string, id: string) => ctx.db.get<{ n: number }>(sql, id)!.n;
    for (const table of ['tasks', 'statuses', 'task_types', 'events', 'agent_settings'])
      expect(count(`SELECT COUNT(*) AS n FROM ${table} WHERE project_id = ?`, projectId)).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM subtasks WHERE task_id = ?', t.id)).toBe(0);
    expect(ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ideas')!.n).toBe(0);
  });

  it('fails for an unknown project', () => {
    const { ctx } = setup();
    expect(() => deleteProject(ctx, 'nope')).toThrow();
  });
});
