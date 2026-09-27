/**
 * Пресеты команды запуска агента. Промпт подаётся в stdin процесса.
 * Плейсхолдеры: {mcpConfigFile} — JSON с подключением к доске, {mcpUrl}, {promptFile},
 * {repoPath}, {task} (PAY-12), {subtask} (id). Пути подставляются в кавычках.
 */
import type { RunnerSourceId } from './api';

export interface AgentPreset {
  id: Exclude<RunnerSourceId, 'custom'>;
  label: string;
  /** Имя агента в ленте. */
  agentName: string;
  command: string;
}

export const AGENT_PRESETS: readonly AgentPreset[] = [
  {
    id: 'claude-cli',
    label: 'Claude Code CLI',
    agentName: 'Claude Code',
    command:
      'claude -p --output-format stream-json --verbose --mcp-config {mcpConfigFile} --allowedTools mcp__trakt --permission-mode acceptEdits',
  },
  {
    id: 'codex-cli',
    label: 'Codex CLI',
    agentName: 'Codex',
    command: 'codex exec --full-auto -',
  },
];

/** Имя агента по команде запуска: кого подписывать в ленте. */
export function agentNameForCommand(command: string | null | undefined): string {
  const bin = (command ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  const base = bin
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.(exe|cmd|bat)$/, '');
  return AGENT_PRESETS.find((p) => p.command.split(' ')[0] === base)?.agentName ?? 'Агент';
}
