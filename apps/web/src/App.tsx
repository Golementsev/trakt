import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveMessage } from '@trakt/shared';
import { useBoard, useEvents, useProjects, useSettings, refreshProject } from './api/queries';
import { useLiveUpdates } from './api/live';
import { api } from './api/client';
import { isYou } from './lib/format';
import { useStored } from './lib/storage';
import { Toast, run, toast } from './lib/toast';
import { Sidebar } from './components/Sidebar';
import { TopBar, type LaneMode } from './components/TopBar';
import { Ticker } from './components/Ticker';
import { Board } from './components/Board';
import { TaskModal, type DraftInit } from './components/TaskModal';
import { Settings, type SettingsTab } from './components/Settings';
import { Feed } from './components/Feed';

type Open = { kind: 'task'; id: string } | { kind: 'draft'; init: DraftInit } | null;

export function App() {
  const projects = useProjects();
  const settings = useSettings();
  const [storedProject, setStoredProject] = useStored<string | null>('project', null);
  const [lane, setLane] = useStored<LaneMode>('lane', 'type');

  const list = projects.data ?? [];
  const projectId = list.find((p) => p.id === storedProject)?.id ?? list[0]?.id ?? null;
  const board = useBoard(projectId);
  const events = useEvents(projectId);
  const agentsPaused = settings.data?.agentsPaused ?? false;

  const [open, setOpen] = useState<Open>(null);
  const [closeSignal, setCloseSignal] = useState(0);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const [feedOpen, setFeedOpen] = useState(false);

  // карточки, которые недавно поменял агент или только что создали, мигают
  const [flash, setFlash] = useState<ReadonlySet<string>>(new Set());
  const flashTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const flashTask = useCallback((id: string) => {
    setFlash((s) => new Set(s).add(id));
    clearTimeout(flashTimers.current.get(id));
    flashTimers.current.set(
      id,
      setTimeout(() => {
        setFlash((s) => {
          const n = new Set(s);
          n.delete(id);
          return n;
        });
      }, 1400),
    );
  }, []);

  useLiveUpdates((m: LiveMessage) => {
    if (m.taskId && !isYou(m.actor)) flashTask(m.taskId);
  });

  // Esc закрывает верхнее окно
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (settingsTab) setSettingsTab(null);
      else if (open) setCloseSignal((n) => n + 1);
      else if (feedOpen) setFeedOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [settingsTab, open, feedOpen]);

  const selectProject = (id: string) => {
    setStoredProject(id);
    setOpen(null);
  };

  const createProject = async (name: string) => {
    const p = await run(api.createProject(name));
    if (!p) return;
    refreshProject(p.id);
    selectProject(p.id);
    toast('Проект создан');
  };

  const toggleAgents = async () => {
    const res = await run(api.updateSettings({ agentsPaused: !agentsPaused }));
    if (!res) return;
    refreshProject(null);
    toast(
      res.agentsPaused
        ? 'Агент на паузе: доска меняется только вами'
        : 'Агент снова двигает задачи по готовности',
    );
  };

  const current = list.find((p) => p.id === projectId);
  const b = board.data;

  return (
    <>
      <div className="app">
        <Sidebar
          projects={list}
          currentId={projectId}
          onSelect={selectProject}
          onCreate={createProject}
          agentsOn={!agentsPaused}
          agentTaskCount={current?.agentTaskCount ?? 0}
        />
        <main className="main">
          {current && b ? (
            <>
              <TopBar
                projects={list}
                currentId={current.id}
                onSelect={selectProject}
                name={b.project.name}
                projectKey={b.project.key}
                lane={lane}
                onLane={setLane}
                agentsOn={!agentsPaused}
                onAgentsToggle={() => void toggleAgents()}
                onFeed={() => setFeedOpen(true)}
                onSettings={() => setSettingsTab('statuses')}
                onNewTask={() => setOpen({ kind: 'draft', init: {} })}
              />
              <Ticker event={events.data?.[0]} />
              <Board
                board={b}
                lane={lane}
                flash={flash}
                onOpen={(id) => setOpen({ kind: 'task', id })}
                onNew={(statusId) => setOpen({ kind: 'draft', init: { statusId } })}
              />
            </>
          ) : (
            <EmptyMain
              loading={projects.isLoading || (!!projectId && board.isLoading)}
              error={projects.error}
            />
          )}
        </main>
      </div>

      {open && b && (
        <TaskModal
          key={open.kind === 'task' ? open.id : 'draft'}
          board={b}
          taskId={open.kind === 'task' ? open.id : null}
          draft={open.kind === 'draft' ? open.init : null}
          closeSignal={closeSignal}
          onClose={() => setOpen(null)}
          onCreated={(id) => {
            setOpen(null);
            flashTask(id);
          }}
        />
      )}
      {settingsTab && b && (
        <Settings board={b} tab={settingsTab} onTab={setSettingsTab} onClose={() => setSettingsTab(null)} />
      )}
      {feedOpen && b && (
        <Feed projectName={b.project.name} events={events.data ?? []} onClose={() => setFeedOpen(false)} />
      )}
      <Toast />
    </>
  );
}

function EmptyMain({ loading, error }: { loading: boolean; error: Error | null }) {
  return (
    <div className="boardwrap">
      <p className="hint">
        {error
          ? `Не удалось загрузить доску: ${error.message}`
          : loading
            ? 'Загружаю доску…'
            : 'Проектов пока нет. Создайте первый слева: «+ Новый проект».'}
      </p>
    </div>
  );
}
