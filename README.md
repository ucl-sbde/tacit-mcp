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

```bash
git clone https://github.com/ucl-sbde/tacit-mcp.git
cd tacit-mcp
npm install
npm run build
```

You'll need a Tacit API key. Get one from your dashboard at [app.betacit.com](https://app.betacit.com) under **Site Settings > API Keys**.

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "tacit": {
      "command": "node",
      "args": ["/path/to/tacit-mcp/dist/index.js"],
      "env": {
        "TACIT_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Claude Code

Add to `.mcp.json` in your project:

```json
{
  "mcpServers": {
    "tacit": {
      "command": "node",
      "args": ["/path/to/tacit-mcp/dist/index.js"],
      "env": {
        "TACIT_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "tacit": {
      "command": "node",
      "args": ["/path/to/tacit-mcp/dist/index.js"],
      "env": {
        "TACIT_API_KEY": "your-api-key"
      }
    }
  }
}
```

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
| `TACIT_API_KEY` | Yes | | Your Tacit API key |
| `TACIT_API_URL` | No | `https://api.tacit.dev` | API base URL (for self-hosted deployments) |

## Development

```bash
npm run dev     # watch mode with tsx
npm run build   # compile TypeScript
npm start       # run compiled output
```

## License

MIT
