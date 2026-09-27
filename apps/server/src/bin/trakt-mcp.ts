#!/usr/bin/env node
/**
 * stdio-вход MCP для харнесов, которые умеют только stdio.
 * Прозрачный прокси: сообщения JSON-RPC из stdin уходят на http://127.0.0.1:4700/mcp и обратно.
 * Логики тут нет — все правила на сервере доски, он должен быть запущен.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { isJSONRPCRequest, type JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

const url = new URL(process.env.TRAKT_MCP_URL ?? `http://127.0.0.1:${process.env.TRAKT_PORT || 4700}/mcp`);

const up = new StreamableHTTPClientTransport(url);
const down = new StdioServerTransport();

down.onmessage = (msg: JSONRPCMessage) => {
  up.send(msg).catch((e: unknown) => {
    // сервер доски недоступен — отвечаем агенту понятной ошибкой
    if (isJSONRPCRequest(msg)) {
      void down.send({
        jsonrpc: '2.0',
        id: msg.id,
        error: {
          code: -32000,
          message: `Доска Тракт не отвечает на ${url.href}. Запустите её: npm start (или npm run dev). ${e instanceof Error ? e.message : ''}`,
        },
      });
    }
  });
};

up.onmessage = (msg: JSONRPCMessage) => {
  // после initialize сообщаем версию протокола, чтобы HTTP-транспорт ставил нужный заголовок
  const result = (msg as { result?: { protocolVersion?: string } }).result;
  if (result?.protocolVersion) up.setProtocolVersion(result.protocolVersion);
  void down.send(msg);
};

up.onerror = (e) => process.stderr.write(`trakt-mcp: ${e.message}\n`);
down.onclose = () => void up.close().finally(() => process.exit(0));

await up.start();
await down.start();
