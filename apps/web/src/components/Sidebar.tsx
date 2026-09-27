import { plural } from '../lib/plural';

export interface SidebarProject {
  id: string;
  name: string;
  key: string;
  taskCount: number;
}

interface Props {
  projects: SidebarProject[];
  currentId: string;
  agentsOn: boolean;
  /** Сколько незакрытых задач ведёт агент в текущем проекте. */
  agentTaskCount: number;
}

export function Sidebar({ projects, currentId, agentsOn, agentTaskCount: n }: Props) {
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
            <button key={p.id} className={`pitem ${p.id === currentId ? 'on' : ''}`}>
              <span className="pkey">{p.key}</span>
              {p.name}
              <span className="pcount">{p.taskCount}</span>
            </button>
          ))}
        </div>
        <button className="ghost" style={{ marginTop: 6 }}>
          + Новый проект
        </button>
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
