import { describe, expect, it } from 'vitest';
import { plural } from './plural';

describe('plural', () => {
  it.each([
    [1, 'задачу'],
    [2, 'задачи'],
    [5, 'задач'],
    [11, 'задач'],
    [12, 'задач'],
    [21, 'задачу'],
    [22, 'задачи'],
    [0, 'задач'],
  ])('%i → %s', (n, word) => {
    expect(plural(n, 'задачу', 'задачи', 'задач')).toBe(word);
  });
});
