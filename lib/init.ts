import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { db } from "@/lib/db";
import { bumpVersion, ingestSnapshot, type Snapshot } from "@/lib/ingest";
import { structured } from "@/lib/ai-structured";
import { getAppSettings } from "@/lib/settings";
import { setProjectMeta } from "@/lib/project-meta";
import { writeContextFiles } from "@/lib/context-files";
import { repoRoot } from "@/lib/project";
import { loadConfig } from "@/intel/config";
import { scanFiles, type SourceFile } from "@/intel/extractors/files";
import { fetchOpenApi } from "@/intel/extractors/openapi";
import { extractImports, importGraphText } from "@/intel/extractors/imports";
import { extractGraph } from "@/intel/extract";
import { mergeSnapshot } from "@/intel/merge";

// `beacon init`: read an existing repo, understand it, and map its architecture +
// database. Reuses the code-intelligence extraction for the DB/endpoints, and adds an
// AI architecture pass that turns the repo (tree + manifests + source) into a graph of
// components grouped by domain, each linked to its key files.

const archSchema = z.object({
  components: z
    .array(
      z.object({
        title: z.string().trim().min(1),
        domain: z.string().trim().min(1),
        role: z.string().nullish(),
        plain: z.string().nullish(),
        files: z.array(z.string()).default([]),
        depends: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  roadmap: z
    .array(
      z.object({
        title: z.string().trim().min(1),
        why: z.string().nullish(),
      }),
    )
    .default([]),
  overview: z.string().nullish(),
  conventions: z.array(z.string()).default([]),
});
type Arch = z.infer<typeof archSchema>;

const ARCH_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    components: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          domain: { type: "string" },
          role: { type: ["string", "null"] },
          plain: { type: ["string", "null"] },
          files: { type: "array", items: { type: "string" } },
          depends: { type: "array", items: { type: "string" } },
        },
        required: ["title", "domain"],
      },
    },
    roadmap: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          why: { type: ["string", "null"] },
        },
        required: ["title"],
      },
    },
    overview: { type: ["string", "null"] },
    conventions: { type: "array", items: { type: "string" } },
  },
  required: ["components", "roadmap"],
};

const ARCH_SYSTEM = `You are a software architect mapping an EXISTING codebase from the repository context provided (file tree, manifests/README, a MODULE DEPENDENCY GRAPH, and source samples).

Produce a concise architecture map:
- components: the main building blocks (services, modules, subsystems, features) — aim for ~8-25, not every file. USE THE DEPENDENCY GRAPH to draw sharper boundaries: files that import each other heavily usually belong to the same component; the external packages a file uses hint at its role.
- domain: a short UPPERCASE area each belongs to (e.g. AUTH, API, DATA, UI, JOBS, BILLING, SEARCH, INFRA…).
- role: one-line technical role. plain: one plain-language sentence.
- files: the few key repo-relative files that implement it (so they can be linked on the map).
- depends: titles of other components it depends on, derived from the dependency graph (optional).

Also propose "roadmap": 3-6 BROAD, HIGH-LEVEL directions for this project — big-picture themes only (e.g. "Harden auth & security", "Add automated test coverage", "Scale the data layer", "Add observability", "Pay down tech debt"). These are SUGGESTIONS, deliberately vague and strategic — NOT detailed tasks, NOT file-level. Keep each to a short title + one-line "why".

Also provide:
- overview: one short paragraph — what this project is and its stack — for an AI contributor's context file.
- conventions: 3-8 concrete conventions/gotchas an AI contributor MUST follow (build/test commands, where code goes, patterns, things easy to get wrong).

Infer the stack from the manifests. Describe only what is actually present. Output ONLY via the structure.`;

const MANIFESTS = [
  "README.md",
  "README",
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "go.mod",
  "Cargo.toml",
  "pom.xml",
  "composer.json",
  "Gemfile",
];

function readManifests(root: string): string {
  const out: string[] = [];
  for (const m of MANIFESTS) {
    const p = join(root, m);
    if (existsSync(p)) {
      try {
        out.push(`### ${m}\n${readFileSync(p, "utf8").slice(0, 2500)}`);
      } catch {
        /* skip */
      }
    }
  }
  return out.join("\n\n") || "(no manifests found)";
}

function fileTree(files: SourceFile[], max = 400): string {
  return files
    .map((f) => f.path)
    .sort()
    .slice(0, max)
    .join("\n");
}

