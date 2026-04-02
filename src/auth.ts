/**
 * OAuth 2.1 provider for Tacit MCP server.
 *
 * Supports two authentication modes:
 * 1. API key (Bearer token) — existing Tacit API keys work as bearer tokens
 * 2. OAuth 2.1 — full authorization code flow delegated to Tacit's auth server
 *
 * When TACIT_OAUTH_ISSUER is set, the server runs in OAuth mode with
 * dynamic client registration, authorization code + PKCE, and token exchange.
 * Otherwise, it falls back to simple API key bearer auth.
 */

import type { Response } from "express";
import type {
  OAuthServerProvider,
  AuthorizationParams,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

const API_URL = process.env.TACIT_API_URL || "https://app.betacit.com";

// ---------------------------------------------------------------------------
// Simple bearer-token verifier (API key mode)
// ---------------------------------------------------------------------------

/**
 * Verifies bearer tokens by calling the Tacit API's identity endpoint.
 * Works with both raw API keys and OAuth access tokens issued by Tacit.
 */
export class TacitTokenVerifier implements OAuthTokenVerifier {
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const res = await fetch(`${API_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      throw new Error("Invalid or expired token");
    }

    const body = (await res.json()) as { id?: string; scopes?: string[] };

    return {
      token,
      clientId: body.id ?? "tacit-user",
      scopes: body.scopes ?? ["read"],
    };
  }
}

// ---------------------------------------------------------------------------
// In-memory OAuth client store
// ---------------------------------------------------------------------------

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
      client_secret_expires_at: 0, // never expires
    };
    this.clients.set(full.client_id, full);
    return full;
  }
}

// ---------------------------------------------------------------------------
// In-memory authorization code store
// ---------------------------------------------------------------------------

interface PendingAuth {
  client: OAuthClientInformationFull;
  codeChallenge: string;
  redirectUri: string;
  scopes: string[];
  code: string;
}

// ---------------------------------------------------------------------------
// Full OAuth 2.1 provider (delegates token exchange to Tacit)
// ---------------------------------------------------------------------------

/**
 * OAuth server provider that delegates authorization and token exchange
 * to the Tacit platform. This enables MCP clients that only support OAuth
 * (not raw API keys) to authenticate via Tacit's login flow.
 *
 * Set TACIT_OAUTH_ISSUER to enable this mode.
 */
export class TacitOAuthProvider implements OAuthServerProvider {
  private _clientsStore = new InMemoryClientsStore();
  private pendingAuths = new Map<string, PendingAuth>();

  get clientsStore(): OAuthRegisteredClientsStore {
    return this._clientsStore;
  }

  /**
   * Redirects the user to Tacit's login page for authorization.
   */
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    const code = crypto.randomUUID();

    this.pendingAuths.set(code, {
      client,
      codeChallenge: params.codeChallenge,
      redirectUri: params.redirectUri,
      scopes: params.scopes ?? ["read"],
      code,
    });

    // Build Tacit's OAuth authorize URL
    const tacitAuthUrl = new URL(`${API_URL}/oauth/authorize`);
    tacitAuthUrl.searchParams.set("client_id", client.client_id);
    tacitAuthUrl.searchParams.set("redirect_uri", params.redirectUri);
    tacitAuthUrl.searchParams.set("response_type", "code");
    tacitAuthUrl.searchParams.set("code_challenge", params.codeChallenge);
    tacitAuthUrl.searchParams.set("code_challenge_method", "S256");
    tacitAuthUrl.searchParams.set("state", params.state ?? "");
    tacitAuthUrl.searchParams.set("scope", (params.scopes ?? ["read"]).join(" "));

    // Store mapping so we can exchange the code later
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

  /**
   * Exchanges an authorization code for tokens by calling Tacit's token endpoint.
   */
  async exchangeAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<OAuthTokens> {
    const pending = this.pendingAuths.get(authorizationCode);
    if (!pending) {
      throw new Error("Unknown authorization code");
    }
    this.pendingAuths.delete(authorizationCode);

    // Exchange with Tacit's token endpoint
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

  /**
   * Refreshes an access token via Tacit's token endpoint.
   */
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

  /**
   * Verifies an access token against Tacit's API.
   */
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const verifier = new TacitTokenVerifier();
    return verifier.verifyAccessToken(token);
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
