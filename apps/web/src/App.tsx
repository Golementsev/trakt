import { useCallback, useEffect, useRef, useState } from 'react';
import { PanelLeft } from 'lucide-react';
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
import { IdeaFab } from './components/IdeaFab';
import { AgentsPage } from './components/AgentsPage';
import type { View } from './components/Sidebar';

type Open = { kind: 'task'; id: string } | { kind: 'draft'; init: DraftInit; n: number } | null;

/** Черновик каждый раз новый (n — чтобы окно пересоздалось с новыми данными). */
const draft = (init: DraftInit): Open => ({ kind: 'draft', init, n: Date.now() });

export function App() {
  const projects = useProjects();
  const settings = useSettings();
  const [storedProject, setStoredProject] = useStored<string | null>('project', null);
  const [lane, setLane] = useStored<LaneMode>('lane', 'type');
  const [view, setView] = useStored<View>('view', 'board');
  // боковая панель: на широком экране сворачивается, на узком выезжает поверх
  const [sideClosed, setSideClosed] = useStored<boolean>('sideClosed', false);
  const [sideOpen, setSideOpen] = useState(false);
  const toggleSide = () => {
    if (window.matchMedia('(max-width: 900px)').matches) setSideOpen((v) => !v);
    else setSideClosed(!sideClosed);
  };

  const list = projects.data ?? [];
  const projectId = list.find((p) => p.id === storedProject)?.id ?? list[0]?.id ?? null;
  const board = useBoard(projectId);
  const events = useEvents(projectId);
  const agentsPaused = settings.data?.agentsPaused ?? false;

  const [open, setOpen] = useState<Open>(null);
  const [closeSignal, setCloseSignal] = useState(0);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const [feedOpen, setFeedOpen] = useState(false);
  const [ideaOpen, setIdeaOpen] = useState(false);

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

  const connected = useLiveUpdates((m: LiveMessage) => {
    if (m.taskId && !isYou(m.actor)) flashTask(m.taskId);
  });

  // Esc закрывает верхнее окно
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (settingsTab) setSettingsTab(null);
      else if (open) setCloseSignal((n) => n + 1);
      else if (feedOpen) setFeedOpen(false);
      else if (ideaOpen) setIdeaOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [settingsTab, open, feedOpen, ideaOpen]);

  const selectProject = (id: string) => {
    setStoredProject(id);
    setView('board');
    setSideOpen(false);
    setOpen(null);
  };
  const selectView = (v: View) => {
    setView(v);
    setSideOpen(false);
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
      <div className={`app ${sideClosed ? 'side-closed' : ''} ${sideOpen ? 'side-open' : ''}`}>
        <div className="side-scrim" onClick={() => setSideOpen(false)} />
        <Sidebar
          projects={list}
          currentId={projectId}
          view={view}
          onView={selectView}
          onSelect={selectProject}
          onCreate={createProject}
          agentsOn={!agentsPaused}
          agentTaskCount={current?.agentTaskCount ?? 0}
        />
        <main className="main">
          {view === 'agents' ? (
            <AgentsPage onToggleSide={toggleSide} />
          ) : current && b ? (
            <>
              <TopBar
                onToggleSide={toggleSide}
                name={b.project.name}
                projectKey={b.project.key}
                lane={lane}
                onLane={setLane}
                agentsOn={!agentsPaused}
                onAgentsToggle={() => void toggleAgents()}
                onFeed={() => setFeedOpen(true)}
                onSettings={() => setSettingsTab('statuses')}
                onNewTask={() => setOpen(draft({}))}
              />
              <Ticker event={events.data?.[0]} offline={!connected} />
              <Board
                board={b}
                lane={lane}
                flash={flash}
                onOpen={(id) => setOpen({ kind: 'task', id })}
                onNew={(statusId) => setOpen(draft({ statusId }))}
              />
            </>
          ) : (
            <EmptyMain
              onToggleSide={toggleSide}
              loading={projects.isLoading || (!!projectId && board.isLoading)}
              error={projects.error}
            />
          )}
        </main>
      </div>

      {open && b && (
        <TaskModal
          key={open.kind === 'task' ? open.id : `draft-${open.n}`}
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
        <Settings
          board={b}
          tab={settingsTab}
          onTab={setSettingsTab}
          onClose={() => setSettingsTab(null)}
          onOpenAgents={() => {
            setSettingsTab(null);
            selectView('agents');
          }}
        />
      )}
      {feedOpen && b && (
        <Feed projectName={b.project.name} events={events.data ?? []} onClose={() => setFeedOpen(false)} />
      )}
      {b && view === 'board' && (
        <IdeaFab
          projectId={b.project.id}
          projectName={b.project.name}
          open={ideaOpen}
          onOpenChange={setIdeaOpen}
          onToTask={(title, description) => setOpen(draft({ title, description }))}
        />
      )}
      <Toast />
    </>
  );
}

function EmptyMain({
  loading,
  error,
  onToggleSide,
}: {
  loading: boolean;
  error: Error | null;
  onToggleSide: () => void;
}) {
  return (
    <>
      <div className="top">
        <button className="iconbtn side-toggle" aria-label="Боковая панель" onClick={onToggleSide}>
          <PanelLeft className="i" />
        </button>
      </div>
      <div className="boardwrap">
        <p className="hint">
          {error
            ? `Не удалось загрузить доску: ${error.message}`
            : loading
              ? 'Загружаю доску…'
              : 'Проектов пока нет. Создайте первый слева: «+ Новый проект».'}
        </p>
      </div>
    </>
  );
}
