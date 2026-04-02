# tacit-mcp

MCP server that connects AI assistants to [Tacit](https://betacit.com) building digital twins. Ask questions about your buildings, equipment, sensors, and zones in natural language.

Works with Claude Desktop, Claude Code, Cursor, Windsurf, and any MCP-compatible client.

## What it does

Four read-only tools:

| Tool | Purpose |
|------|---------|
| `tacit_list_sites` | List buildings your API key can access |
| `tacit_graphql` | Query the building knowledge graph (Brick-compliant) |
| `tacit_timeseries` | Fetch historical sensor data |
| `tacit_list_files` | List documents and files for a site |

The GraphQL tool includes the full schema reference, so the AI model can compose queries without needing separate documentation.

## Quick start

### Option A: npx (recommended — no install needed)

```bash
npx -y @tacit/mcp-server
```

Just point your MCP client at it (see configuration below). No cloning, no building.

### Option B: Clone and build

```bash
git clone https://github.com/ucl-sbde/tacit-mcp.git
cd tacit-mcp
npm install
npm run build
```

You'll need a Tacit API key. Get one from your dashboard at [app.betacit.com](https://app.betacit.com) under **Site Settings > API Keys**.

## Connection methods

### 1. Stdio transport (local, default)

The standard method — the MCP client launches the server as a child process. Best for individual use on your own machine.

#### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "tacit": {
      "command": "npx",
      "args": ["-y", "@tacit/mcp-server"],
      "env": {
        "TACIT_API_KEY": "your-api-key"
      }
    }
  }
}
```

#### Claude Code

Add to `.mcp.json` in your project:

```json
{
  "mcpServers": {
    "tacit": {
      "command": "npx",
      "args": ["-y", "@tacit/mcp-server"],
      "env": {
        "TACIT_API_KEY": "your-api-key"
      }
    }
  }
}
```

#### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "tacit": {
      "command": "npx",
      "args": ["-y", "@tacit/mcp-server"],
      "env": {
        "TACIT_API_KEY": "your-api-key"
      }
    }
  }
}
```

### 2. Streamable HTTP transport (remote)

Run the server as a persistent HTTP service. Best for teams, cloud deployments, and environments where users can't install Node.js locally.

```bash
# Start the HTTP server
TACIT_API_KEY=your-api-key npm run start:http

# Or with npx
TACIT_API_KEY=your-api-key npx -y @tacit/mcp-server/../tacit-mcp-http
```

The server listens on `http://0.0.0.0:3001/mcp` by default.

#### Connect from any MCP client

Point your client at the server URL with a bearer token:

```json
{
  "mcpServers": {
    "tacit": {
      "type": "streamable-http",
      "url": "https://your-host:3001/mcp",
      "headers": {
        "Authorization": "Bearer your-api-key"
      }
    }
  }
}
```

#### HTTP configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Port to listen on |
| `HOST` | `0.0.0.0` | Bind address |
| `MCP_PATH` | `/mcp` | MCP endpoint path |
| `TACIT_API_KEY` | | Required in API key mode |
| `TACIT_OAUTH_ISSUER` | | Set to enable OAuth 2.1 mode |

#### Health check

```
GET /health → { "status": "ok", "transport": "streamable-http", "sessions": 3 }
```

### 3. OAuth 2.1 (enterprise)

For production deployments where you want users to authenticate via Tacit's login flow instead of managing API keys:

```bash
TACIT_OAUTH_ISSUER=https://app.betacit.com npm run start:http
```

This enables:
- **Dynamic client registration** — MCP clients register automatically
- **Authorization code + PKCE** — users log in through Tacit's web UI
- **Token refresh** — sessions stay alive without re-authentication
- **Token revocation** — clean session termination

MCP clients that support OAuth (like Claude Desktop) will discover the auth configuration automatically via the `.well-known/oauth-authorization-server` metadata endpoint.

### 4. Docker

```bash
docker run -p 3001:3001 -e TACIT_API_KEY=your-api-key tacit/mcp-server
```

Connect using the HTTP transport config above.

## Try it

Once connected, ask your AI assistant things like:

- "List all my building sites"
- "What AHUs are in Tower West?"
- "Show me temperature sensors on AHU-001"
- "Get the last 24 hours of supply air temperature data"
- "What equipment feeds the lobby zone?"

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TACIT_API_KEY` | Yes (stdio/HTTP) | | Your Tacit API key |
| `TACIT_API_URL` | No | `https://app.betacit.com` | API base URL (for self-hosted deployments) |
| `TACIT_OAUTH_ISSUER` | No | | OAuth issuer URL (enables OAuth 2.1 mode) |
| `PORT` | No | `3001` | HTTP server port |
| `HOST` | No | `0.0.0.0` | HTTP server bind address |
| `MCP_PATH` | No | `/mcp` | HTTP MCP endpoint path |

## Development

```bash
npm run dev       # watch mode — stdio transport
npm run dev:http  # watch mode — HTTP transport
npm run build     # compile TypeScript
npm start         # run stdio transport
npm run start:http # run HTTP transport
```

## License

MIT
