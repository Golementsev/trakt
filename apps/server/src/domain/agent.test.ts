import { describe, expect, it } from 'vitest';
import {
  agentAddComment,
  agentClaimTask,
  agentCompleteSubtask,
  agentCreateTask,
  agentFailSubtask,
  agentGetTask,
  agentListTasks,
  agentLogProgress,
  agentMoveTask,
  agentReleaseTask,
  agentStartSubtask,
  agentUpdateTask,
} from './agent';
import { listProjectEvents } from './events';
import { updateAgentSettings } from './projects';
import { updateAppSettings } from './settings';
import { createTask, getTaskCard, getTaskDetail, moveTask, updateTask } from './tasks';
import { setup } from './testing';

function withTask(opts: { subtasks?: string[]; status?: number; agentOwned?: boolean } = {}) {
  const env = setup();
  const t = createTask(env.ctx, env.projectId, {
    title: 'Токенизация',
    typeId: env.types[0]!.id,
    statusId: env.statuses[opts.status ?? 2]!,
    fields: { [env.types[0]!.fields[0]!.id]: 'Карта хранится токеном' },
    subtasks: opts.subtasks ?? ['SDK', 'Тесты'],
    agentOwned: opts.agentOwned,
  });
  return { ...env, task: t, key: t.key };
}

const statusName = (env: ReturnType<typeof withTask>) =>
  env.ctx.db.get<{ name: string }>(
    'SELECT s.name FROM tasks t JOIN statuses s ON s.id = t.status_id WHERE t.id = ?',
    env.task.id,
  )!.name;

describe('claim', () => {
  it('claims a task, marks it agent-owned and shows the agent on the card', () => {
    const env = withTask();
    agentClaimTask(env.ctx, env.key, 'claude-code');
    const card = getTaskCard(env.ctx, env.task.id);
    expect(card.agentOwned).toBe(true);
    expect(card.claimedBy).toBe('claude-code');
    const e = listProjectEvents(env.ctx, env.projectId)[0]!;
    expect([e.actor, e.summary]).toEqual(['claude-code', 'взял CHE-1']);
  });

  it('refuses a task held by another agent until the lease expires', () => {
    const env = withTask();
    agentClaimTask(env.ctx, env.key, 'claude-code', 30);
    expect(() => agentClaimTask(env.ctx, env.key, 'codex')).toThrow('сейчас держит «claude-code»');
    // лиз истёк
    env.ctx.db.run("UPDATE tasks SET claim_until = '2000-01-01T00:00:00.000Z'");
    expect(agentClaimTask(env.ctx, env.key, 'codex').ok).toBe(true);
  });

  it('release clears the lease and stops running subtasks', () => {
    const env = withTask();
    agentClaimTask(env.ctx, env.key, 'a');
    agentStartSubtask(env.ctx, env.task.subtasks[0]!.id, 'a');
    agentReleaseTask(env.ctx, env.key, 'a', 'Нужен доступ к стейджу');
    const d = getTaskDetail(env.ctx, env.task.id);
    expect(d.claimedBy).toBeNull();
    expect(d.subtasks[0]!.state).toBe('idle');
    expect(listProjectEvents(env.ctx, env.projectId)[0]!.note).toBe('Нужен доступ к стейджу');
  });

  it('taking the task back in the UI drops the agent lease', () => {
    const env = withTask();
    agentClaimTask(env.ctx, env.key, 'a');
    updateTask(env.ctx, env.task.id, { agentOwned: false });
    expect(getTaskCard(env.ctx, env.task.id).claimedBy).toBeNull();
  });
});

describe('agent moves', () => {
  it('needs the task to be handed over or claimed', () => {
    const env = withTask({ status: 1 });
    expect(() => agentMoveTask(env.ctx, env.key, 'В работе', 'a')).toThrow('не отдана агенту');
    agentClaimTask(env.ctx, env.key, 'a');
    agentMoveTask(env.ctx, env.key, 'в работе', 'a', 'Взял в работу');
    expect(statusName(env)).toBe('В работе');
  });

  it('respects workflow, maxStatus, canMove and the global pause', () => {
    const env = withTask({ status: 3, agentOwned: true });
    expect(() => agentMoveTask(env.ctx, env.key, 'Готово', 'a')).toThrow('не дальше «Ревью»');

    updateAgentSettings(env.ctx, env.projectId, { canMove: false });
    expect(() => agentMoveTask(env.ctx, env.key, 'В работе', 'a')).toThrow('запрещено двигать');
    updateAgentSettings(env.ctx, env.projectId, { canMove: true });

    updateAppSettings(env.ctx, { agentsPaused: true });
    expect(() => agentMoveTask(env.ctx, env.key, 'В работе', 'a')).toThrow('на паузу');
    updateAppSettings(env.ctx, { agentsPaused: false });

    // человеку maxStatus не мешает
    moveTask(env.ctx, env.task.id, { statusId: env.statuses[4]! });
    expect(statusName(env)).toBe('Готово');
  });

  it('get_task lists statuses the agent may move to', () => {
    const env = withTask({ status: 0 });
    const view = agentGetTask(env.ctx, env.key, 'a');
    expect(view.allowedNextStatuses).toEqual(['К работе', 'В работе', 'Ревью']);
    expect(view.hint).toContain('claim_task');
    expect(view.fields).toEqual({ 'Критерии приёмки': 'Карта хранится токеном' });
    expect(view.subtasks.map((s) => s.title)).toEqual(['SDK', 'Тесты']);
  });
});

