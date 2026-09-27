import { describe, expect, it } from 'vitest';
import { actorName, splitTaskKeys } from './format';

describe('format', () => {
  it('highlights task keys', () => {
    expect(splitTaskKeys('перевёл PAY-15 «В работе» → «Ревью»')).toEqual([
      { text: 'перевёл ', key: false },
      { text: 'PAY-15', key: true },
      { text: ' «В работе» → «Ревью»', key: false },
    ]);
  });
  it('names actors', () => {
    expect(actorName('you')).toBe('Вы');
    expect(actorName('claude-code')).toBe('claude-code');
  });
});
