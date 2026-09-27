/**
 * Разбор вывода агента в строки лога. Обычный текст идёт как есть; поток
 * `claude -p --output-format stream-json` превращается в короткие человеческие строки.
 */
export interface OutputLine {
  /** Строка для лога (или null — пропустить). */
  text: string | null;
  /** Итоговый отчёт агента, если он в этой строке. */
  result?: string;
}

const MAX = 400;
const clip = (s: string) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > MAX ? `${one.slice(0, MAX - 1)}…` : one;
};

interface ContentItem {
  type?: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
}

function toolLine(item: ContentItem): string | null {
  const name = item.name ?? 'tool';
  // отчёты в доску агент пишет сам через MCP — в логе они уже есть
  if (name.startsWith('mcp__trakt__')) return null;
  const input = item.input ?? {};
  const arg = [input.file_path, input.path, input.command, input.pattern, input.url, input.description].find(
    (v): v is string => typeof v === 'string' && v.length > 0,
  );
  return clip(`⚙ ${name}${arg ? ` ${arg}` : ''}`);
}

export function parseOutputLine(raw: string): OutputLine[] {
  const line = raw.replace(/\r$/, '');
  if (!line.trim()) return [];
  if (!line.startsWith('{')) return [{ text: clip(line) }];

  let msg: {
    type?: string;
    subtype?: string;
    result?: string;
    is_error?: boolean;
    message?: { content?: ContentItem[] | string };
  };
  try {
    msg = JSON.parse(line) as typeof msg;
  } catch {
    return [{ text: clip(line) }];
  }

  if (msg.type === 'assistant') {
    const content = msg.message?.content;
    if (typeof content === 'string') return [{ text: clip(content) }];
    return (content ?? [])
      .map((c): OutputLine | null => {
        if (c.type === 'text' && c.text?.trim()) return { text: clip(c.text) };
        if (c.type === 'tool_use') {
          const text = toolLine(c);
          return text ? { text } : null;
        }
        return null;
      })
      .filter((x): x is OutputLine => x !== null);
  }
  if (msg.type === 'result') {
    const result = typeof msg.result === 'string' ? msg.result.trim() : '';
    return [{ text: msg.is_error ? `Ошибка агента: ${clip(result)}` : null, result: result || undefined }];
  }
  // system/user/прочие служебные сообщения stream-json в лог не нужны
  if (msg.type) return [];
  return [{ text: clip(line) }];
}
