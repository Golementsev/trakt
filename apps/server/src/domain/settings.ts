import {
  AGENT_PRESETS,
  agentNameForCommand,
  type AiMode,
  type AppSettings,
  type RunnerSourceId,
  type UpdateAgentsInput,
  type UpdateAppSettingsInput,
} from '@trakt/shared';
import type { Ctx } from './context';
import { notify } from './events';

/** Глобальные настройки доски. agentsPaused — тумблер «Агент двигает задачи» выключен. */
export function getAppSettings(ctx: Ctx): AppSettings {
  const r = ctx.db.get<{ value: string }>("SELECT value FROM app_settings WHERE key = 'agentsPaused'");
  return { agentsPaused: r?.value === 'true' };
}

export function updateAppSettings(ctx: Ctx, input: UpdateAppSettingsInput): AppSettings {
  if (input.agentsPaused !== undefined) {
    ctx.db.run(
      "INSERT INTO app_settings (key, value) VALUES ('agentsPaused', ?) ON CONFLICT DO UPDATE SET value = excluded.value",
      String(input.agentsPaused),
    );
  }
  notify(ctx, { projectId: null, actor: 'you', kind: 'settings.updated' });
  return getAppSettings(ctx);
}

export interface AgentsConfig {
  /** Кого доска запускает кнопкой «▶ Агент». */
  runner: RunnerSourceId;
  /** Команда для runner = custom. */
  customCommand: string;
  /** Чем отвечают AI-функции доски. */
  ai: AiMode;
}

const DEFAULT_AGENTS: AgentsConfig = { runner: 'claude-cli', customCommand: '', ai: 'auto' };

/** Источники агентов — одни на всю доску (меняются на странице «Агенты»). */
export function getAgentsConfig(ctx: Ctx): AgentsConfig {
  const r = ctx.db.get<{ value: string }>("SELECT value FROM app_settings WHERE key = 'agents'");
  if (!r) return { ...DEFAULT_AGENTS };
  try {
    return { ...DEFAULT_AGENTS, ...(JSON.parse(r.value) as Partial<AgentsConfig>) };
  } catch {
    return { ...DEFAULT_AGENTS };
  }
}

export function updateAgentsConfig(ctx: Ctx, input: UpdateAgentsInput): AgentsConfig {
  const next = getAgentsConfig(ctx);
  if (input.runner) next.runner = input.runner;
  if (input.customCommand !== undefined) next.customCommand = input.customCommand.trim();
  if (input.ai) next.ai = input.ai;
  ctx.db.run(
    "INSERT INTO app_settings (key, value) VALUES ('agents', ?) ON CONFLICT DO UPDATE SET value = excluded.value",
    JSON.stringify(next),
  );
  notify(ctx, { projectId: null, actor: 'you', kind: 'agents.updated' });
  return next;
}

/** Команда запуска выбранного источника (или null, если «своя команда» пустая). */
export function runnerCommand(cfg: AgentsConfig): string | null {
  if (cfg.runner === 'custom') return cfg.customCommand || null;
  return AGENT_PRESETS.find((p) => p.id === cfg.runner)?.command ?? null;
}

/** Имя агента в ленте для выбранного источника. */
export function runnerAgentName(cfg: AgentsConfig): string {
  if (cfg.runner === 'custom') return agentNameForCommand(cfg.customCommand);
  return AGENT_PRESETS.find((p) => p.id === cfg.runner)?.agentName ?? 'Агент';
}
