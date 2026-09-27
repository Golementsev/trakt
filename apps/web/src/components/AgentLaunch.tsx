import { AGENT_PRESETS, type Board } from '@trakt/shared';
import { api } from '../api/client';
import { Editable } from './Editable';

interface Props {
  board: Board;
  act: (p: Promise<unknown>) => Promise<void>;
}

/** «Настройки → Агент»: как доска сама запускает агента кнопкой «▶ Агент». */
export function AgentLaunch({ board, act }: Props) {
  const pid = board.project.id;
  const g = board.agent;
  const preset =
    AGENT_PRESETS.find((p) => p.command === g.runCommand)?.id ?? (g.runCommand ? 'custom' : null);

  return (
    <div className="sect">
      <h3>Запуск агента кнопкой «▶ Агент»</h3>
      <p className="hint" style={{ margin: '0 0 10px' }}>
        Доска запускает агента в папке проекта и передаёт ему задачу в stdin. Агент отчитывается через MCP,
        лог идёт живьём в сабтаску.
      </p>
      <div className="rows">
        <label className="erow" style={{ fontSize: 13 }}>
          <span className="hint">Папка проекта</span>
          <Editable
            className="in"
            value={board.project.repoPath ?? ''}
            placeholder={'C:\\code\\checkout или /home/me/checkout'}
            onCommit={(repoPath) => void act(api.updateProject(pid, { repoPath: repoPath.trim() || null }))}
          />
        </label>
        <div className="erow">
          <span className="hint">Команда</span>
          <div className="seg">
            {AGENT_PRESETS.map((p) => (
              <button
                key={p.id}
                className={preset === p.id ? 'on' : ''}
                onClick={() => void act(api.updateAgentSettings(pid, { runCommand: p.command }))}
              >
                {p.label}
              </button>
            ))}
            <button className={preset === 'custom' ? 'on' : ''} disabled>
              Своя команда
            </button>
          </div>
        </div>
        <Editable
          multiline
          className="in mono"
          rows={2}
          value={g.runCommand ?? ''}
          placeholder="Например: claude -p --mcp-config {mcpConfigFile}"
          onCommit={(runCommand) =>
            void act(api.updateAgentSettings(pid, { runCommand: runCommand.trim() || null }))
          }
        />
        <p className="hint" style={{ margin: 0 }}>
          Подстановки: <span className="mono">{'{mcpConfigFile}'}</span> — JSON с подключением к доске,{' '}
          <span className="mono">{'{mcpUrl}'}</span>, <span className="mono">{'{promptFile}'}</span>,{' '}
          <span className="mono">{'{repoPath}'}</span>, <span className="mono">{'{task}'}</span>. Промпт также
          приходит в stdin.
        </p>
        <label className="tog" style={{ fontSize: 13 }}>
          <input
            type="checkbox"
            checked={g.useWorktree}
            onChange={(e) => void act(api.updateAgentSettings(pid, { useWorktree: e.target.checked }))}
          />
          Отдельный git worktree на задачу (ветка trakt/PAY-12)
        </label>
        <label className="tog" style={{ fontSize: 13 }}>
          Агентов одновременно
          <input
            className="in"
            type="number"
            min={1}
            max={8}
            style={{ width: 70 }}
            value={g.maxParallel}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (n >= 1 && n <= 8) void act(api.updateAgentSettings(pid, { maxParallel: n }));
            }}
          />
        </label>
      </div>
    </div>
  );
}
