import { Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Board, FieldKind, StatusCategory } from '@trakt/shared';
import { api } from '../api/client';
import { refreshProject } from '../api/queries';
import { plural } from '../lib/plural';
import { run } from '../lib/toast';
import { AgentLaunch } from './AgentLaunch';
import { Editable } from './Editable';

export type SettingsTab = 'statuses' | 'types' | 'tpl' | 'wf' | 'agent';

const TABS: Array<[SettingsTab, string]> = [
  ['statuses', 'Статусы'],
  ['types', 'Типы задач'],
  ['tpl', 'Шаблон задачи'],
  ['wf', 'Воркфлоу'],
  ['agent', 'Агент'],
];

const CATEGORIES: Array<[StatusCategory, string]> = [
  ['todo', 'К выполнению'],
  ['doing', 'В процессе'],
  ['done', 'Готово'],
];

const KINDS: Array<[FieldKind, string]> = [
  ['text', 'Текст'],
  ['number', 'Число'],
  ['date', 'Дата'],
  ['checkbox', 'Чекбокс'],
];

interface Props {
  board: Board;
  tab: SettingsTab;
  onTab: (tab: SettingsTab) => void;
  onClose: () => void;
  /** Перейти на страницу «Агенты» (источники агентов — там). */
  onOpenAgents: () => void;
  /** Проект удалён — закрыть окно и перейти к другому. */
  onDeleted: () => void;
}

export function Settings({ board, tab, onTab, onClose, onOpenAgents, onDeleted }: Props) {
  const pid = board.project.id;
  const [tplType, setTplType] = useState<string | null>(null);
  const typeForTpl = board.types.find((t) => t.id === tplType) ?? board.types[0];
  const [confirmDelete, setConfirmDelete] = useState(false);
  const taskCount = board.tasks.length;

  const deleteProject = async () => {
    if (!(await run(api.deleteProject(pid)))) return;
    refreshProject(null);
    onDeleted();
  };

  /** Выполнить изменение и перечитать доску. */
  const act = async (p: Promise<unknown>) => {
    await run(p);
    refreshProject(pid);
  };

  let content;
  if (tab === 'statuses') content = <StatusesTab board={board} act={act} />;
  else if (tab === 'types')
    content = (
      <TypesTab
        board={board}
        act={act}
        onTemplate={(id) => {
          setTplType(id);
          onTab('tpl');
        }}
      />
    );
  else if (tab === 'tpl')
    content = typeForTpl && (
      <TemplateTab board={board} typeId={typeForTpl.id} onType={setTplType} act={act} />
    );
  else if (tab === 'wf') content = <WorkflowTab board={board} act={act} />;
  else content = <AgentTab board={board} act={act} onOpenAgents={onOpenAgents} />;

  return (
    <div className="modal">
      <div className="scrim" onClick={onClose} />
      <div className="mbox" role="dialog" aria-label="Настройки проекта">
        <div className="mhead">
          <h2>Настройки · {board.project.name}</h2>
          <span className="spacer" />
          {confirmDelete ? (
            <>
              <span className="hint">
                Удалить проект
                {taskCount ? ` и ${taskCount} ${plural(taskCount, 'задачу', 'задачи', 'задач')}` : ''}?
              </span>
              <button className="btn danger sm" onClick={() => void deleteProject()}>
                Удалить
              </button>
              <button className="btn sm" onClick={() => setConfirmDelete(false)}>
                Отмена
              </button>
            </>
          ) : (
            <>
              <button className="btn quiet sm" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="i sm" /> Удалить проект
              </button>
              <button className="btn pri sm" onClick={onClose}>
                Готово
              </button>
            </>
          )}
        </div>
        <div className="mwrap">
          <nav className="mtabs">
            {TABS.map(([k, n]) => (
              <button key={k} className={k === tab ? 'on' : ''} onClick={() => onTab(k)}>
                {n}
              </button>
            ))}
          </nav>
          <div className="mcontent">{content}</div>
        </div>
      </div>
    </div>
  );
}

type Act = (p: Promise<unknown>) => Promise<void>;

/** Цвет: живой предпросмотр, сохранение с задержкой (пипетка шлёт десятки событий). */
function ColorInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    // цвет поменялся на сервере (другая вкладка) — показываем новый
    setPrev(value);
    setV(value);
  }
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <input
      type="color"
      aria-label="Цвет"
      value={v}
      onChange={(e) => {
        const next = e.target.value;
        setV(next);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => onCommit(next), 300);
      }}
    />
  );
}

