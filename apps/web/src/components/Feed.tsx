import type { BoardEvent } from '@trakt/shared';
import { actorName, formatWhen, isYou } from '../lib/format';
import { Avatar } from './Avatar';
import { EventText } from './EventText';

interface Props {
  projectName: string;
  events: BoardEvent[];
  onClose: () => void;
}

/** Лента событий проекта, выезжает справа. */
export function Feed({ projectName, events, onClose }: Props) {
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="feed" aria-label="Лента">
        <div className="fhead">
          <b>Лента · {projectName}</b>
          <span className="spacer" />
          <button className="iconbtn" aria-label="Закрыть" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="list">
          {events.length ? (
            events.map((e) => (
              <div className="fi" key={e.id}>
                <Avatar agent={!isYou(e.actor)} name={actorName(e.actor)} />
                <div className="t">
                  <b>{actorName(e.actor)}</b> <EventText text={e.summary} />
                  {e.note && <span className="note">{e.note}</span>}
                  <span className="when">{formatWhen(e.at)}</span>
                </div>
              </div>
            ))
          ) : (
            <span className="hint">Пока тихо.</span>
          )}
        </div>
      </aside>
    </>
  );
}
