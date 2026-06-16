# Competitive analysis — Understand Anything

**Subject:** [understand-anything.com](https://understand-anything.com/) · GitHub [`Egonex-AI/Understand-Anything`](https://github.com/Egonex-AI/Understand-Anything) (originally `Lum1104/Understand-Anything`)
**Date:** 2026-06-15 · **Analyst:** terminal session (cloned + read the full source, drove the live demo)
**Their numbers:** ~54k★, trending, v2.5.0 (May 2026), MIT, by **egonex.ai**. Community walkthrough by Better Stack.

---

## 0. TL;DR — the brutally honest verdict

**They are not really our competitor. They are our cousin who got famous.**

Understand Anything (UA) and Beacon both draw a codebase as a React-Flow graph. That's where the similarity ends, and it's worth internalizing *how* differently we point:

| | Understand Anything | Beacon |
|---|---|---|
| **Job to be done** | *Understand code that already exists* (onboarding, comprehension) | *Steer the agent building code that doesn't exist yet* (planning, review) |
| **Direction of time** | Backward-looking (what's there) | Forward-looking (what's about to be there) |
| **How the map is built** | Expensive **one-shot multi-agent LLM pipeline** (6–20 min, burns tokens) | **Deterministic live intel daemon** (continuous, ~free) |
| **Freshness** | Stale snapshot; must re-run `/understand` (or commit-hook) | Auto-syncs to the real repo continuously |
| **Output** | A static `knowledge-graph.json` artifact a *human* explores | A live board + a **feedback loop back into the terminal agent** (MCP) |
| **The loop** | None. You look at it. | propose → annotate → approve → feedback → implement |
| **Granularity** | file **+ function + class + concept** nodes, LLM summaries | file-level nodes (deterministic), tables, endpoints, features |
| **Distribution** | 16 platforms, viral OSS, killer hosted demo | niche, local-first, single-user terminal companion |

**The uncomfortable part:** on the axis they chose — *"help a human understand an unfamiliar codebase"* — they are well ahead of us, and they're winning the distribution game hard (54k★). On the axis we chose — *"be the agent's eyes and hands while it plans and builds"* — they have literally nothing, and that axis is arguably more defensible and higher-value. We should **not** chase them onto their axis. We should **steal their two or three best toys** that happen to also serve *our* north star (make the agent's work visible/readable), and otherwise stay in our lane.

The single most useful fact in this whole document: **their dashboard is built on the exact same tech we are** — React Flow + ELK layered layout + Louvain (graphology) + Zustand + Tailwind. The layered container cards with colored stripes and file counts in their "Structural" view are visually near-identical to our grouped-container architecture board. Neither of us has a *visualization* moat. The moat is in what the graph is *for*.

---

## 1. What Understand Anything actually is

A Claude-Code-style **plugin** (skills + agents, no MCP server). You run `/understand`; a pipeline analyzes the repo and writes `.understand-anything/knowledge-graph.json`; `/understand-dashboard` opens a local React dashboard to explore it. Commit the JSON and teammates skip the pipeline.

### Commands
`/understand` (incremental by default · `--language`, `--auto-update`, `--review`, scope to subdir) · `/understand-dashboard` · `/understand-chat` · `/understand-diff` · `/understand-explain [file]` · `/understand-onboard` · `/understand-domain` · `/understand-knowledge [wiki]`.

### The pipeline (tree-sitter + LLM hybrid)
Deterministic where it can be, LLM where it must be — same philosophy as us, but they keep a *lot* more LLM in the loop:

1. **Scan** — `project-scanner` agent + `scan-project.mjs` (git-ls-files, 41 language configs, framework heuristics).
2. **Batch** — `compute-batches.mjs` runs **Louvain community detection** on the import graph (via `graphology`) to group coupled files into batches, minimizing cross-batch edges. Pre-computes a `neighborMap` of exported symbols so analyzers can emit cross-batch edges without re-reading.
3. **Analyze** — `file-analyzer` agents, **up to 5 concurrent, 20–30 files/batch**. Each runs `extract-structure.mjs` (tree-sitter: functions, classes, imports, exports, call sites) then the LLM adds summaries, tags, complexity, and the semantic edges.
4. **Merge** — `merge-batch-graphs.py`: ID normalization, dedup, drop dangling edges, a clever **2-pass `tested_by` linker** that pairs tests to prod by path convention across JS/TS/Py/Go/Java/C#.
5. **Architecture** — `architecture-analyzer` agent assigns nodes to layers (API/Service/Data/UI/Utility).
6. **Tour** — `tour-builder` agent generates a dependency-ordered guided walkthrough.
7. **Review + Save** — inline deterministic validation (or `graph-reviewer` agent with `--review`), then writes the graph + a **fingerprint baseline** (SHA-256 + structural signatures) so future runs classify changes NONE / COSMETIC / STRUCTURAL and skip unchanged files (saves ~157k tokens/run).

**Graph schema:** 21 node types (file, function, class, module, concept, config, service, table, endpoint, domain, flow, step, article, entity, claim…), **35 edge types** across 8 categories (structural, behavioral, data-flow, dependency, semantic, infra, schema, domain, knowledge), layers, and tour steps. Edges carry direction + weight.

**Cost/speed reality:** a ~1000-file repo is **~6–20 min** and a real token bill on first run (file-analyzer LLM calls dominate). Incremental commits are cheap; first run is not. **The user pays the LLM bill.**

### The dashboard (the part that looks like us)
- **React Flow v12 + ELK** (`layered`, two-stage container layout — containers first <500ms, children async) + **D3-force** for knowledge graphs + **Louvain** clustering. Zustand store, Tailwind v4, prism for code, react-markdown.
- Views/toolbar (confirmed live): **Overview / Learn / Deep Dive** (nav levels) · **Structural / Domain** (view toggle) · **Diff** overlay · **Files / +Classes** (function/class drill-down) · type filter chips · **Filter · Export · Path · Theme · ?**.
- **Guided Tours** — right panel, e.g. "Project Tour · 15 steps", numbered, auto-fits viewport to each step's nodes.
- **Domain view** — code → business domains/flows/steps as a separate horizontal graph (`domain-graph.json`).
- **Diff impact** — `diff-overlay.json` highlights changed (red) + affected (amber) nodes.
- **Persona-adaptive UI** — non-technical / junior / experienced detail levels.
- **Path Finder** — shortest path between any two nodes.
- **Export** — PNG / SVG / filtered JSON.
- **Search** — fuzzy + a *Semantic* toggle (**note: the semantic mode is a stub — store falls back to fuzzy; embeddings are never generated by the pipeline**).
- Visual language: near-monochrome **#0a0a0a** dark + a single warm accent **gold #d4a574**, DM Serif Display headings, glass-morphism cards, subtle noise. (Compare Beacon: same monochrome-dark + single warm accent, ours is **orange #ff7a45**. Same design family.)

Screenshots: `./assets/ua-onboarding-tour.jpeg`, `./assets/ua-dashboard.jpeg`.

---

## 2. What they do that we don't (the real gaps)

Ordered by how much it should bother us:

1. **Guided tours / onboarding walkthroughs.** Dependency-ordered, step-by-step "learn this codebase in the right order," with the canvas auto-focusing each step. We have *zero* equivalent. This is their headline feature and it directly serves our own north star (make the work readable). **Biggest gap.**
2. **Function/class-level nodes (`+Classes`).** Their graph drills below the file into functions and classes with summaries. Our code graph stops at the file. For genuinely *reading* a system this is a real granularity gap.
3. **Node-to-node Path Finder.** "Shortest path between component A and component B." We have blast-radius (1→all) but not pairwise A→B.
4. **Export to PNG / SVG / JSON.** One-click share of a board image. We have nothing (our "Shareable link" is still pending and is a different thing — a live read-only board, not a static export).
5. **Code → business-domain/flow view.** They map code into auth flows / payment pipelines / user lifecycles. We have *DB* domain clusters but not a code→business-process flow view.
6. **Per-node plain-English LLM summaries ("teaching" content).** Every node has a human summary, tags, "language concept" callouts. We deliberately removed the AI extraction layer — so by design we don't have this.
7. **Distribution & reach.** 16 platforms (Claude Code, Codex, Cursor, Copilot, Gemini, OpenCode, …), a hosted interactive demo anyone can click, viral OSS positioning, multilingual output (en/zh/zh-TW/ja/ko/ru). We are local-first and niche.
8. **Persona-adaptive detail levels** and **community (Louvain) clustering** as an auto-grouping strategy.

## 3. What we do that they don't (our moat)

This list is longer and, honestly, deeper:

1. **The plan loop.** propose → annotate (per-span + board edits) → approve/discard → structured feedback → implement. UA has **nothing** that steers the agent. They are read-only. This is our whole reason to exist and it's uncopyable without becoming us.
2. **Live, deterministic freshness.** Our intel daemon keeps the map in sync with the real repo continuously and ~for free. UA is a snapshot that goes stale the moment you edit; refreshing means re-running an expensive pipeline.
3. **Zero LLM cost for the map.** Our graph is deterministic. Theirs costs real tokens to build (the user eats the bill), and re-eats it on drift.
4. **MCP integration into the live agent loop.** `beacon_context_for_feature`, `beacon_blast_radius`, `propose_plan`, `describe_feature` — the graph is *fed back to the agent as context*, not just shown to a human. UA's graph is a destination; ours is a source.
5. **Forward-looking artifacts.** The *plan*, the *schema you're about to build*, draft tables/endpoints, scope contracts, dependency links between unbuilt features. UA can only describe the past.
6. **Things we already shipped that match their "advanced" features:** Plan-vs-Repo diff + Touched-Files overlay (≈ their Diff Impact), Ask-the-Agent: Explain This Node (≈ `/understand-explain`), Test-Coverage Flags (≈ their `tested_by` linker), polyglot + multi-root code graph, richer transitive blast-radius, semantic zoom + grouped containers + dependency-flow layout (≈ their Structural view), search, layer visualization with stripes/lanes, DB board with domain clusters + docked endpoints, annotations on boards, notes→feature conversion, scope guard, telemetry.
7. **Multi-workspace isolation, per-browser workspace, request-pinned data layer** — real infra they don't need because they're a one-shot artifact generator.

## 4. Do we have an advantage? — yes, but it's a *positioning* advantage, not a *feature* advantage

- On **features-for-comprehension**, we're behind on tours, function-level nodes, path-finder, export, and they have far more reach.
- On **steering a live agent**, we are in a category of one. They cannot follow us here without throwing away their identity (a sharable static artifact) — the live loop requires a running daemon + MCP + a review surface, which is the opposite of "commit the JSON, teammates skip the pipeline."
- On **cost and trust**, our deterministic map is cheaper and more reproducible. Their first-run token bill and snapshot-drift are structural weaknesses we should lean on in our own messaging.

**Net:** we have a defensible position, *not* a feature lead. The risk is not that they beat us at planning — it's that the market only knows the word "codebase graph" through *them*, and we get mistaken for "a worse Understand Anything." The defense is (a) borrow their best comprehension toys that also serve our loop, and (b) sharpen the message that we are the agent's control surface, not a comprehension viewer.

## 5. Brutal truths to sit with

- **They have a hosted demo you can click in 2 seconds; we don't.** For a visual product, that is a massive top-of-funnel advantage. Our "Shareable link" feature being still-pending is a real miss.
- **Their onboarding tour is genuinely good and we have nothing like it.** The first thing a new user sees in their demo is a polished 5-step "Welcome to the knowledge graph." Our first-run experience has no guided narrative.
- **We converged on their exact visualization stack.** There's no technical wow we can claim over them on rendering. Our differentiation has to be the loop, not the pixels.
- **Our "deterministic, no AI extraction" principle is a double-edged sword.** It's our cost/trust moat *and* the reason our nodes will never "teach" like theirs. We should own that trade-off deliberately, not pretend it's pure upside.
- **They support 16 platforms; we're effectively Claude Code + Codex.** If the agent-tooling market fragments, their install surface is a moat we don't have.

## 6. What to incorporate — and what to deliberately NOT chase

### Take action on (these serve *our* north star, reuse assets we already have, and stay deterministic):

| Borrow | Why it fits Beacon | Effort | Priority |
|---|---|---|---|
| **Guided architecture tours / onboarding** | Dependency-ordered walk over our *existing* code graph + layers, computed deterministically (topological order from import edges + entry-point detection). Directly serves "make the agent's work visible/readable." Fills our biggest gap. | M | **P1** |
| **Node-to-node Path Finder** | BFS over existing `CodeFileEdge`. Complements blast-radius (1→all) with A→B. Cheap, deterministic. | S | **P2** |
| **Function/class drill-down (`+Symbols`)** | Expand a file node into its functions/classes. Our intel already tree-sitter-parses for tables/endpoints — extend it to symbols. Closes the granularity gap. | L | **P2** |
| **Export board → PNG / SVG / JSON** | Client-side render of the current React-Flow viewport. Easy sharing win; pairs with the pending Shareable-link work. | S | **P3** |
| **Louvain/coupling grouping option (Files canvas)** | Alternative auto-grouping by import coupling, beside our layer/roots grouping. We can pull in `graphology` like they do. | M | **P3** |

### Do NOT chase (off-identity — chasing these abandons our moat):
- **Per-node LLM "teaching" summaries** — re-introduces the AI extraction layer we deliberately removed; surrenders our cost/determinism moat to compete on *their* turf. If we ever want this, make it an *on-demand, agent-driven* enrichment (the user already has the agent), not a baked pipeline.
- **A chatbot over the graph (`/understand-chat`)** — the user already has the agent in their terminal; our own CLAUDE.md explicitly says Beacon does **not** embed a chatbot.
- **Knowledge-base / wiki (`/understand-knowledge`) analysis** — pure scope creep; nothing to do with steering an agent building software.
- **Persona-adaptive UI** — low value for a single-developer terminal companion.
- **A full one-shot "analyze the whole repo with LLMs" pipeline** — that's their product. Ours is the live daemon. Don't rebuild theirs.

## 7. Strategic / distribution lessons (not feature cards, but the most important takeaways)

1. **Ship the hosted, clickable demo.** Their 54k★ is downstream of "click this link, pan a real graph." Prioritize the pending Shareable-link / public-board work — it's our single highest-leverage growth item.
2. **Sharpen the one-liner against them.** Not "a codebase graph" (they own that phrase) but **"the planning + review surface for your terminal agent — live, deterministic, and wired into the loop."** Lead with the loop and the freshness/cost story.
3. **Lean on their structural weaknesses in messaging:** first-run token bill, snapshot drift, read-only. Our counter: free to keep fresh, always in sync, and it *steers* the agent.
4. **Multi-platform reach is their moat, not a feature.** We don't need 16 platforms, but the lesson is: lower install friction and meet agents where they are (we already did Codex — keep that posture).

---

## Appendix — clever engineering worth remembering (theirs)
- **Louvain batching + `neighborMap`**: groups coupled files so each LLM batch is semantically coherent and can emit cross-batch edges from a pre-computed symbol map without re-reading files.
- **Fingerprint change-classifier** (NONE/COSMETIC/STRUCTURAL): cosmetic-only commits skip re-analysis — the trick that makes incremental cheap. We have an analogous deterministic freshness story; theirs is a good reference for *symbol-level* staleness.
- **2-pass `tested_by` linker**: path-convention test↔prod pairing across 6 language families. We have Test-Coverage Flags; theirs is a clean reference implementation.
- **Two-stage ELK layout** (containers <500ms, children async) + an O(N) aggregation fix after a 4.8MB graph froze the overview. Direct, applicable performance lessons if our boards ever choke on huge repos.
- **Worktree redirect** (write the graph to the main repo root, not the ephemeral worktree). Small but smart.
