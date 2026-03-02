#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  if (!process.env.TACIT_API_KEY) {
    console.error(
      "ERROR: TACIT_API_KEY environment variable is required.\n" +
        "Get an API key from your Tacit dashboard: Settings > API Keys",
    );
    process.exit(1);
  }

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Tacit MCP server running via stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
