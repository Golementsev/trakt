import type { AppSettings, UpdateAppSettingsInput } from '@trakt/shared';
import type { Ctx } from './context';
import { notify } from './events';

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
