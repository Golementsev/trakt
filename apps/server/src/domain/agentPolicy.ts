import { bool, type Actor, type Ctx } from './context';
import { getAgentSettings } from './projects';
import { getAppSettings } from './settings';
import { getStatusRow, listStatuses } from './statuses';
import type { TaskRow } from './tasks';

/** Права агента на доске. Проверяются в домене — одинаково для MCP и раннера. */

export const DEFAULT_CLAIM_MINUTES = 30;

/** Кто держит задачу прямо сейчас (истёкший лиз не считается). */
export function activeClaim(ctx: Ctx, t: Pick<TaskRow, 'claimed_by' | 'claim_until'>): string | null {
  return t.claimed_by && t.claim_until && t.claim_until > ctx.now() ? t.claimed_by : null;
}

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

/** Почему агент не может работать с задачей (или null — может). */
export function agentWorkProblem(ctx: Ctx, t: TaskRow, agent: Actor, key: string): string | null {
  const holder = activeClaim(ctx, t);
  if (holder && holder !== agent)
    return `${key} сейчас держит «${holder}» до ${hhmm(t.claim_until!)}. Возьмите другую задачу.`;
  if (!bool(t.agent_owned) && holder !== agent)
    return `${key} не отдана агенту. Сначала возьмите её: claim_task("${key}").`;
  return null;
}

/** Почему агент не может перевести задачу в статус toStatusId (или null — может). */
export function agentMoveProblem(
  ctx: Ctx,
  t: TaskRow,
  toStatusId: string,
  agent: Actor,
  key: string,
): string | null {
  return agentMoveRuleProblem(ctx, t, toStatusId) ?? agentWorkProblem(ctx, t, agent, key);
}

/** Правила переходов для агента без учёта того, кто держит задачу: пауза, canMove, maxStatus. */
export function agentMoveRuleProblem(ctx: Ctx, t: TaskRow, toStatusId: string): string | null {
  if (getAppSettings(ctx).agentsPaused)
    return 'Человек поставил агентов на паузу («Агент двигает задачи» выключен). Двигать задачи сейчас нельзя — напишите комментарий через add_comment.';
  const settings = getAgentSettings(ctx, t.project_id);
  if (!settings.canMove)
    return 'В настройках проекта агенту запрещено двигать задачи. Напишите человеку через add_comment, что задача готова.';
  if (settings.maxStatusId) {
    const statuses = listStatuses(ctx, t.project_id);
    const max = statuses.findIndex((s) => s.id === settings.maxStatusId);
    const to = statuses.findIndex((s) => s.id === toStatusId);
    if (max >= 0 && to > max) {
      const maxName = statuses[max]!.name;
      return `Агент двигает задачи не дальше «${maxName}». В «${getStatusRow(ctx, toStatusId).name}» переводит человек.`;
    }
  }
  return null;
}
