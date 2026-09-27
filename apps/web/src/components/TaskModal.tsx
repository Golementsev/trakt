import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Board, Field, FieldValue, RunInfo, Subtask, TaskDetail, UpdateTaskInput } from '@trakt/shared';
import { api } from '../api/client';
import { refreshProject, useTask } from '../api/queries';
import { actorName, formatWhen, isYou } from '../lib/format';
import { run, toast } from '../lib/toast';
import { Avatar } from './Avatar';
import { isWorking } from './Card';
import { Editable } from './Editable';
import { EventText } from './EventText';

export interface DraftInit {
  statusId?: string;
  title?: string;
  description?: string;
}

interface Props {
  board: Board;
  /** Открыть существующую задачу… */
  taskId: string | null;
  /** …или черновик новой. */
  draft: DraftInit | null;
  /** Увеличивается, когда снаружи просят закрыть (Esc). */
  closeSignal: number;
  onClose: () => void;
  onCreated: (taskId: string) => void;
}

interface Draft {
  title: string;
  typeId: string;
  statusId: string;
  description: string;
  fields: Record<string, FieldValue>;
  subtasks: string[];
}

export function TaskModal({ board, taskId, draft: init, closeSignal, onClose, onCreated }: Props) {
  const { project, statuses, types } = board;
  const pid = project.id;
  const isDraft = !taskId;
  const q = useTask(taskId);
  const task = q.data;

  const [draft, setDraft] = useState<Draft>(() => ({
    title: init?.title ?? '',
    typeId: types[0]?.id ?? '',
    statusId: init?.statusId ?? statuses[0]?.id ?? '',
    description: init?.description ?? '',
    fields: {},
    subtasks: [],
  }));
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [creating, setCreating] = useState(false);
  const descRef = useRef<HTMLDivElement>(null);

  // задачу удалили (в другой вкладке или агентом) — закрываем окно
  useEffect(() => {
    if (taskId && q.isError) onClose();
  }, [taskId, q.isError, onClose]);

  const dirty =
    isDraft &&
    (!!draft.title.trim() ||
      !!draft.description.trim() ||
      draft.subtasks.length > 0 ||
      Object.values(draft.fields).some((v) => v !== null && v !== '' && v !== false));

  const requestClose = () => {
    if (dirty && !confirmDiscard) setConfirmDiscard(true);
    else onClose();
  };

  const firstSignal = useRef(closeSignal);
  useEffect(() => {
    if (closeSignal !== firstSignal.current) requestClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeSignal]);

  const create = async (withAgent: boolean) => {
    if (creating) return;
    if (!draft.title.trim()) {
      toast('Напишите, что нужно сделать');
      document.getElementById('dTitle')?.focus();
      return;
    }
    const fieldIds = new Set(types.find((t) => t.id === draft.typeId)?.fields.map((f) => f.id));
    setCreating(true);
    const t = await run(
      api.createTask(pid, {
        title: draft.title,
        typeId: draft.typeId,
        statusId: draft.statusId,
        description: draft.description,
        fields: Object.fromEntries(Object.entries(draft.fields).filter(([k]) => fieldIds.has(k))),
        subtasks: draft.subtasks,
        agentOwned: withAgent,
      }),
    );
    setCreating(false);
    if (!t) return;
    refreshProject(pid);
    toast(`Задача ${t.key} на доске`);
    onCreated(t.id);
  };

  // Ctrl/Cmd+Enter в черновике — создать задачу
  const createRef = useRef(create);
  useEffect(() => {
    createRef.current = create;
  });
  useEffect(() => {
    if (!isDraft) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void createRef.current(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isDraft]);

  const save = async (input: UpdateTaskInput) => {
    if (!taskId) return;
    const res = await run(api.updateTask(taskId, input));
    refreshProject(pid);
    return res;
  };

  if (!isDraft && !task) {
    return (
      <Shell onScrim={onClose} label="Задача">
        <div className="thead">
          <span className="spacer" />
          <button className="iconbtn" aria-label="Закрыть" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="tbody">
          <span className="hint">Загружаю задачу…</span>
        </div>
      </Shell>
    );
  }

  const typeId = task?.typeId ?? draft.typeId;
  const statusId = task?.statusId ?? draft.statusId;
  const type = types.find((t) => t.id === typeId);
  const status = statuses.find((s) => s.id === statusId);
  const fields = type?.fields ?? [];
  const values = task?.fields ?? draft.fields;
  const key = task?.key ?? `${project.key}-${project.nextNumber}`;

  const setField = (f: Field, v: FieldValue) => {
    if (isDraft) setDraft((d) => ({ ...d, fields: { ...d.fields, [f.id]: v } }));
    else void save({ fields: { [f.id]: v } });
  };

  const focusDesc = () => descRef.current?.querySelector('textarea')?.focus();

  return (
    <Shell onScrim={requestClose} label={key}>
      <div className="thead">
        <span className="tid">{key}</span>
        {task && type && (
          <span className="chip" style={{ '--c': type.color } as CSSProperties}>
            <span className="sq" />
            {type.name}
          </span>
        )}
        {task && isWorking(task) && (
          <span className="working" style={{ marginLeft: 0 }}>
            <span className="dot live" />
            агент работает
          </span>
        )}
        <span className="spacer" />
        {isDraft ? (
          <span className="lbl">Новая задача</span>
        ) : (
          <>
            <button
              className={`btn sm ${task!.agentOwned ? '' : 'agent'}`}
              onClick={async () => {
                const res = await save({ agentOwned: !task!.agentOwned });
                if (!res?.agentOwned) return;
                toast(
                  res.runs.length
                    ? 'Агент взялся за задачу'
                    : 'Задача отдана агенту: её возьмёт агент, подключённый через MCP',
                );
              }}
            >
              {task!.agentOwned ? 'Забрать у агента' : '▶ Отдать агенту'}
            </button>
            <button
              className="iconbtn del"
              title="Удалить задачу"
              onClick={async () => {
                if (await run(api.deleteTask(task!.id))) {
                  refreshProject(pid);
                  onClose();
                }
              }}
            >
              🗑
            </button>
          </>
        )}
        <button className="iconbtn" aria-label="Закрыть" onClick={requestClose}>
          ×
        </button>
      </div>

      <div className="tbody">
        <Editable
          id="dTitle"
          className="dtitle"
          value={task?.title ?? draft.title}
          placeholder="Что нужно сделать?"
          autoFocus={isDraft}
          live={isDraft}
          onCommit={(v) => {
            if (isDraft) setDraft((d) => ({ ...d, title: v }));
            else if (v.trim()) void save({ title: v });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
              e.preventDefault();
              focusDesc();
            }
          }}
        />

        {isDraft && (
          <div className="typepick">
            {types.map((t) => (
              <button
                key={t.id}
                className={t.id === draft.typeId ? 'on' : ''}
                style={{ '--c': t.color } as CSSProperties}
                onClick={() => setDraft((d) => ({ ...d, typeId: t.id }))}
              >
                <span className="sq" />
                {t.name}
              </button>
            ))}
          </div>
        )}

        <Stepper board={board} statusId={statusId} />

        <div className="sect" ref={descRef}>
          <h3>
            <label htmlFor="dDesc">Описание</label>
          </h3>
          <Editable
            id="dDesc"
            multiline
            className="in"
            rows={3}
            placeholder="Контекст для вас и агента"
            value={task?.description ?? draft.description}
            live={isDraft}
            onCommit={(v) =>
              isDraft ? setDraft((d) => ({ ...d, description: v })) : void save({ description: v })
            }
          />
        </div>

        {fields
          .filter((f) => f.kind === 'text')
          .map((f) => (
            <div className="sect" key={f.id}>
              <h3>
                <label htmlFor={`fld-${f.id}`}>
                  <FieldLabel field={f} />
                </label>
              </h3>
              <Editable
                id={`fld-${f.id}`}
                multiline
                className="in"
                rows={2}
                placeholder={`${f.name}…`}
                value={typeof values[f.id] === 'string' ? (values[f.id] as string) : ''}
                live={isDraft}
                onCommit={(v) => setField(f, v)}
              />
            </div>
          ))}

        {fields.some((f) => f.kind !== 'text') && (
          <div className="minifields">
            {fields
              .filter((f) => f.kind !== 'text')
              .map((f) => (
                <MiniField
                  key={f.id}
                  field={f}
                  value={values[f.id] ?? null}
                  live={isDraft}
                  onChange={(v) => setField(f, v)}
                />
              ))}
          </div>
        )}

        <Subtasks
          task={task ?? null}
          draftTitles={draft.subtasks}
          draftSource={{ title: draft.title, description: draft.description }}
          onDraftAdd={(title) => setDraft((d) => ({ ...d, subtasks: [...d.subtasks, title] }))}
          projectId={pid}
        />

        <div className="dod">
          <b>Агент двигает задачу дальше, когда:</b> {project.dod}
        </div>

        {task && task.history.length > 0 && <History task={task} />}
      </div>

      {isDraft && (
        <div className="tfoot">
          {confirmDiscard ? (
            <>
              <span className="hint">Закрыть без сохранения? Всё написанное пропадёт.</span>
              <span className="spacer" />
              <button className="btn" onClick={() => setConfirmDiscard(false)}>
                Вернуться
              </button>
              <button className="btn danger" onClick={onClose}>
                Не сохранять
              </button>
            </>
          ) : (
            <>
              <span className="hint">Появится в «{status?.name}»</span>
              <span className="spacer" />
              <button className="btn" onClick={requestClose}>
                Отмена
              </button>
              <button className="btn agent" disabled={creating} onClick={() => void create(true)}>
                Создать и отдать агенту
              </button>
              <button className="btn pri" disabled={creating} onClick={() => void create(false)}>
                Создать задачу
              </button>
            </>
          )}
        </div>
      )}
    </Shell>
  );
}

