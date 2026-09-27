import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { AgentsOverview } from '@trakt/shared';
import { Db } from '../db/db';
import * as d from '../domain';
import { createApp } from '../http/app';
import { McpRegistry } from '../mcp/registry';
import { AgentsService } from './service';

function make(env: NodeJS.ProcessEnv = {}) {
  const ctx = d.createCtx(new Db(':memory:'));
  d.seedDemo(ctx);
  const registry = new McpRegistry();
  const agents = new AgentsService(ctx, {
    registry,
    mcpUrl: 'http://127.0.0.1:4700/mcp',
    // несуществующие CLI — чтобы тест не зависел от того, что установлено на машине
    env: { TRAKT_AI_CLI: 'trakt-no-such-cli', ...env },
  });
  const app = createApp({ ctx, agents, registry });
  const json = (method: string, url: string, body?: unknown) =>
    app.request(`/api${url}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { ctx, registry, agents, app, json };
}

describe('agent sources config', () => {
  it('defaults to Claude Code CLI and resolves commands and names', () => {
    const { ctx } = make();
    const cfg = d.getAgentsConfig(ctx);
    expect(cfg).toEqual({ runner: 'claude-cli', customCommand: '', ai: 'auto' });
    expect(d.runnerCommand(cfg)).toContain('claude -p');
    expect(d.runnerAgentName(cfg)).toBe('Claude Code');

    const custom = d.updateAgentsConfig(ctx, { runner: 'custom', customCommand: '  aider --yes  ' });
    expect(custom.customCommand).toBe('aider --yes');
    expect(d.runnerCommand(custom)).toBe('aider --yes');
    expect(d.runnerAgentName(custom)).toBe('Агент');
    expect(d.runnerCommand(d.updateAgentsConfig(ctx, { customCommand: '' }))).toBeNull();
  });
});

describe('AI source switching', () => {
  it('picks the API when a key is present and honours the mode from the UI', () => {
    const withKey = make({ ANTHROPIC_API_KEY: 'test-key' });
    expect(withKey.agents.aiProvider()?.id).toBe('api');
    d.updateAgentsConfig(withKey.ctx, { ai: 'off' });
    expect(withKey.agents.aiProvider()).toBeNull();
    d.updateAgentsConfig(withKey.ctx, { ai: 'cli' });
    expect(withKey.agents.aiProvider()).toBeNull(); // CLI не установлен

    const noKey = make();
    expect(noKey.agents.aiProvider()).toBeNull();
  });
});

describe('/api/agents', () => {
  it('shows sources, lets the UI switch them and lists MCP clients', async () => {
    const { app, json } = make();
    const client = new Client({ name: 'claude-code', version: '2.1.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL('http://127.0.0.1:4700/mcp'), {
        fetch: (url, init) => Promise.resolve(app.request(String(url), init)),
      }),
    );
    await client.callTool({ name: 'get_task', arguments: { task: 'PAY-12' } });

    const overview = (await (await json('GET', '/agents')).json()) as AgentsOverview;
    expect(overview.runner.selected).toBe('claude-cli');
    expect(overview.runner.sources.map((s) => s.id)).toEqual(['claude-cli', 'codex-cli', 'custom']);
    expect(overview.ai.mode).toBe('auto');
    expect(overview.clients).toHaveLength(1);
    expect(overview.clients[0]).toMatchObject({
      name: 'claude-code',
      version: '2.1.0',
      lastAction: 'get_task PAY-12',
    });

    const changed = (await (
      await json('PUT', '/agents', { runner: 'custom', customCommand: 'my-agent --run', ai: 'off' })
    ).json()) as AgentsOverview;
    expect(changed.runner.selected).toBe('custom');
    expect(changed.runner.sources.find((s) => s.id === 'custom')!.command).toBe('my-agent --run');
    expect(changed.ai.mode).toBe('off');
    expect(changed.ai.effective).toBeNull();

    const bad = await json('PUT', '/agents', { runner: 'gpt' });
    expect(bad.status).toBe(400);
  });

  it('explains checks that cannot run', async () => {
    const { json } = make();
    const ai = (await (await json('POST', '/agents/check', { target: 'ai' })).json()) as {
      ok: boolean;
      message: string;
    };
    expect(ai.ok).toBe(false);
    expect(ai.message).toContain('ANTHROPIC_API_KEY');
    const custom = (await (await json('POST', '/agents/check', { target: 'custom' })).json()) as {
      ok: boolean;
    };
    expect(custom.ok).toBe(false);
  });
});
