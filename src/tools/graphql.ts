import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { graphql } from "../api-client.js";

const MAX_RESPONSE_CHARS = 50_000; // ~50KB, ~12K tokens

const SCHEMA_REFERENCE = `
## Tacit GraphQL Schema - Brick-compliant Building API

### Root Queries

All root queries require siteId (get from tacit_list_sites).

  building(siteId!, id, name, nameMatch) → [Building]
  equipment(siteId!, id, name, nameMatch, locationId, locationName, systemId, is, hasProperty, propertyValue) → [Equipment]
  point(siteId!, id, name, nameMatch, equipmentId, locationId, locationName, zoneId, systemId, is, equipmentIs, hasProperty, propertyValue) → [Point]
  zone(siteId!, id, name, nameMatch, locationId, is, hasProperty, propertyValue) → [Zone]
  system(siteId!, name, nameMatch, is, hasProperty, propertyValue) → [System]
  location(siteId!, locationId!) → Location
  entityByIfcId(siteId!, ifcId!) → KgEntity (union: Building | Location | Zone | System | Equipment)

### Types and Fields

Building {
  uri, id, name, type, ifcId, properties { name value unit }
  locations(name, nameMatch, is, recursive) → [Location]
  zones(name, nameMatch, is, recursive) → [Zone]
  systems(name, nameMatch, is, recursive) → [System]
  equipment(name, nameMatch, is, recursive) → [Equipment]
  points(name, nameMatch, is, recursive) → [Point]
}

Equipment {
  uri, id, name, type, typeHierarchy, ifcId, properties { name value unit }
  points(name, nameMatch, is) → [Point]           # sensors/actuators on this equipment
  parts(name, nameMatch, is) → [Equipment]        # sub-components
  partOf → Equipment                   # parent equipment
  feeds(name, nameMatch, is) → [Equipment]        # what this equipment feeds
  fedBy(name, nameMatch, is) → [Equipment]        # what feeds this equipment
  upstream(maxDepth, medium, is) → [Equipment]   # full upstream chain
  downstream(maxDepth, medium, is) → [Equipment] # full downstream chain
  location → Location
  systems → [System]
}

Point {
  uri, id, name, type, typeHierarchy, unit, equipmentId, timeseriesId
  currentValue { value timestamp quality }  # latest live reading (null if no data)
  properties { name value unit }
  equipment → Equipment
  location → Location
}

Zone {
  uri, id, name, type, typeHierarchy, ifcId, properties { name value unit }
  points(name, nameMatch, is) → [Point]
  fedBy(name, nameMatch, is) → [Equipment]        # equipment feeding this zone
  upstream(maxDepth, medium, is) → [Equipment]
  locations → [Location]
}

System {
  uri, id, name, type, ifcId, properties { name value unit }
  equipment(name, nameMatch, is, recursive) → [Equipment]
  points(name, nameMatch, is, recursive) → [Point]
}

Location {
  uri, id, name, type, ifcId, properties { name value unit }
  locations(name, nameMatch, is, recursive) → [Location]  # child locations
  parent → Location
  equipment(name, nameMatch, is, recursive) → [Equipment]
  points(name, nameMatch, is, recursive) → [Point]
  zones → [Zone]
}

### Enums

NameMatch: CONTAINS | EXACT (default: CONTAINS)

### Filter Parameter Guide

- "is" filters by Brick class: "AHU", "VAV", "FCU", "Temperature_Sensor", "HVAC_Zone", etc.
- "recursive: true" traverses the full hierarchy (e.g. all equipment in a building, not just direct children)
- "nameMatch: EXACT" for exact name match, CONTAINS for partial
- "upstream/downstream" traces the feeds/fedBy supply chain (use maxDepth to limit)
- "medium" on upstream/downstream filters by medium type (e.g. "HOT_WATER", "CHILLED_WATER", "AIR")
- "hasProperty" + "propertyValue" filter entities by custom properties
- "equipmentIs" on points filters by the Brick class of the parent equipment

### Example Queries

# List AHUs with their sensor points
{ equipment(siteId: "x", is: "AHU") { name type points { name type unit timeseriesId } } }

# Trace what feeds a zone
{ zone(siteId: "x", name: "Atrium") { name upstream(maxDepth: 3) { name type } } }

# Building floor hierarchy with equipment
{ building(siteId: "x") { name locations(recursive: true) { name type equipment { name type } } } }

# Equipment detail with parts and supply chain
{ equipment(siteId: "x", name: "AHU-001") { name type parts { name type } feeds { name type } fedBy { name type } points { name type unit timeseriesId } } }

# All temperature sensors with current values
{ point(siteId: "x", is: "Temperature_Sensor") { name unit timeseriesId currentValue { value timestamp } equipment { name type } location { name } } }

# Points on VAVs in a specific location
{ point(siteId: "x", locationName: "Tower West", equipmentIs: "VAV") { name type unit timeseriesId equipment { name } } }

# Look up an entity by its IFC Global ID
{ entityByIfcId(siteId: "x", ifcId: "3Zu5Bv0LOHrPC6") { ... on Equipment { name type points { name } } ... on Location { name type } } }
`;

export function registerGraphQLTool(server: McpServer): void {
  server.registerTool(
    "tacit_graphql",
    {
      title: "Query Building Data (GraphQL)",
      description: `Execute a GraphQL query against the Tacit building digital twin API.

Compose any query using the Brick-compliant schema. Supports nested fields, filtering by Brick class, supply chain traversal (upstream/downstream), and recursive location hierarchy.

Use tacit_list_sites first to get a valid site ID, then construct queries freely.

Args:
  - site_id (string, required): The site ID (injected as siteId into your query variables)
  - query (string, required): GraphQL query string
  - variables (string, optional): JSON-encoded variables object (siteId is auto-injected)

${SCHEMA_REFERENCE}`,
      inputSchema: {
        site_id: z.string().describe("Site ID from tacit_list_sites"),
        query: z.string().describe("GraphQL query string"),
        variables: z
          .string()
          .optional()
          .describe("JSON-encoded variables (siteId is auto-injected)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ site_id, query, variables: varsJson }) => {
      try {
        let vars: Record<string, unknown> = {};
        if (varsJson) {
          try {
            vars = JSON.parse(varsJson);
          } catch {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Error: 'variables' must be valid JSON.",
                },
              ],
              isError: true,
            };
          }
        }
        vars.siteId = site_id;

        const data = await graphql<Record<string, unknown>>(query, vars);
        const json = JSON.stringify(data, null, 2);

        // Count top-level result items for context
        const counts: string[] = [];
        for (const [key, val] of Object.entries(data)) {
          if (Array.isArray(val)) {
            counts.push(`${val.length} ${key}`);
          }
        }
        const summary = counts.length ? `Returned: ${counts.join(", ")}.` : "";

        // Truncate oversized responses to protect context window
        if (json.length > MAX_RESPONSE_CHARS) {
          const truncated = json.slice(0, MAX_RESPONSE_CHARS);
          return {
            content: [
              {
                type: "text" as const,
                text: `${summary ? summary + "\n\n" : ""}${truncated}\n\n--- TRUNCATED (${json.length} chars, limit ${MAX_RESPONSE_CHARS}) ---\nResponse too large. Narrow your query with filters: "is" (Brick class), "name"/"nameMatch", specific "id", or remove nested fields like "recursive: true".`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `${summary ? summary + "\n\n" : ""}${json}`,
            },
          ],
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
