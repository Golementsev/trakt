import { useQuery } from '@tanstack/react-query';
import type { Board } from '@trakt/shared';
import { api } from '../api/client';
import { Editable } from './Editable';

interface Props {
  board: Board;
  act: (p: Promise<unknown>) => Promise<void>;
  onOpenAgents: () => void;
}

/** «Настройки → Агент»: где агент работает в этом проекте. Кто именно — на странице «Агенты». */
export function AgentLaunch({ board, act, onOpenAgents }: Props) {
  const pid = board.project.id;
  const g = board.agent;
  const agents = useQuery({ queryKey: ['agents'], queryFn: api.agents });
  const src = agents.data?.runner.sources.find((s) => s.id === agents.data?.runner.selected);

  return (
    <div className="sect">
      <h3>Запуск агента кнопкой «▶ Агент»</h3>
      <p className="hint" style={{ margin: '0 0 12px' }}>
        Доска запускает агента в папке проекта и передаёт ему задачу. Агент отчитывается через MCP, лог идёт
        живьём в сабтаску.
      </p>
      <div className="rows">
        <div className="erow">
          <span className="hint">
            Запускается: <b style={{ color: 'var(--text)' }}>{src?.label ?? '…'}</b>
          </span>
          <button className="btn sm quiet" onClick={onOpenAgents}>
            Сменить на странице «Агенты»
          </button>
        </div>
        <label className="erow" style={{ fontSize: 13 }}>
          <span className="hint">Папка проекта</span>
          <Editable
            className="in"
            value={board.project.repoPath ?? ''}
            placeholder={'C:\\code\\checkout или /home/me/checkout'}
            onCommit={(repoPath) => void act(api.updateProject(pid, { repoPath: repoPath.trim() || null }))}
          />
        </label>
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
