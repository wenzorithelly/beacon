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
import { selfHealGlobal } from "@/lib/global-install";
import {
  addWorkspace,
  BEACON_WS_PATH_HEADER,
  ensureWorkspaceDb,
  idForPath,
  repoRootFrom,
} from "@/lib/workspaces";
import { mentionsDbSchema } from "@/lib/plan-block";
import { validateProposedFeatures } from "@/lib/feature-rules";
import { approvedFeaturesContext } from "@/lib/plan-approval-message";
import type { ApprovedFeature } from "@/lib/plan-verdict";
import {
  PLAN_POLL_INTERVAL_MS,
  PLAN_TOOL_TIMEOUT_MS,
  RESOURCE_POLL_INTERVAL_MS,
} from "@/lib/constants";
import { slug } from "@/lib/slug";
import {
  findNoteBySlug,
  noteResourceList,
  renderNoteResource,
  type NoteResourceRow,
} from "@/lib/note-resource";

// Every Claude Code session spawns `beacon mcp` once via .mcp.json. Re-applying the
// global ~/.claude/ assets here means a single Beacon-wired repo is enough to keep
// every session on this machine discovering Beacon — no per-repo re-install needed.
// selfHealGlobal only touches the filesystem; it never writes to stdout (which the
// StdioServerTransport below owns for the MCP protocol).
await selfHealGlobal();

const BASE = process.env.BEACON_URL || `http://localhost:${process.env.PORT || 4319}`;

// The repo this MCP server is serving. Claude Code spawns `beacon mcp` with the repo as
// CWD, so the git toplevel (or CWD) identifies it. We pin EVERY request to this repo's
// workspace via the x-beacon-workspace header, so the agent's reads + writes always hit
// ITS workspace's DB — never whatever the user has selected in the browser dropdown.
// This is what stops a /beacon-init in one repo from landing in another's database.
const WORKSPACE_PATH = repoRootFrom();
const WORKSPACE_ID = idForPath(WORKSPACE_PATH);

// Register THIS repo + provision its db on startup, BEFORE serving any tool. The registry and the
// per-workspace db live on shared disk (~/.beacon), so registering from this process is enough for
// the separate Beacon server process to resolve our `x-beacon-workspace` header to a real, migrated
// workspace. Without this, a repo never opened with `beacon` had an UNREGISTERED id → the server
// ignored the header → the agent's writes fell back to the browser's active repo (cross-workspace
// corruption). stderr only — stdout is the MCP transport.
try {
  addWorkspace(WORKSPACE_PATH);
  const r = await ensureWorkspaceDb(WORKSPACE_ID);
  if (!r.ok) console.error(`[beacon mcp] db provisioning failed: ${r.error}`);
} catch (e) {
  console.error(`[beacon mcp] workspace registration failed: ${e instanceof Error ? e.message : e}`);
}

