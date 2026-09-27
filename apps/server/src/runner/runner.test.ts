import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as d from '../domain';
import { setup } from '../domain/testing';
import { Runner } from './runner';

const fake = resolve(fileURLToPath(new URL('.', import.meta.url)), 'fixtures/fake-agent.mjs');

function env(args = '', opts: { subtasks?: string[]; configure?: boolean } = {}) {
  const e = setup();
  const repo = mkdtempSync(join(tmpdir(), 'trakt-repo-'));
  if (opts.configure !== false) {
    d.updateProject(e.ctx, e.projectId, { repoPath: repo });
    d.updateAgentSettings(e.ctx, e.projectId, { runCommand: `node "${fake}" ${args}` });
  }
  const runner = new Runner(e.ctx, {
    mcpUrl: 'http://127.0.0.1:4700/mcp',
    workDir: mkdtempSync(join(tmpdir(), 'trakt-runs-')),
  });
  const task = d.createTask(e.ctx, e.projectId, {
    title: 'Удалить старый шлюз',
    typeId: e.types[3]!.id,
    statusId: e.statuses[2]!,
    subtasks: opts.subtasks ?? ['Найти вызовы', 'Удалить модуль'],
  });
  const status = () =>
    e.ctx.db.get<{ name: string }>(
      'SELECT s.name FROM tasks t JOIN statuses s ON s.id = t.status_id WHERE t.id = ?',
      task.id,
    )!.name;
  const idle = async () => {
    for (let i = 0; i < 200 && runner.runsForTask(task.id).length; i++)
      await new Promise((r) => setTimeout(r, 50));
    expect(runner.runsForTask(task.id)).toEqual([]);
  };
  return { ...e, runner, task, status, idle, detail: () => d.getTaskDetail(e.ctx, task.id) };
}

describe('Runner', () => {
  it('runs a subtask, streams output into its log and closes it on success', async () => {
    const e = env();
    const [s1] = e.task.subtasks;
    const info = e.runner.runSubtask(s1!.id);
    expect(info.status).toBe('running');
    expect(e.detail().subtasks[0]!.state).toBe('running');
    expect(e.detail().claimedBy).toBe('Агент');
    await e.idle();

    const sub = e.detail().subtasks[0]!;
    expect(sub.state).toBe('done');
    const log = sub.log.map((l) => l.text);
    expect(log).toContain('task=CHE-1 agent=Агент');
    expect(log.some((l) => l.startsWith('Ты — агент на канбан-доске «Тракт». Задача CHE-1'))).toBe(true);
    expect(log).toContain('warn: stderr тоже в лог');
    expect(e.detail().claimedBy).toBeNull();
    expect(e.status()).toBe('В работе');
    const kinds = d.listProjectEvents(e.ctx, e.projectId).map((x) => x.kind);
    expect(kinds.slice(0, 3)).toEqual(['subtask.done', 'subtask.started', 'task.claimed']);
  });

  it('runs all subtasks one by one and moves the task to review', async () => {
    const e = env('json');
    const runs = e.runner.runTask(e.task.id);
    expect(runs.map((r) => r.status)).toEqual(['running', 'queued']);
    await e.idle();
    expect(e.detail().subtasks.map((s) => s.state)).toEqual(['done', 'done']);
    expect(e.status()).toBe('Ревью');
    // отчёт из stream-json стал отчётом по сабтаске
    const done = d.listProjectEvents(e.ctx, e.projectId).find((x) => x.kind === 'subtask.done')!;
    expect(done.note).toBe('Удалить модуль — Сделал CHE-1');
  });

  it('fails the subtask on a non-zero exit and drops the rest of the queue', async () => {
    const e = env('exit=3');
    e.runner.runTask(e.task.id);
    await e.idle();
    expect(e.detail().subtasks.map((s) => s.state)).toEqual(['failed', 'idle']);
    const failed = d.listProjectEvents(e.ctx, e.projectId).find((x) => x.kind === 'subtask.failed')!;
    expect(failed.note).toContain('процесс завершился с кодом 3');
  });

  it('stops a running agent', async () => {
    const e = env('sleep=20000');
    const run = e.runner.runSubtask(e.task.subtasks[0]!.id);
    await new Promise((r) => setTimeout(r, 300));
    e.runner.stopRun(run.id);
    await e.idle();
    const sub = e.detail().subtasks[0]!;
    expect(sub.state).toBe('idle');
    expect(sub.log.at(-1)!.text).toBe('Остановлено');
    const status = e.ctx.db.get<{ status: string }>('SELECT status FROM runs WHERE id = ?', run.id)!.status;
    expect(status).toBe('stopped');
  });

  it('runs a task without subtasks as a whole and posts the report', async () => {
    const e = env('json', { subtasks: [] });
    e.runner.runTask(e.task.id);
    await e.idle();
    expect(e.detail().taskLog.map((l) => l.text)).toContain('Читаю задачу');
    const comment = d.listProjectEvents(e.ctx, e.projectId).find((x) => x.kind === 'task.comment')!;
    expect(comment.note).toBe('Сделал CHE-1');
  });

  it('runs in a separate git worktree per task when enabled', async () => {
    const e = env();
    const repo = d.getProject(e.ctx, e.projectId).repoPath!;
    const git = (...a: string[]) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' }).toString();
    git('init', '-q');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
    d.updateAgentSettings(e.ctx, e.projectId, { useWorktree: true });
    e.runner.runSubtask(e.task.subtasks[0]!.id);
    await e.idle();
    const log = e.detail().subtasks[0]!.log.map((l) => l.text);
    expect(log.find((l) => l.startsWith('Папка:'))).toMatch(/worktrees[\\/]CHE-1$/);
    expect(git('branch', '--list', 'trakt/CHE-1')).toContain('trakt/CHE-1');
  });

  it('explains what to configure', () => {
    const e = env('', { configure: false });
    expect(() => e.runner.runSubtask(e.task.subtasks[0]!.id)).toThrow('Укажите папку проекта');
    expect(e.runner.handOver(e.task.id)).toBe(false);
  });

  it('hands over only when not paused', async () => {
    const e = env();
    d.updateAppSettings(e.ctx, { agentsPaused: true });
    expect(e.runner.handOver(e.task.id)).toBe(false);
    d.updateAppSettings(e.ctx, { agentsPaused: false });
    expect(e.runner.handOver(e.task.id)).toBe(true);
    await e.idle();
  });

  it('auto-takes a task from the second status', async () => {
    const e = env();
    d.updateAgentSettings(e.ctx, e.projectId, { autoTake: true });
    const t = d.createTask(e.ctx, e.projectId, {
      title: 'Из «К работе»',
      typeId: e.types[3]!.id,
      statusId: e.statuses[1]!,
      subtasks: ['Одна'],
    });
    e.runner.autoTakeTick();
    expect(e.runner.runsForTask(t.id)).toHaveLength(1);
    for (let i = 0; i < 200 && e.runner.runsForTask(t.id).length; i++)
      await new Promise((r) => setTimeout(r, 50));
    const after = d.getTaskDetail(e.ctx, t.id);
    expect(after.subtasks[0]!.state).toBe('done');
    // взял в работу и после единственной сабтаски передал на ревью
    expect(
      e.ctx.db.get<{ name: string }>('SELECT name FROM statuses WHERE id = ?', after.statusId)!.name,
    ).toBe('Ревью');
  });
});
