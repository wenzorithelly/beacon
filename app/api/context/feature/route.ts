import { codeGraphFreshness } from "@/lib/code-graph-freshness";
import { db, runWithWorkspace } from "@/lib/db-drizzle";
import { appSetting } from "@/lib/drizzle/schema";
import { rankByQuery } from "@/lib/embeddings";
import { workspaceIdFromRequest } from "@/lib/workspaces";

// Cosine threshold below which a vector "match" is considered noise — fall
// through to the lexical path instead. Calibrated empirically against this
// workspace: short-title pairs that genuinely match score ~0.20-0.30, while
// unrelated pairs cluster around 0.05-0.10. The middle band is the cutoff.
const VECTOR_MIN_SCORE = 0.18;

// One-shot "context for working on this feature" — the answer Claude Code used
// to need 15-45K tokens of Glob+Read to derive. Resolves a feature reference
// (id | title | natural-language query) and returns the full neighborhood:
// files + their imports both ways, endpoints in the same domain + the tables
// each touches, those tables' FK relations, sibling architecture components,
// and the project's conventions. One DB round-trip's worth of joins replaces
// the entire blind-discovery phase.

interface ContextResponse {
  feature: {
    id: string;
    title: string;
    cluster: string | null;
    role: string | null;
    plain: string | null;
    status: string;
  } | null;
  files: string[];
  imports: { from: string; to: string }[];
  importedBy: { from: string; to: string }[];
  endpoints: {
    method: string;
    path: string;
    domain: string | null;
    description: string | null;
    tables: { name: string; access: string }[];
  }[];
  tables: {
    name: string;
    domain: string | null;
    description: string | null;
    columns: {
      name: string;
      type: string;
      isPk: boolean;
      isFk: boolean;
      nullable: boolean;
    }[];
    relations: {
      fromTable: string;
      fromColumn: string;
      toTable: string;
      toColumn: string;
    }[];
  }[];
  components: {
    title: string;
    domain: string | null;
    role: string | null;
    plain: string | null;
    files: string[];
  }[];
  conventions: string[];
  codeGraph?: { syncedAt: string | null; watching: boolean };
  note?: string;
}

async function resolveFeature(
  id: string | null,
  title: string | null,
  query: string | null,
) {
  if (id) {
    return db.query.node.findFirst({
      where: (t, { and, eq }) => and(eq(t.id, id), eq(t.view, "ROADMAP")),
    });
  }
  if (title) {
    const exact = await db.query.node.findFirst({
      where: (t, { and, eq }) => and(eq(t.view, "ROADMAP"), eq(t.title, title)),
    });
    if (exact) return exact;
    return db.query.node.findFirst({
      where: (t, { and, eq, like }) => and(eq(t.view, "ROADMAP"), like(t.title, `%${title}%`)),
    });
  }
  if (query) {
    // Vector path: rank by cosine against any roadmap node that has an embedding.
    // Falls through to lexical when no node has an embedding yet, when the
    // embedder fails, or when the top score is below VECTOR_MIN_SCORE (random).
    const embedded = await db.query.node.findMany({
      where: (t, { and, eq, isNotNull }) => and(eq(t.view, "ROADMAP"), isNotNull(t.embedding)),
    });
    if (embedded.length) {
      const ranked = await rankByQuery(
        query,
        embedded.map((n) => ({ ...n, embedding: n.embedding! })),
      );
      if (ranked && ranked.length && ranked[0].score >= VECTOR_MIN_SCORE) {
        return ranked[0].item;
      }
    }
    // Lexical fallback: split the query into words, OR-match against title + plain.
    const words = query.split(/\s+/).filter((w) => w.length >= 3);
    if (!words.length) return null;
    return db.query.node.findFirst({
      where: (t, { and, eq, or, like }) =>
        and(
          eq(t.view, "ROADMAP"),
          or(...words.flatMap((w) => [like(t.title, `%${w}%`), like(t.plain, `%${w}%`)])),
        ),
    });
  }
  return null;
}

export async function GET(req: Request) {
  return runWithWorkspace(workspaceIdFromRequest(req), () => handle(req));
}

