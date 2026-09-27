import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { LiveMessage } from '@trakt/shared';
import { Db } from '../db/db';
import { createCtx, getTaskCard, listProjectEvents, resolveTask, seedDemo } from '../domain';
import { createApp } from '../http/app';

async function connect(name = 'test-agent') {
  const ctx = createCtx(new Db(':memory:'));
  seedDemo(ctx);
  const app = createApp({ ctx });
  const client = new Client({ name, version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('http://127.0.0.1:4700/mcp'), {
    fetch: (url, init) => Promise.resolve(app.request(String(url), init)),
  });
  await client.connect(transport);
  const call = async (tool: string, args: Record<string, unknown> = {}) => {
    const res = await client.callTool({ name: tool, arguments: args });
    const text = (res.content as Array<{ text: string }>)[0]!.text;
    if (res.isError) throw new Error(text);
    return JSON.parse(text) as Record<string, unknown> & Array<Record<string, unknown>>;
  };
  return { ctx, client, call };
}

describe('MCP', () => {
  it('exposes the contract tools and the work_on_task prompt', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'add_comment',
        'add_subtask',
        'claim_task',
        'complete_subtask',
        'create_task',
        'fail_subtask',
        'get_board',
        'get_task',
        'list_projects',
        'list_tasks',
        'log_progress',
        'move_task',
        'release_task',
        'start_subtask',
        'update_task',
      ].sort(),
    );
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(['work_on_task']);
    expect(client.getInstructions()).toContain('claim_task');
  });

  it('runs a full cycle on a task and the board sees it live', async () => {
    const { ctx, call } = await connect('claude-code');
    const live: LiveMessage[] = [];
    ctx.bus.subscribe((m) => live.push(m));

    const projects = await call('list_projects');
    expect(projects.map((p) => p.key)).toEqual(['PAY', 'MOB', 'OPS']);

    // PAY-20: «К работе», ведёт агент, одна сабтаска
    const available = await call('list_tasks', { project: 'PAY', onlyAvailable: true });
    expect(available.map((t) => t.id)).toContain('PAY-20');

    const task = await call('get_task', { task: 'PAY-20' });
    expect(task.status).toBe('К работе');
    const [sub] = task.subtasks as Array<{ id: string }>;

    await call('claim_task', { task: 'PAY-20' });
    await call('move_task', { task: 'PAY-20', status: 'В работе', note: 'Беру в работу' });
    await call('start_subtask', { subtask: sub!.id });
    await call('log_progress', { subtask: sub!.id, text: 'canMakePayments() возвращает false в Chrome' });
    const done = await call('complete_subtask', { subtask: sub!.id, report: 'Нужен флаг в настройках' });
    expect(done.taskMovedTo).toBe('Ревью');

    const card = getTaskCard(ctx, resolveTask(ctx, 'PAY-20').id);
    expect(card.claimedBy).toBe('claude-code');
    expect(card.subtasks).toEqual({ done: 1, total: 1 });

    const pay = ctx.db.get<{ id: string }>("SELECT id FROM projects WHERE key = 'PAY'")!;
    const feed = listProjectEvents(ctx, pay.id);
    expect(feed.slice(0, 5).map((e) => `${e.actor}: ${e.summary}`)).toEqual([
      'claude-code: перевёл PAY-20 «В работе» → «Ревью»',
      'claude-code: закрыл сабтаску в PAY-20',
      'claude-code: начал сабтаску в PAY-20',
      'claude-code: перевёл PAY-20 «К работе» → «В работе»',
      'claude-code: взял PAY-20',
    ]);
    // UI получает живые сообщения по каждому шагу
    expect(live.every((m) => m.actor === 'claude-code')).toBe(true);
    expect(live.map((m) => m.kind)).toContain('subtask.log');
  });

  it('returns readable errors instead of breaking', async () => {
    const { call } = await connect();
    await expect(call('move_task', { task: 'PAY-18', status: 'Готово', note: 'x' })).rejects.toThrow(
      'запрещён воркфлоу',
    );
    await expect(call('get_task', { task: 'PAY-999' })).rejects.toThrow('не найдена');
    await expect(call('list_tasks', { project: 'NOPE' })).rejects.toThrow('Есть: PAY, MOB, OPS');
  });

  it('uses the agent parameter as the name in the feed', async () => {
    const { ctx, call } = await connect();
    await call('add_comment', { task: 'PAY-12', text: 'Нужен ключ', agent: 'Codex' });
    const e = ctx.db.get<{ actor: string }>('SELECT actor FROM events ORDER BY id DESC LIMIT 1')!;
    expect(e.actor).toBe('Codex');
  });
});

describe('local-only guard', () => {
  it('rejects foreign origins, foreign hosts and non-json mutations', async () => {
    const ctx = createCtx(new Db(':memory:'));
    const app = createApp({ ctx });
    const foreign = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(foreign.status).toBe(403);
    const rebinding = await app.request('http://evil.example/api/projects');
    expect(rebinding.status).toBe(403);
    const form = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(form.status).toBe(415);
    const ok = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:5173' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(ok.status).toBe(201);
  });
});
