import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Assets Beacon installs into a target repo so its agent sessions (Claude Code, Codex)
// can use Beacon: the init + refresh skills and the MCP server registration. Database
// design is now driven by the plan-mode hook (`beacon plan` → /plan page), so there's no
// separate db-design skill. Node-builtins only (the CLI dynamic-imports this, like
// lib/workspaces).

export const INIT_SKILL = `---
name: beacon-init
description: Read this repository and map its architecture, schema, and roadmap into Beacon (the local visual planning panel). Use when the user runs /beacon-init, asks to "set up Beacon for this repo", or asks to initialize/bootstrap Beacon's map of this codebase.
---

# Map this repo into Beacon (/beacon-init)

The user already has Beacon running. You're going to map this repository's architecture into it — what used to be \`beacon init\`. **You** do the analysis (your session already has the codebase context); Beacon just persists what you send.

## What you produce

A single \`beacon_init_persist\` MCP tool call with:

- **hasFrontend**: \`true\` or \`false\` — does this repo have a frontend surface (UI code)? You just read the repo, so you know. Set it explicitly; it gates the frontend/backend \`layer\` distinction on the boards (a pure-backend repo never shows it).
- **classificationRoots** (optional): the top-level directories whose immediate children are the meaningful groups on the Files canvas — e.g. \`["frontend", "backend/app"]\`. The canvas groups files ONE level below each root (so \`frontend\` → \`frontend/components\`, \`frontend/app\`, …). Pick the dir sitting directly ABOVE the real package dirs — use \`frontend/src\` if there's a \`src/\` wrapper. List both sides of a monorepo so neither collapses into one flat blob. Not every dir — just where grouping should START. Omit it for a simple single-root repo; the canvas falls back to automatic grouping.
- **components**: 8–25 main building blocks of this codebase. NOT every file. Group them by \`domain\` (short UPPERCASE: AUTH, API, DATA, UI, JOBS, INFRA, BILLING, SEARCH, …). For each: a one-line technical \`role\`, a one-sentence plain-language \`plain\`, the few \`files\` that implement it (repo-relative), \`depends\` listing other component titles it relies on — and, when \`hasFrontend\` is true, \`layer\` (\`"frontend" | "backend" | "fullstack"\`). Use the dependency graph you can see in the source — files that import each other heavily usually belong together. If you spot a bug or something worth investigating while reading a component's code, add \`bugs: [{ note }]\` to that component — it renders as a bug flag on the node (attributed to the agent). Only flag what you actually saw in the code; don't speculate.
- **roadmap**: 3–6 BROAD strategic directions. Big-picture themes only — "Harden auth & security", "Add observability", "Scale the data layer", "Pay down test-coverage debt". NOT detailed tasks. NOT file-level. Each gets a short title and one-line \`why\`. If one of them is a concrete BUG to fix (something broken you saw in the code), add \`kind: "BUG"\` so it renders as a typed bug card. When \`hasFrontend\` is true, give each a \`layer\` too (\`"frontend" | "backend" | "fullstack"\`).
- **overview**: one paragraph describing what this project is and its stack. This lands in AGENTS.md as the project intro.
- **conventions**: 3–8 concrete rules a contributor MUST follow — build/test commands, where code goes, patterns, things easy to get wrong. Infer from actual files, not assumptions.
- **snapshot** (optional but encouraged): \`{ tables, relations, endpoints }\` for the existing database. If the project uses Prisma, read \`prisma/schema.prisma\`. If SQLAlchemy, read the model files. If Django, read \`models.py\`. If you find no obvious schema source, skip the snapshot — don't fabricate.

## How to do it

1. **Survey**. Use \`LS\` / \`Glob\` to see the top-level structure. Read \`README.md\` and the manifest (\`package.json\` / \`pyproject.toml\` / \`go.mod\` / \`Cargo.toml\` / \`pom.xml\`).
2. **Sample the source.** Read 15–30 representative files — one per cluster you can identify. Don't read everything; pick by name (route files, model files, main entrypoints, key services). The goal is to identify boundaries, not memorize every line.
3. **Identify the schema** if any. \`prisma/schema.prisma\` → translate each model into a \`tables\` entry. \`alembic\`/SQLAlchemy → read the latest models. Django → read \`models.py\`. Skip the snapshot if the source-of-truth isn't obvious.
4. **Identify endpoints** if any. Look for routes — Next.js \`app/api/*\` files, FastAPI \`@router.*\` / \`@app.*\`, Express \`app.get\`/etc. For each endpoint try to fill \`uses: [{ table, access }]\` so the canvas can draw which endpoint touches which table.
5. **Call \`beacon_init_persist\`** ONCE with the whole analysis. It replaces any prior init-derived map (idempotent) and regenerates \`AGENTS.md\`.

## What you should NOT do

- Don't propose detailed tasks in \`roadmap\` — that's what \`beacon_propose_plan\` is for. Init roadmap is strategic only.
- Don't list every file as a \`component\`. Aim for ~15. If you have 40, you're listing files, not components.
- Don't fabricate tables/endpoints. If you can't find the schema source, omit \`snapshot\`.
- Don't ask the user to confirm before persisting. The user invoked /beacon-init — that's the confirmation.

If \`beacon_init_persist\` isn't available, the Beacon panel isn't running in this repo. Tell the user to run \`beacon\` here first, then re-invoke /beacon-init.

After the tool returns, tell the user the counts (components / roadmap / tables / endpoints) and point them at the running Beacon panel.
`;