describe('subtasks and auto transition', () => {
  it('logs progress and moves the task to review after the last subtask', () => {
    const env = withTask();
    agentClaimTask(env.ctx, env.key, 'a');
    const [s1, s2] = env.task.subtasks;
    agentStartSubtask(env.ctx, s1!.id, 'a');
    agentLogProgress(env.ctx, { subtask: s1!.id }, 'Тесты: 42 passed', 'a');
    expect(getTaskCard(env.ctx, env.task.id).running).toBe(true);
    const first = agentCompleteSubtask(env.ctx, s1!.id, 'a', 'SDK 4.2');
    expect(first.taskMovedTo).toBeUndefined();
    const last = agentCompleteSubtask(env.ctx, s2!.id, 'a');
    expect(last.taskMovedTo).toBe('Ревью');
    expect(statusName(env)).toBe('Ревью');

    const log = getTaskDetail(env.ctx, env.task.id).subtasks[0]!.log.map((l) => l.text);
    expect(log).toEqual(['a начал работу', 'Тесты: 42 passed', 'Готово: SDK 4.2']);
    const moved = listProjectEvents(env.ctx, env.projectId).find((e) => e.kind === 'task.moved')!;
    expect(moved.summary).toBe('перевёл CHE-1 «В работе» → «Ревью»');
  });

  it('explains why it did not move when rules forbid it', () => {
    const env = withTask({ subtasks: ['one'] });
    agentClaimTask(env.ctx, env.key, 'a');
    updateAgentSettings(env.ctx, env.projectId, { canMove: false });
    const res = agentCompleteSubtask(env.ctx, env.task.subtasks[0]!.id, 'a');
    expect(res.taskMovedTo).toBeUndefined();
    expect(res.note).toContain('запрещено двигать');
    expect(statusName(env)).toBe('В работе');
  });

  it('records failures and comments in the feed', () => {
    const env = withTask();
    agentClaimTask(env.ctx, env.key, 'a');
    agentFailSubtask(env.ctx, env.task.subtasks[0]!.id, 'нет доступа к стейджу', 'a');
    expect(getTaskDetail(env.ctx, env.task.id).subtasks[0]!.state).toBe('failed');
    agentAddComment(env.ctx, env.key, 'Нужен ключ API', 'a');
    const [comment, failed] = listProjectEvents(env.ctx, env.projectId);
    expect(comment!.summary).toBe('написал в CHE-1');
    expect(failed!.note).toBe('SDK — нет доступа к стейджу');
  });
});

describe('agent edits and creation', () => {
  it('updates fields by name', () => {
    const env = withTask({ agentOwned: true });
    agentUpdateTask(env.ctx, env.key, { fields: { 'критерии приёмки': 'Новые критерии' } }, 'a');
    const d = getTaskDetail(env.ctx, env.task.id);
    expect(Object.values(d.fields)).toEqual(['Новые критерии']);
    expect(() => agentUpdateTask(env.ctx, env.key, { fields: { Срок: '2026-01-01' } }, 'a')).toThrow(
      'Доступные поля: «Критерии приёмки»',
    );
  });

  it('creates tasks only when allowed and checks required fields', () => {
    const env = withTask();
    const input = { project: 'che', title: 'Новая', type: 'Баг' };
    expect(() => agentCreateTask(env.ctx, input, 'a')).toThrow('запрещено создавать');
    updateAgentSettings(env.ctx, env.projectId, { canCreate: true });
    expect(() => agentCreateTask(env.ctx, input, 'a')).toThrow('Шаги воспроизведения');
    const res = agentCreateTask(env.ctx, { ...input, fields: { 'Шаги воспроизведения': '1. клик' } }, 'a');
    expect(res).toEqual({ ok: true, task: 'CHE-2', status: 'Бэклог' });
  });

  it('lists only available tasks', () => {
    const env = withTask({ agentOwned: true });
    createTask(env.ctx, env.projectId, { title: 'чужая', typeId: env.types[3]!.id });
    const list = agentListTasks(env.ctx, 'CHE', { onlyAvailable: true }, 'b');
    expect(list.map((t) => t.id)).toEqual(['CHE-1']);
    agentClaimTask(env.ctx, 'CHE-1', 'a');
    expect(agentListTasks(env.ctx, 'CHE', { onlyAvailable: true }, 'b')).toEqual([]);
  });
});
