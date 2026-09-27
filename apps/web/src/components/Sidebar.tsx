import { useState } from 'react';
import { Bot, Download, Hash, Plus } from 'lucide-react';
import type { ProjectSummary } from '@trakt/shared';
import { plural } from '../lib/plural';

export type View = 'board' | 'agents';

interface Props {
  projects: ProjectSummary[];
  currentId: string | null;
  view: View;
  onSelect: (id: string) => void;
  onView: (view: View) => void;
  onCreate: (name: string) => Promise<void>;
  agentsOn: boolean;
  /** Сколько незакрытых задач ведёт агент в текущем проекте. */
  agentTaskCount: number;
}

export function Sidebar(p: Props) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const n = p.agentTaskCount;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = name.trim();
    if (!v) return;
    await p.onCreate(v);
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

      <nav className="nav">
        <button className={`navitem ${p.view === 'agents' ? 'on' : ''}`} onClick={() => p.onView('agents')}>
          <Bot className="i" />
          Агенты
        </button>
      </nav>

      <h4>Проекты</h4>
      <div className="plist">
        {p.projects.map((x) => (
          <button
            key={x.id}
            className={`pitem ${p.view === 'board' && x.id === p.currentId ? 'on' : ''}`}
            onClick={() => p.onSelect(x.id)}
            title={x.name}
          >
            <Hash className="i sm" style={{ color: 'var(--faint)' }} />
            <span className="pname">{x.name}</span>
            <span className="pkey">{x.key}</span>
            <span className="pcount">{x.taskCount}</span>
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
        <button className="ghost" onClick={() => setAdding(true)}>
          <Plus className="i sm" />
          Новый проект
        </button>
      )}

      <div className="agentbox">
        <b>
          <span className={`dot ${p.agentsOn && n ? 'live' : ''}`} />
          Агент {p.agentsOn ? 'на доске' : 'на паузе'}
        </b>
        <span>
          Ведёт {n} {plural(n, 'задачу', 'задачи', 'задач')} в этом проекте. Берёт задачу, делает, двигает по
          готовности.
        </span>
      </div>

      <div className="side-foot">
        <a href="/api/export" download title="Все проекты, задачи и лента одним файлом">
          <Download className="i sm" />
          Скачать копию доски (JSON)
        </a>
      </div>
    </aside>
  );
}