function Shell({ children, onScrim, label }: { children: ReactNode; onScrim: () => void; label: string }) {
  return (
    <>
      <div className="scrim" onClick={onScrim} />
      <div className="tmodal">
        <div className="tbox anim" role="dialog" aria-modal="true" aria-label={label}>
          {children}
        </div>
      </div>
    </>
  );
}

function FieldLabel({ field: f }: { field: Field }) {
  return (
    <>
      {f.name}
      {f.required && (
        <>
          {' '}
          <span className="req">*</span>
        </>
      )}
      {f.visibleToAgent && (
        <>
          {' '}
          <span className="aitag" title="Агент видит это поле">
            AI
          </span>
        </>
      )}
    </>
  );
}

function Stepper({ board, statusId }: { board: Board; statusId: string }) {
  const ci = board.statuses.findIndex((s) => s.id === statusId);
  const cur = board.statuses[ci];
  return (
    <div className="stepper" aria-label={`Статус: ${cur?.name ?? ''}`}>
      {board.statuses.map((s, i) => (
        <span key={s.id} style={{ display: 'contents' }}>
          {i > 0 && <span className={`step-line ${i <= ci ? 'past' : ''}`} />}
          <span
            className={`step ${i < ci ? 'past' : i === ci ? 'cur' : ''}`}
            style={{ '--c': s.color } as CSSProperties}
          >
            <i />
            {s.name}
          </span>
        </span>
      ))}
    </div>
  );
}

