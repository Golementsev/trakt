import { execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ACTOR_YOU, type ActiveRun, type RunInfo } from '@trakt/shared';
import * as d from '../domain';
import { killTree, lineSplitter, spawnShell } from './process';
import { parseOutputLine } from './output';
import { buildPrompt } from './prompt';

export interface RunnerOptions {
  /** Адрес MCP доски — его получает агент. */
  mcpUrl: string;
  /** Папка для служебных файлов прогонов и worktree (data/runs). */
  workDir: string;
  /** Период фоновой раздачи задач (autoTake), мс. 0 — не запускать. */
  autoTakeMs?: number;
}

interface Pending {
  id: string;
  taskId: string;
  subtaskId: string | null;
  projectId: string;
  agentName: string;
}

interface Active extends Pending {
  child: ChildProcess;
  stopped: boolean;
  report: string | null;
  lastLines: string[];
}

const RUN_CLAIM_MINUTES = 24 * 60;

/**
 * Push-режим: доска сама запускает агента командой из настроек проекта.
 * Агент внутри прогона отчитывается через тот же MCP, поэтому правила те же, что в pull-режиме.
 * Сабтаски одной задачи идут строго по очереди; проектов параллельно — не больше maxParallel.
 */
export class Runner {
  private readonly queue: Pending[] = [];
  private readonly active = new Map<string, Active>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private notifyTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly ctx: d.Ctx,
    private readonly opts: RunnerOptions,
  ) {}

  /** Подобрать «зависшие» прогоны прошлого запуска и включить autoTake. */
  start() {
    const stale = this.ctx.db.all<{ id: string; subtask_id: string | null }>(
      "SELECT id, subtask_id FROM runs WHERE status = 'running'",
    );
    for (const r of stale) {
      this.ctx.db.run(
        "UPDATE runs SET status = 'failed', finished_at = ?, report = 'Сервер доски перезапустился' WHERE id = ?",
        this.ctx.now(),
        r.id,
      );
      if (r.subtask_id)
        this.ctx.db.run(
          "UPDATE subtasks SET state = 'idle' WHERE id = ? AND state = 'running'",
          r.subtask_id,
        );
    }
    if (this.opts.autoTakeMs) this.timer = setInterval(() => this.autoTakeTick(), this.opts.autoTakeMs);
  }

  close() {
    clearInterval(this.timer);
    for (const a of this.active.values()) {
      a.stopped = true;
      killTree(a.child);
    }
  }

  // ---------- что видит UI ----------

  runsForTask(taskId: string): RunInfo[] {
    const running = [...this.active.values()].filter((a) => a.taskId === taskId);
    const queued = this.queue.filter((q) => q.taskId === taskId);
    return [
      ...running.map((a) => ({
        id: a.id,
        subtaskId: a.subtaskId,
        status: 'running' as const,
        agentName: a.agentName,
      })),
      ...queued.map((q) => ({
        id: q.id,
        subtaskId: q.subtaskId,
        status: 'queued' as const,
        agentName: q.agentName,
      })),
    ];
  }

  /** Все прогоны доски — для страницы «Агенты». */
  allRuns(): ActiveRun[] {
    const info = (x: Pending, status: ActiveRun['status']): ActiveRun | null => {
      try {
        const t = d.getTaskRow(this.ctx, x.taskId);
        return {
          id: x.id,
          task: d.taskKey(this.ctx, t),
          taskTitle: t.title,
          subtask: x.subtaskId ? d.getSubtaskRow(this.ctx, x.subtaskId).title : null,
          agentName: x.agentName,
          status,
        };
      } catch {
        return null;
      }
    };
    return [
      ...[...this.active.values()].map((a) => info(a, 'running')),
      ...this.queue.map((q) => info(q, 'queued')),
    ].filter((x): x is ActiveRun => x !== null);
  }

  // ---------- команды ----------

  /** «▶ Агент» на сабтаске. */
  runSubtask(subtaskId: string): RunInfo {
    const s = d.getSubtaskRow(this.ctx, subtaskId);
    const t = d.getTaskRow(this.ctx, s.task_id);
    if (s.done) throw d.invalid('Сабтаска уже готова');
    if (this.isBusy(t.id, subtaskId)) throw d.conflict('Агент уже работает над этой сабтаской');
    const item = this.enqueue(t, subtaskId);
    this.recordStart(t, [s.title]);
    this.dispatch();
    return this.infoOf(item.id);
  }

  /** «▶ Все агенту»: открытые сабтаски по очереди; если сабтасок нет — задача целиком. */
  runTask(taskId: string, actor = ACTOR_YOU): RunInfo[] {
    const t = d.getTaskRow(this.ctx, taskId);
    const open = d.listSubtasks(this.ctx, taskId).filter((s) => !s.done && !this.isBusy(taskId, s.id));
    const hasSubtasks = d.listSubtasks(this.ctx, taskId).length > 0;
    if (hasSubtasks && !open.length) throw d.invalid('Все сабтаски уже готовы или в работе');
    if (!hasSubtasks && this.isBusy(taskId, null)) throw d.conflict('Агент уже работает над задачей');
    this.config(t.project_id);
    const items = hasSubtasks ? open.map((s) => this.enqueue(t, s.id)) : [this.enqueue(t, null)];
    this.recordStart(t, hasSubtasks ? open.map((s) => s.title) : [], actor);
    this.dispatch();
    return items.map((i) => this.infoOf(i.id));
  }

  /**
   * Задачу отдали агенту («▶ Отдать агенту», «Создать и отдать агенту»). Если раннер
   * настроен и агенты не на паузе — сразу запускаем. Иначе задачу возьмёт агент через MCP.
   */
  handOver(taskId: string): boolean {
    const t = d.getTaskRow(this.ctx, taskId);
    if (d.getAppSettings(this.ctx).agentsPaused || !this.isConfigured(t.project_id)) return false;
    if (this.runsForTask(taskId).length) return false;
    try {
      this.runTask(taskId);
      return true;
    } catch {
      return false;
    }
  }

  /** «■ Стоп» на прогоне (или снять его из очереди). */
  stopRun(runId: string, actor = ACTOR_YOU) {
    const qi = this.queue.findIndex((q) => q.id === runId);
    if (qi >= 0) {
      const [q] = this.queue.splice(qi, 1);
      this.touch(q!.projectId, q!.taskId);
      return;
    }
    const a = this.active.get(runId);
    if (!a) throw d.notFound('Прогон');
    a.stopped = true;
    const t = d.getTaskRow(this.ctx, a.taskId);
    const sub = a.subtaskId ? d.getSubtaskRow(this.ctx, a.subtaskId).title : null;
    d.record(this.ctx, {
      projectId: t.project_id,
      taskId: t.id,
      actor,
      kind: 'run.stopped',
      summary: `остановили агента в ${d.taskKey(this.ctx, t)}`,
      note: sub,
    });
    killTree(a.child);
  }

  /** «Забрать у агента»: снять очередь и остановить прогоны задачи. */
  stopTask(taskId: string) {
    for (let i = this.queue.length - 1; i >= 0; i--)
      if (this.queue[i]!.taskId === taskId) this.queue.splice(i, 1);
    for (const a of this.active.values()) {
      if (a.taskId !== taskId) continue;
      a.stopped = true;
      killTree(a.child);
    }
  }

  /** Фоновая раздача: агент сам берёт задачи из второго статуса («К работе»). */
  autoTakeTick() {
    if (d.getAppSettings(this.ctx).agentsPaused) return;
    const projects = this.ctx.db.all<{ project_id: string }>(
      'SELECT project_id FROM agent_settings WHERE auto_take = 1',
    );
    for (const { project_id: pid } of projects) {
      if (!this.isConfigured(pid)) continue;
      const settings = d.getAgentSettings(this.ctx, pid);
      if (this.loadOf(pid) >= settings.maxParallel) continue;
      const statuses = d.listStatuses(this.ctx, pid);
      const from = statuses[1];
      if (!from || from.category === 'done') continue;
      const candidate = this.ctx.db
        .all<d.TaskRow>('SELECT * FROM tasks WHERE status_id = ? ORDER BY position', from.id)
        .find((t) => !d.activeClaim(this.ctx, t) && !this.runsForTask(t.id).length);
      if (!candidate) continue;
      this.takeAutomatically(candidate, statuses);
    }
  }

  // ---------- внутреннее ----------

  private takeAutomatically(t: d.TaskRow, statuses: ReturnType<typeof d.listStatuses>) {
    const agent = this.agentName();
    const key = d.taskKey(this.ctx, t);
    try {
      d.agentClaimTask(this.ctx, key, agent, RUN_CLAIM_MINUTES);
      const cur = statuses.findIndex((s) => s.id === t.status_id);
      const doing = statuses.slice(cur + 1).find((s) => s.category === 'doing');
      if (doing) {
        try {
          d.agentMoveTask(this.ctx, key, doing.id, agent, 'Беру в работу');
        } catch {
          /* воркфлоу не пускает — работаем в текущем статусе */
        }
      }
      this.runTask(t.id, agent);
    } catch (e) {
      d.agentAddComment(this.ctx, key, `Не смог взять задачу: ${e instanceof Error ? e.message : e}`, agent);
    }
  }

  private isBusy(taskId: string, subtaskId: string | null) {
    return this.runsForTask(taskId).some((r) => r.subtaskId === subtaskId);
  }

  private loadOf(projectId: string) {
    return (
      [...this.active.values()].filter((a) => a.projectId === projectId).length +
      new Set(this.queue.filter((q) => q.projectId === projectId).map((q) => q.taskId)).size
    );
  }

  /** Имя в ленте — по источнику, выбранному на странице «Агенты». */
  private agentName() {
    return d.runnerAgentName(d.getAgentsConfig(this.ctx));
  }

  private isConfigured(projectId: string) {
    try {
      this.config(projectId);
      return true;
    } catch {
      return false;
    }
  }

  /** Что нужно для запуска: папка проекта и команда. Иначе — понятная ошибка. */
  private config(projectId: string) {
    const p = d.getProjectRow(this.ctx, projectId);
    const s = d.getAgentSettings(this.ctx, projectId);
    if (!p.repo_path)
      throw d.invalid('Укажите папку проекта в «Настройки → Агент» — в ней агент будет работать.');
    if (!existsSync(p.repo_path) || !statSync(p.repo_path).isDirectory())
      throw d.invalid(`Папка проекта не найдена: ${p.repo_path}`);
    const command = d.runnerCommand(d.getAgentsConfig(this.ctx));
    if (!command) throw d.invalid('Выберите, кто запускается кнопкой «▶ Агент», на странице «Агенты».');
    return {
      repoPath: p.repo_path,
      command,
      useWorktree: s.useWorktree,
      maxParallel: s.maxParallel,
    };
  }

  private enqueue(t: d.TaskRow, subtaskId: string | null): Pending {
    this.config(t.project_id);
    const item: Pending = {
      id: this.ctx.newId(),
      taskId: t.id,
      subtaskId,
      projectId: t.project_id,
      agentName: this.agentName(),
    };
    this.queue.push(item);
    return item;
  }

  private recordStart(t: d.TaskRow, titles: string[], actor = ACTOR_YOU) {
    if (actor !== ACTOR_YOU) return;
    d.record(this.ctx, {
      projectId: t.project_id,
      taskId: t.id,
      actor,
      kind: 'run.started',
      summary: `запустили агента в ${d.taskKey(this.ctx, t)}`,
      note: titles.length ? titles.join(', ') : null,
    });
  }

  private infoOf(id: string): RunInfo {
    const a = this.active.get(id);
    if (a) return { id, subtaskId: a.subtaskId, status: 'running', agentName: a.agentName };
    const q = this.queue.find((x) => x.id === id);
    if (q) return { id, subtaskId: q.subtaskId, status: 'queued', agentName: q.agentName };
    // успел завершиться (например, команда не нашлась) — отдаём последнее состояние
    return { id, subtaskId: null, status: 'running', agentName: '' };
  }

  /** Запустить из очереди всё, что можно: одна задача — один прогон, проект — до maxParallel. */
  private dispatch() {
    for (const item of [...this.queue]) {
      const busyTask = [...this.active.values()].some((a) => a.taskId === item.taskId);
      if (busyTask) continue;
      let max = 1;
      try {
        max = d.getAgentSettings(this.ctx, item.projectId).maxParallel;
      } catch {
        /* проект удалили */
      }
      const running = [...this.active.values()].filter((a) => a.projectId === item.projectId).length;
      if (running >= max) continue;
      this.queue.splice(this.queue.indexOf(item), 1);
      this.launch(item);
    }
  }

  private launch(item: Pending) {
    const { ctx } = this;
    let t: d.TaskRow;
    try {
      t = d.getTaskRow(ctx, item.taskId);
    } catch {
      return; // задачу удалили, пока ждала в очереди
    }
    const key = d.taskKey(ctx, t);
    const fail = (message: string) => {
      d.agentAddComment(ctx, key, `Не удалось запустить агента: ${message}`, item.agentName);
      this.dropQueueOf(item.taskId);
    };

    let cwd: string;
    let command: string;
    try {
      const cfg = this.config(t.project_id);
      cwd = cfg.useWorktree ? this.worktree(cfg.repoPath, key) : cfg.repoPath;
      command = cfg.command;
      d.agentClaimTask(ctx, key, item.agentName, RUN_CLAIM_MINUTES);
      if (item.subtaskId) d.agentStartSubtask(ctx, item.subtaskId, item.agentName);
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
      return;
    }

    const dir = resolve(this.opts.workDir, item.id);
    mkdirSync(dir, { recursive: true });
    const prompt = buildPrompt(ctx, {
      taskId: t.id,
      subtaskId: item.subtaskId,
      agentName: item.agentName,
      cwd,
    });
    const promptFile = join(dir, 'prompt.md');
    const mcpConfigFile = join(dir, 'mcp.json');
    writeFileSync(promptFile, prompt);
    writeFileSync(
      mcpConfigFile,
      JSON.stringify({ mcpServers: { trakt: { type: 'http', url: this.opts.mcpUrl } } }, null, 2),
    );

    const q = (s: string) => `"${s}"`;
    const expanded = command
      .replaceAll('{promptFile}', q(promptFile))
      .replaceAll('{mcpConfigFile}', q(mcpConfigFile))
      .replaceAll('{mcpUrl}', this.opts.mcpUrl)
      .replaceAll('{repoPath}', q(cwd))
      .replaceAll('{task}', key)
      .replaceAll('{subtask}', item.subtaskId ?? '');

    const child = spawnShell(expanded, cwd, {
      TRAKT_TASK: key,
      TRAKT_SUBTASK: item.subtaskId ?? '',
      TRAKT_MCP_URL: this.opts.mcpUrl,
      TRAKT_AGENT: item.agentName,
    });
    const run: Active = { ...item, child, stopped: false, report: null, lastLines: [] };
    this.active.set(item.id, run);
    ctx.db.run(
      `INSERT INTO runs (id, task_id, subtask_id, agent_name, mode, status, pid, started_at)
       VALUES (?, ?, ?, ?, 'push', 'running', ?, ?)`,
      item.id,
      t.id,
      item.subtaskId,
      item.agentName,
      child.pid ?? null,
      ctx.now(),
    );
    this.log(run, `$ ${expanded}`);
    this.log(run, `Папка: ${cwd}`);

    const onLine = (line: string) => {
      for (const out of parseOutputLine(line)) {
        if (out.result) run.report = out.result;
        if (out.text) this.log(run, out.text);
      }
    };
    const stdout = lineSplitter(onLine);
    const stderr = lineSplitter(onLine);
    child.stdout?.on('data', (c: Buffer) => stdout.push(c));
    child.stderr?.on('data', (c: Buffer) => stderr.push(c));
    child.stdin?.on('error', () => {
      /* агент мог не читать stdin */
    });
    child.stdin?.end(prompt);

    let done = false;
    const finish = (code: number | null, error?: string) => {
      if (done) return;
      done = true;
      stdout.flush();
      stderr.flush();
      if (error) this.log(run, error);
      this.finish(run, code);
    };
    child.on('error', (e) => finish(null, `Не удалось запустить команду: ${e.message}`));
    child.on('close', (code) => finish(code));
    this.touch(item.projectId, item.taskId);
  }

  private finish(run: Active, code: number | null) {
    const { ctx } = this;
    this.active.delete(run.id);
    const status = run.stopped ? 'stopped' : code === 0 ? 'done' : 'failed';
    ctx.db.run(
      'UPDATE runs SET status = ?, finished_at = ?, report = ? WHERE id = ?',
      status,
      ctx.now(),
      run.report,
      run.id,
    );

    try {
      const t = d.getTaskRow(ctx, run.taskId);
      const key = d.taskKey(ctx, t);
      const sub = run.subtaskId ? d.getSubtaskRow(ctx, run.subtaskId) : null;
      if (status === 'stopped') {
        this.log(run, 'Остановлено');
        if (sub) ctx.db.run("UPDATE subtasks SET state = 'idle' WHERE id = ? AND state = 'running'", sub.id);
        this.dropQueueOf(run.taskId);
      } else if (status === 'done') {
        // агент сам отчитался через MCP — ничего не делаем; иначе закрываем по коду выхода
        if (sub && !sub.done)
          d.agentCompleteSubtask(ctx, sub.id, run.agentName, run.report ?? 'Прогон завершён');
        if (!sub && run.report) d.agentAddComment(ctx, key, run.report, run.agentName);
      } else {
        const tail = run.lastLines.at(-1);
        const reason = `процесс завершился с кодом ${code ?? '—'}${tail ? `: ${tail}` : ''}`;
        if (sub && !d.getSubtaskRow(ctx, sub.id).done && d.getSubtaskRow(ctx, sub.id).state !== 'failed')
          d.agentFailSubtask(ctx, sub.id, reason, run.agentName);
        if (!sub) d.agentAddComment(ctx, key, `Прогон не удался: ${reason}`, run.agentName);
        this.dropQueueOf(run.taskId);
      }
      // больше прогонов по задаче нет — отпускаем лиз, чтобы задачу мог взять кто-то ещё
      if (!this.runsForTask(t.id).length)
        ctx.db.run(
          'UPDATE tasks SET claimed_by = NULL, claim_until = NULL WHERE id = ? AND claimed_by = ?',
          t.id,
          run.agentName,
        );
      this.touch(t.project_id, t.id);
    } catch (e) {
      // задачу удалили во время прогона — просто продолжаем очередь
      if (!(e instanceof d.DomainError)) console.error(e);
    }
    this.dispatch();
  }

  private dropQueueOf(taskId: string) {
    for (let i = this.queue.length - 1; i >= 0; i--)
      if (this.queue[i]!.taskId === taskId) this.queue.splice(i, 1);
  }

  private log(run: Active, text: string) {
    this.ctx.db.run(
      'INSERT INTO run_log_lines (run_id, subtask_id, text, at) VALUES (?, ?, ?, ?)',
      run.id,
      run.subtaskId,
      text,
      this.ctx.now(),
    );
    run.lastLines.push(text);
    if (run.lastLines.length > 20) run.lastLines.shift();
    this.touch(run.projectId, run.taskId);
  }

  /** Живое обновление, не чаще раза в 300 мс на задачу (агент может писать много). */
  private touch(projectId: string, taskId: string) {
    if (this.notifyTimers.has(taskId)) return;
    this.notifyTimers.set(
      taskId,
      setTimeout(() => {
        this.notifyTimers.delete(taskId);
        d.notify(this.ctx, { projectId, taskId, actor: ACTOR_YOU, kind: 'run.updated' });
      }, 300),
    );
  }

  /** Отдельный git worktree на задачу: ветка trakt/PAY-12 в data/runs/worktrees/PAY-12. */
  private worktree(repoPath: string, key: string) {
    const dir = resolve(this.opts.workDir, 'worktrees', key);
    if (existsSync(dir)) return dir;
    try {
      execFileSync('git', ['-C', repoPath, 'worktree', 'add', '-B', `trakt/${key}`, dir], {
        stdio: 'pipe',
        windowsHide: true,
      });
    } catch (e) {
      const msg = (e as { stderr?: Buffer }).stderr?.toString().trim() || String(e);
      throw d.invalid(`Не удалось создать git worktree (папка проекта — git-репозиторий?): ${msg}`);
    }
    return dir;
  }
}
