import type { ProjectSummary } from '@trakt/shared';

export type LaneMode = 'none' | 'type' | 'agent';

const LANES: Array<[LaneMode, string]> = [
  ['none', 'Нет'],
  ['type', 'Тип'],
  ['agent', 'Агент'],
];

interface Props {
  projects: ProjectSummary[];
  currentId: string;
  onSelect: (id: string) => void;
  name: string;
  projectKey: string;
  lane: LaneMode;
  onLane: (lane: LaneMode) => void;
  agentsOn: boolean;
  onAgentsToggle: () => void;
  onFeed: () => void;
  onSettings: () => void;
  onNewTask: () => void;
}

export function TopBar(p: Props) {
  return (
    <div className="top">
      <select
        className="in mobile-only"
        aria-label="Проект"
        value={p.currentId}
        onChange={(e) => p.onSelect(e.target.value)}
      >
        {p.projects.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </select>
      <div className="titleblock">
        <h1>{p.name}</h1>
        <span className="pk">{p.projectKey}</span>
      </div>
      <div className="spacer" />
      <span className="lbl">Стримлайны</span>
      <div className="seg">
        {LANES.map(([key, label]) => (
          <button key={key} className={p.lane === key ? 'on' : ''} onClick={() => p.onLane(key)}>
            {label}
          </button>
        ))}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={p.agentsOn}
        className={`switch ${p.agentsOn ? 'on' : ''}`}
        style={{ border: 0, background: 'none', padding: 0 }}
        title="Агент сам двигает задачи по готовности"
        onClick={p.onAgentsToggle}
      >
        <i />
        Агент двигает задачи
      </button>
      <button className="btn" onClick={p.onFeed}>
        Лента
      </button>
      <button className="btn" onClick={p.onSettings}>
        Настройки
      </button>
      <button className="btn pri" onClick={p.onNewTask}>
        + Задача
      </button>
    </div>
  );
}