function MiniField({
  field: f,
  value,
  live,
  onChange,
}: {
  field: Field;
  value: FieldValue;
  live: boolean;
  onChange: (v: FieldValue) => void;
}) {
  const id = `fld-${f.id}`;
  let input: ReactNode;
  if (f.kind === 'checkbox') {
    input = (
      <input type="checkbox" id={id} checked={value === true} onChange={(e) => onChange(e.target.checked)} />
    );
  } else if (f.kind === 'date') {
    input = (
      <input
        className="in"
        type="date"
        id={id}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value || null)}
      />
    );
  } else {
    input = (
      <NumberInput id={id} value={typeof value === 'number' ? value : null} live={live} onCommit={onChange} />
    );
  }
  return (
    <label htmlFor={id}>
      {f.name}
      {f.required && (
        <>
          {' '}
          <span className="req">*</span>
        </>
      )}{' '}
      {input}
    </label>
  );
}

function NumberInput(p: {
  id: string;
  value: number | null;
  live: boolean;
  onCommit: (v: FieldValue) => void;
}) {
  const toValue = (s: string): FieldValue => (s.trim() === '' ? null : Number(s));
  return (
    <Editable
      id={p.id}
      className="in"
      value={p.value === null ? '' : String(p.value)}
      live={p.live}
      onCommit={(s) => p.onCommit(toValue(s))}
    />
  );
}