function StatusesTab({ board, act }: { board: Board; act: Act }) {
  const { statuses } = board;
  const [focusNew, setFocusNew] = useState<string | null>(null);
  return (
    <>
      <p className="hint">
        Колонки доски слева направо. Порядок меняется стрелками здесь или перетаскиванием заголовка колонки на
        доске. Категория подсказывает агенту, что значит статус: «В процессе» — можно брать в работу, «Готово»
        — задача закрыта.
      </p>
      <div className="rows">
        {statuses.map((s, i) => (
          <div className="erow" key={s.id}>
            <span className="grip">{i + 1}</span>
            <ColorInput value={s.color} onCommit={(color) => void act(api.updateStatus(s.id, { color }))} />
            <Editable
              className="in"
              value={s.name}
              autoFocus={s.id === focusNew}
              onCommit={(name) => name.trim() && void act(api.updateStatus(s.id, { name }))}
            />
            <select
              className="in narrow"
              value={s.category}
              onChange={(e) =>
                void act(api.updateStatus(s.id, { category: e.target.value as StatusCategory }))
              }
            >
              {CATEGORIES.map(([k, n]) => (
                <option key={k} value={k}>
                  {n}
                </option>
              ))}
            </select>
            <button
              className="iconbtn"
              title="Раньше"
              onClick={() => i > 0 && void act(api.moveStatus(s.id, i - 1))}
            >
              ↑
            </button>
            <button
              className="iconbtn"
              title="Позже"
              onClick={() => i < statuses.length - 1 && void act(api.moveStatus(s.id, i + 1))}
            >
              ↓
            </button>
            <button className="iconbtn del" title="Удалить" onClick={() => void act(api.deleteStatus(s.id))}>
              <Trash2 className="i sm" />
            </button>
          </div>
        ))}
      </div>
      <div>
        <button
          className="btn"
          onClick={async () => {
            const s = await run(api.createStatus(board.project.id, { name: 'Новый статус' }));
            if (s) setFocusNew(s.id);
            refreshProject(board.project.id);
          }}
        >
          + Статус
        </button>
      </div>
    </>
  );
}

function TypesTab({ board, act, onTemplate }: { board: Board; act: Act; onTemplate: (id: string) => void }) {
  return (
    <>
      <p className="hint">
        Типы задач этого проекта. У каждого типа свой шаблон полей. Тип выбирается один раз, при создании
        задачи.
      </p>
      <div className="rows">
        {board.types.map((t) => (
          <div className="erow" key={t.id}>
            <ColorInput value={t.color} onCommit={(color) => void act(api.updateType(t.id, { color }))} />
            <Editable
              className="in"
              value={t.name}
              onCommit={(name) => name.trim() && void act(api.updateType(t.id, { name }))}
            />
            <span className="hint">
              {t.taskCount} задач · {t.fields.length} полей
            </span>
            <button className="btn sm" onClick={() => onTemplate(t.id)}>
              Шаблон
            </button>
            <button className="iconbtn del" title="Удалить" onClick={() => void act(api.deleteType(t.id))}>
              <Trash2 className="i sm" />
            </button>
          </div>
        ))}
      </div>
      <div>
        <button className="btn" onClick={() => void act(api.createType(board.project.id))}>
          + Тип задачи
        </button>
      </div>
    </>
  );
}

