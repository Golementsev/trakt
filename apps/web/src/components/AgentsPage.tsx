import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bot,
  CircleCheck,
  CircleX,
  Loader2,
  PanelLeft,
  Plug,
  Sparkles,
  Terminal,
  Workflow,
  Zap,
} from 'lucide-react';
import type { AgentsOverview, AiMode, CheckResult, RunnerSourceId } from '@trakt/shared';
import { api } from '../api/client';
import { queryClient } from '../api/queries';
import { formatWhen } from '../lib/format';
import { run } from '../lib/toast';
import { AgentConnect } from './AgentConnect';
import { Editable } from './Editable';

const KEY = ['agents'];

/** Человеческое имя MCP-клиента по clientInfo.name. */
function clientLabel(name: string) {
  const n = name.toLowerCase();
  if (n.includes('claude-code') || n === 'claude code') return 'Claude Code';
  if (n.includes('claude')) return 'Claude Desktop';
  if (n.includes('codex')) return 'Codex';
  if (n.includes('cursor')) return 'Cursor';
  return name;
}

const minutesAgo = (iso: string) => Math.round((Date.now() - Date.parse(iso)) / 60_000);

/** Страница «Агенты»: источники агентов меняются здесь, для всей доски. */
export function AgentsPage({ onToggleSide }: { onToggleSide: () => void }) {
  const q = useQuery({ queryKey: KEY, queryFn: api.agents, refetchInterval: 5000 });
  const data = q.data;

  const update = async (b: Parameters<typeof api.updateAgents>[0]) => {
    const res = await run(api.updateAgents(b));
    if (res) queryClient.setQueryData(KEY, res);
  };

  return (
    <>
      <div className="top">
        <button className="iconbtn side-toggle" aria-label="Боковая панель" onClick={onToggleSide}>
          <PanelLeft className="i" />
        </button>
        <div className="titleblock">
          <h1>Агенты</h1>
        </div>
      </div>
      <div className="ticker">
        <span className="txt">Кто работает на доске, как он туда попадает и чем отвечают AI-функции.</span>
      </div>
      <div className="page">
        {!data ? (
          <p className="hint">
            {q.error ? `Не удалось загрузить: ${q.error.message}` : 'Проверяю, что установлено…'}
          </p>
        ) : (
          <div className="page-inner" style={{ paddingTop: 16 }}>
            <RunnerSection data={data} update={update} />
            <ClientsSection data={data} />
            <AiSection data={data} update={update} />
            <RunsSection data={data} />
            <HowItWorks />
          </div>
        )}
      </div>
    </>
  );
}

function Section({
  icon,
  title,
  lead,
  children,
}: {
  icon: ReactNode;
  title: string;
  lead: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {icon}
        {title}
      </h2>
      <p className="lead">{lead}</p>
      {children}
    </section>
  );
}

/** Кнопка «Проверить» с результатом под ней. */
function Check({ target }: { target: RunnerSourceId | 'ai' }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<CheckResult | null>(null);
  return (
    <div className="rows" style={{ gap: 6 }}>
      <button
        className="btn sm"
        style={{ width: 'fit-content' }}
        disabled={busy}
        onClick={async (e) => {
          e.stopPropagation();
          setBusy(true);
          setRes((await run(api.checkAgent(target))) ?? null);
          setBusy(false);
        }}
      >
        {busy ? <Loader2 className="i sm spin" /> : null}
        {busy ? 'Проверяю…' : 'Проверить'}
      </button>
      {res && (
        <span className={`badge ${res.ok ? 'ok' : 'bad'}`} style={{ whiteSpace: 'normal' }}>
          {res.ok ? <CircleCheck className="i sm" /> : <CircleX className="i sm" />}
          {res.message} · {(res.ms / 1000).toFixed(1)} с
        </span>
      )}
    </div>
  );
}