/** Write the /beacon-init skill into <repo>/.claude/skills/beacon-init/SKILL.md. */
export function installInitSkill(repo: string): string {
  const dir = join(repo, ".claude", "skills", "beacon-init");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  writeFileSync(path, INIT_SKILL);
  return path;
}

export const REFRESH_SKILL = `---
name: beacon-refresh
description: Re-survey the repo and update Beacon's architecture / schema / endpoints map after /beacon-init was already run — picks up new components, removed ones, schema changes, and new routes. Use when the user runs /beacon-refresh or asks to "refresh", "update", "re-sync", or "bring Beacon up to date" with the current code.
---

# Refresh Beacon's map (/beacon-refresh)

Beacon was already initialized in this repo (\`/beacon-init\` ran at some point). The codebase has moved since then — new modules, removed ones, schema changes, new routes. Your job is to re-survey the current code, show the user what changed, then persist the refreshed map.

## How it differs from /beacon-init

- **Init is a cold start** — no prior map, you survey everything fresh.
- **Refresh is incremental** — the map already exists. Read what's there first, then diff against the source so you can tell the user what actually changed. The user gets to see "+ 3 new components, − 1 removed, ~ 2 changed roles" instead of an opaque re-run.

## What gets preserved vs replaced

The \`beacon_init_persist\` tool **replaces only init-derived nodes** (\`source=INIT\`). A curated architecture node (created by \`beacon_describe_feature\` or by hand) whose title matches a component in your refreshed analysis is **merged in place** — your fresh \`domain\`/\`role\`/\`plain\`/\`layer\`/\`files\` land on it, but it keeps its source, position, status, and bug flags, and no duplicate INIT node is created. Curated nodes your analysis does NOT mention survive untouched, as do hand-edited tables, custom positions, notes, and draft feature plans. So you can re-run this freely.

The one caveat: if the user manually edited an INIT-source node on the canvas (e.g., renamed it, rewrote its role), that edit IS overwritten when you re-persist — and a renamed node no longer title-matches, so it survives as its own card. If the user mentions hand-curated INIT nodes, ask whether they want those carried into the new analysis verbatim.

## How to do it

1. **Read the current map.** Call \`beacon_entities\` with \`{ kind: "architecture" }\`, \`{ kind: "roadmap" }\`, \`{ kind: "tables" }\`, \`{ kind: "endpoints" }\`. This is what Beacon has now.
2. **Survey the source like init.** Same approach as \`/beacon-init\`: \`LS\` / \`Glob\` for top-level structure, read \`README.md\` and the manifest, sample 15–30 representative files. Focus on areas likely to have changed — diff your memory against what \`beacon_entities\` returned.
3. **Build the diff in your head.** For each entity kind:
   - **components**: which titles in the current map no longer match any cluster you'd produce? Which clusters you'd produce don't appear in the current map?
   - **tables**: any added / removed since? Any model files you can see that aren't in the snapshot?
   - **endpoints**: walk the route directories — any new routes, any deleted ones?
   - **roadmap**: usually stable, but a strategic theme can finish or new ones can emerge.
4. **Surface the diff to the user, briefly, BEFORE persisting.** Something like:
   - **+ added**: NEW_COMPONENT_1, NEW_COMPONENT_2 (with one-line reason each)
   - **− removed**: STALE_COMPONENT (file no longer exists)
   - **~ changed**: COMPONENT_X (role expanded to cover Y)
   - **schema**: + 2 new tables (TableA, TableB); + 3 new endpoints; − 1 deprecated endpoint
   No need to wait for confirmation — just show the diff so the user sees what's about to land.
5. **Call \`beacon_init_persist\`** ONCE with the refreshed full analysis (same shape as init: \`components\`, \`roadmap\`, \`overview\`, \`conventions\`, \`snapshot\`, \`hasFrontend\` — re-assert it, the stack may have changed; and \`classificationRoots\` if the Files-canvas grouping needs to change, e.g. a new top-level dir like \`mobile/\` — OMIT it to keep the existing roots, don't pass \`[]\` unless you mean to clear them). It replaces all init-source nodes and regenerates \`AGENTS.md\`. Bug flags already on a component survive the refresh (they're carried over by title); add \`bugs: [{ note }]\` for anything NEW you found worth investigating — identical open flags are not duplicated.

## What you should NOT do

- Don't ask "should I refresh?" — the user invoked /beacon-refresh, that's the answer.
- Don't preserve stale components for sentimental reasons. If the underlying files are gone or merged into another component, drop it from the new \`components\` list.
- Don't pad with file-level granularity. Refresh maintains the same ~15-component altitude as init.
- Don't fabricate changes. If the codebase hasn't materially moved since the last init, say so and persist the current state anyway (re-runs are cheap; it's fine).

If \`beacon_entities\` or \`beacon_init_persist\` isn't available, the Beacon panel isn't running in this repo. Tell the user to run \`beacon\` here first, then re-invoke /beacon-refresh.

After the tool returns, report the final counts plus a one-line summary of the diff you surfaced.
`;

