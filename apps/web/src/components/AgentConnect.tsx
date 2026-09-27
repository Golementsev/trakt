import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type AgentConnectInfo } from '../api/client';
import { toast } from '../lib/toast';

interface Snippet {
  id: string;
  title: string;
  where: string;
  code: string;
}

/** Готовые конфиги подключения MCP для популярных харнесов. */
export function snippetsFor(info: AgentConnectInfo): Snippet[] {
  const { httpUrl, stdio } = info;
  const entry = stdio.args[0] ?? '';
  return [
    {
      id: 'claude',
      title: 'Claude Code',
      where: 'Выполните в терминале, в папке проекта:',
      code: `claude mcp add --transport http trakt ${httpUrl}`,
    },
    {
      id: 'codex',
      title: 'Codex CLI',
      where: 'Добавьте в ~/.codex/config.toml:',
      // одинарные кавычки в TOML — строка без экранирования (важно для путей Windows)
      code: `[mcp_servers.trakt]\ncommand = '${stdio.command}'\nargs = ['${entry}']`,
    },
    {
      id: 'cursor',
      title: 'Cursor',
      where: 'Добавьте в .cursor/mcp.json (или глобальный ~/.cursor/mcp.json):',
      code: JSON.stringify({ mcpServers: { trakt: { url: httpUrl } } }, null, 2),
    },
    {
      id: 'json',
      title: 'Другой агент',
      where: 'Streamable HTTP, если харнес его умеет; иначе — stdio:',
      code: JSON.stringify(
        {
          mcpServers: {
            trakt: { type: 'http', url: httpUrl },
            'trakt-stdio': { command: stdio.command, args: stdio.args },
          },
        },
        null,
        2,
      ),
    },
  ];
}

export function AgentConnect() {
  const q = useQuery({ queryKey: ['agent-connect'], queryFn: api.agentConnect, staleTime: Infinity });
  const [tab, setTab] = useState('claude');
  const info = q.data;
  if (!info) return null;
  const snippets = snippetsFor(info);
  const s = snippets.find((x) => x.id === tab) ?? snippets[0]!;
  const usesStdio = s.id === 'codex' || s.id === 'json';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(s.code);
      toast('Скопировано');
    } catch {
      toast('Не получилось скопировать — выделите текст вручную');
    }
  };

  return (
    <div className="sect">
      <h3>Подключить агента</h3>
      <p className="hint" style={{ margin: '0 0 10px' }}>
        Доска — это MCP-сервер. Подключите его к своему агенту, потом скажите: «возьми PAY-12 с доски Тракт».
        Агент сам возьмёт задачу, будет писать прогресс и двигать её по правилам выше.
      </p>
      <div className="seg" style={{ marginBottom: 8 }}>
        {snippets.map((x) => (
          <button key={x.id} className={x.id === s.id ? 'on' : ''} onClick={() => setTab(x.id)}>
            {x.title}
          </button>
        ))}
      </div>
      <p className="hint" style={{ margin: '0 0 6px' }}>
        {s.where}
      </p>
      <pre className="snippet">{s.code}</pre>
      <div className="erow" style={{ marginTop: 8 }}>
        <button className="btn sm" onClick={() => void copy()}>
          Скопировать
        </button>
        {usesStdio && !info.stdio.built && (
          <span className="hint" style={{ color: 'var(--danger)' }}>
            stdio-вход ещё не собран: выполните npm run build
          </span>
        )}
      </div>
    </div>
  );
}
