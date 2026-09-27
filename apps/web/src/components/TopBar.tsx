import { Activity, PanelLeft, Plus, Settings2 } from 'lucide-react';

export type LaneMode = 'none' | 'type' | 'agent';

const LANES: Array<[LaneMode, string]> = [
  ['none', 'Нет'],
  ['type', 'Тип'],
  ['agent', 'Агент'],
];

interface Props {
  name: string;
  projectKey: string;
  lane: LaneMode;
  onLane: (lane: LaneMode) => void;
  agentsOn: boolean;
  onAgentsToggle: () => void;
  onToggleSide: () => void;
  onFeed: () => void;
  onSettings: () => void;
  onNewTask: () => void;
}

export function TopBar(p: Props) {
  return (
    <div className="top">
      <button className="iconbtn side-toggle" aria-label="Боковая панель" onClick={p.onToggleSide}>
        <PanelLeft className="i" />
      </button>
      <div className="titleblock">
        <h1>{p.name}</h1>
        <span className="pk">{p.projectKey}</span>
      </div>
      <div className="spacer" />
      <div className="toolbar">
        <span className="lbl lbl-lanes">Стримлайны</span>
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
          title="Агент сам двигает задачи по готовности"
          onClick={p.onAgentsToggle}
        >
          <i />
          Агент двигает задачи
        </button>
        <button className="btn quiet" onClick={p.onFeed} title="Лента">
          <Activity className="i sm" />
          <span className="btn-text">Лента</span>
        </button>
        <button className="btn quiet" onClick={p.onSettings} title="Настройки">
          <Settings2 className="i sm" />
          <span className="btn-text">Настройки</span>
        </button>
        <button className="btn pri" onClick={p.onNewTask}>
          <Plus className="i sm" />
          Задача
        </button>
      </div>
    </div>
  );
}
