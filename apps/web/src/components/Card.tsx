import type { CSSProperties, DragEvent } from 'react';
import type { TaskCard, TaskType } from '@trakt/shared';

interface Props {
  task: TaskCard;
  type: TaskType | undefined;
  flash: boolean;
  dragging: boolean;
  onOpen: () => void;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
}

/** Агент сейчас реально работает: держит задачу или гоняет сабтаску. */
export const isWorking = (t: Pick<TaskCard, 'running' | 'claimedBy'>) => t.running || !!t.claimedBy;

export function Card({ task: t, type, flash, dragging, onOpen, onDragStart, onDragEnd }: Props) {
  const { done, total } = t.subtasks;
  const cls = ['card', flash && 'flash', dragging && 'dragging'].filter(Boolean).join(' ');
  return (
    <article
      className={cls}
      draggable
      tabIndex={0}
      data-id={t.id}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="row1">
        <span className="cid">{t.key}</span>
      </div>
      <div className="ttl">{t.title}</div>
      <div className="meta">
        <span className="chip" style={{ '--c': type?.color ?? '#888' } as CSSProperties}>
          <span className="sq" />
          {type?.name ?? '—'}
        </span>
        {total > 0 && (
          <span className="sub" title="Сабтаски">
            <span className="bar">
              <i style={{ width: `${(done / total) * 100}%` }} />
            </span>
            {done}/{total}
          </span>
        )}
        {isWorking(t) ? (
          <span className="working">
            <span className="dot live" />
            агент работает
          </span>
        ) : t.agentOwned ? (
          <span className="working" style={{ color: 'var(--faint)' }} title="Задачу ведёт агент">
            AI
          </span>
        ) : null}
      </div>
    </article>
  );
}
