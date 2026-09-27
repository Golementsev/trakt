import { ACTOR_YOU } from '@trakt/shared';

/** «10:42» для сегодняшних событий, «12.09 10:42» для остальных. */
export function formatWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return time;
  const date = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  return `${date} ${time}`;
}

export const isYou = (actor: string) => actor === ACTOR_YOU;
export const actorName = (actor: string) => (isYou(actor) ? 'Вы' : actor);

/** Разбить текст на куски, выделив номера задач (PAY-12). */
export function splitTaskKeys(text: string): Array<{ text: string; key: boolean }> {
  return text
    .split(/([A-Z]{2,5}-\d+)/)
    .filter(Boolean)
    .map((t) => ({ text: t, key: /^[A-Z]{2,5}-\d+$/.test(t) }));
}
