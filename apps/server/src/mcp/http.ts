import { randomUUID } from 'node:crypto';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Context } from 'hono';
import type { Ctx } from '../domain';
import { createMcpServer } from './server';

/**
 * Streamable HTTP на /mcp. Сессия на клиента: так сервер помнит clientInfo.name
 * и подписывает действия агента в ленте его именем.
 */
export function mcpHandler(ctx: Ctx) {
  const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>();

  const handler = async (c: Context) => {
    const sid = c.req.header('mcp-session-id');
    if (sid) {
      const existing = sessions.get(sid);
      if (existing) return existing.handleRequest(c.req.raw);
      return c.json(
        {
          jsonrpc: '2.0',
          error: { code: -32001, message: 'Сессия не найдена — переподключитесь' },
          id: null,
        },
        404,
      );
    }

    const transport: WebStandardStreamableHTTPServerTransport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => void sessions.set(id, transport),
      onsessionclosed: (id) => void sessions.delete(id),
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    await createMcpServer(ctx).connect(transport);
    return transport.handleRequest(c.req.raw);
  };

  return Object.assign(handler, { sessions });
}
