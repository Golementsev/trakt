import { describe, expect, it } from 'vitest';
import { createStatus, deleteStatus, listStatuses, moveStatus } from './statuses';
import { getAgentSettings } from './projects';
import { createTask, getTaskRow } from './tasks';
import { isTransitionAllowed } from './workflow';
import { setup } from './testing';
import { listProjectEvents } from './events';

const names = (ctx: Parameters<typeof listStatuses>[0], p: string) => listStatuses(ctx, p).map((s) => s.name);

describe('statuses', () => {
  it('inserts a new status before done by default and connects it both ways', () => {
    const { ctx, projectId, statuses } = setup();
    const s = createStatus(ctx, projectId, { name: 'QA' });
    expect(names(ctx, projectId)).toEqual(['Бэклог', 'К работе', 'В работе', 'Ревью', 'QA', 'Готово']);
    expect(s.category).toBe('doing');
    for (const other of statuses) {
      expect(isTransitionAllowed(ctx, other, s.id)).toBe(true);
      expect(isTransitionAllowed(ctx, s.id, other)).toBe(true);
    }
  });

  it('inserts after a given status or at the start', () => {
    const { ctx, projectId, statuses } = setup();
    createStatus(ctx, projectId, { name: 'Идеи', afterStatusId: null });
    createStatus(ctx, projectId, { name: 'Дизайн', afterStatusId: statuses[1]! });
    expect(names(ctx, projectId)).toEqual([
      'Идеи',
      'Бэклог',
      'К работе',
      'Дизайн',
      'В работе',
      'Ревью',
      'Готово',
    ]);
    expect(listStatuses(ctx, projectId).map((s) => s.position)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('moves a status to another index', () => {
    const { ctx, projectId, statuses } = setup();
    moveStatus(ctx, statuses[4]!, 0);
    expect(names(ctx, projectId)).toEqual(['Готово', 'Бэклог', 'К работе', 'В работе', 'Ревью']);
    moveStatus(ctx, statuses[4]!, 99);
    expect(names(ctx, projectId)[4]).toBe('Готово');
  });

  it('moves tasks to the left neighbour on delete and keeps agent maxStatus valid', () => {
    const { ctx, projectId, statuses, types } = setup();
    const t = createTask(ctx, projectId, {
      title: 'x',
      typeId: types[3]!.id,
      statusId: statuses[3]!,
    });
    const res = deleteStatus(ctx, statuses[3]!);
    expect(res).toEqual({ movedTo: statuses[2], moved: 1 });
    expect(getTaskRow(ctx, t.id).status_id).toBe(statuses[2]);
    expect(getAgentSettings(ctx, projectId).maxStatusId).toBe(statuses[2]);
    expect(listProjectEvents(ctx, projectId)[0]?.note).toBe('1 задач перенесено в «В работе»');
  });

  it('moves tasks of the first status to the new first one', () => {
    const { ctx, projectId, statuses, types } = setup();
    const t = createTask(ctx, projectId, { title: 'x', typeId: types[3]!.id, statusId: statuses[0]! });
    deleteStatus(ctx, statuses[0]!);
    expect(getTaskRow(ctx, t.id).status_id).toBe(statuses[1]);
  });

  it('keeps at least two statuses', () => {
    const { ctx, statuses } = setup();
    deleteStatus(ctx, statuses[0]!);
    deleteStatus(ctx, statuses[1]!);
    deleteStatus(ctx, statuses[2]!);
    expect(() => deleteStatus(ctx, statuses[3]!)).toThrow('хотя бы два статуса');
  });
});
