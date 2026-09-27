import type { AppSettings, Board, UpdateAppSettingsInput } from '@trakt/shared';
import type { Ctx } from './context';
import { notify } from './events';
import { getAgentSettings, getProject } from './projects';
import { listStatuses } from './statuses';
import { listTypes } from './taskTypes';
import { listTaskCards } from './tasks';
import { listTransitions } from './workflow';

/** Всё, что нужно для отрисовки доски проекта, одним ответом. */
export function getBoard(ctx: Ctx, projectId: string): Board {
  return {
    project: getProject(ctx, projectId),
    statuses: listStatuses(ctx, projectId),
    types: listTypes(ctx, projectId),
    transitions: listTransitions(ctx, projectId),
    agent: getAgentSettings(ctx, projectId),
    tasks: listTaskCards(ctx, projectId),
  };
}

/** Глобальные настройки доски. agentsPaused — тумблер «Агент двигает задачи» выключен. */
export function getAppSettings(ctx: Ctx): AppSettings {
  const r = ctx.db.get<{ value: string }>("SELECT value FROM app_settings WHERE key = 'agentsPaused'");
  return { agentsPaused: r?.value === 'true' };
}

export function updateAppSettings(ctx: Ctx, input: UpdateAppSettingsInput): AppSettings {
  if (input.agentsPaused !== undefined) {
    ctx.db.run(
      "INSERT INTO app_settings (key, value) VALUES ('agentsPaused', ?) ON CONFLICT DO UPDATE SET value = excluded.value",
      String(input.agentsPaused),
    );
  }
  notify(ctx, { projectId: null, actor: 'you', kind: 'settings.updated' });
  return getAppSettings(ctx);
}