function RunnerSection({
  data,
  update,
}: {
  data: AgentsOverview;
  update: (b: { runner?: RunnerSourceId; customCommand?: string }) => Promise<void>;
}) {
  const { selected, sources, customCommand } = data.runner;
  return (
    <Section
      icon={<Terminal className="i" />}
      title="Кого доска запускает сама"
      lead={
        <>
          Кнопки «▶ Агент», «▶ Все агенту» и «▶ Отдать агенту» запускают выбранный агент в папке проекта
          (папка — в настройках проекта). Он получает задачу в stdin и отчитывается через MCP.
        </>
      }
    >
      <div className="sources">
        {sources.map((s) => {
          const on = s.id === selected;
          const missing = s.installed === false;
          return (
            <div
              key={s.id}
              role="radio"
              aria-checked={on}
              tabIndex={0}
              className={`source ${on ? 'on' : ''}`}
              onClick={() => !on && void update({ runner: s.id })}
              onKeyDown={(e) => e.key === 'Enter' && !on && void update({ runner: s.id })}
            >
              <div className="shead">
                {s.id === 'custom' ? <Terminal className="i" /> : <Bot className="i" />}
                <b>{s.label}</b>
                <span className="radio" />
              </div>
              {s.installed === true && <span className="badge ok">Установлен · {s.version ?? 'ok'}</span>}
              {missing && <span className="badge bad">Не найден на этом компьютере</span>}
              {s.id === 'custom' ? (
                <>
                  <p>
                    Любой агент с неинтерактивным режимом. Промпт придёт в stdin, адрес доски — в {'{mcpUrl}'}
                    .
                  </p>
                  {on && (
                    <div onClick={(e) => e.stopPropagation()}>
                      <Editable
                        multiline
                        className="in mono"
                        rows={2}
                        value={customCommand}
                        placeholder="aider --yes-always --message-file {promptFile}"
                        onCommit={(v) => void update({ customCommand: v })}
                      />
                    </div>
                  )}
                </>
              ) : (
                <p>
                  В ленте — «{s.agentName}».{' '}
                  {s.id === 'claude-cli'
                    ? 'Работает под вашей подпиской Claude (нужен вход: claude → /login).'
                    : 'Нужен установленный и авторизованный Codex CLI.'}
                </p>
              )}
              {s.id !== 'custom' && !missing && <Check target={s.id} />}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function ClientsSection({ data }: { data: AgentsOverview }) {
  return (
    <Section
      icon={<Plug className="i" />}
      title="Кто подключается сам (MCP)"
      lead={
        <>
          Любой агент, к которому подключена доска как MCP-сервер ( <code>{data.mcpUrl}</code>), работает с
          ней сам: вы говорите ему «возьми PAY-12 с доски Тракт». Так подключается и Claude Desktop.
        </>
      }
    >
      <div className="panel" style={{ marginBottom: 14 }}>
        {data.clients.length ? (
          data.clients.map((c) => {
            const fresh = minutesAgo(c.lastSeenAt) < 3;
            return (
              <div className="prow" key={c.id}>
                <span className={`dot ${fresh ? 'live' : ''}`} />
                <div className="pmain">
                  <b>
                    {clientLabel(c.name)}{' '}
                    <span className="lbl mono">
                      {c.name}
                      {c.version ? ` ${c.version}` : ''}
                    </span>
                  </b>
                  <span>
                    Подключился в {formatWhen(c.connectedAt)} · активность{' '}
                    {fresh ? 'только что' : `${minutesAgo(c.lastSeenAt)} мин назад`}
                    {c.lastAction ? ` · последнее: ${c.lastAction}` : ''}
                  </span>
                </div>
              </div>
            );
          })
        ) : (
          <div className="prow">
            <span className="dot" />
            <div className="pmain">
              <b>Пока никто не подключён</b>
              <span>Подключите агента ниже — он появится здесь, как только обратится к доске.</span>
            </div>
          </div>
        )}
      </div>
      <AgentConnect />
    </Section>
  );
}

const AI_MODES: Array<{ id: AiMode; title: string; text: string }> = [
  { id: 'auto', title: 'Автоматически', text: 'Ключ API, если он есть в .env, иначе Claude Code CLI.' },
  { id: 'cli', title: 'Claude Code CLI', text: 'Под вашей подпиской, через claude -p. Ключ не нужен.' },
  { id: 'api', title: 'Anthropic API', text: 'По ключу ANTHROPIC_API_KEY из файла .env в папке доски.' },
  { id: 'off', title: 'Выключено', text: 'Кнопки AI покажут, как их включить. Остальная доска работает.' },
];

function AiSection({
  data,
  update,
}: {
  data: AgentsOverview;
  update: (b: { ai?: AiMode }) => Promise<void>;
}) {
  const ai = data.ai;
  return (
    <Section
      icon={<Sparkles className="i" />}
      title="Чем отвечают AI-функции доски"
      lead="«✦ Разбить с AI» и идеи из кнопки «+» — короткие запросы к модели, не агент. Здесь выбирается, кто на них отвечает."
    >
      <div className="sources">
        {AI_MODES.map((m) => {
          const on = ai.mode === m.id;
          const unavailable = (m.id === 'api' && !ai.apiKey) || (m.id === 'cli' && !ai.cli);
          return (
            <div
              key={m.id}
              role="radio"
              aria-checked={on}
              tabIndex={0}
              className={`source ${on ? 'on' : ''}`}
              onClick={() => !on && void update({ ai: m.id })}
              onKeyDown={(e) => e.key === 'Enter' && !on && void update({ ai: m.id })}
            >
              <div className="shead">
                <b>{m.title}</b>
                <span className="radio" />
              </div>
              <p>{m.text}</p>
              {unavailable && (
                <span className="badge bad">
                  {m.id === 'api' ? 'Ключ не найден в .env' : 'claude не найден'}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="erow" style={{ marginTop: 12, alignItems: 'flex-start' }}>
        <span className={`badge ${ai.effective ? 'ok' : 'bad'}`}>
          {ai.effective ? `Сейчас отвечает: ${ai.effective}` : ai.hint}
        </span>
        {ai.effective && <Check target="ai" />}
      </div>
    </Section>
  );
}

function RunsSection({ data }: { data: AgentsOverview }) {
  return (
    <Section
      icon={<Zap className="i" />}
      title="Сейчас работают"
      lead="Агенты, которых запустила доска. Остановить — кнопкой «■ Стоп» в окне задачи."
    >
      <div className="panel">
        {data.runs.length ? (
          data.runs.map((r) => (
            <div className="prow" key={r.id}>
              <span className={`dot ${r.status === 'running' ? 'live' : ''}`} />
              <div className="pmain">
                <b>
                  {r.task} · {r.taskTitle}
                </b>
                <span>
                  {r.agentName} · {r.status === 'running' ? 'работает' : 'в очереди'}
                  {r.subtask ? ` · ${r.subtask}` : ' · задача целиком'}
                </span>
              </div>
            </div>
          ))
        ) : (
          <div className="prow">
            <span className="dot" />
            <div className="pmain">
              <b>Никто не запущен</b>
              <span>Нажмите «▶ Агент» на сабтаске — прогон появится здесь.</span>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}

function HowItWorks() {
  return (
    <Section
      icon={<Workflow className="i" />}
      title="Как это устроено"
      lead="Доска — это сервер на вашем компьютере (127.0.0.1:4700). У него три входа: страница, которую вы видите, MCP для агентов и запуск агентов процессом."
    >
      <div className="modes" style={{ marginBottom: 20 }}>
        <div className="mode">
          <h3>
            <Plug className="i sm" />
            Агент приходит сам (pull)
          </h3>
          <p className="hint" style={{ margin: 0 }}>
            Вы работаете в Claude Desktop или в терминале и говорите: «возьми PAY-12 с доски Тракт». Агент
            видит инструменты доски (list_tasks, claim_task, log_progress…) и вызывает их сам. Доска только
            отвечает и следит за правилами.
          </p>
        </div>
        <div className="mode">
          <h3>
            <Terminal className="i sm" />
            Доска запускает агента (push)
          </h3>
          <p className="hint" style={{ margin: 0 }}>
            Вы жмёте «▶ Агент». Доска запускает выбранный выше CLI в папке проекта, даёт ему задачу и тот же
            MCP. Лог процесса идёт в сабтаску, «■ Стоп» завершает процесс.
          </p>
        </div>
      </div>
      <ol className="steps">
        <li>
          <b>Вы отдаёте задачу агенту</b>
          «▶ Отдать агенту», «▶ Агент» на сабтаске, перенос в дорожку «Ведёт агент» — или просто просите
          агента в чате взять задачу.
        </li>
        <li>
          <b>Агент берёт задачу — claim_task</b>
          Доска ставит отметку «держит Claude Code до 18:40», чтобы второй агент не взял ту же задачу. Отметка
          продлевается, пока агент работает, и снимается, когда он закончил.
        </li>
        <li>
          <b>Читает контекст — get_task</b>
          Описание, поля с меткой AI, сабтаски, условие готовности и в какие статусы ему можно перевести
          задачу.
        </li>
        <li>
          <b>Работает в папке проекта</b>
          Меняет код, запускает тесты — как обычно. Если включён отдельный git worktree, работает в своей
          ветке
          <code>trakt/PAY-12</code>.
        </li>
        <li>
          <b>Пишет прогресс — start_subtask, log_progress</b>
          На карточке — «агент работает», в окне задачи — живой лог. Каждое действие приходит на доску сразу,
          без перезагрузки.
        </li>
        <li>
          <b>Закрывает сабтаски — complete_subtask</b>
          Когда закрыта последняя, доска сама переводит задачу дальше (обычно в «Ревью»), если это разрешают
          воркфлоу и «не дальше статуса».
        </li>
        <li>
          <b>Вы проверяете</b>В «Готово» по умолчанию переводит человек. Если агент застрял, он пишет вопрос в
          ленту (add_comment) и отпускает задачу.
        </li>
      </ol>
    </Section>
  );
}