async function api(path: string, init?: RequestInit): Promise<unknown> {
  const headers = new Headers(init?.headers);
  headers.set("x-beacon-workspace", WORKSPACE_ID);
  // Also send the repo path so the server can self-register us if the id is somehow still unknown
  // (e.g. a freshly-restarted server racing our startup) — a belt-and-suspenders for the line above.
  headers.set(BEACON_WS_PATH_HEADER, WORKSPACE_PATH);
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
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

// api() throws "Beacon <path> -> <status> <body>" on a non-2xx. For the creation guards, the
// body is `{ "error": "⛔ … actionable …" }` — surface THAT text to the agent (so it self-corrects)
// instead of the raw wrapped throw.
function errText(e: unknown): { content: { type: "text"; text: string }[]; isError: true } {
  const raw = e instanceof Error ? e.message : String(e);
  const m = raw.match(/\{[\s\S]*\}$/);
  if (m) {
    try {
      const j = JSON.parse(m[0]) as { error?: string };
      if (j?.error) return { content: [{ type: "text" as const, text: j.error }], isError: true };
    } catch {
      /* fall through to raw */
    }
  }
  return { content: [{ type: "text" as const, text: raw }], isError: true };
}

const server = new McpServer({ name: "beacon", version: "0.1.0" });

server.registerTool(
  "beacon_map",
  { description: "List existing features on the roadmap. Call before starting work." },
  async () => {
    const map = await api("/api/map");
    return { content: [{ type: "text" as const, text: JSON.stringify(map) }] };
  },
);

server.registerTool(
  "beacon_start_feature",
  {
    description:
      "Flag that you're working on a feature. If the title matches an existing feature it just marks it IN_PROGRESS (no category needed); if it's NEW it creates the node — and a new feature REQUIRES a `category`. Call beacon_map first so you reuse an existing feature/category instead of duplicating one.",
    inputSchema: {
      title: z.string(),
      id: z.string().optional().describe("node id from beacon_map (preferred)"),
      category: z
        .string()
        .optional()
        .describe(
          "Domain lane for a NEW feature: AUTH | SEARCH | DATA | INTEL | BILLING | INFRA | UI | … REQUIRED when this creates a new top-level feature; reuse a category already on the board. Ignored when flagging an existing feature or nesting under a `front` (inherits the parent's).",
        ),
      front: z
        .string()
        .optional()
        .describe(
          "Title of an EXISTING parent feature to nest this under (draws the parent → child edge). It must match a real feature — it is NOT a domain tag (use `category` for the domain). A `front` that matches nothing is REJECTED; create the parent first via beacon_propose_plan.",
        ),
      detail: z
        .string()
        .optional()
        .describe(
          "One-line plain-language description shown on the canvas card. Replaced later by beacon_describe_feature's markdown when the work is done.",
        ),
    },
  },
  async ({ title, id, front, detail, category }) => {
    try {
      const r = await post("/api/map/start", { title, id, front, detail, category });
      return { content: [{ type: "text" as const, text: JSON.stringify(r) }] };
    } catch (e) {
      return errText(e);
    }
  },
);

server.registerTool(
  "beacon_add_subtasks",
  {
    description:
      "Add N sub-tasks under an existing feature in one call. Use when the user says 'add these as subtasks to <feature>' or you want to record follow-ups discovered during work. Parent resolves by `parentId` (preferred — get it from beacon_map / beacon_entities) or by `parentTitle` (fuzzy-matched against top-level features). Children inherit the parent's view and cluster and land in a row beneath it; bumps the sync version so an open /map canvas refreshes.",
    inputSchema: {
      parentId: z.string().optional().describe("node id of the parent feature (preferred)"),
      parentTitle: z
        .string()
        .optional()
        .describe("fuzzy title of the parent feature; ignored if parentId is provided"),
      items: z
        .array(
          z.object({
            title: z.string().describe("short sub-task title"),
            plain: z
              .string()
              .optional()
              .describe("one-paragraph description / why / acceptance hint"),
          }),
        )
        .describe("the sub-tasks to add"),
    },
  },
  async ({ parentId, parentTitle, items }) => {
    try {
      const r = await post("/api/nodes/subtasks", { parentId, parentTitle, items });
      return { content: [{ type: "text" as const, text: JSON.stringify(r) }] };
    } catch (e) {
      return errText(e);
    }
  },
);

const architectureItemSchema = z
  .array(
    z.object({
      title: z.string().describe("real component/subsystem name (e.g. 'Plan review loop') — NEVER a file"),
      domain: z.string().describe("uppercase lane: PLAN | DATA | UI | MCP | INTEL | …"),
      role: z.string().optional().describe("one-line technical role"),
      plain: z.string().optional().describe("one plain-language sentence"),
      status: z.enum(["KEEP", "REBUILD", "REPLACE", "DROP"]).optional(),
      files: z.array(z.string()).optional(),
      depends: z.array(z.string()).optional().describe("titles of components this one depends on"),
    }),
  )
  .optional()
  .describe("Only when the feature adds/changes a REAL architectural component — upserts curated nodes, never one-per-file");

server.registerTool(
  "beacon_describe_feature",
  {
    description:
      "Register shipped feature(s) at the end of the work: marks status=DONE, records the files touched (kept on the FEATURE for context), and replaces each node's description with your markdown. Subsumes touch_files + finish_feature. REGISTER ALL FEATURES A PLAN CREATED IN ONE CALL via the `features` array (one entry per feature) — do NOT call this once per feature. Pass each feature's `id` (returned to you at plan approval) so no title-matching is needed. For a single feature you may pass the top-level fields instead. Pass `architecture` only when a feature added/changed a REAL subsystem (never a file).",
    inputSchema: {
      // Batch form (preferred): register every feature the plan created in ONE round-trip.
      features: z
        .array(
          z.object({
            id: z.string().optional().describe("node id from plan approval / beacon_map (preferred over title)"),
            title: z.string().optional().describe("feature title (fuzzy-matched if no id)"),
            description: z.string().describe("Markdown: ### Overview ... ### Files - `path` — what it does"),
            files: z.array(z.string()).optional().describe("repo-relative files this feature touches"),
            architecture: architectureItemSchema,
          }),
        )
        .optional()
        .describe("Register many features at once — one entry per feature, each id-keyed. Use this instead of N separate calls."),
      // Single form (back-compat): one feature via the top-level fields.
      description: z
        .string()
        .optional()
        .describe("Single-feature markdown (omit when using `features`): ### Overview ... ### Files - `path` — what it does"),
      files: z.array(z.string()).optional().describe("repo-relative files this feature touches (single form)"),
      id: z.string().optional().describe("node id from plan approval / beacon_map (preferred over title)"),
      title: z.string().optional().describe("feature title (fuzzy-matched if no id)"),
      architecture: architectureItemSchema,
    },
  },
  async ({ features, description, files, id, title, architecture }) => {
    const body =
      features?.length
        ? { features }
        : { description, files, id, title, architecture };
    const r = await post("/api/map/describe", body);
    return { content: [{ type: "text" as const, text: JSON.stringify(r) }] };
  },
);

server.registerTool(
  "beacon_init_persist",
  {
    description:
      "Use ONLY inside the `beacon-init` skill. After YOU (Claude Code) have read the repo and built the architecture analysis, call this once to persist it into Beacon. Replaces any prior init-derived map. Same DB shape as `beacon_propose_plan` for tables/endpoints, but it commits directly (no /plan review step) because the user explicitly invoked init.",
    inputSchema: {
      overview: z
        .string()
        .optional()
        .describe("one-paragraph summary of the project — written to ProjectMeta + AGENTS.md"),
      conventions: z
        .array(z.string())
        .optional()
        .describe("3-8 concrete conventions/gotchas a contributor must follow"),
      components: z
        .array(
          z.object({
            title: z.string(),
            domain: z.string().describe("short UPPERCASE area: AUTH, API, DATA, UI, JOBS, INFRA, …"),
            role: z.string().optional().describe("one-line technical role"),
            plain: z.string().optional().describe("one plain-language sentence"),
            files: z.array(z.string()).optional().describe("repo-relative key files"),
            depends: z.array(z.string()).optional().describe("titles of other components it depends on"),
          }),
        )
        .describe("8-25 main building blocks, not every file"),
      roadmap: z
        .array(
          z.object({
            title: z.string(),
            why: z.string().optional(),
            category: z
              .string()
              .optional()
              .describe("category for the board (AUTH | SEARCH | DATA | INTEL | …) — set it so the item isn't category-less"),
            priority: z.number().int().min(0).max(3).optional().describe("0=P0 critical .. 3=P3 low"),
          }),
        )
        .optional()
        .describe(
          "3-6 broad strategic directions (NOT detailed tasks); each with a `category` + `priority`. Re-runs DEDUPE roadmap features by title, so re-persisting won't double up existing ones.",
        ),
      snapshot: z
        .object({
          tables: z
            .array(
              z.object({
                name: z.string(),
                domain: z.string().optional(),
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
            .optional(),
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
            .optional(),
          endpoints: z
            .array(
              z.object({
                method: z.string(),
                path: z.string(),
                domain: z.string().optional(),
                description: z.string().optional(),
                uses: z
                  .array(
                    z.object({
                      table: z.string(),
                      access: z.string().optional(),
                    }),
                  )
                  .optional(),
              }),
            )
            .optional(),
        })
        .optional()
        .describe("optional: also seed /db with the schema you discovered from prisma/SQLAlchemy/etc."),
    },
  },
  async (input) => {
    const r = await post("/api/init", input);
    return { content: [{ type: "text" as const, text: JSON.stringify(r) }] };
  },
);

server.registerTool(
  "beacon_context_for_feature",
  {
    description:
      "Use BEFORE Glob/Grep/Read when starting work on a feature. Returns a single bundle of everything Beacon knows about it: attached files, what those files import + what imports them (1-hop blast radius from the live code graph), endpoints in the feature's domain + the tables each touches, those tables' FK relations, sibling architecture components, and the project's conventions. Saves an entire discovery-phase round of file reads. Match by id (preferred), exact title, or a natural-language query.",
    inputSchema: {
      id: z.string().optional().describe("node id from beacon_map (preferred)"),
      title: z.string().optional().describe("feature title (case-insensitive contains)"),
      query: z
        .string()
        .optional()
        .describe("natural-language phrase — OR-matched against title + plain description"),
    },
  },
  async ({ id, title, query }) => {
    const qs = new URLSearchParams();
    if (id) qs.set("id", id);
    if (title) qs.set("title", title);
    if (query) qs.set("query", query);
    const r = await api(`/api/context/feature?${qs.toString()}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(r) }] };
  },
);

server.registerTool(
  "beacon_blast_radius",
  {
    description:
      "For 'if I change this file, what else cares?' — returns the file's 1-hop imports + importedBy, the TRANSITIVE blast radius both directions (downstream = who depends on it, upstream = what it depends on, grouped by depth), hub/centrality scoring (inDegree/outDegree + isHub), and every feature/component that has the file attached. Use mid-feature when deciding the impact of a change, or before refactoring a hub file.",
    inputSchema: {
      path: z.string().describe("repo-relative POSIX file path"),
      depth: z
        .number()
        .optional()
        .describe("how far to walk the transitive graph (default 2, capped at 5)"),
    },
  },
  async ({ path, depth }) => {
    const qs = new URLSearchParams({ path });
    if (depth != null) qs.set("depth", String(depth));
    const r = await api(`/api/context/file?${qs.toString()}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(r) }] };
  },
);

server.registerTool(
  "beacon_entities",
  {
    description:
      "Read planning data. `features` = roadmap, `architecture` = components, `tables`/`endpoints` = DB map.",
    inputSchema: {
      kind: z.enum(["features", "architecture", "tables", "endpoints"]),
    },
  },
  async ({ kind }) => {
    const r = await api(`/api/entities?kind=${kind}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(r) }] };
  },
);

// The unified "propose a plan" tool: push features + tables + endpoints in ONE call. Blocks
// until the user approves, discards, or submits inline comments via /plan in Beacon.
server.registerTool(
  "beacon_propose_plan",
  {
    description:
      "BLOCKS until the user reviews. Pushes a feature plan (top-level roadmap features + DB tables + endpoints) to Beacon's /plan page. Use when the user asks you to plan a feature. EVERY feature MUST include `cluster` (its category) and `priority` (0=P0 critical .. 3=P3 low) — the tool REJECTS a plan whose features omit either, so set both on every feature. Do not implement code or migrations until this returns approval. If it returns inline feedback, revise and call again.",
    inputSchema: {
      description: z.string().describe("Short summary the user will see in the review header"),
      features: z
        .array(
          z.object({
            title: z.string(),
            role: z.string().optional().describe("one-line technical role"),
            plain: z.string().optional().describe("one plain-language sentence for the user"),
            category: z
              .string()
              .optional()
              .describe("REQUIRED category for the board (AUTH | SEARCH | BILLING | DATA | INTEL | …)"),
            cluster: z.string().optional().describe("alias for `category`"),
            domain: z.string().optional().describe("alias for `category`"),
            priority: z
              .number()
              .int()
              .min(0)
              .max(3)
              .optional()
              .describe("REQUIRED priority: 0=P0 critical, 1=P1 high, 2=P2 medium, 3=P3 low"),
            dependsOn: z
              .array(z.string())
              .optional()
              .describe(
                "titles of other features in THIS plan that must ship first — drawn as 'depends on' links so the board shows the dependency chain, not loose cards",
              ),
          }),
        )
        .optional()
        .describe("the top-level roadmap features this plan adds"),
      tables: z
        .array(
          z.object({
            name: z.string(),
            domain: z.string().optional(),
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
        .optional(),
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
        .optional(),
      endpoints: z
        .array(
          z.object({
            method: z.string().describe("GET|POST|PUT|PATCH|DELETE"),
            path: z.string(),
            domain: z.string().optional(),
            description: z.string().optional(),
            uses: z
              .array(
                z.object({
                  table: z.string(),
                  access: z.string().optional(),
                }),
              )
              .optional(),
          }),
        )
        .optional(),
    },
  },
  async ({ description, features, tables, relations, endpoints }) => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

    // HARD RULE: a plan that touches the database must SHIP its schema as structured `tables`,
    // not just describe it in prose / feature text. Beacon's /db board renders ONLY structured
    // tables — prose is never parsed — so a plan that declares endpoints or whose text clearly
    // describes models/migrations but passes NO `tables` is rejected here. Re-call with tables.
    const hasTables = (tables?.length ?? 0) > 0;
    const featureText = (features ?? [])
      .map((f) => `${f.title} ${f.role ?? ""} ${f.plain ?? ""}`)
      .join("\n");
    const dbSignaled =
      (endpoints?.length ?? 0) > 0 || mentionsDbSchema(`${description}\n${featureText}`);
    if (!hasTables && dbSignaled) {
      return text(
        "⛔ This plan touches the database — it declares endpoints and/or its text describes " +
          "models/tables/migrations — but you passed NO `tables`. Beacon's schema board renders " +
          "ONLY from structured `tables`; prose is never parsed, so the /db tab would be empty " +
          "and nothing would persist on approve.\n\n" +
          "Re-call `beacon_propose_plan` with every table in `tables` (each with its `columns`), " +
          "the `relations` (FKs), and keep the `endpoints` (each with `uses:[{table,access}]`). " +
          "Mirror EVERY database entity your plan mentions into the structured fields.",
      );
    }

    // HARD RULE: every roadmap feature must carry a category (cluster) and a priority — they
    // drive grouping/ordering on the board and the user shouldn't have to add them by hand each
    // round. Reject here (before pushing) with the list of what's missing so the agent re-proposes.
    if (features?.length) {
      const featureErr = validateProposedFeatures(features);
      if (featureErr) return text(featureErr);
    }

    const hasDb = (tables?.length ?? 0) + (endpoints?.length ?? 0) > 0;
    await post("/api/plan", {
      description,
      draft: hasDb
        ? {
            tables: tables ?? [],
            relations: relations ?? [],
            endpoints: endpoints ?? [],
          }
        : undefined,
      features: features?.length ? features : undefined,
    });

    // Make sure the browser shows THIS repo's plan. The ExitPlanMode hook activates the
    // workspace; the MCP path didn't, so a fresh plan stayed invisible until the user
    // switched the dropdown. Activate by id (validated server-side; failures are non-fatal).
    await fetch(`${BASE}/api/workspace/activate?id=${WORKSPACE_ID}`).catch(() => {});

    // Block for the verdict. ONE coherent source now — /api/plan/verdict resolves feedback /
    // approve / discard (whichever the user produced first), so this tool and the ExitPlanMode
    // hook can never disagree, and a features-only approve is no longer misread as a discard.
    // The verdict persists on disk, so a timeout is resumable.
    const deadline = Date.now() + PLAN_TOOL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(PLAN_POLL_INTERVAL_MS);
      const v = (await api("/api/plan/verdict").catch(() => null)) as
        | { kind: "pending" }
        | { kind: "feedback"; feedback: string }
        | { kind: "approved"; summary: string; detail?: string; features?: ApprovedFeature[] }
        | { kind: "discarded"; summary: string }
        | null;
      if (!v) continue;

      // Feedback bundles text annotations on the markdown AND any edits the user made on the
      // /map and /db boards (see lib/plan-feedback.ts) — the user's revision intent.
      if (v.kind === "feedback") {
        return text(
          "💬 The user left feedback on the plan in Beacon — text comments and/or edits they " +
            "made directly on the /map and /db boards. Read everything below, revise the plan " +
            "accordingly (matching the board changes verbatim), and call `beacon_propose_plan` " +
            "again with the revised version — DO NOT implement yet:\n\n" +
            v.feedback,
        );
      }
      if (v.kind === "approved") {
        return text(
          `✅ Plan approved by the user. ${v.summary}` +
            (v.detail
              ? "\n\nImplement EXACTLY the schema below (migrations + code) — the user may have " +
                "edited columns on the canvas:\n\n" +
                v.detail
              : "") +
            approvedFeaturesContext(v.features),
        );
      }
      if (v.kind === "discarded") {
        return text(
          `❌ The user discarded the plan in Beacon. ${v.summary} Ask what they want to adjust before proposing again.`,
        );
      }
      // kind === "pending" → keep polling.
    }
    return text(
      "Still waiting for the user to review in Beacon. Your plan is preserved — call " +
        "`beacon_propose_plan` again with the SAME plan to resume (the verdict is picked up " +
        "immediately if they've since decided), or ask whether they've reviewed it.",
    );
  },
);

// Present ANY plan (as markdown) on /plan and block for the verdict — the mode-independent path
// the /beacon-plan skill and the Stop hook route to. Unlike beacon_propose_plan (structured
// features/tables), this takes free-form markdown, so it covers code-change plans / "how should I
// approach X" too. A fenced ```beacon block in the markdown still renders the editable board.
server.registerTool(
  "beacon_present_plan",
  {
    description:
      "BLOCKS until the user reviews. Pushes ANY plan (as markdown) to Beacon's /plan page so the user reviews it on the canvas instead of in the terminal — use this whenever you'd otherwise end a turn asking 'does this look right / should I proceed?'. Embed ONE fenced ```beacon block of JSON ({tables,relations,endpoints,features}) for any DB/roadmap entities so they render as an editable board. Returns the verdict (approved / discarded / feedback). Do NOT implement until it returns approval; on feedback, revise and call again. (For a pure schema+features plan, beacon_propose_plan is the structured alternative.)",
    inputSchema: {
      description: z.string().describe("One-line summary shown in the review header"),
      markdown: z
        .string()
        .describe("The full plan as markdown. Embed a ```beacon block for tables/endpoints/features."),
    },
  },
  async ({ description, markdown }) => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

    // Push the plan markdown, then make sure the browser shows THIS repo's plan (same as the
    // ExitPlanMode hook / beacon_propose_plan do — the MCP path must activate the workspace).
    await post("/api/plan", { description, markdown });
    await fetch(`${BASE}/api/workspace/activate?id=${WORKSPACE_ID}`).catch(() => {});

    // Block on the single verdict source — same loop as beacon_propose_plan (the verdict persists
    // on disk, so a timeout is resumable by calling again with the same plan).
    const deadline = Date.now() + PLAN_TOOL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(PLAN_POLL_INTERVAL_MS);
      const v = (await api("/api/plan/verdict").catch(() => null)) as
        | { kind: "pending" }
        | { kind: "feedback"; feedback: string }
        | { kind: "approved"; summary?: string; detail?: string; features?: ApprovedFeature[] }
        | { kind: "discarded"; summary?: string }
        | null;
      if (!v) continue;
      if (v.kind === "feedback")
        return text(
          "💬 The user left feedback on the plan in Beacon (inline comments and/or edits on the " +
            "/map and /db boards). Revise the plan accordingly and call `beacon_present_plan` " +
            "again — do NOT implement yet:\n\n" +
            v.feedback,
        );
      if (v.kind === "approved")
        return text(
          `✅ Plan approved by the user. ${v.summary ?? ""}`.trim() +
            (v.detail ? `\n\nImplement exactly what's on the board:\n\n${v.detail}` : "") +
            approvedFeaturesContext(v.features),
        );
      if (v.kind === "discarded")
        return text(
          `❌ The user discarded the plan in Beacon. ${v.summary ?? ""} Ask what they want to adjust before presenting again.`.trim(),
        );
      // kind === "pending" → keep polling.
    }
    return text(
      "Still waiting for the user to review in Beacon. Your plan is preserved — call " +
        "`beacon_present_plan` again with the SAME plan to resume, or ask whether they've reviewed it.",
    );
  },
);

// ── Resources: @-mention Beacon entities in a Claude Code session ──────────────
// Type `@` in your terminal → these show up. The URI is a readable slug of the name and
// the description leads with the proper name, so the menu reads cleanly (Claude Code shows
// "<server>:<uri> - <description>"). Picking a feature/component imports the node's
// description + the project's existing DB tables. No AI calls.
const one = (v: string | string[]) => (Array.isArray(v) ? v[0] : v);

interface NodeRow {
  id: string;
  title: string;
  cluster: string | null;
  status: string;
  plain?: string | null;
  role?: string | null;
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
    return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: "(not found)" }] };

  const tablesRes = (await api("/api/entities?kind=tables")) as {
    items: Array<{ name: string }>;
  };
  const names = (tablesRes.items ?? []).map((t) => t.name);

  const parts: string[] = [`# ${f.title}`];
  if (f.cluster) parts.push(`*Domain:* \`${f.cluster}\``);
  if (f.status) parts.push(`*Status:* \`${f.status}\``);
  parts.push("");
  parts.push(
    f.plain?.trim() ||
      "(this node has no description yet — add one on Beacon's /map page)",
  );
  parts.push("", "## Existing DB tables in this project");
  parts.push(names.length ? names.join(", ") : "(none yet)");

  if (kind === "features") {
    const feats = await nodeItems("features");
    const cats = [
      ...new Set(feats.map((x) => x.cluster?.trim()).filter((c): c is string => !!c)),
    ].sort();
    parts.push("", "## Existing feature categories — reuse one before inventing a new one");
    parts.push(cats.length ? cats.join(", ") : "(none yet)");
    parts.push(
      "",
      "## Beacon feature loop — follow IN ORDER (do not jump to Glob/Grep/Read)",
      "1. **Load context FIRST.** Call `beacon_context_for_feature({ title })` for this feature BEFORE any Glob/Grep/Read. It returns the attached files, 1-hop import blast radius, the domain's endpoints + tables + FK relations, sibling components, and the project conventions — and marks this feature active so your edits attach to it. That bundle replaces the discovery phase; Glob is a last resort.",
      "2. **Design data before code.** Identify the tables this feature needs. If ANY are missing from the list above, design the schema and call `beacon_propose_plan` (tables + relations + endpoints, each endpoint with `uses:[{table,access}]`). It BLOCKS until the user approves on /plan — do NOT write migrations or code until it returns approval.",
      "3. **Register at the end — in ONE call.** When the work is done, call `beacon_describe_feature` ONCE with a `features` array (one entry per feature the plan created, each keyed by the `id` you got back at approval, with the files you touched + a short markdown summary). Don't make one call per feature, and don't register only the umbrella — that leaves the rest Pending.",
    );
  }

  return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: parts.join("\n") }] };
}