async function handle(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const title = url.searchParams.get("title");
  const query = url.searchParams.get("query");

  const feature = await resolveFeature(id, title, query);
  if (!feature) {
    return Response.json({
      feature: null,
      files: [],
      imports: [],
      importedBy: [],
      endpoints: [],
      tables: [],
      components: [],
      conventions: [],
      note: "No feature matched. Try /api/entities?kind=features to list available titles.",
    } satisfies ContextResponse);
  }

  // A confident match (by id, or exact title) == "the agent is working on this
  // feature". Auto-mark it active so edits attach to it and the loop is "started"
  // without a separate beacon_start_feature call. Fuzzy query matches are NOT
  // auto-started — too easy to resolve the wrong node and mis-attribute edits.
  const confident =
    !!id || (!!title && feature.title.trim().toLowerCase() === title.trim().toLowerCase());
  if (confident) {
    await db
      .insert(appSetting)
      .values({ id: "singleton", currentFeatureId: feature.id })
      .onConflictDoUpdate({ target: appSetting.id, set: { currentFeatureId: feature.id } })
      .catch(() => {});
  }

  // Files directly attached to the feature.
  const filesRows = await db.query.nodeFile.findMany({
    where: (t, { eq }) => eq(t.nodeId, feature.id),
    columns: { path: true },
  });
  const files = filesRows.map((f) => f.path);

  // 1-hop import-graph neighborhood. Both directions so Claude sees "blast radius."
  const [importsRows, importedByRows] = files.length
    ? await Promise.all([
        db.query.codeFileEdge.findMany({
          where: (t, { inArray }) => inArray(t.fromPath, files),
          columns: { fromPath: true, toPath: true },
        }),
        db.query.codeFileEdge.findMany({
          where: (t, { inArray }) => inArray(t.toPath, files),
          columns: { fromPath: true, toPath: true },
        }),
      ])
    : [[], []];

  // Endpoints in the same domain — `Endpoint.domain` matches `Node.cluster`.
  const endpointsRaw = feature.cluster
    ? await db.query.endpoint.findMany({
        where: (t, { eq }) => eq(t.domain, feature.cluster!),
        with: { tables: { with: { table: { columns: { name: true } } } } },
      })
    : [];
  const endpoints = endpointsRaw.map((e) => ({
    method: e.method,
    path: e.path,
    domain: e.domain,
    description: e.description,
    tables: e.tables.map((t) => ({ name: t.table.name, access: t.access })),
  }));

  // Tables surfaced by any of those endpoints, plus tables in the domain. Dedupe.
  const tableNames = new Set<string>();
  for (const e of endpoints) for (const t of e.tables) tableNames.add(t.name);
  if (feature.cluster) {
    const domainTables = await db.query.dbTable.findMany({
      where: (t, { eq }) => eq(t.domain, feature.cluster!),
      columns: { name: true },
    });
    for (const t of domainTables) tableNames.add(t.name);
  }
  const tablesRaw = tableNames.size
    ? await db.query.dbTable.findMany({
        where: (t, { inArray }) => inArray(t.name, [...tableNames]),
        with: {
          columns: { orderBy: (c, { asc }) => asc(c.ord) },
          fksOut: { with: { toTable: { columns: { name: true } } } },
        },
      })
    : [];
  const tableNameById = new Map(tablesRaw.map((t) => [t.id, t.name]));
  const tables = tablesRaw.map((t) => ({
    name: t.name,
    domain: t.domain,
    description: t.description,
    columns: t.columns.map((c) => ({
      name: c.name,
      type: c.type,
      isPk: c.isPk,
      isFk: c.isFk,
      nullable: c.nullable,
    })),
    relations: t.fksOut.map((r) => ({
      fromTable: t.name,
      fromColumn: r.fromColumn,
      toTable: r.toTable.name,
      toColumn: r.toColumn,
    })),
  }));
  // Pull inbound FKs too so Claude sees "who points at me" without round-tripping.
  if (tablesRaw.length) {
    const toTableIds = tablesRaw.map((t) => t.id);
    const inbound = await db.query.dbRelation.findMany({
      where: (t, { inArray }) => inArray(t.toTableId, toTableIds),
      with: { fromTable: { columns: { name: true } } },
    });
    for (const r of inbound) {
      const tName = tableNameById.get(r.toTableId);
      const target = tables.find((t) => t.name === tName);
      if (!target) continue;
      const dup = target.relations.some(
        (x) => x.fromTable === r.fromTable.name && x.fromColumn === r.fromColumn,
      );
      if (!dup) {
        target.relations.push({
          fromTable: r.fromTable.name,
          fromColumn: r.fromColumn,
          toTable: tName!,
          toColumn: r.toColumn,
        });
      }
    }
  }

  // Sibling architecture components — the structural neighbors of this feature.
  const componentsRaw = feature.cluster
    ? await db.query.node.findMany({
        where: (t, { and, eq }) =>
          and(eq(t.view, "ARCHITECTURE"), eq(t.cluster, feature.cluster!)),
        with: { files: { columns: { path: true } } },
      })
    : [];
  const components = componentsRaw.map((c) => ({
    title: c.title,
    domain: c.cluster,
    role: c.role,
    plain: c.plain,
    files: c.files.map((f) => f.path),
  }));

  const meta = await db.query.projectMeta.findFirst({
    where: (t, { eq }) => eq(t.id, "singleton"),
  });
  let conventions: string[] = [];
  if (meta?.conventions) {
    try {
      const parsed = JSON.parse(meta.conventions);
      if (Array.isArray(parsed)) conventions = parsed.filter((x) => typeof x === "string");
    } catch {
      /* malformed — ignore */
    }
  }

  const response: ContextResponse = {
    feature: {
      id: feature.id,
      title: feature.title,
      cluster: feature.cluster,
      role: feature.role,
      plain: feature.plain,
      status: feature.status,
    },
    files,
    imports: importsRows.map((r) => ({ from: r.fromPath, to: r.toPath })),
    importedBy: importedByRows.map((r) => ({ from: r.fromPath, to: r.toPath })),
    endpoints,
    tables,
    components,
    conventions,
    codeGraph: await codeGraphFreshness(req),
  };
  if (!files.length) {
    response.note =
      "This feature has no files attached yet. The map is still useful for tables/endpoints/components. " +
      "Call beacon_describe_feature at the end of work to attach files.";
  }
  return Response.json(response);
}
