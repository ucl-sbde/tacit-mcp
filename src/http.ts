#!/usr/bin/env node

/**
 * Streamable HTTP transport for the Tacit MCP server.
 *
 * Usage:
 *   TACIT_API_KEY=... node dist/http.js                    # API key mode
 *   TACIT_OAUTH_ISSUER=https://... node dist/http.js       # OAuth mode
 */

import { randomUUID } from "node:crypto";
import type { Request } from "express";
import express from "express";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { createServer } from "./server.js";
import { TacitTokenVerifier, TacitOAuthProvider } from "./auth.js";

const PORT = parseInt(process.env.PORT || "3001", 10);
const HOST = process.env.HOST || "0.0.0.0";
const MCP_PATH = process.env.MCP_PATH || "/mcp";
const OAUTH_ISSUER = process.env.TACIT_OAUTH_ISSUER;
const SESSION_IDLE_TIMEOUT_MS = 30 * 60_000;
const SESSION_REAP_INTERVAL_MS = 5 * 60_000;

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  lastActivity: number;
}

const sessions = new Map<string, Session>();

function createSession(): { transport: StreamableHTTPServerTransport; server: McpServer } {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  server.connect(transport);

  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid) sessions.delete(sid);
  };

  return { transport, server };
}

function getSession(req: Request): Session | undefined {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  return sessionId ? sessions.get(sessionId) : undefined;
}

function touchSession(session: Session): void {
  session.lastActivity = Date.now();
}

// Reap idle sessions periodically
const reaper = setInterval(() => {
  const cutoff = Date.now() - SESSION_IDLE_TIMEOUT_MS;
  for (const [sid, session] of sessions) {
    if (session.lastActivity < cutoff) {
      session.transport.close();
      sessions.delete(sid);
    }
  }
}, SESSION_REAP_INTERVAL_MS);
reaper.unref();

const app = express();

app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id");
  res.header("Access-Control-Expose-Headers", "Mcp-Session-Id");
  if (_req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

if (OAUTH_ISSUER) {
  const provider = new TacitOAuthProvider();

  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: new URL(OAUTH_ISSUER),
      serviceDocumentationUrl: new URL("https://docs.betacit.com/agents/mcp-server"),
      scopesSupported: ["read"],
    }),
  );

  app.use(MCP_PATH, requireBearerAuth({ verifier: provider }));

  console.error(`OAuth 2.1 enabled (issuer: ${OAUTH_ISSUER})`);
} else {
  const verifier = new TacitTokenVerifier();
  app.use(MCP_PATH, requireBearerAuth({ verifier }));
  console.error("Bearer token auth enabled (API key mode)");
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", transport: "streamable-http", sessions: sessions.size });
});

app.post(MCP_PATH, async (req, res) => {
  let session = getSession(req);

  if (!session) {
    const { transport, server } = createSession();
    session = { transport, server, lastActivity: Date.now() };
    await transport.handleRequest(req, res);
    const sid = transport.sessionId;
    if (sid) sessions.set(sid, session);
    return;
  }

  touchSession(session);
  await session.transport.handleRequest(req, res);
});

app.get(MCP_PATH, async (req, res) => {
  const session = getSession(req);
  if (!session) {
    res.status(400).json({ error: "Missing or invalid session ID" });
    return;
  }

  touchSession(session);
  await session.transport.handleRequest(req, res);
});

app.delete(MCP_PATH, async (req, res) => {
  const session = getSession(req);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  await session.transport.handleRequest(req, res);
});

app.listen(PORT, HOST, () => {
  console.error(`Tacit MCP server (HTTP) listening on http://${HOST}:${PORT}${MCP_PATH}`);
  console.error(`Health check: http://${HOST}:${PORT}/health`);
  if (OAUTH_ISSUER) {
    console.error(`OAuth metadata: http://${HOST}:${PORT}/.well-known/oauth-authorization-server`);
  }
});
