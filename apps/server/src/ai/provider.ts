import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import Anthropic from '@anthropic-ai/sdk';
import { lineSplitter } from '../runner/process';

/**
 * Источник модели для AI-функций доски («✦ Разбить с AI», идеи из «+»).
 * - api: Anthropic API (ANTHROPIC_API_KEY или ANTHROPIC_AUTH_TOKEN в окружении / .env);
 * - cli: установленный и авторизованный Claude Code (`claude -p`);
 * Какой из них отвечает — выбирается на странице «Агенты» (см. agents/service.ts).
 */
export interface AiProvider {
  id: 'api' | 'cli';
  label: string;
  /** Сгенерировать текст; onText получает весь накопленный текст по мере генерации. */
  generate(prompt: string, opts?: { signal?: AbortSignal; onText?: (text: string) => void }): Promise<string>;
}

export interface AiStatus {
  available: boolean;
  provider: string | null;
  hint: string | null;
}

export const AI_UNAVAILABLE_HINT =
  'AI недоступен: добавьте ANTHROPIC_API_KEY в файл .env в корне доски или установите и авторизуйте Claude Code (claude, затем /login), потом перезапустите доску.';

const DEFAULT_MODEL = 'claude-opus-5';

/** Anthropic API: стриминг, server-side fallbacks на случай отказа классификаторов. */
export function apiProvider(): AiProvider {
  const client = new Anthropic();
  const model = process.env.TRAKT_AI_MODEL || DEFAULT_MODEL;
  return {
    id: 'api',
    label: `Anthropic API (${model})`,
    async generate(prompt, opts = {}) {
      const stream = client.beta.messages.stream(
        {
          model,
          max_tokens: 16000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          // короткие бытовые задачи — низкое усилие, быстро и дёшево
          output_config: { effort: 'low' },
          messages: [{ role: 'user', content: prompt }],
        },
        { signal: opts.signal },
      );
      let text = '';
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          text += event.delta.text;
          opts.onText?.(text);
        }
      }
      const final = await stream.finalMessage();
      if (final.stop_reason === 'refusal') throw new Error('Модель отказалась отвечать на этот запрос.');
      return text;
    },
  };
}

/** Claude Code в неинтерактивном режиме: `claude -p`, текст из stream-json. */
export function cliProvider(command = process.env.TRAKT_AI_CLI || 'claude'): AiProvider {
  return {
    id: 'cli',
    label: `Claude Code CLI (${command})`,
    generate(prompt, opts = {}) {
      return new Promise((resolve, reject) => {
        // пустая временная папка: генерации идей не нужен доступ к файлам
        const child = spawn(`${command} -p --output-format stream-json --verbose`, {
          cwd: tmpdir(),
          shell: true,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        let text = '';
        let result: string | null = null;
        let error = '';
        const out = lineSplitter((line) => {
          try {
            const msg = JSON.parse(line) as {
              type?: string;
              result?: string;
              is_error?: boolean;
              message?: { content?: Array<{ type?: string; text?: string }> };
            };
            if (msg.type === 'assistant') {
              for (const c of msg.message?.content ?? []) if (c.type === 'text' && c.text) text += c.text;
              opts.onText?.(text);
            }
            if (msg.type === 'result') {
              if (msg.is_error) error = msg.result ?? 'ошибка';
              else result = msg.result ?? text;
            }
          } catch {
            error += `${line}\n`;
          }
        });
        child.stdout.on('data', (c: Buffer) => out.push(c));
        child.stderr.on('data', (c: Buffer) => (error += c.toString()));
        child.stdin.on('error', () => {});
        child.stdin.end(prompt);
        const onAbort = () => child.kill();
        opts.signal?.addEventListener('abort', onAbort, { once: true });
        child.on('error', (e) => reject(new Error(`Не удалось запустить ${command}: ${e.message}`)));
        child.on('close', (code) => {
          out.flush();
          opts.signal?.removeEventListener('abort', onAbort);
          if (opts.signal?.aborted) return resolve(text);
          if (code === 0 && !error) return resolve(result ?? text);
          reject(new Error(`Claude Code: ${error.trim().split('\n').at(-1) || `код ${code}`}`));
        });
      });
    },
  };
}

export function statusOf(provider: AiProvider | null): AiStatus {
  return provider
    ? { available: true, provider: provider.label, hint: null }
    : { available: false, provider: null, hint: AI_UNAVAILABLE_HINT };
}
