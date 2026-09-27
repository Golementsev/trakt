import type { BoardEvent } from '@trakt/shared';
import { actorName, formatWhen, isYou } from '../lib/format';
import { Avatar } from './Avatar';
import { EventText } from './EventText';

/** Строка под шапкой: последнее событие проекта. */
export function Ticker({ event: e, offline }: { event: BoardEvent | undefined; offline?: boolean }) {
  return (
    <div className="ticker">
      {offline ? (
        <span className="txt" style={{ color: 'var(--danger)' }}>
          Нет связи с доской — переподключаюсь… Проверьте, что сервер запущен (npm start).
        </span>
      ) : e ? (
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
