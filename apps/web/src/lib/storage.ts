import { useState } from 'react';

/** Удобства одного браузера (выбранный проект, стримлайны). Хранилище может быть недоступно. */
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`trakt.${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(`trakt.${key}`, JSON.stringify(value));
  } catch {
    /* приватный режим и т.п. — не страшно */
  }
}

export function useStored<T>(key: string, fallback: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => load(key, fallback));
  return [
    v,
    (next: T) => {
      setV(next);
      save(key, next);
    },
  ];
}
