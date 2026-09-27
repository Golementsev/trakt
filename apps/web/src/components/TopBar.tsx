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
}

export function TopBar({ name, projectKey, lane, onLane, agentsOn, onAgentsToggle }: Props) {
  return (
    <div className="top">
      <div className="titleblock">
        <h1>{name}</h1>
        <span className="pk">{projectKey}</span>
      </div>
      <div className="spacer" />
      <span className="lbl">Стримлайны</span>
      <div className="seg">
        {LANES.map(([key, label]) => (
          <button key={key} className={lane === key ? 'on' : ''} onClick={() => onLane(key)}>
            {label}
          </button>
        ))}
      </div>
      <label
        className={`switch ${agentsOn ? 'on' : ''}`}
        title="Агент сам двигает задачи по готовности"
        onClick={onAgentsToggle}
      >
        <i />
        Агент двигает задачи
      </label>
      <button className="btn">Лента</button>
      <button className="btn">Настройки</button>
      <button className="btn pri">+ Задача</button>
    </div>
  );
}
