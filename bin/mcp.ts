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
      "Register that you're starting work on a feature. If it already exists on the map it's flagged as being worked on; otherwise it's added under `front` (a new front is created if it doesn't exist). Prefer tagging to an existing front (see beacon_map).",
    inputSchema: {
      title: z.string().describe("the feature you're starting"),
      front: z.string().optional().describe("the front/area it belongs to (existing or new)"),
      detail: z.string().optional().describe("one-line description"),
    },
  },
  async ({ title, front, detail }) => {
    const r = await post("/api/map/start", { title, front, detail });
    return { content: [{ type: "text" as const, text: JSON.stringify(r) }] };
  },
);

server.registerTool(
  "beacon_finish_feature",
  {
    description: "Mark a feature on the map as done.",
    inputSchema: { title: z.string() },
  },
  async ({ title }) => {
    const r = await post("/api/map/finish", { title });
    return { content: [{ type: "text" as const, text: JSON.stringify(r) }] };
  },
);

await server.connect(new StdioServerTransport());
