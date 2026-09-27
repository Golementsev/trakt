import type { BoardEvent } from '@trakt/shared';
import { actorName, formatWhen, isYou } from '../lib/format';
import { Avatar } from './Avatar';
import { EventText } from './EventText';

/** Строка под шапкой: последнее событие проекта. */
export function Ticker({ event: e }: { event: BoardEvent | undefined }) {
  return (
    <div className="ticker">
      {e ? (
        <>
          <Avatar agent={!isYou(e.actor)} name={actorName(e.actor)} small />
          <span className="txt">
            <b>{actorName(e.actor)}</b> <EventText text={e.summary} />
            {e.note ? ` — ${e.note}` : ''}
          </span>
          <span className="when">{formatWhen(e.at)}</span>
        </>
      ) : (
        <span className="txt">Здесь появляются ваши действия и действия агента</span>
      )}
    </div>
  );
}
