/** Русское склонение по числу: plural(3, 'задачу', 'задачи', 'задач') → 'задачи'. */
export function plural(n: number, one: string, few: string, many: string): string {
  const m = n % 10;
  const h = n % 100;
  if (m === 1 && h !== 11) return one;
  if (m >= 2 && m <= 4 && (h < 12 || h > 14)) return few;
  return many;
}