function TemplateTab({
  board,
  typeId,
  onType,
  act,
}: {
  board: Board;
  typeId: string;
  onType: (id: string) => void;
  act: Act;
}) {
  const type = board.types.find((t) => t.id === typeId)!;
  return (
    <>
      <div className="erow">
        <span className="hint">Шаблон для типа</span>
        <select className="in narrow" value={typeId} onChange={(e) => onType(e.target.value)}>
          {board.types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <p className="hint">
        Название, описание и сабтаски есть у любой задачи. Здесь поля сверху. Текстовые поля показываются под
        описанием. «Видно агенту» — поле уходит агенту в контекст.
      </p>
      <div className="rows">
        {type.fields.length ? (
          type.fields.map((f) => (
            <div className="erow" key={f.id}>
              <Editable
                className="in"
                value={f.name}
                onCommit={(name) => name.trim() && void act(api.updateField(f.id, { name }))}
              />
              <select
                className="in narrow"
                value={f.kind}
                onChange={(e) => void act(api.updateField(f.id, { kind: e.target.value as FieldKind }))}
              >
                {KINDS.map(([k, n]) => (
                  <option key={k} value={k}>
                    {n}
                  </option>
                ))}
              </select>
              <label className="tog">
                <input
                  type="checkbox"
                  checked={f.required}
                  onChange={(e) => void act(api.updateField(f.id, { required: e.target.checked }))}
                />
                обязательное
              </label>
              <label className="tog">
                <input
                  type="checkbox"
                  checked={f.visibleToAgent}
                  onChange={(e) => void act(api.updateField(f.id, { visibleToAgent: e.target.checked }))}
                />
                видно агенту
              </label>
              <button
                className="iconbtn del"
                title="Удалить поле"
                onClick={() => void act(api.deleteField(f.id))}
              >
                <Trash2 className="i sm" />
              </button>
            </div>
          ))
        ) : (
          <span className="hint">Дополнительных полей нет</span>
        )}
      </div>
      <div>
        <button className="btn" onClick={() => void act(api.createField(typeId))}>
          + Поле
        </button>
      </div>
      <div className="sect">
        <h3>Когда агент двигает задачу дальше</h3>
        <Editable
          multiline
          className="in"
          rows={3}
          value={board.project.dod}
          onCommit={(dod) => void act(api.updateProject(board.project.id, { dod }))}
        />
      </div>
    </>
  );
}

function WorkflowTab({ board, act }: { board: Board; act: Act }) {
  const { statuses, transitions } = board;
  const has = (a: string, b: string) => transitions.some(([f, t]) => f === a && t === b);
  const toggle = (a: string, b: string, on: boolean) => {
    const next = on
      ? [...transitions, [a, b] as [string, string]]
      : transitions.filter(([f, t]) => !(f === a && t === b));
    void act(api.setWorkflow(board.project.id, next));
  };
  return (
    <>
      <p className="hint">
        Разрешённые переходы. Строка — откуда, столбец — куда. Правила одинаковы для вас и для агента.
      </p>
      <div className="matrix">
        <table>
          <tbody>
            <tr>
              <th>Из \ В</th>
              {statuses.map((s) => (
                <th key={s.id}>{s.name}</th>
              ))}
            </tr>
            {statuses.map((a) => (
              <tr key={a.id}>
                <td>
                  <b>{a.name}</b>
                </td>
                {statuses.map((b) => (
                  <td key={b.id}>
                    {a.id === b.id ? (
                      <span style={{ color: 'var(--faint)' }}>·</span>
                    ) : (
                      <input
                        type="checkbox"
                        aria-label={`${a.name} → ${b.name}`}
                        checked={has(a.id, b.id)}
                        onChange={(e) => toggle(a.id, b.id, e.target.checked)}
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AgentTab({ board, act, onOpenAgents }: { board: Board; act: Act; onOpenAgents: () => void }) {
  const g = board.agent;
  const pid = board.project.id;
  const second = board.statuses[1]?.name ?? '';
  return (
    <>
      <p className="hint">
        Агент берёт задачу, которую вы ему отдали, делает её и двигает по доске. Он двигает задачу, только
        если переход разрешён воркфлоу и выполнено условие готовности.
      </p>
      <div className="rows">
        <label className="tog" style={{ fontSize: 13 }}>
          <input
            type="checkbox"
            checked={g.canMove}
            onChange={(e) => void act(api.updateAgentSettings(pid, { canMove: e.target.checked }))}
          />
          Двигает задачи сам
        </label>
        <label className="tog" style={{ fontSize: 13 }}>
          Не дальше статуса{' '}
          <select
            className="in"
            value={g.maxStatusId ?? ''}
            onChange={(e) => void act(api.updateAgentSettings(pid, { maxStatusId: e.target.value || null }))}
          >
            {board.statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="tog" style={{ fontSize: 13 }}>
          <input
            type="checkbox"
            checked={g.autoTake}
            onChange={(e) => void act(api.updateAgentSettings(pid, { autoTake: e.target.checked }))}
          />
          Сам берёт задачи из «{second}»
        </label>
        <label className="tog" style={{ fontSize: 13 }}>
          <input
            type="checkbox"
            checked={g.canCreate}
            onChange={(e) => void act(api.updateAgentSettings(pid, { canCreate: e.target.checked }))}
          />
          Может создавать задачи
        </label>
      </div>
      <AgentLaunch board={board} act={act} onOpenAgents={onOpenAgents} />
    </>
  );
}
