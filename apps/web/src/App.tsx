import { useState } from 'react';
import { DEFAULT_STATUSES, DEFAULT_TYPES } from '@trakt/shared';
import { Sidebar } from './components/Sidebar';
import { TopBar, type LaneMode } from './components/TopBar';
import { Ticker } from './components/Ticker';
import { Board, type BoardColumn, type BoardLaneSource } from './components/Board';

/**
 * Этап 0: оболочка без данных. Колонки и типы — стандартный набор нового проекта,
 * на этапе 1 заменяются ответом сервера (`GET /api/projects/:id/board`).
 */
const SHELL_PROJECT = { name: 'Новый проект', key: 'NEW' };
const SHELL_COLUMNS: BoardColumn[] = DEFAULT_STATUSES.map((s, i) => ({ id: `s${i}`, ...s }));
const SHELL_TYPES: BoardLaneSource[] = DEFAULT_TYPES.map((t, i) => ({
  id: `t${i}`,
  name: t.name,
  color: t.color,
}));

export function App() {
  const [lane, setLane] = useState<LaneMode>('type');
  const [agentsOn, setAgentsOn] = useState(true);

  return (
    <div className="app">
      <Sidebar
        projects={[{ id: 'shell', ...SHELL_PROJECT, taskCount: 0 }]}
        currentId="shell"
        agentsOn={agentsOn}
        agentTaskCount={0}
      />
      <main className="main">
        <TopBar
          name={SHELL_PROJECT.name}
          projectKey={SHELL_PROJECT.key}
          lane={lane}
          onLane={setLane}
          agentsOn={agentsOn}
          onAgentsToggle={() => setAgentsOn((v) => !v)}
        />
        <Ticker />
        <Board columns={SHELL_COLUMNS} types={SHELL_TYPES} lane={lane} />
      </main>
    </div>
  );
}
