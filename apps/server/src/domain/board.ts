import type { Board } from '@trakt/shared';
import type { Ctx } from './context';
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
