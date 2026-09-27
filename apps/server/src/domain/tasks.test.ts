import { describe, expect, it } from 'vitest';
import { createTask, deleteTask, getTaskDetail, listTaskCards, moveTask, updateTask } from './tasks';
import { addSubtask, updateSubtask } from './subtasks';
import { setWorkflow } from './workflow';
import { listProjectEvents } from './events';
import { setup } from './testing';

describe('createTask', () => {
  it('numbers tasks per project and appends to the column', () => {
    const { ctx, projectId, types, statuses } = setup();
    const a = createTask(ctx, projectId, { title: 'A', typeId: types[3]!.id });
    const b = createTask(ctx, projectId, { title: 'B', typeId: types[3]!.id, subtasks: ['s1', 's2'] });
    expect([a.key, b.key]).toEqual(['CHE-1', 'CHE-2']);
    expect(a.statusId).toBe(statuses[0]);
    expect(b.position).toBeGreaterThan(a.position);
    expect(b.subtasks.map((s) => s.title)).toEqual(['s1', 's2']);
    expect(listProjectEvents(ctx, projectId)[0]?.summary).toBe('создали CHE-2 в «Бэклог»');
  });

  it('requires required template fields', () => {
    const { ctx, projectId, types } = setup();
    const feature = types[0]!;
    expect(() => createTask(ctx, projectId, { title: 'A', typeId: feature.id })).toThrow(
      'Заполните обязательные поля: «Критерии приёмки»',
    );
    expect(() =>
      createTask(ctx, projectId, {
        title: 'A',
        typeId: feature.id,
        fields: { [feature.fields[0]!.id]: '   ' },
      }),
    ).toThrow('Критерии приёмки');
    const ok = createTask(ctx, projectId, {
      title: 'A',
      typeId: feature.id,
      fields: { [feature.fields[0]!.id]: 'Работает' },
    });
    expect(ok.fields[feature.fields[0]!.id]).toBe('Работает');
  });

  it('validates field values by kind', () => {
    const { ctx, projectId, types } = setup();
    const research = types[2]!;
    const [question, deadline] = research.fields;
    expect(() =>
      createTask(ctx, projectId, {
        title: 'A',
        typeId: research.id,
        fields: { [question!.id]: 'Почему?', [deadline!.id]: 'завтра' },
      }),
    ).toThrow('нужна дата');
  });

  it('logs handing a new task to the agent', () => {
    const { ctx, projectId, types } = setup();
    createTask(ctx, projectId, { title: 'A', typeId: types[3]!.id, agentOwned: true });
    expect(listProjectEvents(ctx, projectId)[0]?.summary).toBe('отдали CHE-1 агенту');
  });
});

describe('moveTask', () => {
  it('moves between allowed statuses and writes the note to the feed', () => {
    const { ctx, projectId, types, statuses } = setup();
    const t = createTask(ctx, projectId, { title: 'A', typeId: types[3]!.id, agentOwned: true });
    moveTask(ctx, t.id, { statusId: statuses[2]! }, 'Агент', 'Взял в работу');
    const e = listProjectEvents(ctx, projectId)[0]!;
    expect(e.summary).toBe('перевёл CHE-1 «Бэклог» → «В работе»');
    expect(e.actor).toBe('Агент');
    expect(e.note).toBe('Взял в работу');
  });

  it('refuses transitions forbidden by the workflow with a helpful message', () => {
    const { ctx, projectId, types, statuses } = setup();
    const t = createTask(ctx, projectId, { title: 'A', typeId: types[3]!.id });
    expect(() => moveTask(ctx, t.id, { statusId: statuses[4]! })).toThrow(
      'Переход «Бэклог» → «Готово» запрещён воркфлоу. Разрешено: «К работе», «В работе», «Ревью».',
    );
    setWorkflow(ctx, projectId, []);
    expect(() => moveTask(ctx, t.id, { statusId: statuses[1]! })).toThrow('Из этого статуса переходов нет');
  });

  it('reorders inside a column', () => {
    const { ctx, projectId, types, statuses } = setup();
    const [a, b, c] = ['A', 'B', 'C'].map((title) =>
      createTask(ctx, projectId, { title, typeId: types[3]!.id }),
    );
    moveTask(ctx, c!.id, { statusId: statuses[0]!, beforeTaskId: a!.id });
    moveTask(ctx, a!.id, { statusId: statuses[0]!, beforeTaskId: b!.id });
    expect(listTaskCards(ctx, projectId).map((t) => t.title)).toEqual(['C', 'A', 'B']);
    moveTask(ctx, c!.id, { statusId: statuses[0]! });
    expect(listTaskCards(ctx, projectId).map((t) => t.title)).toEqual(['A', 'B', 'C']);
  });

  it('changes type and agent ownership when dropped into another lane', () => {
    const { ctx, projectId, types, statuses } = setup();
    const t = createTask(ctx, projectId, { title: 'A', typeId: types[3]!.id });
    const card = moveTask(ctx, t.id, { statusId: statuses[0]!, typeId: types[1]!.id, agentOwned: true });
    expect(card.typeId).toBe(types[1]!.id);
    expect(card.agentOwned).toBe(true);
    const kinds = listProjectEvents(ctx, projectId).map((e) => e.kind);
    expect(kinds.slice(0, 2)).toEqual(['task.agent', 'task.type']);
  });
});

describe('task edits and subtasks', () => {
  it('updates fields partially and toggles agent ownership', () => {
    const { ctx, projectId, types } = setup();
    const bug = types[1]!;
    const [steps, where] = bug.fields;
    const t = createTask(ctx, projectId, { title: 'A', typeId: bug.id, fields: { [steps!.id]: '1. клик' } });
    const u = updateTask(ctx, t.id, { fields: { [where!.id]: 'prod' }, agentOwned: true });
    expect(u.fields).toEqual({ [steps!.id]: '1. клик', [where!.id]: 'prod' });
    expect(u.agentOwned).toBe(true);
    expect(updateTask(ctx, t.id, { fields: { [where!.id]: '' } }).fields[where!.id]).toBeUndefined();
    expect(() => updateTask(ctx, t.id, { fields: { nope: 'x' } })).toThrow('Поле не относится');
  });

  it('counts subtasks on the card and logs closing', () => {
    const { ctx, projectId, types } = setup();
    const t = createTask(ctx, projectId, { title: 'A', typeId: types[3]!.id });
    const s1 = addSubtask(ctx, t.id, 'один');
    addSubtask(ctx, t.id, 'два');
    updateSubtask(ctx, s1.id, { done: true });
    expect(listTaskCards(ctx, projectId)[0]!.subtasks).toEqual({ done: 1, total: 2 });
    expect(getTaskDetail(ctx, t.id).subtasks[0]!.state).toBe('done');
    const e = listProjectEvents(ctx, projectId)[0]!;
    expect([e.summary, e.note]).toEqual(['закрыли сабтаску в CHE-1', 'один']);
  });

  it('deletes a task with its subtasks', () => {
    const { ctx, projectId, types } = setup();
    const t = createTask(ctx, projectId, { title: 'A', typeId: types[3]!.id, subtasks: ['x'] });
    deleteTask(ctx, t.id);
    expect(listTaskCards(ctx, projectId)).toEqual([]);
    expect(ctx.db.all('SELECT * FROM subtasks')).toEqual([]);
    expect(listProjectEvents(ctx, projectId)[0]?.summary).toBe('удалили CHE-1 «A»');
  });
});
