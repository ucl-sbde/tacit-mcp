import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { restGet } from "../api-client.js";

interface SiteFile {
  id: string;
  site: string;
  entity_uri: string;
  category: string;
  name: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
  updated_at: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const CATEGORY_LABELS: Record<string, string> = {
  "kg-csv": "KG CSV Data",
  "model-3d": "3D Model",
  "bim-source": "BIM Source File",
  "spec-sheet": "Spec Sheet",
  maintenance: "Maintenance Document",
  other: "Other",
};

export function registerFilesTool(server: McpServer): void {
  server.registerTool(
    "tacit_list_files",
    {
      title: "List Site Files",
      description: `List documents and files associated with a site.

Returns metadata for files uploaded to a site: spec sheets, maintenance documents, BIM source files, 3D models, and knowledge graph data.

Useful for answering questions like "What documentation exists for this building?" or "Are there spec sheets for this equipment?"

Args:
  - site_id (string, required): The site ID (from tacit_list_sites)
  - category (string, optional): Filter by file type. One of: kg-csv, model-3d, bim-source, spec-sheet, maintenance, other
  - entity_uri (string, optional): Filter by associated entity URI (from GraphQL entity.uri field)

Returns: List of files with name, category, size, and upload date.`,
      inputSchema: {
        site_id: z.string().describe("Site ID from tacit_list_sites"),
        category: z
          .string()
          .optional()
          .describe(
            "Filter by category: kg-csv, model-3d, bim-source, spec-sheet, maintenance, other",
          ),
        entity_uri: z
          .string()
          .optional()
          .describe("Filter by entity URI"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ site_id, category, entity_uri }) => {
      try {
        const params = new URLSearchParams({ site_id });
        if (category) params.set("category", category);
        if (entity_uri) params.set("entity_uri", entity_uri);

        const files = await restGet<SiteFile[]>(
          `/api/files/?${params.toString()}`,
        );

        if (!files.length) {
          const filter = category ? ` in category "${category}"` : "";
          return {
            content: [
              {
                type: "text" as const,
                text: `No files found for this site${filter}.`,
              },
            ],
          };
        }

        const lines = [`# Files (${files.length})`, ""];

        // Group by category
        const grouped = new Map<string, SiteFile[]>();
        for (const f of files) {
          const group = grouped.get(f.category) || [];
          group.push(f);
          grouped.set(f.category, group);
        }

        for (const [cat, catFiles] of grouped) {
          const label = CATEGORY_LABELS[cat] || cat;
          lines.push(`## ${label}`);
          for (const f of catFiles) {
            const size = formatBytes(f.size_bytes);
            const date = new Date(f.created_at).toISOString().split("T")[0];
            lines.push(`- **${f.name}** (${size}, uploaded ${date})`);
            if (f.entity_uri) {
              lines.push(`  Entity: ${f.entity_uri}`);
            }
          }
          lines.push("");
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
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
