import { Fragment, useState, type CSSProperties } from 'react';
import type { StatusCategory } from '@trakt/shared';
import type { LaneMode } from './TopBar';
import { Avatar } from './Avatar';

export interface BoardColumn {
  id: string;
  name: string;
  color: string;
  category: StatusCategory;
}

export interface BoardLaneSource {
  id: string;
  name: string;
  color: string;
}

interface Lane {
  key: string;
  name: string | null;
  color?: string;
  agent?: boolean;
}

interface Props {
  columns: BoardColumn[];
  types: BoardLaneSource[];
  lane: LaneMode;
}

function lanesFor(mode: LaneMode, types: BoardLaneSource[]): Lane[] {
  if (mode === 'type') return types.map((t) => ({ key: t.id, name: t.name, color: t.color }));
  if (mode === 'agent')
    return [
      { key: '1', name: 'Ведёт агент', agent: true },
      { key: '0', name: 'Делаю сам' },
    ];
  return [{ key: '_', name: null }];
}

export function Board({ columns, types, lane }: Props) {
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const lanes = lanesFor(lane, types);
  const n = columns.length;
  const doneIndex = columns.findIndex((c) => c.category === 'done');
  const defaultAfter = columns[(doneIndex < 0 ? n : doneIndex) - 1]?.id;

  return (
    <div className="boardwrap">
      <div className="board" style={{ gridTemplateColumns: `repeat(${n}, minmax(268px, 300px)) 220px` }}>
        {columns.map((s, i) => (
          <div key={s.id} className="colhead" title="Перетащите, чтобы поменять место">
            <span className="grab">⋮⋮</span>
            <span className="cdot" style={{ background: s.color }} />
            <b>{s.name}</b>
            <span className="cnt">0</span>
            <span className="x">
              {i > 0 && (
                <button className="iconbtn" title="Сдвинуть левее">
                  ←
                </button>
              )}
              {i < n - 1 && (
                <button className="iconbtn" title="Сдвинуть правее">
                  →
                </button>
              )}
              <button className="iconbtn" title={`Задача в «${s.name}»`}>
                +
              </button>
              <button className="iconbtn del" title="Удалить статус">
                ×
              </button>
            </span>
          </div>
        ))}
        <div className="addcol">
          <form onSubmit={(e) => e.preventDefault()}>
            <input className="in" placeholder="+ Новый статус" aria-label="Название статуса" />
            <label className="after">
              после{' '}
              <select className="in" defaultValue={defaultAfter}>
                <option value="_first">— в начало —</option>
                {columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn sm pri">Добавить</button>
          </form>
        </div>

        {lanes.map((l) => {
          const k = `${lane}:${l.key}`;
          const isClosed = !!closed[k];
          return (
            <Fragment key={k}>
              {l.name !== null && (
                <button
                  className={`lanehead ${isClosed ? 'closed' : ''}`}
                  onClick={() => setClosed((c) => ({ ...c, [k]: !c[k] }))}
                >
                  <span className="chev">▾</span>
                  {l.agent && <Avatar agent small />}
                  {l.color ? (
                    <span className="chip" style={{ '--c': l.color } as CSSProperties}>
                      <span className="sq" />
                      {l.name}
                    </span>
                  ) : (
                    l.name
                  )}
                  <span className="ln">0</span>
                </button>
              )}
              {!isClosed && (
                <>
                  {columns.map((s) => (
                    <div key={s.id} className="cell">
                      {s.category !== 'done' && l.name === null && (
                        <button className="addcard">+ Задача</button>
                      )}
                    </div>
                  ))}
                  <div />
                </>
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