server.registerResource(
  "beacon-feature",
  new ResourceTemplate("feature://{slug}", {
    list: async () => nodeResources(await nodeItems("features"), "feature://"),
  }),
  {
    title: "Beacon: features",
    description: "Roadmap features — picking one imports the node's description plus existing-DB context.",
    mimeType: "text/markdown",
  },
  (uri, { slug: s }) => readNode(uri, s, "features"),
);

server.registerResource(
  "beacon-component",
  new ResourceTemplate("component://{slug}", {
    list: async () => nodeResources(await nodeItems("architecture"), "component://"),
  }),
  {
    title: "Beacon: architecture",
    description: "Architecture components — picking one imports 'what the agent sees'.",
    mimeType: "text/markdown",
  },
  (uri, { slug: s }) => readNode(uri, s, "architecture"),
);

async function noteItems(): Promise<NoteResourceRow[]> {
  return (await api("/api/notes")) as NoteResourceRow[];
}

server.registerResource(
  "beacon-note",
  new ResourceTemplate("note://{slug}", {
    list: async () => noteResourceList(await noteItems()),
  }),
  {
    title: "Beacon: notes",
    description:
      "Your Beacon notes — picking one imports its markdown verbatim so you can turn it into features.",
    mimeType: "text/markdown",
  },
  async (uri, { slug: s }) => {
    const note = findNoteBySlug(await noteItems(), one(s));
    const md = note ? renderNoteResource(note) : "(not found)";
    return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: md }] };
  },
);

await server.connect(new StdioServerTransport());

// Keep the client's @-mention list live. MCP clients cache resources/list for the session
// and only refetch on a resources/list_changed notification. This stdio process can't see the
// daemon's events, so poll the per-workspace sync version and forward the notification when it
// advances — that's what makes a note (or feature) created mid-session show up in the picker
// instead of only after a restart. Prime on the first read so we don't fire at startup; stay
// quiet if the daemon is briefly unreachable.
let lastSyncVersion = -1;
setInterval(async () => {
  try {
    const { version } = (await api("/api/version")) as { version: number };
    if (lastSyncVersion === -1) lastSyncVersion = version;
    else if (version !== lastSyncVersion) {
      lastSyncVersion = version;
      server.sendResourceListChanged();
    }
  } catch {
    // daemon not up yet, or a transient blip — retry on the next tick
  }
}, RESOURCE_POLL_INTERVAL_MS);
