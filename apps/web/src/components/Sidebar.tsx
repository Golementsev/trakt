import { useState } from 'react';
import type { ProjectSummary } from '@trakt/shared';
import { plural } from '../lib/plural';

interface Props {
  projects: ProjectSummary[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onCreate: (name: string) => Promise<void>;
  agentsOn: boolean;
  /** Сколько незакрытых задач ведёт агент в текущем проекте. */
  agentTaskCount: number;
}

export function Sidebar({ projects, currentId, onSelect, onCreate, agentsOn, agentTaskCount: n }: Props) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = name.trim();
    if (!v) return;
    await onCreate(v);
    setName('');
    setAdding(false);
  };

  return (
    <aside className="side">
      <div className="brand">
        <div className="brand-mark">
          <span />
        </div>
        <b>Тракт</b>
      </div>
      <div>
        <h4>Проекты</h4>
        <div className="plist">
          {projects.map((p) => (
            <button
              key={p.id}
              className={`pitem ${p.id === currentId ? 'on' : ''}`}
              onClick={() => onSelect(p.id)}
            >
              <span className="pkey">{p.key}</span>
              {p.name}
              <span className="pcount">{p.taskCount}</span>
            </button>
          ))}
        </div>
        {adding ? (
          <form className="newproj" onSubmit={(e) => void submit(e)}>
            <input
              className="in"
              autoFocus
              placeholder="Название проекта"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setAdding(false)}
            />
            <button className="btn sm pri">ОК</button>
          </form>
        ) : (
          <button className="ghost" style={{ marginTop: 6 }} onClick={() => setAdding(true)}>
            + Новый проект
          </button>
        )}
      </div>
      <div className="agentbox">
        <b>
          <span className={`dot ${agentsOn && n ? 'live' : ''}`} />
          Агент {agentsOn ? 'на доске' : 'на паузе'}
        </b>
        <span>
          Ведёт {n} {plural(n, 'задачу', 'задачи', 'задач')} в этом проекте. Берёт задачу, делает, двигает по
          готовности.
        </span>
      </div>
    </aside>
  );
}
