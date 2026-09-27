import { Fragment, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, GripVertical, Plus, Trash2 } from 'lucide-react';
import type { Board as BoardData, TaskCard } from '@trakt/shared';
import { api } from '../api/client';
import { keys, queryClient, refreshProject } from '../api/queries';
import { useStored } from '../lib/storage';
import { run } from '../lib/toast';
import type { LaneMode } from './TopBar';
import { Avatar } from './Avatar';
import { Card } from './Card';

interface Lane {
  key: string;
  name: string | null;
  color?: string;
  agent?: boolean;
}

interface Props {
  board: BoardData;
  lane: LaneMode;
  flash: ReadonlySet<string>;
  onOpen: (taskId: string) => void;
  onNew: (statusId: string) => void;
}

function lanesFor(mode: LaneMode, board: BoardData): Lane[] {
  if (mode === 'type') return board.types.map((t) => ({ key: t.id, name: t.name, color: t.color }));
  if (mode === 'agent')
    return [
      { key: '1', name: 'Ведёт агент', agent: true },
      { key: '0', name: 'Делаю сам' },
    ];
  return [{ key: '_', name: null }];
}

const laneOf = (mode: LaneMode, t: TaskCard) =>
  mode === 'type' ? t.typeId : mode === 'agent' ? (t.agentOwned ? '1' : '0') : '_';

const byPosition = (a: TaskCard, b: TaskCard) => a.position - b.position;

/** Позиция для вставки перед before (или в конец) — так же, как считает сервер. */
function positionIn(column: TaskCard[], beforeTaskId: string | null): number {
  const i = beforeTaskId ? column.findIndex((x) => x.id === beforeTaskId) : -1;
  if (i < 0) return (column.at(-1)?.position ?? 0) + 1;
  if (i === 0) return column[0]!.position - 1;
  return (column[i - 1]!.position + column[i]!.position) / 2;
}