export async function analyzeArchitecture(files: SourceFile[]): Promise<Arch | null> {
  const settings = await getAppSettings();
  const root = repoRoot();
  const sample = files
    .slice(0, 40)
    .map((f) => `// ${f.path}\n${f.content.slice(0, 1200)}`)
    .join("\n\n");
  const graph = importGraphText(extractImports(files));
  const prompt = [
    `Repository: ${root}`,
    `## File tree\n${fileTree(files)}`,
    `## Manifests / README\n${readManifests(root)}`,
    `## Module dependency graph (file -> internal imports | external pkgs)\n${graph || "(none detected)"}`,
    `## Source samples\n${sample}`,
  ].join("\n\n");

  const raw = await structured({
    system: ARCH_SYSTEM,
    prompt,
    schema: ARCH_JSON_SCHEMA,
    model: settings.intelModel,
    provider: settings.intelProvider,
  });
  return raw ? archSchema.parse(raw) : null;
}

export async function persistArchitecture(arch: Arch): Promise<number> {
  // Idempotent: replace a previous init-derived architecture.
  await db.node.deleteMany({ where: { view: "ARCHITECTURE", source: "INIT" } });

  const domains = Array.from(new Set(arch.components.map((c) => c.domain)));
  const idByTitle = new Map<string, string>();

  for (const c of arch.components) {
    const lane = domains.indexOf(c.domain);
    const inLane = arch.components.filter((x) => x.domain === c.domain);
    const idx = inLane.indexOf(c);
    const node = await db.node.create({
      data: {
        view: "ARCHITECTURE",
        source: "INIT",
        cluster: c.domain,
        title: c.title,
        role: c.role ?? null,
        plain: c.plain ?? null,
        status: "KEEP",
        x: lane * 320,
        y: idx * 150,
        files: { create: Array.from(new Set(c.files)).map((path) => ({ path })) },
      },
    });
    idByTitle.set(c.title.toLowerCase(), node.id);
  }

  for (const c of arch.components) {
    const fromId = idByTitle.get(c.title.toLowerCase());
    for (const dep of c.depends ?? []) {
      const toId = idByTitle.get(dep.toLowerCase());
      if (fromId && toId && fromId !== toId) {
        await db.edge.create({ data: { fromId, toId, kind: "DEPENDS" } }).catch(() => {});
      }
    }
  }
  return arch.components.length;
}

/** Persist the broad, high-level roadmap suggestions as ROADMAP fronts (source=INIT). */
export async function persistRoadmap(roadmap: Arch["roadmap"]): Promise<number> {
  await db.node.deleteMany({ where: { view: "ROADMAP", source: "INIT" } });
  for (let i = 0; i < roadmap.length; i++) {
    const r = roadmap[i];
    await db.node.create({
      data: {
        view: "ROADMAP",
        source: "INIT",
        title: r.title,
        plain: r.why ?? null,
        status: "PENDING",
        x: i * 320,
        y: 0,
      },
    });
  }
  return roadmap.length;
}

export async function runInit(): Promise<{
  files: number;
  tables: number;
  endpoints: number;
  components: number;
  roadmap: number;
  context: string[];
}> {
  const config = loadConfig();
  const roots = config.roots.map((r) => resolve(config.configDir, r));
  const seen = new Set<string>();
  const files: SourceFile[] = [];
  for (const root of roots) {
    for (const f of scanFiles(root, { maxFiles: config.llm.maxFiles, maxBytes: config.llm.maxBytes })) {
      if (!seen.has(f.path)) {
        seen.add(f.path);
        files.push(f);
      }
    }
  }

  // 1. Database + endpoints (reuse code intelligence; write straight to the DB).
  let tables = 0;
  let endpoints = 0;
  try {
    const facts = await fetchOpenApi(config.openapiUrl);
    const { snapshot } = await extractGraph(files, facts, config);
    const base: Snapshot = snapshot ?? {
      tables: [],
      relations: [],
      endpoints: facts.map((e) => ({ ...e, uses: [] })),
    };
    const merged = mergeSnapshot(base, facts);
    if ((merged.tables?.length ?? 0) + (merged.endpoints?.length ?? 0) > 0) {
      const res = await ingestSnapshot(merged);
      tables = res.tables;
      endpoints = res.endpoints;
    }
  } catch (e) {
    console.error("[init] db extraction failed:", e instanceof Error ? e.message : e);
  }

  // 2. Architecture map + high-level roadmap suggestions + context files.
  let components = 0;
  let roadmap = 0;
  let context: string[] = [];
  try {
    const arch = await analyzeArchitecture(files);
    if (arch) {
      components = await persistArchitecture(arch);
      roadmap = await persistRoadmap(arch.roadmap);
      await setProjectMeta({ overview: arch.overview ?? null, conventions: arch.conventions });
    }
  } catch (e) {
    console.error("[init] architecture analysis failed:", e instanceof Error ? e.message : e);
  }

  // 3. Write AGENTS.md + ensure CLAUDE.md imports it (so Claude Code reads it).
  try {
    context = await writeContextFiles();
  } catch (e) {
    console.error("[init] context files failed:", e instanceof Error ? e.message : e);
  }

  await bumpVersion();
  return { files: files.length, tables, endpoints, components, roadmap, context };
}
