import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import {
  AGENT_PRESETS,
  type AgentsOverview,
  type CheckResult,
  type RunnerSource,
  type RunnerSourceId,
} from '@trakt/shared';
import * as d from '../domain';
import { AI_UNAVAILABLE_HINT, apiProvider, cliProvider, type AiProvider } from '../ai/provider';
import type { McpRegistry } from '../mcp/registry';
import type { Runner } from '../runner/runner';

interface Probe {
  at: number;
  installed: boolean;
  version: string | null;
}

const PROBE_TTL = 30_000;
const CHECK_PROMPT = 'Ответь ровно одним словом: готов';

/** Первая строка ответа/ошибки, коротко — для карточки источника. */
const firstLine = (s: string) => s.trim().split('\n').filter(Boolean).at(-1)?.slice(0, 240) ?? '';

// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string) => s.replace(/[[0-9;]*m/g, '');

/** Команда через оболочку без stdin (иначе CLI ждут ввод). out — stdout, а если он пуст — stderr. */
function sh(command: string, timeout: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: tmpdir(),
      shell: true,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => (stdout += c.toString()));
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
    const timer = setTimeout(() => child.kill(), timeout);
    const finish = (code: number) => {
      clearTimeout(timer);
      resolve({ code, out: stripAnsi(stdout.trim() || stderr.trim()) });
    };
    child.on('error', () => finish(127));
    child.on('close', (code) => finish(code ?? 1));
  });
}

/**
 * Источники агентов: кого доска умеет запускать сама, чем отвечают AI-функции,
 * кто подключён по MCP. Выбор хранится в домене (getAgentsConfig), здесь — проверки окружения.
 */
export class AgentsService {
  private readonly probes = new Map<string, Probe>();
  private readonly env: NodeJS.ProcessEnv;

  constructor(
    private readonly ctx: d.Ctx,
    private readonly opts: {
      registry: McpRegistry;
      mcpUrl: string;
      runner?: Runner;
      env?: NodeJS.ProcessEnv;
    },
  ) {
    this.env = opts.env ?? process.env;
  }

  private get hasApiKey() {
    return !!(this.env.ANTHROPIC_API_KEY || this.env.ANTHROPIC_AUTH_TOKEN);
  }

  private get aiCli() {
    return this.env.TRAKT_AI_CLI || 'claude';
  }

  /** Установлен ли CLI (по `--version`), с кешем на 30 секунд. */
  async probe(bin: string, force = false): Promise<Probe> {
    const cached = this.probes.get(bin);
    if (cached && !force && Date.now() - cached.at < PROBE_TTL) return cached;
    const { code, out } = await sh(`${bin} --version`, 15_000);
    const p = { at: Date.now(), installed: code === 0, version: code === 0 ? firstLine(out) || null : null };
    this.probes.set(bin, p);
    return p;
  }

  /** Синхронная проверка для первого запроса к AI, дальше — кеш. */
  private cliInstalledSync(bin: string): boolean {
    const cached = this.probes.get(bin);
    if (cached) return cached.installed;
    const ok =
      spawnSync(`${bin} --version`, { shell: true, windowsHide: true, timeout: 15_000 }).status === 0;
    this.probes.set(bin, { at: Date.now(), installed: ok, version: null });
    return ok;
  }

  /** Чем сейчас отвечают AI-функции (с учётом режима «авто»). null — AI недоступен. */
  aiProvider(): AiProvider | null {
    const mode = (this.env.TRAKT_AI as d.AgentsConfig['ai'] | undefined) ?? d.getAgentsConfig(this.ctx).ai;
    if (mode === 'off') return null;
    if (mode === 'api') return this.hasApiKey ? apiProvider() : null;
    if (mode === 'cli') return this.cliInstalledSync(this.aiCli) ? cliProvider(this.aiCli) : null;
    // авто: ключ API, иначе установленный Claude Code
    if (this.hasApiKey) return apiProvider();
    return this.cliInstalledSync(this.aiCli) ? cliProvider(this.aiCli) : null;
  }

  async overview(): Promise<AgentsOverview> {
    const cfg = d.getAgentsConfig(this.ctx);
    const sources: RunnerSource[] = await Promise.all(
      AGENT_PRESETS.map(async (p) => {
        const probe = await this.probe(p.command.split(' ')[0]!);
        return {
          id: p.id,
          label: p.label,
          agentName: p.agentName,
          command: p.command,
          installed: probe.installed,
          version: probe.version,
        };
      }),
    );
    sources.push({
      id: 'custom',
      label: 'Своя команда',
      agentName: d.runnerAgentName({ ...cfg, runner: 'custom' }),
      command: cfg.customCommand || null,
      installed: null,
      version: null,
    });
    await this.probe(this.aiCli);
    const ai = this.aiProvider();
    return {
      runner: { selected: cfg.runner, customCommand: cfg.customCommand, sources },
      ai: {
        mode: cfg.ai,
        effective: ai?.label ?? null,
        apiKey: this.hasApiKey,
        cli: this.probes.get(this.aiCli)?.installed ?? false,
        hint: ai ? null : AI_UNAVAILABLE_HINT,
      },
      clients: this.opts.registry.list(),
      runs: this.opts.runner?.allRuns() ?? [],
      mcpUrl: this.opts.mcpUrl,
    };
  }

  /** Пробный запуск: источник отвечает на короткий вопрос. Тратит немного токенов. */
  async check(target: RunnerSourceId | 'ai'): Promise<CheckResult> {
    const started = Date.now();
    const done = (ok: boolean, message: string): CheckResult => ({ ok, message, ms: Date.now() - started });

    if (target === 'ai') {
      const ai = this.aiProvider();
      if (!ai) return done(false, AI_UNAVAILABLE_HINT);
      try {
        const answer = await ai.generate(CHECK_PROMPT);
        return done(true, `${ai.label}: «${firstLine(answer)}»`);
      } catch (e) {
        return done(false, e instanceof Error ? e.message : String(e));
      }
    }
    if (target === 'custom')
      return done(
        false,
        'Свою команду доска проверяет только настоящим запуском: нажмите «▶ Агент» на сабтаске.',
      );

    const preset = AGENT_PRESETS.find((p) => p.id === target)!;
    const bin = preset.command.split(' ')[0]!;
    const probe = await this.probe(bin, true);
    if (!probe.installed) return done(false, `${preset.label} не найден: команды «${bin}» нет в PATH.`);
    const cmd =
      target === 'claude-cli' ? `${bin} -p "${CHECK_PROMPT}" --max-turns 1` : `${bin} exec "${CHECK_PROMPT}"`;
    const { code, out } = await sh(cmd, 120_000);
    if (code === 0) return done(true, `Отвечает: «${firstLine(out)}» (${probe.version ?? bin})`);
    return done(false, firstLine(out) || `Команда завершилась с кодом ${code}`);
  }
}
