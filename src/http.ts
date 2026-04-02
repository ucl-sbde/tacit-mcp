#!/usr/bin/env node

/**
 * Streamable HTTP transport for the Tacit MCP server.
 *
 * Enables remote MCP connections over HTTP, supporting:
 * - Streamable HTTP (MCP spec's latest transport standard)
 * - Bearer token authentication (API keys or OAuth tokens)
 * - Optional OAuth 2.1 authorization server (set TACIT_OAUTH_ISSUER)
 * - Session management with automatic cleanup
 * - CORS for browser-based MCP clients
 *
 * Usage:
 *   TACIT_API_KEY=... node dist/http.js                    # API key mode
 *   TACIT_OAUTH_ISSUER=https://... node dist/http.js       # OAuth mode
 */

import { randomUUID } from "node:crypto";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { createServer } from "./server.js";
import { TacitTokenVerifier, TacitOAuthProvider } from "./auth.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || "3001", 10);
const HOST = process.env.HOST || "0.0.0.0";
const MCP_PATH = process.env.MCP_PATH || "/mcp";
const OAUTH_ISSUER = process.env.TACIT_OAUTH_ISSUER;

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer }>();

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

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();

// CORS for browser-based clients
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

// ---------------------------------------------------------------------------
// Auth setup — OAuth 2.1 or simple bearer token
// ---------------------------------------------------------------------------

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

  app.use(
    MCP_PATH,
    requireBearerAuth({ verifier: provider }),
  );

  console.error(`OAuth 2.1 enabled (issuer: ${OAUTH_ISSUER})`);
} else {
  // Simple bearer token auth — validates API key against Tacit
  const verifier = new TacitTokenVerifier();

  app.use(MCP_PATH, requireBearerAuth({ verifier }));

  console.error("Bearer token auth enabled (API key mode)");
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

app.get("/health", (_req, res) => {
  res.json({ status: "ok", transport: "streamable-http", sessions: sessions.size });
});

// ---------------------------------------------------------------------------
// MCP endpoint — Streamable HTTP
// ---------------------------------------------------------------------------

app.post(MCP_PATH, async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  let entry = sessionId ? sessions.get(sessionId) : undefined;

  if (!entry) {
    // New session (initialization request)
    entry = createSession();
    const sid = entry.transport.sessionId;
    if (sid) sessions.set(sid, entry);
  }

  await entry.transport.handleRequest(req, res);
});

// GET for SSE stream (long-lived server-to-client channel)
app.get(MCP_PATH, async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const entry = sessionId ? sessions.get(sessionId) : undefined;

  if (!entry) {
    res.status(400).json({ error: "Missing or invalid session ID" });
    return;
  }

  await entry.transport.handleRequest(req, res);
});

// DELETE to terminate session
app.delete(MCP_PATH, async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const entry = sessionId ? sessions.get(sessionId) : undefined;

  if (!entry) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  await entry.transport.handleRequest(req, res);
  sessions.delete(sessionId!);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, HOST, () => {
  console.error(`Tacit MCP server (HTTP) listening on http://${HOST}:${PORT}${MCP_PATH}`);
  console.error(`Health check: http://${HOST}:${PORT}/health`);
  if (OAUTH_ISSUER) {
    console.error(`OAuth metadata: http://${HOST}:${PORT}/.well-known/oauth-authorization-server`);
  }
});
