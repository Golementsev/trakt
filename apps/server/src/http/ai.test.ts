import { describe, expect, it } from 'vitest';
import type { Board, Idea, TaskDetail } from '@trakt/shared';
import { Db } from '../db/db';
import { createCtx, listProjectEvents, resolveTask, seedDemo } from '../domain';
import type { AiProvider } from '../ai/provider';
import { createApp } from './app';

/** Поддельная модель: отвечает заготовкой, отдаёт текст кусками. */
function fakeAi(answer: string, prompts: string[] = []): AiProvider {
  return {
    id: 'api',
    label: 'fake',
    async generate(prompt, opts) {
      prompts.push(prompt);
      let acc = '';
      for (const part of answer.match(/.{1,5}/gs) ?? []) {
        acc += part;
        opts?.onText?.(acc);
      }
      return answer;
    },
  };
}

function make(ai: AiProvider | null) {
  const ctx = createCtx(new Db(':memory:'));
  seedDemo(ctx);
  const app = createApp({ ctx, ai: () => ai });
  const pay = ctx.db.get<{ id: string }>("SELECT id FROM projects WHERE key = 'PAY'")!.id;
  const req = (method: string, url: string, body?: unknown) =>
    app.request(`/api${url}`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { ctx, app, pay, req };
}

describe('AI endpoints', () => {
  it('reports availability and explains how to enable AI', async () => {
    const off = make(null);
    expect(await (await off.req('GET', '/ai')).json()).toMatchObject({ available: false });
    const res = await off.req('POST', '/ai/split', { title: 'x' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('ANTHROPIC_API_KEY');
    expect(await (await make(fakeAi('')).req('GET', '/ai')).json()).toEqual({
      available: true,
      provider: 'fake',
      hint: null,
    });
  });

  it('splits a draft and an existing task into subtasks', async () => {
    const prompts: string[] = [];
    const { ctx, pay, req } = make(fakeAi('["Собрать требования", "Сделать", "Проверить"]', prompts));
    const draft = await req('POST', '/ai/split', { title: 'Экспорт в CSV', description: 'Для бухгалтерии' });
    expect(await draft.json()).toEqual({ subtasks: ['Собрать требования', 'Сделать', 'Проверить'] });
    expect(prompts[0]).toContain('«Экспорт в CSV»');

    const t = resolveTask(ctx, 'PAY-18');
    const res = await req('POST', `/tasks/${t.id}/split`, {});
    const detail = (await res.json()) as TaskDetail;
    expect(detail.subtasks.map((s) => s.title)).toEqual(['Собрать требования', 'Сделать', 'Проверить']);
    const e = listProjectEvents(ctx, pay)[0]!;
    expect([e.actor, e.summary]).toEqual(['AI', 'разбил PAY-18 на сабтаски']);
  });

  it('streams an idea as NDJSON with the board in context', async () => {
    const prompts: string[] = [];
    const { pay, req } = make(fakeAi('Идея: оплата по QR.\n— Задача один', prompts));
    const res = await req('POST', '/ai/generate', { projectId: pay, text: 'Идея фичи' });
    expect(res.headers.get('content-type')).toContain('ndjson');
    const lines = (await res.text())
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { t?: string; done?: boolean });
    expect(lines.at(-1)).toEqual({ done: true });
    expect(lines.map((l) => l.t ?? '').join('')).toBe('Идея: оплата по QR.\n— Задача один');
    expect(prompts[0]).toContain('PAY-12 [В работе] Токенизация карты');
  });

  it('keeps ideas per project', async () => {
    const { pay, req } = make(null);
    const created = (await (
      await req('POST', `/projects/${pay}/ideas`, { text: 'Оплата по QR', aiText: 'x' })
    ).json()) as Idea;
    expect(created.text).toBe('Оплата по QR');
    const list = (await (await req('GET', `/projects/${pay}/ideas`)).json()) as Idea[];
    expect(list.map((i) => i.text)).toEqual(['Оплата по QR']);
    await req('DELETE', `/ideas/${created.id}`);
    expect(await (await req('GET', `/projects/${pay}/ideas`)).json()).toEqual([]);
    const board = (await (await req('GET', `/projects/${pay}/board`)).json()) as Board;
    expect(board.project.key).toBe('PAY');
  });
});