function Subtasks({
  task,
  draftTitles,
  onDraftAdd,
  draftSource,
  projectId,
}: {
  task: TaskDetail | null;
  draftTitles: string[];
  onDraftAdd: (title: string) => void;
  /** Заголовок и описание черновика — для «✦ Разбить с AI» до создания задачи. */
  draftSource: { title: string; description: string };
  projectId: string;
}) {
  const [title, setTitle] = useState('');
  const [splitting, setSplitting] = useState(false);
  const taskId = task?.id ?? null;
  const runs = task?.runs ?? [];
  const rows: Array<Pick<Subtask, 'title' | 'done' | 'state' | 'log'> & { id: string }> =
    task?.subtasks ??
    draftTitles.map((t, i) => ({ id: `d${i}`, title: t, done: false, state: 'idle', log: [] }));
  const done = rows.filter((s) => s.done).length;
  const runOf = (subtaskId: string) => runs.find((r) => r.subtaskId === subtaskId);
  const canRunAll = !!taskId && rows.some((s) => !s.done && s.state !== 'running' && !runOf(s.id));
  const taskRun = runs.find((r) => r.subtaskId === null);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = title.trim();
    if (!v) return;
    if (!taskId) onDraftAdd(v);
    else {
      if (!(await run(api.addSubtask(taskId, v)))) return;
      refreshProject(projectId);
    }
    setTitle('');
  };

  const act = async (p: Promise<unknown>) => {
    await run(p);
    refreshProject(projectId);
  };

  const split = async () => {
    setSplitting(true);
    if (taskId) await act(api.splitTask(taskId));
    else {
      const res = await run(api.aiSplit(draftSource.title, draftSource.description));
      res?.subtasks.forEach(onDraftAdd);
    }
    setSplitting(false);
  };

  return (
    <div className="sect">
      <h3>
        Сабтаски{' '}
        <span className="mono" style={{ letterSpacing: 0 }}>
          {done}/{rows.length}
        </span>
        <span className="sp" />
        <button className="btn sm agent" disabled={splitting} onClick={() => void split()}>
          {splitting ? '✦ Думаю…' : '✦ Разбить с AI'}
        </button>
        {canRunAll && (
          <button className="btn sm" onClick={() => void act(api.runTask(taskId))}>
            ▶ Все агенту
          </button>
        )}
      </h3>
      <div className="subs">
        {rows.length ? (
          rows.map((s) => (
            <div key={s.id} className={`srow ${s.done ? 'done' : ''}`}>
              <input
                type="checkbox"
                aria-label="Готово"
                checked={s.done}
                disabled={!taskId}
                onChange={(e) => void act(api.updateSubtask(s.id, { done: e.target.checked }))}
              />
              <span className="st">{s.title}</span>
              {taskId && (
                <SubtaskAction
                  state={s.state}
                  done={s.done}
                  run={runOf(s.id)}
                  onRun={() => void act(api.runSubtask(s.id))}
                  onStop={(runId) => void act(api.stopRun(runId))}
                />
              )}
              {s.log.length > 0 && <LogBox lines={s.log} live={s.state === 'running'} />}
            </div>
          ))
        ) : (
          <div className="srow">
            <span className="hint">Сабтасок пока нет. Добавьте вручную или разбейте задачу с AI.</span>
          </div>
        )}
      </div>
      <form className="addsub" onSubmit={(e) => void add(e)}>
        <input
          className="in"
          placeholder="Новая сабтаска и Enter"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button className="btn">Добавить</button>
      </form>
      {task && (task.taskLog.length > 0 || taskRun) && (
        <div style={{ marginTop: 12 }}>
          <h3>
            Агент по задаче целиком
            <span className="sp" />
            {taskRun && (
              <button className="btn sm" onClick={() => void act(api.stopRun(taskRun.id))}>
                ■ Стоп
              </button>
            )}
          </h3>
          <LogBox lines={task.taskLog} live={taskRun?.status === 'running'} />
        </div>
      )}
    </div>
  );
}

/** Лог прогона: всегда прокручен к последней строке, как в макете. */
function LogBox({ lines, live }: { lines: Subtask['log']; live: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines.length]);
  return (
    <div className="log" ref={ref}>
      {lines.map((l, i) => (
        <div key={i} className={live && i === lines.length - 1 ? 'cur' : ''}>
          {l.text}
        </div>
      ))}
    </div>
  );
}

/** Справа в строке сабтаски: ▶ Агент / ■ Стоп / в очереди / готово (как в макете). */
function SubtaskAction({
  state,
  done,
  run: r,
  onRun,
  onStop,
}: {
  state: Subtask['state'];
  done: boolean;
  run: RunInfo | undefined;
  onRun: () => void;
  onStop: (runId: string) => void;
}) {
  if (r)
    return (
      <>
        {r.status === 'queued' && (
          <span className="hint" style={{ fontSize: 12 }}>
            в очереди
          </span>
        )}
        <button className="btn sm" onClick={() => onStop(r.id)}>
          ■ Стоп
        </button>
      </>
    );
  if (done)
    return (
      <span className="hint" style={{ fontSize: 12 }}>
        готово
      </span>
    );
  // сабтаску ведёт агент, подключённый через MCP — остановить его доска не может
  if (state === 'running')
    return (
      <span className="working" style={{ marginLeft: 0 }}>
        <span className="dot live" />
        агент работает
      </span>
    );
  return (
    <>
      {state === 'failed' && (
        <span className="hint" style={{ fontSize: 12, color: 'var(--danger)' }}>
          не вышло
        </span>
      )}
      <button className="btn sm agent" onClick={onRun}>
        ▶ Агент
      </button>
    </>
  );
}

function History({ task }: { task: TaskDetail }) {
  return (
    <div className="sect">
      <h3>История</h3>
      <div className="hist">
        {task.history.slice(0, 8).map((h) => (
          <div className="hrow" key={h.id}>
            <Avatar agent={!isYou(h.actor)} name={actorName(h.actor)} small />
            <div>
              <b>{actorName(h.actor)}</b> <EventText text={h.summary} />
              {h.note ? ` — ${h.note}` : ''}{' '}
              <span className="mono" style={{ color: 'var(--faint)', fontSize: 11 }}>
                · {formatWhen(h.at)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