/** Write the /beacon-refresh skill into <repo>/.claude/skills/beacon-refresh/SKILL.md. */
export function installRefreshSkill(repo: string): string {
  const dir = join(repo, ".claude", "skills", "beacon-refresh");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  writeFileSync(path, REFRESH_SKILL);
  return path;
}

export const PLAN_SKILL = `---
name: beacon-plan
description: Present your current plan or approach to the user on Beacon's /plan canvas for review — instead of asking for approval in prose. Use when the user says "present the plan", "show me the plan", "let me see it / the plan", or whenever you are about to end a turn asking whether to proceed with a plan, design, or approach.
---

# Present a plan on Beacon (/beacon-plan)

Beacon reviews plans on a canvas at /plan — never as a wall of text in the terminal. So do NOT
end a turn with "here's my plan… should I proceed?" in prose. Present it through Beacon and let the
tool BLOCK until the user decides.

## How to present

Call the **\`beacon_present_plan\`** MCP tool with your plan as markdown:

- \`description\`: a one-line summary shown in the review header.
- \`markdown\`: the full plan as markdown (headings, lists, code).
- If the plan proposes DB tables / relations / endpoints or roadmap features, embed ONE fenced
  \`\`\`beacon JSON block in the markdown — the same shapes \`beacon_propose_plan\` accepts:

\`\`\`beacon
{ "tables": [...], "relations": [...], "endpoints": [...], "features": [...] }
\`\`\`

Beacon extracts that block deterministically, strips it from the prose, and renders an editable
board on /plan. The board is built ONLY from the block — prose is never parsed — so mirror EVERY
table/endpoint/feature you mention in the prose into the block, or that board will be empty.

\`beacon_present_plan\` opens /plan and BLOCKS until the user clicks Approve / Discard / submits
feedback, then returns their verdict. Implement code or migrations ONLY after it returns approval.
If it returns feedback, revise and call it again.

## Which tool

- **Pure schema/feature plan** (tables + endpoints + roadmap features, little prose) → you may use
  \`beacon_propose_plan\` with the structured fields instead; it's the same review loop.
- **Anything else** (a code-change plan, a mixed plan, a "how should I approach X") → use
  \`beacon_present_plan\` with markdown so the full reasoning shows on /plan.

If \`beacon_present_plan\` isn't available, the panel isn't wired here — fall back to ExitPlanMode
with the same \`\`\`beacon block (Claude Code only; Codex has no ExitPlanMode), or tell the user to
run \`beacon\` in this repo once.
`;

