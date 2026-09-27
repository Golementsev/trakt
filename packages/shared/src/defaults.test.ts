import { describe, expect, it } from 'vitest';
import { DEFAULT_STATUSES, defaultTransitions } from './defaults';

describe('defaultTransitions', () => {
  it('allows everything except jumping from the first two statuses straight to done', () => {
    const pairs = defaultTransitions(DEFAULT_STATUSES);
    const has = (a: number, b: number) => pairs.some(([f, t]) => f === a && t === b);

    expect(has(0, 4)).toBe(false);
    expect(has(1, 4)).toBe(false);
    expect(has(2, 4)).toBe(true);
    expect(has(3, 4)).toBe(true);
    expect(has(4, 0)).toBe(true);
    expect(has(0, 0)).toBe(false);
    // 5 статусов: 20 переходов без петель, минус 2 запрещённых
    expect(pairs).toHaveLength(18);
  });
});
