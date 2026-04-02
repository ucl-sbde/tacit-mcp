/**
 * OAuth 2.1 provider for Tacit MCP server.
 *
 * Two auth modes:
 * 1. API key (Bearer token) — existing Tacit API keys work as bearer tokens
 * 2. OAuth 2.1 — authorization code flow delegated to Tacit's auth server
 *    (enabled when TACIT_OAUTH_ISSUER is set)
 */

import type { Response } from "express";
import type {
  OAuthServerProvider,
  AuthorizationParams,
  OAuthTokenVerifier,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { API_URL } from "./api-client.js";

const DEFAULT_SCOPES = ["read"];
const TOKEN_CACHE_TTL_MS = 60_000;
const PENDING_AUTH_TTL_MS = 10 * 60_000;
const CLEANUP_INTERVAL_MS = 60_000;

interface CachedToken {
  authInfo: AuthInfo;
  expiresAt: number;
}

export class TacitTokenVerifier implements OAuthTokenVerifier {
  private cache = new Map<string, CachedToken>();

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const cached = this.cache.get(token);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.authInfo;
    }

    const res = await fetch(`${API_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      this.cache.delete(token);
      throw new Error("Invalid or expired token");
    }

    const body = (await res.json()) as { id?: string; scopes?: string[] };

    const authInfo: AuthInfo = {
      token,
      clientId: body.id ?? "tacit-user",
      scopes: body.scopes ?? DEFAULT_SCOPES,
    };

    this.cache.set(token, { authInfo, expiresAt: Date.now() + TOKEN_CACHE_TTL_MS });
    return authInfo;
  }
}

export class InMemoryClientsStore implements OAuthRegisteredClientsStore {
  private clients = new Map<string, OAuthClientInformationFull>();

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    return this.clients.get(clientId);
  }

  registerClient(
    client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">,
  ): OAuthClientInformationFull {
    const full: OAuthClientInformationFull = {
      ...client,
      client_id: crypto.randomUUID(),
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_secret: crypto.randomUUID(),
      client_secret_expires_at: 0,
    };
    this.clients.set(full.client_id, full);
    return full;
  }
}

interface PendingAuth {
  client: OAuthClientInformationFull;
  codeChallenge: string;
  redirectUri: string;
  createdAt: number;
}

export class TacitOAuthProvider implements OAuthServerProvider {
  private _clientsStore = new InMemoryClientsStore();
  private pendingAuths = new Map<string, PendingAuth>();
  private verifier = new TacitTokenVerifier();
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor() {
    this.cleanupTimer = setInterval(() => this.evictExpiredAuths(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  private evictExpiredAuths(): void {
    const cutoff = Date.now() - PENDING_AUTH_TTL_MS;
    for (const [code, pending] of this.pendingAuths) {
      if (pending.createdAt < cutoff) this.pendingAuths.delete(code);
    }
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    return this._clientsStore;
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    const code = crypto.randomUUID();
    const scopes = params.scopes ?? DEFAULT_SCOPES;

    this.pendingAuths.set(code, {
      client,
      codeChallenge: params.codeChallenge,
      redirectUri: params.redirectUri,
      createdAt: Date.now(),
    });

    const tacitAuthUrl = new URL(`${API_URL}/oauth/authorize`);
    tacitAuthUrl.searchParams.set("client_id", client.client_id);
    tacitAuthUrl.searchParams.set("redirect_uri", params.redirectUri);
    tacitAuthUrl.searchParams.set("response_type", "code");
    tacitAuthUrl.searchParams.set("code_challenge", params.codeChallenge);
    tacitAuthUrl.searchParams.set("code_challenge_method", "S256");
    tacitAuthUrl.searchParams.set("state", params.state ?? "");
    tacitAuthUrl.searchParams.set("scope", scopes.join(" "));
    tacitAuthUrl.searchParams.set("mcp_code", code);

    res.redirect(tacitAuthUrl.toString());
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const pending = this.pendingAuths.get(authorizationCode);
    if (!pending) {
      throw new Error("Unknown authorization code");
    }
    return pending.codeChallenge;
  }

  async exchangeAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<OAuthTokens> {
    const pending = this.pendingAuths.get(authorizationCode);
    if (!pending) {
      throw new Error("Unknown authorization code");
    }
    this.pendingAuths.delete(authorizationCode);

    const res = await fetch(`${API_URL}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code: authorizationCode,
        redirect_uri: pending.redirectUri,
        client_id: pending.client.client_id,
      }),
    });

    if (!res.ok) {
      throw new Error(`Token exchange failed: ${res.status}`);
    }

    return (await res.json()) as OAuthTokens;
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
  ): Promise<OAuthTokens> {
    const res = await fetch(`${API_URL}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: client.client_id,
        scope: scopes?.join(" "),
      }),
    });

    if (!res.ok) {
      throw new Error(`Token refresh failed: ${res.status}`);
    }

    return (await res.json()) as OAuthTokens;
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    return this.verifier.verifyAccessToken(token);
  }

  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    await fetch(`${API_URL}/oauth/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: request.token }),
    });
  }
}