/** Write the /beacon-plan skill into <repo>/.claude/skills/beacon-plan/SKILL.md. */
export function installPlanSkill(repo: string): string {
  const dir = join(repo, ".claude", "skills", "beacon-plan");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  writeFileSync(path, PLAN_SKILL);
  return path;
}

const CODEX_REPO_SKILLS = [
  { name: "beacon-init", body: () => INIT_SKILL },
  { name: "beacon-refresh", body: () => REFRESH_SKILL },
] as const;

/**
 * Codex discovers repo skills under <repo>/.agents/skills (same SKILL.md format as
 * Claude's .claude/skills). Same init+refresh pair as the per-repo Claude install.
 */
export function installCodexRepoSkills(repo: string): string[] {
  const paths: string[] = [];
  for (const s of CODEX_REPO_SKILLS) {
    const dir = join(repo, ".agents", "skills", s.name);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "SKILL.md");
    writeFileSync(path, s.body());
    paths.push(path);
  }
  return paths;
}

const WORKFLOW_MARK_START = "<!-- beacon:workflow:start -->";
const WORKFLOW_MARK_END = "<!-- beacon:workflow:end -->";
const WORKFLOW_RULE = `${WORKFLOW_MARK_START}
## Beacon — feature workflow

This project uses Beacon (a local planning/visualization panel; run \`beacon\` to open it). When you start work on a FEATURE — whether referenced via an \`@beacon:feature://…\` mention, an \`@beacon:note://…\` note the user wrote in the Notes panel (treat its checkbox \`- [ ]\` todos as subtasks and order features by their dependencies), or just described in chat — follow these steps in order:

### 1. Load context FIRST — do NOT Glob/Grep the codebase blind

Call \`beacon_context_for_feature({ id | title | query })\` BEFORE reading files. It returns, in one round-trip:
- the files the feature is attached to,
- what those files import + what imports them (live code-graph blast radius),
- endpoints in the feature's domain + the tables each touches + those tables' FK relations,
- sibling architecture components and the project's conventions.

That bundle replaces the discovery phase. Read only the files it returns plus whatever those imports lead you to. If the feature has no files attached yet, the bundle still gives you the domain map — Glob is a last resort.

Mid-feature, when deciding whether a change is safe, call \`beacon_blast_radius({ path })\` for the file you're about to edit — same code-graph data, file-centric.

### 2. Design the data BEFORE writing code

Determine the database tables the feature needs. If any don't exist yet, design the schema and call \`beacon_propose_plan\` (tables + relations + endpoints). This renders an **editable draft on the /plan page** for the user to review. The tool BLOCKS until the user clicks Approve / Discard / submits feedback. Implement migrations + code ONLY after it returns approval.

When listing endpoints, give each \`uses: [{ table, access }]\` so the endpoint→table links draw on /db.

EVERY feature MUST carry \`category\` (e.g. AUTH | SEARCH | DATA | INTEL | BILLING | …; \`cluster\` is accepted as an alias) and \`priority\` (0 = P0 critical, 1 = P1 high, 2 = P2 medium, 3 = P3 low). Beacon REJECTS a plan whose features omit either — \`beacon_propose_plan\` returns the list of what's missing, and an ExitPlanMode \`\`\`beacon block is denied — so set both on every feature instead of relying on defaults.

When the workspace HAS A FRONTEND (Beacon knows — the agent set \`hasFrontend\` at init, or frontend files were detected), every feature must ALSO carry \`layer\`: \`"frontend" | "backend" | "fullstack"\` — which side of the stack the work lands on. Plans omitting it are REJECTED the same way category/priority are. It works on every surface that creates roadmap cards (\`beacon_propose_plan\`, the \`\`\`beacon block, \`beacon_start_feature\`, \`beacon_add_subtasks\` — sub-tasks default to the parent's layer) and on architecture components (\`beacon_describe_feature\` / \`beacon_init_persist\`). In a pure-backend repo, never set it — the boards don't show it there.

REUSE before you create. Call \`beacon_map\` to see the features + categories that already exist. Beacon HARD-BLOCKS a feature that duplicates an existing one (it returns the existing feature to use instead) and one created without a category — so don't re-create work that's already on the board, and reuse an existing category rather than a near-synonym. \`category\` is the ONLY domain field. \`front\` (in \`beacon_start_feature\`) nests a feature UNDER an existing parent feature — it is NOT a domain tag; a \`front\` that matches no real feature is rejected.

When listing features, give each \`dependsOn: ["Other feature title", …]\` for any feature that must ship after another in the same plan. Beacon draws these as "depends on" links so the roadmap shows the dependency chain instead of loose, disconnected cards.

A roadmap item that is a BUG to fix (not a feature to build) should carry \`kind: "BUG"\` — it renders as a typed bug card. This works everywhere roadmap cards are created: \`beacon_propose_plan\` features, the \`\`\`beacon block, \`beacon_start_feature\` (when the user says they're starting on a bug), \`beacon_add_subtasks\` items (a bug discovered mid-work), and \`beacon_init_persist\` roadmap items. Default is FEATURE.

### 2b. Presenting a plan in plan mode (ExitPlanMode)

In Codex (which has no ExitPlanMode), always present plans via \`beacon_present_plan\` / \`beacon_propose_plan\` instead — this section applies to Claude Code's plan mode only.

When you present a plan via ExitPlanMode (not \`beacon_propose_plan\`) and it proposes DB tables/relations/endpoints or roadmap features, embed ONE fenced \`\`\`beacon code block of JSON in the plan — the same shapes \`beacon_propose_plan\` accepts:

\`\`\`beacon
{ "tables": [...], "relations": [...], "endpoints": [...], "features": [...] }
\`\`\`

Beacon extracts it deterministically and **strips the block from the prose** (it's never shown in the annotation panel), then renders the tables + features as an **editable board** on /plan so the user can edit them and have those edits flow back as feedback. Omit the block for pure code-change plans.

**The board is built ONLY from the block — prose is NOT parsed.** If your plan describes ANY database models/tables/columns in the prose (e.g. "Model \`legal_precedent.py\` — natural key (court, …)"), you MUST also put them in the block's \`tables\` array (with \`columns\`), or the /db tab will be empty for that plan. Same for endpoints (\`endpoints\` with \`uses:[{table,access}]\`) and features (\`features\`). A plan that lists five tables in prose but ships a block with only \`features\` renders an empty database board — exactly the "I described models but the DB tab is empty" failure. Mirror every DB entity you mention into the block.

### 3. At the end, register the work — in ONE call

Call \`beacon_describe_feature\` **ONCE** with a \`features\` array — one entry per feature the plan created — each with the files you touched and a short markdown description. This flips each one to **Done** — including its sub-tasks (the cascade completes every PENDING/IN_PROGRESS child; a sub-task you did NOT finish must be set BLOCKED or CANCELLED before registering, so it survives visibly) — and keeps \`beacon_context_for_feature\` accurate for the next session.

Key each entry by its node \`id\`: the ids are handed back to you when the plan is approved (in the approval message / additionalContext), so you don't fuzzy-match titles or pay a disambiguation round-trip. If you don't have an id, \`title\` still works.

Register them all in that single batched call. If a plan added five features, that's ONE \`beacon_describe_feature\` call with five entries — NOT five calls, and NOT just an umbrella ("Harden auth"), which leaves the individual features stuck on **Pending**.

If the feature added or materially changed a REAL architectural component (a subsystem — NOT a file), also pass \`architecture: [{ title, domain, role, … }]\` so the Architecture map stays accurate. It upserts curated components by title; never list files as components. If you found a bug or something worth investigating in a component's code, add \`bugs: [{ note }]\` to its architecture entry — it renders as a bug flag on the node (attributed to the agent); identical open flags are not duplicated. Only flag what you actually saw in the code.

Pull raw planning data anytime with \`beacon_entities\` (features / architecture / tables / endpoints).
${WORKFLOW_MARK_END}`;

