#!/usr/bin/env bun
/**
 * Beacon MCP server (stdio). Gives a Claude Code session tools to see the repo's
 * feature map and register what it's working on. Talks to the running Beacon panel
 * over HTTP (start `beacon` first). Add to your repo's .mcp.json:
 *
 *   { "mcpServers": { "beacon": { "command": "beacon", "args": ["mcp"] } } }
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = process.env.BEACON_URL || `http://localhost:${process.env.PORT || 4319}`;

async function api(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`Beacon ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

function post(path: string, body: unknown) {
  return api(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const server = new McpServer({ name: "beacon", version: "0.1.0" });

server.registerTool(
  "beacon_map",
  {
    description:
      "See the project's feature/roadmap map: fronts and their features, and which are currently being worked on. Call this before starting a feature so you can tag it to the right front.",
  },
  async () => {
    const map = await api("/api/map");
    return { content: [{ type: "text" as const, text: JSON.stringify(map, null, 2) }] };
  },
);

server.registerTool(
  "beacon_start_feature",
  {
    description:
      "Register that you're starting work on a feature. If it already exists on the map it's flagged as being worked on; otherwise it's added under `front` (a new front is created if it doesn't exist). For reliability, call beacon_map first and pass the matching node's `id`. If the response is {action:'ambiguous', candidates}, re-call with the chosen `id`.",
    inputSchema: {
      title: z.string().describe("the feature you're starting"),
      id: z.string().optional().describe("exact node id from beacon_map (most reliable)"),
      front: z.string().optional().describe("the front/area it belongs to (existing or new)"),
      detail: z.string().optional().describe("one-line description"),
      files: z.array(z.string()).optional().describe("repo-relative files this feature touches"),
    },
  },
  async ({ title, id, front, detail, files }) => {
    const r = await post("/api/map/start", { title, id, front, detail, files });
    return { content: [{ type: "text" as const, text: JSON.stringify(r) }] };
  },
);

server.registerTool(
  "beacon_touch_files",
  {
    description:
      "Record the files a feature spans, so clicking it on the map shows everything it touches. Call this as you edit files for a feature. Pass the node `id` (from beacon_map) when known, else the title.",
    inputSchema: {
      files: z.array(z.string()).describe("repo-relative file paths you touched"),
      id: z.string().optional().describe("node id from beacon_map (most reliable)"),
      title: z.string().optional().describe("feature title (fuzzy-matched if no id)"),
    },
  },
  async ({ files, id, title }) => {
    const r = await post("/api/map/files", { files, id, title });
    return { content: [{ type: "text" as const, text: JSON.stringify(r) }] };
  },
);

server.registerTool(
  "beacon_finish_feature",
  {
    description: "Mark a feature on the map as done. Pass the node `id` from beacon_map when known.",
    inputSchema: { title: z.string().optional(), id: z.string().optional() },
  },
  async ({ title, id }) => {
    const r = await post("/api/map/finish", { title, id });
    return { content: [{ type: "text" as const, text: JSON.stringify(r) }] };
  },
);

server.registerTool(
  "beacon_entities",
  {
    description:
      "Pull the project's planning data from Beacon so you can ground your work in it: `features` (roadmap items), `architecture` (components/subsystems), `bugs` (known issues with severity + file:line), `tables` (the DB map with columns), `endpoints`. Use this when the user references something 'in Beacon' / 'on the map'.",
    inputSchema: {
      kind: z
        .enum(["features", "architecture", "bugs", "tables", "endpoints"])
        .describe("which set to fetch"),
    },
  },
  async ({ kind }) => {
    const r = await api(`/api/entities?kind=${kind}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }] };
  },
);

server.registerTool(
  "beacon_draft_table",
  {
    description:
      "Render a DESIGNED database schema as a draft on Beacon's /db canvas (dashed 'preview before implement' tables) — do NOT create migrations. Use after designing tables for a feature so the user can see/accept them. Replaces any existing draft.",
    inputSchema: {
      tables: z
        .array(
          z.object({
            name: z.string().describe("real table name"),
            domain: z.string().optional().describe("short area, e.g. auth/billing"),
            description: z.string().optional(),
            columns: z.array(
              z.object({
                name: z.string(),
                type: z.string(),
                isPk: z.boolean().optional(),
                isFk: z.boolean().optional(),
                nullable: z.boolean().optional(),
                note: z.string().optional(),
              }),
            ),
          }),
        )
        .describe("the tables to draft"),
      relations: z
        .array(
          z.object({
            fromTable: z.string(),
            fromColumn: z.string(),
            toTable: z.string(),
            toColumn: z.string(),
            label: z.string().optional(),
          }),
        )
        .optional()
        .describe("foreign-key relationships"),
    },
  },
  async ({ tables, relations }) => {
    const r = await post("/api/draft", { tables, relations: relations ?? [] });
    return { content: [{ type: "text" as const, text: JSON.stringify(r) }] };
  },
);

await server.connect(new StdioServerTransport());
