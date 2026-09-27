import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { ACTOR_YOU, type LiveMessage } from '@trakt/shared';
import type { Db } from '../db/db';

/** Шина живых обновлений: домен публикует, SSE раздаёт. */
export class Bus {
  private readonly ee = new EventEmitter().setMaxListeners(0);
  publish(msg: LiveMessage) {
    this.ee.emit('msg', msg);
  }
  subscribe(fn: (msg: LiveMessage) => void) {
    this.ee.on('msg', fn);
    return () => void this.ee.off('msg', fn);
  }
}

export interface Ctx {
  db: Db;
  bus: Bus;
  now: () => string;
  newId: () => string;
}

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
export function newId(): string {
  const bytes = randomBytes(14);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s;
}

export function createCtx(db: Db, bus = new Bus()): Ctx {
  return { db, bus, now: () => new Date().toISOString(), newId };
}

/** Ошибка домена: сообщение показывается человеку (или агенту) как есть. */
export class DomainError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new DomainError(404, `${what} не найден(а)`);
export const invalid = (message: string) => new DomainError(400, message);
export const conflict = (message: string) => new DomainError(409, message);

/** Кто действует: 'you' (UI) или имя агента. */
export type Actor = string;
export const isYou = (actor: Actor) => actor === ACTOR_YOU;
/** Глагол по актору: «перевели» (вы) / «перевёл» (агент). */
export const verb = (actor: Actor, you: string, agent: string) => (isYou(actor) ? you : agent);

export const bool = (v: unknown) => v === 1 || v === true;
