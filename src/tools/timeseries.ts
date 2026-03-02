import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { restPost } from "../api-client.js";

interface TimeseriesResponse {
  query: { start: string; end: string; window?: string; aggregate?: string };
  series: Array<{
    timeseriesId: string;
    name: string;
    type: string;
    unit: string;
    equipment: string;
    data: Array<{ t: string; v: number | null }>;
  }>;
  errors: Record<string, string>;
}

export function registerTimeseriesTool(server: McpServer): void {
  server.registerTool(
    "tacit_timeseries",
    {
      title: "Query Time-Series Data",
      description: `Query historical or live sensor data for one or more points.

Points are identified by their timeseriesId (UUID). Use tacit_graphql first to find points and their timeseriesId values.

Args:
  - site_id (string, required): The site ID
  - point_ids (string, required): Comma-separated timeseriesId UUIDs (max 200)
  - start (string, optional): Start time, relative like "-1h", "-24h", "-7d" or ISO 8601. Default: "-1h"
  - end (string, optional): End time, "now()" or ISO 8601. Default: "now()"
  - window (string, optional): Aggregation window like "5m", "1h", "1d". Only with aggregate.
  - aggregate (string, optional): Aggregation function: mean, min, max, sum, count, first, last. Default: "mean"
  - limit (number, optional): Max records per point (1-10000). Default: 1000

Common patterns:
  - Last hour raw: start="-1h" (default)
  - Daily averages for a week: start="-7d", window="1d", aggregate="mean"
  - Last 24h at 15-min intervals: start="-24h", window="15m"

For current/live values, use tacit_graphql with the currentValue { value timestamp quality } field on Point instead of this tool.

Returns: Array of series, each with timeseriesId, name, type, unit, equipment, and data records [{t, v}].`,
      inputSchema: {
        site_id: z.string().describe("Site ID"),
        point_ids: z
          .string()
          .describe("Comma-separated timeseriesId UUIDs (from tacit_graphql Point.timeseriesId)"),
        start: z.string().optional().describe('Start time: "-1h", "-24h", "-7d", or ISO 8601'),
        end: z.string().optional().describe('End time: "now()" or ISO 8601. Default: "now()"'),
        window: z.string().optional().describe('Aggregation window: "5m", "1h", "1d"'),
        aggregate: z
          .string()
          .optional()
          .describe("Aggregation: mean, min, max, sum, count, first, last"),
        limit: z.number().optional().describe("Max records per point (1-10000)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ site_id, point_ids, start, end, window, aggregate, limit }) => {
      try {
        const ids = point_ids.split(",").map((s) => s.trim()).filter(Boolean);
        if (ids.length === 0) {
          return {
            content: [{ type: "text" as const, text: "Error: No point IDs provided." }],
            isError: true,
          };
        }

        const body: Record<string, unknown> = { timeseriesIds: ids };
        if (start) body.start = start;
        if (end) body.end = end;
        if (window) body.window = window;
        if (aggregate) body.aggregate = aggregate;
        if (limit) body.limit = limit;

        const data = await restPost<TimeseriesResponse>(
          `/api/sites/${site_id}/timeseries`,
          body,
        );

        if (!data.series.length && Object.keys(data.errors).length) {
          const errLines = Object.entries(data.errors).map(
            ([id, msg]) => `- ${id}: ${msg}`,
          );
          return {
            content: [
              {
                type: "text" as const,
                text: `No data returned. Errors:\n${errLines.join("\n")}`,
              },
            ],
          };
        }

        const lines: string[] = [];
        lines.push(`# Time-Series Data (${data.query.start} → ${data.query.end})`);
        if (data.query.window) {
          lines.push(`Aggregation: ${data.query.aggregate} every ${data.query.window}`);
        }
        lines.push("");

        for (const s of data.series) {
          const unit = s.unit ? ` (${s.unit})` : "";
          lines.push(`## ${s.name}${unit}`);
          lines.push(`Type: ${s.type} | Equipment: ${s.equipment}`);
          if (s.data.length === 0) {
            lines.push("_No data in range_");
          } else if (s.data.length <= 20) {
            for (const d of s.data) {
              const time = d.t ? new Date(d.t).toISOString() : "N/A";
              lines.push(`- ${time}: ${d.v ?? "null"}`);
            }
          } else {
            // Summarize large datasets
            const values = s.data.filter((d) => d.v != null).map((d) => d.v as number);
            const first = s.data[0];
            const last = s.data[s.data.length - 1];
            lines.push(`${s.data.length} records`);
            lines.push(
              `- First: ${first.t ? new Date(first.t).toISOString() : "N/A"} → ${first.v}`,
            );
            lines.push(
              `- Last: ${last.t ? new Date(last.t).toISOString() : "N/A"} → ${last.v}`,
            );
            if (values.length) {
              lines.push(`- Min: ${Math.min(...values)}`);
              lines.push(`- Max: ${Math.max(...values)}`);
              lines.push(
                `- Avg: ${(values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)}`,
              );
            }
          }
          lines.push("");
        }

        if (Object.keys(data.errors).length) {
          lines.push("## Errors");
          for (const [id, msg] of Object.entries(data.errors)) {
            lines.push(`- ${id}: ${msg}`);
          }
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