/**
 * Ensure the design-first rule lives in <repo>/AGENTS.md (marker block, idempotent),
 * and that CLAUDE.md @imports AGENTS.md so Claude Code always loads it.
 */
export function ensureWorkflowDoc(repo: string): void {
  const agents = join(repo, "AGENTS.md");
  let body = "";
  try {
    body = readFileSync(agents, "utf8");
  } catch {
    /* new file */
  }
  const re = new RegExp(`${WORKFLOW_MARK_START}[\\s\\S]*?${WORKFLOW_MARK_END}`);
  body = re.test(body)
    ? body.replace(re, WORKFLOW_RULE)
    : `${body.trim()}\n\n${WORKFLOW_RULE}\n`.trimStart();
  writeFileSync(agents, body.endsWith("\n") ? body : `${body}\n`);

  // CLAUDE.md must @import AGENTS.md (Claude Code reads CLAUDE.md natively).
  const claude = join(repo, "CLAUDE.md");
  let cm = "";
  try {
    cm = readFileSync(claude, "utf8");
  } catch {
    /* new file */
  }
  if (!/@AGENTS\.md/.test(cm)) {
    writeFileSync(claude, `${cm ? `${cm.trim()}\n\n` : ""}@AGENTS.md\n`);
  }
}

/** Ensure <repo>/.mcp.json registers the Beacon MCP server (idempotent). */
export function ensureMcp(repo: string): { path: string; added: boolean } {
  const path = join(repo, ".mcp.json");
  let cfg: { mcpServers?: Record<string, unknown> } = {};
  try {
    cfg = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    /* new file */
  }
  cfg.mcpServers = cfg.mcpServers ?? {};
  if (cfg.mcpServers.beacon) return { path, added: false };
  cfg.mcpServers.beacon = { command: "beacon", args: ["mcp"] };
  writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
  return { path, added: true };
}

