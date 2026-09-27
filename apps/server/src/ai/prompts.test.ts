import { describe, expect, it } from 'vitest';
import { parseSubtasks } from './prompts';

describe('parseSubtasks', () => {
  it('reads a JSON array, even wrapped in text', () => {
    expect(parseSubtasks('Вот:\n```json\n["Обновить SDK", "Написать тесты"]\n```')).toEqual([
      'Обновить SDK',
      'Написать тесты',
    ]);
    expect(parseSubtasks('[{"title":"Один"},{"title":"Два"}]')).toEqual(['Один', 'Два']);
  });

  it('falls back to list lines and caps the count', () => {
    const answer = Array.from({ length: 9 }, (_, i) => `${i + 1}. Шаг ${i + 1}`).join('\n');
    expect(parseSubtasks(answer)).toEqual(['Шаг 1', 'Шаг 2', 'Шаг 3', 'Шаг 4', 'Шаг 5', 'Шаг 6']);
    expect(parseSubtasks('- Первое\n- Второе')).toEqual(['Первое', 'Второе']);
  });
});
