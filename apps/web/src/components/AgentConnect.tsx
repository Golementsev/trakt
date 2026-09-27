import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { api, type AgentConnectInfo } from '../api/client';
import { toast } from '../lib/toast';

interface Block {
  where: string;
  code: string;
}

interface Snippet {
  id: string;
  title: string;
  blocks: Block[];
  stdio?: boolean;
}

/** Готовые конфиги подключения MCP для популярных харнесов. */
export function snippetsFor(info: AgentConnectInfo): Snippet[] {
  const { httpUrl, stdio } = info;
  const entry = stdio.args[0] ?? '';
  const addUser = `claude mcp add --scope user --transport http trakt ${httpUrl}`;
  return [
    {
      id: 'desktop',
      title: 'Claude Desktop',
      stdio: true,
      blocks: [
        {
          where:
            'Вкладка Code в Claude Desktop — это Claude Code: он берёт серверы MCP из тех же настроек, что и терминал. Выполните один раз в терминале и перезапустите сессию:',
          code: addUser,
        },
        {
          where:
            'Обычный чат Claude Desktop: Настройки → Разработчик → «Изменить конфиг» (claude_desktop_config.json), добавьте и перезапустите приложение:',
          code: JSON.stringify(
            { mcpServers: { trakt: { command: stdio.command, args: stdio.args } } },
            null,
            2,
          ),
        },
      ],
    },
    {
      id: 'claude',
      title: 'Claude Code CLI',
      blocks: [{ where: 'Один раз в терминале — доска будет доступна во всех папках:', code: addUser }],
    },
    {
      id: 'codex',
      title: 'Codex CLI',
      stdio: true,
      // одинарные кавычки в TOML — строка без экранирования (важно для путей Windows)
      blocks: [
        {
          where: 'Добавьте в ~/.codex/config.toml:',
          code: `[mcp_servers.trakt]\ncommand = '${stdio.command}'\nargs = ['${entry}']`,
        },
      ],
    },
    {
      id: 'cursor',
      title: 'Cursor',
      blocks: [
        {
          where: 'Добавьте в .cursor/mcp.json (или глобальный ~/.cursor/mcp.json):',
          code: JSON.stringify({ mcpServers: { trakt: { url: httpUrl } } }, null, 2),
        },
      ],
    },
    {
      id: 'json',
      title: 'Другой агент',
      stdio: true,
      blocks: [
        {
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
      ],
    },
  ];
}

export function AgentConnect() {
  const q = useQuery({ queryKey: ['agent-connect'], queryFn: api.agentConnect, staleTime: Infinity });
  const [tab, setTab] = useState('desktop');
  const info = q.data;
  if (!info) return null;
  const snippets = snippetsFor(info);
  const s = snippets.find((x) => x.id === tab) ?? snippets[0]!;

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast('Скопировано');
    } catch {
      toast('Не получилось скопировать — выделите текст вручную');
    }
  };

  return (
    <div className="rows" style={{ gap: 10 }}>
      <div className="seg" style={{ width: 'fit-content', maxWidth: '100%', overflowX: 'auto' }}>
        {snippets.map((x) => (
          <button key={x.id} className={x.id === s.id ? 'on' : ''} onClick={() => setTab(x.id)}>
            {x.title}
          </button>
        ))}
      </div>
      {s.blocks.map((b) => (
        <div key={b.code} className="rows" style={{ gap: 6 }}>
          <span className="hint">{b.where}</span>
          <pre className="snippet">{b.code}</pre>
          <div className="erow">
            <button className="btn sm" onClick={() => void copy(b.code)}>
              <Copy className="i sm" />
              Скопировать
            </button>
          </div>
        </div>
      ))}
      {s.stdio && !info.stdio.built && (
        <span className="hint" style={{ color: 'var(--danger)' }}>
          stdio-вход ещё не собран: выполните npm run build в папке доски.
        </span>
      )}
    </div>
  );
}