// ── Audit + remove (used by `beacon doctor` / `beacon uninstall`) ────────────

export interface RepoAudit {
  repo: string;
  mcpRegistered: boolean;
  agentsMdBlock: boolean;
  claudeMdImport: boolean;
  skills: {
    "beacon-init": boolean;
    "beacon-refresh": boolean;
  };
  /** Codex-side repo skills under .agents/skills (only meaningful when codex is installed). */
  codexSkills: {
    "beacon-init": boolean;
    "beacon-refresh": boolean;
  };
}

export function auditRepo(repo: string): RepoAudit {
  const mcpPath = join(repo, ".mcp.json");
  let mcpRegistered = false;
  try {
    const cfg = JSON.parse(readFileSync(mcpPath, "utf8")) as {
      mcpServers?: Record<string, unknown>;
    };
    mcpRegistered = !!cfg.mcpServers?.beacon;
  } catch {
    /* no .mcp.json */
  }
  let agentsMdBlock = false;
  try {
    agentsMdBlock = readFileSync(join(repo, "AGENTS.md"), "utf8").includes(WORKFLOW_MARK_START);
  } catch {
    /* no AGENTS.md */
  }
  let claudeMdImport = false;
  try {
    claudeMdImport = /@AGENTS\.md/.test(readFileSync(join(repo, "CLAUDE.md"), "utf8"));
  } catch {
    /* no CLAUDE.md */
  }
  return {
    repo,
    mcpRegistered,
    agentsMdBlock,
    claudeMdImport,
    skills: {
      "beacon-init": existsSync(join(repo, ".claude", "skills", "beacon-init", "SKILL.md")),
      "beacon-refresh": existsSync(
        join(repo, ".claude", "skills", "beacon-refresh", "SKILL.md"),
      ),
    },
    codexSkills: {
      "beacon-init": existsSync(join(repo, ".agents", "skills", "beacon-init", "SKILL.md")),
      "beacon-refresh": existsSync(
        join(repo, ".agents", "skills", "beacon-refresh", "SKILL.md"),
      ),
    },
  };
}

