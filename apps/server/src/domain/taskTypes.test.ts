import { describe, expect, it } from 'vitest';
import { createField, createType, deleteField, deleteType, listTypes, updateField } from './taskTypes';
import { createTask, getTaskDetail, getTaskRow, updateTask } from './tasks';
import { setup } from './testing';

describe('task types and template fields', () => {
  it('creates a type with a default required field', () => {
    const { ctx, projectId } = setup();
    const t = createType(ctx, projectId, {});
    expect(t.name).toBe('Новый тип');
    expect(t.fields.map((f) => [f.name, f.required])).toEqual([['Ожидаемый результат', true]]);
  });

  it('moves tasks to the first remaining type on delete', () => {
    const { ctx, projectId, types } = setup();
    const task = createTask(ctx, projectId, { title: 'x', typeId: types[3]!.id });
    deleteType(ctx, types[3]!.id);
    expect(getTaskRow(ctx, task.id).type_id).toBe(types[0]!.id);
    expect(listTypes(ctx, projectId)).toHaveLength(3);
  });

  it('keeps at least one type', () => {
    const { ctx, types } = setup();
    for (const t of types.slice(1)) deleteType(ctx, t.id);
    expect(() => deleteType(ctx, types[0]!.id)).toThrow('хотя бы один тип');
  });

  it('drops stored values when a field changes kind or is deleted', () => {
    const { ctx, projectId, types } = setup();
    const f = createField(ctx, types[3]!.id, { name: 'Оценка', kind: 'number' });
    const task = createTask(ctx, projectId, { title: 'x', typeId: types[3]!.id, fields: { [f.id]: 5 } });
    expect(getTaskDetail(ctx, task.id).fields[f.id]).toBe(5);
    updateField(ctx, f.id, { kind: 'text' });
    expect(getTaskDetail(ctx, task.id).fields[f.id]).toBeUndefined();
    updateTask(ctx, task.id, { fields: { [f.id]: 'много' } });
    deleteField(ctx, f.id);
    expect(getTaskDetail(ctx, task.id).fields[f.id]).toBeUndefined();
  });
});
