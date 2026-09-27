/** Порт сервера по умолчанию. Слушаем только 127.0.0.1. */
export const DEFAULT_PORT = 4700;
export const DEFAULT_HOST = '127.0.0.1';

export const STATUS_CATEGORIES = ['todo', 'doing', 'done'] as const;
export type StatusCategory = (typeof STATUS_CATEGORIES)[number];

export const FIELD_KINDS = ['text', 'number', 'date', 'checkbox'] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

/** Имя актора для действий из UI. В ленте показывается как «Вы». */
export const ACTOR_YOU = 'you';
/** Имя агента, если харнес не представился. */
export const DEFAULT_AGENT_NAME = 'Агент';