export interface RepoRemoveResult {
  skillsRemoved: string[];
  mcpUnregistered: boolean;
  agentsBlockRemoved: boolean;
  claudeImportRemoved: boolean;
}

/** Reverse setupRepo: drop skill files, strip the workflow block from AGENTS.md, drop
 * the beacon entry from .mcp.json, and remove the @AGENTS.md import from CLAUDE.md if
 * THAT was the only meaningful content (else leave the line — the user may rely on it). */
export function removeRepoAssets(repo: string): RepoRemoveResult {
  const skillsRemoved: string[] = [];
  for (const name of ["beacon-init", "beacon-refresh", "beacon-db-design"]) {
    const dir = join(repo, ".claude", "skills", name);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
      skillsRemoved.push(name);
    }
  }

  // Codex-side repo skills (.agents/skills) — removed unconditionally; cheap and
  // safe even when the codex binary is long gone.
  for (const name of ["beacon-init", "beacon-refresh"]) {
    const dir = join(repo, ".agents", "skills", name);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
      skillsRemoved.push(`codex:${name}`);
    }
  }

  // .mcp.json — drop only our entry; if mcpServers ends up empty, drop the whole file
  // only when nothing else lives in it.
  let mcpUnregistered = false;
  const mcpPath = join(repo, ".mcp.json");
  try {
    const cfg = JSON.parse(readFileSync(mcpPath, "utf8")) as {
      mcpServers?: Record<string, unknown>;
      [k: string]: unknown;
    };
    if (cfg.mcpServers?.beacon) {
      delete cfg.mcpServers.beacon;
      mcpUnregistered = true;
      if (cfg.mcpServers && Object.keys(cfg.mcpServers).length === 0) delete cfg.mcpServers;
      if (Object.keys(cfg).length === 0) rmSync(mcpPath, { force: true });
      else writeFileSync(mcpPath, JSON.stringify(cfg, null, 2) + "\n");
    }
  } catch {
    /* no .mcp.json */
  }

  // AGENTS.md — strip just the marker-bounded block; leave the rest.
  let agentsBlockRemoved = false;
  const agentsPath = join(repo, "AGENTS.md");
  try {
    const body = readFileSync(agentsPath, "utf8");
    const re = new RegExp(`\\n?${WORKFLOW_MARK_START}[\\s\\S]*?${WORKFLOW_MARK_END}\\n?`);
    if (re.test(body)) {
      const out = body.replace(re, "\n").replace(/\n{3,}/g, "\n\n").trimStart();
      writeFileSync(agentsPath, out.endsWith("\n") ? out : `${out}\n`);
      agentsBlockRemoved = true;
    }
  } catch {
    /* no AGENTS.md */
  }

  // CLAUDE.md — drop the `@AGENTS.md` line only when the rest of the file is empty
  // (otherwise the user may have wired AGENTS.md themselves for non-Beacon reasons).
  let claudeImportRemoved = false;
  const claudePath = join(repo, "CLAUDE.md");
  try {
    const body = readFileSync(claudePath, "utf8");
    const stripped = body.replace(/^[ \t]*@AGENTS\.md[ \t]*\n?/m, "");
    if (stripped !== body) {
      if (!stripped.trim()) rmSync(claudePath, { force: true });
      else writeFileSync(claudePath, stripped);
      claudeImportRemoved = true;
    }
  } catch {
    /* no CLAUDE.md */
  }

  return { skillsRemoved, mcpUnregistered, agentsBlockRemoved, claudeImportRemoved };
}
