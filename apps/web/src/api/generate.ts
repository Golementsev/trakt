import { ApiError } from './client';

/**
 * Идея с AI: POST /api/ai/generate отвечает потоком NDJSON
 * ({t: дельта} … {done: true} | {error}). onText получает весь текст по мере генерации.
 * Отмена — через signal (кнопка «Стоп»): сервер тоже прекращает генерацию.
 */
export async function generateIdea(
  projectId: string,
  text: string,
  opts: { signal: AbortSignal; onText: (full: string) => void },
): Promise<string> {
  let res: Response;
  try {
    res = await fetch('/api/ai/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, text }),
      signal: opts.signal,
    });
  } catch (e) {
    if (opts.signal.aborted) throw e;
    throw new ApiError(0, 'Сервер доски не отвечает');
  }
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, data?.error ?? `Ошибка ${res.status}`);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  let full = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const msg = JSON.parse(line) as { t?: string; done?: boolean; error?: string };
      if (msg.error) throw new ApiError(502, msg.error);
      if (msg.t) {
        full += msg.t;
        opts.onText(full);
      }
    }
  }
  return full;
}