export function Board({ board, lane, flash, onOpen, onNew }: Props) {
  const { project, statuses, types, tasks } = board;
  const pid = project.id;
  const allowed = useMemo(() => new Set(board.transitions.map(([f, t]) => `${f}>${t}`)), [board.transitions]);
  const lanes = lanesFor(lane, board);
  const [closed, setClosed] = useStored<Record<string, boolean>>(`lanes.${pid}`, {});

  const [dragTask, setDragTask] = useState<string | null>(null);
  const [over, setOver] = useState<{ cell: string; ok: boolean } | null>(null);
  const [dragCol, setDragCol] = useState<string | null>(null);
  const [colDrop, setColDrop] = useState<{ id: string; side: 'L' | 'R' } | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const cellEls = useRef(new Map<string, HTMLDivElement>());

  const n = statuses.length;

  // ---- перетаскивание карточек ----
  // Матрица с сервера нужна только для подсветки; решает всё равно сервер.
  const canDrop = (t: TaskCard, statusId: string) =>
    t.statusId === statusId || allowed.has(`${t.statusId}>${statusId}`);

  /** Карточка, перед которой бросили (по вертикали курсора), или null — в конец. */
  const beforeAt = (cellKey: string, y: number): string | null => {
    const el = cellEls.current.get(cellKey);
    if (!el) return null;
    for (const c of el.querySelectorAll<HTMLElement>('.card')) {
      if (c.dataset.id === dragTask) continue;
      const r = c.getBoundingClientRect();
      if (y < r.top + r.height / 2) return c.dataset.id ?? null;
    }
    return null;
  };

  const dropTask = async (statusId: string, laneKey: string, beforeTaskId: string | null) => {
    const t = tasks.find((x) => x.id === dragTask);
    setDragTask(null);
    setOver(null);
    if (!t) return;
    const typeId = lane === 'type' && laneKey !== t.typeId ? laneKey : undefined;
    const agentOwned = lane === 'agent' && laneKey !== laneOf(lane, t) ? laneKey === '1' : undefined;
    const column = tasks.filter((x) => x.statusId === statusId && x.id !== t.id).sort(byPosition);
    const position = positionIn(column, beforeTaskId);
    // бросили туда же, где лежала: следующая за ней карточка совпадает с ориентиром
    const sameSpot =
      t.statusId === statusId &&
      typeId === undefined &&
      agentOwned === undefined &&
      (column.find((x) => x.position > t.position)?.id ?? null) === beforeTaskId;
    if (sameSpot) return;

    // запрещённый переход заранее не рисуем — сервер вернёт понятную причину
    const snapshot = queryClient.getQueryData<BoardData>(keys.board(pid));
    if (snapshot && canDrop(t, statusId)) {
      queryClient.setQueryData<BoardData>(keys.board(pid), {
        ...snapshot,
        tasks: snapshot.tasks.map((x) =>
          x.id === t.id
            ? {
                ...x,
                statusId,
                position,
                typeId: typeId ?? x.typeId,
                agentOwned: agentOwned ?? x.agentOwned,
              }
            : x,
        ),
      });
    }
    const res = await run(api.moveTask(t.id, { statusId, beforeTaskId, typeId, agentOwned }));
    if (!res && snapshot) queryClient.setQueryData(keys.board(pid), snapshot);
    refreshProject(pid);
  };

  const cellProps = (statusId: string, laneKey: string) => {
    const cellKey = `${statusId}|${laneKey}`;
    return {
      ref: (el: HTMLDivElement | null) => {
        if (el) cellEls.current.set(cellKey, el);
        else cellEls.current.delete(cellKey);
      },
      onDragOver: (e: DragEvent) => {
        if (!dragTask) return;
        e.preventDefault();
        const t = tasks.find((x) => x.id === dragTask);
        const ok = !!t && canDrop(t, statusId);
        if (over?.cell !== cellKey || over.ok !== ok) setOver({ cell: cellKey, ok });
      },
      onDrop: (e: DragEvent) => {
        if (!dragTask) return;
        e.preventDefault();
        void dropTask(statusId, laneKey, beforeAt(cellKey, e.clientY));
      },
      className: `cell ${over?.cell === cellKey ? (over.ok ? 'over' : 'deny') : ''}`,
    };
  };

  // ---- статусы ----
  const moveStatus = async (id: string, toIndex: number) => {
    if (toIndex < 0 || toIndex >= n) return;
    await run(api.moveStatus(id, toIndex));
    refreshProject(pid);
  };

  const deleteStatus = async (id: string) => {
    if (await run(api.deleteStatus(id))) refreshProject(pid);
  };

  const dropCol = (e: DragEvent, targetId: string) => {
    e.preventDefault();
    const from = statuses.findIndex((s) => s.id === dragCol);
    let to = statuses.findIndex((s) => s.id === targetId);
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (e.clientX >= r.left + r.width / 2) to++;
    if (from < to) to--;
    const id = dragCol;
    setDragCol(null);
    setColDrop(null);
    if (id && from !== to) void moveStatus(id, to);
  };

  // ---- новый статус ----
  const doneIndex = statuses.findIndex((c) => c.category === 'done');
  const defaultAfter = statuses[(doneIndex < 0 ? n : doneIndex) - 1]?.id ?? '_first';
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [after, setAfter] = useState<string | null>(null);
  const afterValue =
    after && (after === '_first' || statuses.some((s) => s.id === after)) ? after : defaultAfter;

  const addStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const s = await run(
      api.createStatus(pid, { name, afterStatusId: afterValue === '_first' ? null : afterValue }),
    );
    if (!s) return;
    setNewName('');
    setAdding(false);
    setAfter(null);
    setFresh(s.id);
    setTimeout(() => setFresh(null), 1600);
    refreshProject(pid);
  };

  return (
    <div className="boardwrap">
      <div className="board" style={{ '--cols': n } as CSSProperties}>
        {statuses.map((s, i) => {
          const cls = [
            'colhead',
            s.id === fresh && 'fresh',
            s.id === dragCol && 'dragging',
            colDrop?.id === s.id && (colDrop.side === 'L' ? 'dropL' : 'dropR'),
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div
              key={s.id}
              className={cls}
              draggable
              title="Перетащите, чтобы поменять место"
              onDragStart={(e) => {
                setDragCol(s.id);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', s.id);
              }}
              onDragEnd={() => {
                setDragCol(null);
                setColDrop(null);
              }}
              onDragOver={(e) => {
                if (!dragCol || dragCol === s.id) return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                const side = e.clientX < r.left + r.width / 2 ? 'L' : 'R';
                if (colDrop?.id !== s.id || colDrop.side !== side) setColDrop({ id: s.id, side });
              }}
              onDrop={(e) => dragCol && dropCol(e, s.id)}
            >
              <span className="grab">
                <GripVertical className="i sm" />
              </span>
              <span className="cdot" style={{ background: s.color }} />
              <b>{s.name}</b>
              <span className="cnt">{tasks.filter((t) => t.statusId === s.id).length}</span>
              <span className="x">
                {i > 0 && (
                  <button
                    className="iconbtn sm"
                    title="Сдвинуть левее"
                    onClick={() => void moveStatus(s.id, i - 1)}
                  >
                    <ChevronLeft className="i sm" />
                  </button>
                )}
                {i < n - 1 && (
                  <button
                    className="iconbtn sm"
                    title="Сдвинуть правее"
                    onClick={() => void moveStatus(s.id, i + 1)}
                  >
                    <ChevronRight className="i sm" />
                  </button>
                )}
                <button className="iconbtn sm" title={`Задача в «${s.name}»`} onClick={() => onNew(s.id)}>
                  <Plus className="i sm" />
                </button>
                <button
                  className="iconbtn sm del"
                  title="Удалить статус"
                  onClick={() => void deleteStatus(s.id)}
                >
                  <Trash2 className="i sm" />
                </button>
              </span>
            </div>
          );
        })}
        <div className="addcol">
          <button
            className="iconbtn"
            title="Новый статус"
            aria-label="Новый статус"
            onClick={() => setAdding(!adding)}
          >
            <Plus className="i" />
          </button>
          {adding && (
            <form
              className="addpop"
              onSubmit={(e) => void addStatus(e)}
              onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setAdding(false))}
            >
              <input
                className="in"
                autoFocus
                placeholder="+ Новый статус"
                aria-label="Название статуса"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <label className="after">
                после{' '}
                <select className="in" value={afterValue} onChange={(e) => setAfter(e.target.value)}>
                  <option value="_first">— в начало —</option>
                  {statuses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <button className="btn sm pri">Добавить</button>
            </form>
          )}
        </div>

        {lanes.map((l) => {
          const k = `${lane}:${l.key}`;
          const isClosed = !!closed[k];
          const laneTasks = tasks.filter((t) => laneOf(lane, t) === l.key);
          return (
            <Fragment key={k}>
              {l.name !== null && (
                <button
                  className={`lanehead ${isClosed ? 'closed' : ''}`}
                  onClick={() => setClosed({ ...closed, [k]: !isClosed })}
                >
                  <span className="chev">
                    <ChevronDown className="i sm" />
                  </span>
                  {l.agent && <Avatar agent small />}
                  {l.color ? (
                    <span className="chip" style={{ '--c': l.color } as CSSProperties}>
                      <span className="sq" />
                      {l.name}
                    </span>
                  ) : (
                    l.name
                  )}
                  <span className="ln">{laneTasks.length}</span>
                </button>
              )}
              {!isClosed && (
                <>
                  {statuses.map((s) => (
                    <div key={s.id} {...cellProps(s.id, l.key)}>
                      {laneTasks
                        .filter((t) => t.statusId === s.id)
                        .sort(byPosition)
                        .map((t) => (
                          <Card
                            key={t.id}
                            task={t}
                            type={types.find((x) => x.id === t.typeId)}
                            flash={flash.has(t.id)}
                            dragging={dragTask === t.id}
                            onOpen={() => onOpen(t.id)}
                            onDragStart={(e) => {
                              e.stopPropagation();
                              setDragTask(t.id);
                              e.dataTransfer.effectAllowed = 'move';
                              e.dataTransfer.setData('text/plain', t.id);
                            }}
                            onDragEnd={() => {
                              setDragTask(null);
                              setOver(null);
                            }}
                          />
                        ))}
                      {s.category !== 'done' && l.name === null && (
                        <button className="addcard" onClick={() => onNew(s.id)}>
                          <Plus className="i sm" />
                          Задача
                        </button>
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
      {tasks.length === 0 && (
        <p className="hint" style={{ marginTop: 12 }}>
          Задач пока нет. «+ Задача» в шапке или «+» в заголовке колонки создаёт первую. Статус меняется
          перетаскиванием карточки, агенту задачу можно отдать прямо из окна задачи.
        </p>
      )}
    </div>
  );
}
