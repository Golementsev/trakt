import type { Field, FieldValue } from '@trakt/shared';
import { invalid } from './context';

/** Привести значение к виду поля. null — «пусто» (значение удаляется). */
export function normalizeFieldValue(field: Field, value: FieldValue): FieldValue {
  if (value === null || value === '') return null;
  switch (field.kind) {
    case 'text':
      if (typeof value !== 'string') throw invalid(`Поле «${field.name}»: нужен текст`);
      return value;
    case 'number': {
      const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
      if (!Number.isFinite(n)) throw invalid(`Поле «${field.name}»: нужно число`);
      return n;
    }
    case 'date':
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
        throw invalid(`Поле «${field.name}»: нужна дата ГГГГ-ММ-ДД`);
      return value;
    case 'checkbox':
      if (typeof value !== 'boolean') throw invalid(`Поле «${field.name}»: нужно да/нет`);
      return value ? true : null;
  }
}

export const isEmptyValue = (v: FieldValue | undefined) =>
  v === undefined || v === null || v === false || (typeof v === 'string' && !v.trim());

/** Обязательные поля, которые остались пустыми. */
export function missingRequired(fields: Field[], values: Record<string, FieldValue>): Field[] {
  return fields.filter((f) => f.required && isEmptyValue(values[f.id]));
}

export function missingMessage(missing: Field[]): string {
  return `Заполните обязательные поля: ${missing.map((f) => `«${f.name}»`).join(', ')}`;
}
