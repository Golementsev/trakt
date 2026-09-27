import { useSyncExternalStore } from 'react';

let message: string | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Короткое сообщение внизу экрана (как в макете). Можно звать откуда угодно. */
export function toast(m: string) {
  message = m;
  emit();
  clearTimeout(timer);
  timer = setTimeout(() => {
    message = null;
    emit();
  }, 2600);
}

export function Toast() {
  const m = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => message,
  );
  if (!m) return null;
  return (
    <div className="toast" role="status">
      {m}
    </div>
  );
}

/** Выполнить запрос к серверу; ошибку показать тостом. */
export async function run<T>(p: Promise<T>): Promise<T | undefined> {
  try {
    return await p;
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Что-то пошло не так');
    return undefined;
  }
}
