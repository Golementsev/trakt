import type { McpClientInfo } from '@trakt/shared';

interface Entry extends McpClientInfo {
  /** clientInfo приходит в initialize — читаем его лениво у MCP-сервера сессии. */
  who: () => { name?: string; version?: string } | undefined;
}

/** Кто подключён к доске по MCP: имя клиента, когда подключился, что делал последним. */
export class McpRegistry {
  private readonly sessions = new Map<string, Entry>();

  add(id: string, who: Entry['who']) {
    const now = new Date().toISOString();
    this.sessions.set(id, {
      id,
      name: '',
      version: null,
      connectedAt: now,
      lastSeenAt: now,
      lastAction: null,
      who,
    });
  }

  seen(id: string | undefined, action?: string) {
    const s = id ? this.sessions.get(id) : undefined;
    if (!s) return;
    s.lastSeenAt = new Date().toISOString();
    if (action) s.lastAction = action;
  }

  remove(id: string) {
    this.sessions.delete(id);
  }

  /** Сначала самые активные. Сессии без активности дольше суток не показываем. */
  list(): McpClientInfo[] {
    const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
    return [...this.sessions.values()]
      .filter((s) => s.lastSeenAt > dayAgo)
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
      .map(({ who, ...s }) => {
        const info = who();
        return { ...s, name: info?.name || s.name || 'MCP-клиент', version: info?.version ?? s.version };
      });
  }
}
