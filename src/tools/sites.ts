import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { restGet } from "../api-client.js";

interface Site {
  id: string;
  name: string;
  organization: string;
  address: string;
  city: string;
  country: string;
  country_code: string;
  latitude: string;
  longitude: string;
  timezone: string;
}

export function registerSiteTools(server: McpServer): void {
  server.registerTool(
    "tacit_list_sites",
    {
      title: "List Sites",
      description: `List all building sites the current API key has access to.

Each site represents a physical location (building, campus, warehouse) managed in Tacit.
Sites are the top-level container. You need a site ID to query buildings, equipment, points, zones, and systems.

Returns: Array of sites with id, name, address, city, country, timezone.

Use this tool first to discover available sites before querying building data.`,
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const sites = await restGet<Site[]>("/api/sites/");
        if (!sites.length) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No sites found. Your API key may not have access to any sites.",
              },
            ],
          };
        }
        const lines = [`# Sites (${sites.length})`, ""];
        for (const s of sites) {
          lines.push(`## ${s.name}`);
          lines.push(`- **ID**: \`${s.id}\``);
          lines.push(`- **Address**: ${s.address || "N/A"}`);
          lines.push(
            `- **Location**: ${[s.city, s.country].filter(Boolean).join(", ") || "N/A"}`,
          );
          lines.push(`- **Timezone**: ${s.timezone}`);
          lines.push("");
        }
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
