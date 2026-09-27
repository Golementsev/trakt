import { describe, expect, it } from 'vitest';
import { parseOutputLine } from './output';

describe('parseOutputLine', () => {
  it('passes plain text through', () => {
    expect(parseOutputLine('Тесты: 42 passed\r')).toEqual([{ text: 'Тесты: 42 passed' }]);
    expect(parseOutputLine('   ')).toEqual([]);
  });

  it('summarises claude stream-json', () => {
    const assistant = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Смотрю  форму\nоплаты' },
          { type: 'tool_use', name: 'Edit', input: { file_path: 'src/CardForm.tsx' } },
          { type: 'tool_use', name: 'mcp__trakt__log_progress', input: { text: 'x' } },
        ],
      },
    });
    expect(parseOutputLine(assistant)).toEqual([
      { text: 'Смотрю форму оплаты' },
      { text: '⚙ Edit src/CardForm.tsx' },
    ]);
    expect(parseOutputLine(JSON.stringify({ type: 'system', subtype: 'init' }))).toEqual([]);
    expect(parseOutputLine(JSON.stringify({ type: 'result', result: 'Готово: 3 файла' }))).toEqual([
      { text: null, result: 'Готово: 3 файла' },
    ]);
  });

  it('keeps unknown json as text', () => {
    expect(parseOutputLine('{"level":"info"}')).toEqual([{ text: '{"level":"info"}' }]);
  });
});
