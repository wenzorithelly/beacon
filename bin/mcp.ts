#!/usr/bin/env bun
/**
 * Beacon MCP server (stdio). Gives a Claude Code session tools to see the repo's
 * feature map and register what it's working on. Talks to the running Beacon panel
 * over HTTP (start `beacon` first). Add to your repo's .mcp.json:
 *
 *   { "mcpServers": { "beacon": { "command": "beacon", "args": ["mcp"] } } }
 */
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
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
      "Render a DESIGNED database schema + endpoints as a draft on Beacon's /db canvas (dashed 'preview before implement' tables and endpoints) — do NOT create migrations. Use after designing tables/endpoints for a feature so the user can see, edit, and accept them. Replaces any existing draft.",
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
      endpoints: z
        .array(
          z.object({
            method: z.string().describe("GET|POST|PUT|PATCH|DELETE"),
            path: z.string().describe("e.g. /orgs/{id}/members"),
            domain: z.string().optional(),
            description: z.string().optional(),
          }),
        )
        .optional()
        .describe("the endpoints this feature adds (rendered as dashed drafts on /db)"),
    },
  },
  async ({ tables, relations, endpoints }) => {
    const r = await post("/api/draft", {
      tables,
      relations: relations ?? [],
      endpoints: endpoints ?? [],
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(r) }] };
  },
);

// ── Resources: @-mention Beacon entities in a Claude Code session ──────────────
// Type `@` in your terminal → these show up. The URI is a readable slug of the name and
// the description leads with the proper name, so the menu reads cleanly (Claude Code shows
// "<server>:<uri> - <description>"). Picking a feature/component imports "what the agent
// sees" (the enhanced prompt); a bug imports its facts.
const one = (v: string | string[]) => (Array.isArray(v) ? v[0] : v);
function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "") // strip accents
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "item"
  );
}

interface NodeRow {
  id: string;
  title: string;
  cluster: string | null;
  status: string;
}
async function nodeItems(kind: "features" | "architecture"): Promise<NodeRow[]> {
  return ((await api(`/api/entities?kind=${kind}`)) as { items: NodeRow[] }).items;
}
function nodeResources(items: NodeRow[], scheme: string) {
  return {
    resources: items.map((f) => ({
      uri: `${scheme}${slug(f.title)}`,
      name: f.title,
      description: `${f.title}${f.cluster ? ` · ${f.cluster}` : ""} · ${f.status}`,
      mimeType: "text/markdown",
    })),
  };
}
async function readNode(uri: URL, s: string | string[], kind: "features" | "architecture") {
  const f = (await nodeItems(kind)).find((x) => slug(x.title) === one(s));
  if (!f)
    return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: "(não encontrado)" }] };

  const [enh, tablesRes] = await Promise.all([
    post("/api/enhance", { nodeId: f.id }) as Promise<{ enhanced?: string }>,
    api("/api/entities?kind=tables") as Promise<{ items: Array<{ name: string }> }>,
  ]);
  const names = (tablesRes.items ?? []).map((t) => t.name);

  const parts = [
    `# ${f.title} — what the agent sees`,
    "",
    enh.enhanced || "(adicione descrição ao nó e edite para gerar)",
    "",
    "## Existing DB tables in this project",
    names.length ? names.join(", ") : "(none yet)",
  ];

  // Features must be designed (DB + endpoints) and approved before implementation.
  if (kind === "features") {
    parts.push(
      "",
      "## REQUIRED before implementing this feature",
      "Beacon is a planning board. Before writing ANY code or migrations for this feature:",
      "1. Identify the database tables it needs. If ANY are missing from the list above, DESIGN the schema and call the `beacon_draft_table` tool (tables + relations) so the user sees a dashed draft on the /db page and can approve it. Do NOT implement or create migrations until the user approves.",
      "2. Propose the ENDPOINTS this feature will create — list each as `METHOD /path — tables it touches` — so the user can review, approve, or redesign them.",
      "3. Wait for the user's approval (they may also edit the draft on /db manually) before you implement anything.",
    );
  }

  return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: parts.join("\n") }] };
}

server.registerResource(
  "beacon-feature",
  new ResourceTemplate("beacon://feature/{slug}", {
    list: async () => nodeResources(await nodeItems("features"), "beacon://feature/"),
  }),
  {
    title: "Beacon: features",
    description: "Roadmap features — picking one imports 'what the agent sees' (the enhanced prompt).",
    mimeType: "text/markdown",
  },
  (uri, { slug: s }) => readNode(uri, s, "features"),
);

server.registerResource(
  "beacon-component",
  new ResourceTemplate("beacon://component/{slug}", {
    list: async () => nodeResources(await nodeItems("architecture"), "beacon://component/"),
  }),
  {
    title: "Beacon: architecture",
    description: "Architecture components — picking one imports 'what the agent sees'.",
    mimeType: "text/markdown",
  },
  (uri, { slug: s }) => readNode(uri, s, "architecture"),
);

interface BugRow {
  id: string;
  title: string;
  severity: string;
  status: string;
  detail: string | null;
  sourceRef: string | null;
  feature: string | null;
}
server.registerResource(
  "beacon-bug",
  new ResourceTemplate("beacon://bug/{slug}", {
    list: async () => {
      const items = ((await api("/api/entities?kind=bugs")) as { items: BugRow[] }).items;
      return {
        resources: items.map((b) => ({
          uri: `beacon://bug/${slug(b.title)}`,
          name: b.title,
          description: `${b.title} · ${b.severity} · ${b.status}`,
          mimeType: "text/markdown",
        })),
      };
    },
  }),
  { title: "Beacon: bugs", description: "Known issues with severity + file:line.", mimeType: "text/markdown" },
  async (uri, { slug: s }) => {
    const items = ((await api("/api/entities?kind=bugs")) as { items: BugRow[] }).items;
    const b = items.find((x) => slug(x.title) === one(s));
    const text = b
      ? `# Bug: ${b.title}\n\n- severity: ${b.severity}\n- status: ${b.status}\n- feature: ${b.feature ?? "—"}\n- source: ${b.sourceRef ?? "—"}\n\n${b.detail ?? ""}`
      : "(bug não encontrado)";
    return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
  },
);

await server.connect(new StdioServerTransport());
