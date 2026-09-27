import { useEffect, useRef } from 'react';
import type { LiveMessage } from '@trakt/shared';
import { queryClient, refreshProject } from './queries';

/**
 * Подписка на /api/events. Любое изменение на сервере (из этой вкладки, другой вкладки
 * или от агента) → перечитываем затронутые данные. EventSource сам переподключается.
 */
export function useLiveUpdates(onMessage?: (m: LiveMessage) => void) {
  const cb = useRef(onMessage);
  useEffect(() => {
    cb.current = onMessage;
  });

  useEffect(() => {
    const es = new EventSource('/api/events');
    let wasOpen = false;
    es.addEventListener('hello', () => {
      // после обрыва могли пропустить изменения — перечитываем всё
      if (wasOpen) void queryClient.invalidateQueries();
      wasOpen = true;
    });
    es.addEventListener('change', (e) => {
      const m = JSON.parse((e as MessageEvent<string>).data) as LiveMessage;
      refreshProject(m.projectId);
      cb.current?.(m);
    });
    return () => es.close();
  }, []);
}
