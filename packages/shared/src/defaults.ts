import type { FieldKind, StatusCategory } from './constants';

export interface DefaultStatus {
  name: string;
  category: StatusCategory;
  color: string;
}

export interface DefaultField {
  name: string;
  kind: FieldKind;
  required: boolean;
  visibleToAgent: boolean;
}

export interface DefaultType {
  name: string;
  color: string;
  fields: DefaultField[];
}

/** Стандартный набор нового проекта (SPEC §3). Цвета — из макета. */
export const DEFAULT_STATUSES: readonly DefaultStatus[] = [
  { name: 'Бэклог', category: 'todo', color: '#8995A3' },
  { name: 'К работе', category: 'todo', color: '#5B7BD8' },
  { name: 'В работе', category: 'doing', color: '#C98A12' },
  { name: 'Ревью', category: 'doing', color: '#8A5CD6' },
  { name: 'Готово', category: 'done', color: '#0A8A6D' },
];

/** Статус по умолчанию для maxStatus агента — «Ревью». */
export const DEFAULT_AGENT_MAX_STATUS_INDEX = 3;

export const DEFAULT_TYPES: readonly DefaultType[] = [
  {
    name: 'Фича',
    color: '#2C57E0',
    fields: [{ name: 'Критерии приёмки', kind: 'text', required: true, visibleToAgent: true }],
  },
  {
    name: 'Баг',
    color: '#CF3F37',
    fields: [
      { name: 'Шаги воспроизведения', kind: 'text', required: true, visibleToAgent: true },
      { name: 'Где воспроизводится', kind: 'text', required: false, visibleToAgent: true },
    ],
  },
  {
    name: 'Исследование',
    color: '#8A5CD6',
    fields: [
      { name: 'Главный вопрос', kind: 'text', required: true, visibleToAgent: true },
      { name: 'Срок', kind: 'date', required: false, visibleToAgent: false },
    ],
  },
  {
    name: 'Техдолг',
    color: '#6B7785',
    fields: [{ name: 'Что трогаем', kind: 'text', required: false, visibleToAgent: true }],
  },
];

export const DEFAULT_DOD =
  'Тесты зелёные, PR открыт и привязан к задаче, в описании есть короткий отчёт что сделано.';

export const DEFAULT_AGENT_SETTINGS = {
  canMove: true,
  autoTake: false,
  canCreate: false,
} as const;

/**
 * Воркфлоу по умолчанию: разрешено всё, кроме прыжка из первых двух статусов
 * сразу в «Готово». Возвращает пары индексов [from, to].
 */
export function defaultTransitions(statuses: readonly DefaultStatus[]): Array<[number, number]> {
  const doneIndex = statuses.findIndex((s) => s.category === 'done');
  const pairs: Array<[number, number]> = [];
  statuses.forEach((_, from) => {
    statuses.forEach((_, to) => {
      if (from === to) return;
      if (to === doneIndex && from < 2) return;
      pairs.push([from, to]);
    });
  });
  return pairs;
}
