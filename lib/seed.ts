import { db } from "@/lib/db";

/**
 * Seeds the control map from three sources, all grounded in the Juriscan
 * proposal PDF and the prior vibe-coded reference codebase:
 *   1. ROADMAP   — the production-reform plan (emergency + 4 fronts + DoD)
 *   2. ARCHITECTURE — the reference feature inventory with keep/rebuild/replace/drop
 *   3. Bugs      — the 8 confirmed issues (real file:line), each linked to a front
 *
 * Idempotent: clears all tables then re-inserts, so it is safe to re-run and to
 * use as a test fixture.
 */

const LANE = 340; // x spacing between roadmap fronts / arch columns
const ROW = 92; // y spacing between stacked children

type Prisma = typeof db;

interface Child {
  title: string;
  plain?: string;
  criterion?: boolean; // one of the 8 binary success criteria
}

interface Front {
  cluster: string;
  title: string;
  role: string;
  plain: string;
  priority?: number;
  children: Child[];
}

const FRONTS: Front[] = [
  {
    cluster: "EMERGENCY",
    priority: 0,
    title: "Emergência: bucket público",
    role: "Fechar o bucket de uploads exposto publicamente",
    plain:
      "Right now anyone on the internet — with no login — can list, download, overwrite and delete clients' uploaded files. Lock the uploads bucket down before anything else.",
    children: [
      { title: "Set bucket public = false" },
      { title: "Owner-scoped RLS (select/insert/update/delete)" },
      {
        title: "Anonymous access returns 401/403",
        criterion: true,
        plain: "Success criterion #4 — the bucket rejects anyone not logged in.",
      },
    ],
  },
  {
    cluster: "FRONT_1",
    title: "Frente 1: busca por similaridade",
    role: "Trocar a busca falsa por busca vetorial nativa (pgvector)",
    plain:
      "Search pretends to be semantic but actually ships full precedent texts to an AI to guess relevance — slow, costly and non-reproducible. Replace it with real vector search.",
    children: [
      { title: "Native pgvector kNN search (drop LLM ranking)" },
      { title: "Fix embedding dimension (768 → 1536)" },
      {
        title: "recall@10 ≥ 0.85 with avg latency < 500ms",
        criterion: true,
        plain: "Success criterion #7 — search is accurate and fast.",
      },
      { title: "Cost per query < US$ 0.005" },
    ],
  },
  {
    cluster: "FRONT_2",
    priority: 0,
    title: "Frente 2: contas e escritórios",
    role: "Introduzir o conceito de escritório (multi-tenant) — caminho crítico",
    plain:
      "Today every lawyer is an island. Add the idea of a law firm so colleagues share cases, quota and keys — and so one firm can never read or change another firm's data. This front defines how everything connects to the paying customer.",
    children: [
      { title: "Firm/org model + membership" },
      {
        title: "Real tenant isolation (firm A can't read/modify firm B)",
        criterion: true,
        plain: "Success criterion #1 — true data isolation between firms.",
      },
      {
        title: "Member invite + password reset end-to-end",
        criterion: true,
        plain: "Success criterion #2 — invites and resets work in production.",
      },
      { title: "Encrypt API keys at rest" },
      { title: "Close Enterprise-plan self-promote bypass" },
      {
        title: "Shared quota + admin sees aggregate usage",
        criterion: true,
        plain: "Success criterion #3 — quota respected, firm admin sees totals.",
      },
      {
        title: "Cascade-delete a user across all tables (LGPD)",
        criterion: true,
        plain: "Success criterion #5 — deleting a user removes their data atomically.",
      },
    ],
  },
  {
    cluster: "FRONT_3",
    title: "Frente 3: lógica de negócio / cota de IA",
    role: "Consolidar geração de petições em um provedor + cota por escritório",
    plain:
      "Petition generation accepts five AI providers in parallel with no limit, so any user can drain a provider's balance in an afternoon. Pick one provider after a benchmark and enforce a per-firm monthly quota.",
    children: [
      { title: "Benchmark 5–10 petitions, choose ONE provider" },
      { title: "Remove the 5-provider switch" },
      {
        title: "Every AI call verifies firm + quota before executing",
        criterion: true,
        plain: "Success criterion #6 — no AI call runs without a firm + quota check.",
      },
      { title: "Enforce quota on generate-petition & find-applicable-precedents" },
    ],
  },
  {
    cluster: "FRONT_4",
    title: "Frente 4: dívida técnica do banco",
    role: "Quitar a dívida técnica do banco de dados",
    plain:
      "The schema has inconsistent column types, referential integrity only by convention, and scheduled jobs that live outside version control. Clean these up before the data grows.",
    children: [
      { title: "Fix column type inconsistencies" },
      { title: "Add foreign-key constraints (real referential integrity)" },
      { title: "Move pg_cron / scheduled jobs into version control" },
    ],
  },
  {
    cluster: "CROSS_CUTTING",
    title: "Transversais & Definition of Done",
    role: "Itens transversais e os 8 critérios objetivos de sucesso",
    plain:
      "Work that cuts across every front, plus the eight pass/fail criteria that define 'done'. The project ships when all eight are simultaneously true.",
    children: [
      { title: "Wire Sentry error monitoring" },
      {
        title: "Total monthly cost < US$ 160 (first 90 days)",
        criterion: true,
        plain: "Success criterion #8 — operating cost stays under budget.",
      },
    ],
  },
];

interface ArchNode {
  key: string;
  cluster: string;
  title: string;
  role: string;
  plain: string;
  status: "KEEP" | "REBUILD" | "REPLACE" | "DROP";
  sourceRef?: string;
  tags: string[];
}

const ARCH: ArchNode[] = [
  {
    key: "auth",
    cluster: "AUTH",
    title: "Auth & Accounts",
    role: "Supabase email/password auth, RBAC, subscriptions",
    plain: "How users log in and what plan they're on. Rebuild on the new stack.",
    status: "REBUILD",
    tags: ["auth"],
  },
  {
    key: "firms",
    cluster: "FIRMS",
    title: "Firms / Organizations",
    role: "Multi-tenant firm model — absent today",
    plain: "The law-firm concept that doesn't exist yet. Build from scratch.",
    status: "REBUILD",
    tags: ["firms"],
  },
  {
    key: "semantic-search",
    cluster: "SEARCH",
    title: "semantic-search (LLM ranking)",
    role: "Fake semantic search that ranks via an LLM",
    plain: "The search that secretly asks an AI to rank full texts. Replace it.",
    status: "REPLACE",
    sourceRef: "supabase/functions/semantic-search/index.ts:107-173",
    tags: ["search", "ai"],
  },
  {
    key: "rag-search",
    cluster: "SEARCH",
    title: "rag-search (pgvector)",
    role: "Real embedding/vector search — the keeper path",
    plain: "The proper vector search. Rebuild this as the single search path.",
    status: "REBUILD",
    sourceRef: "supabase/functions/rag-search/index.ts",
    tags: ["search"],
  },
  {
    key: "storage",
    cluster: "STORAGE",
    title: "Document upload / storage",
    role: "Spreadsheet upload + Supabase storage bucket",
    plain: "Uploading case files. Rebuild and fix the public-bucket hole.",
    status: "REBUILD",
    tags: ["storage"],
  },
  {
    key: "petition",
    cluster: "PETITION",
    title: "AI petition generation",
    role: "Multi-provider petition generator (5 providers)",
    plain: "Drafting petitions with AI. Replace the 5-provider sprawl with one.",
    status: "REPLACE",
    sourceRef: "supabase/functions/generate-petition/index.ts",
    tags: ["petition", "ai"],
  },
  {
    key: "billing",
    cluster: "BILLING",
    title: "Plans / quota / billing",
    role: "Subscription plans + monthly quota tracking",
    plain: "Who pays for what and how much they can use. Rebuild with firm quota.",
    status: "REBUILD",
    tags: ["billing"],
  },
  {
    key: "admin",
    cluster: "ADMIN",
    title: "Admin dashboards / reporting",
    role: "KPI dashboard, reports, classification dashboards",
    plain: "Internal screens to see what's happening. Mostly keep as-is.",
    status: "KEEP",
    tags: ["admin"],
  },
  {
    key: "ingest",
    cluster: "INGEST",
    title: "Scrapers / ingestion (STF/STJ)",
    role: "Playwright scrapers + pg_cron + GitHub Action",
    plain: "The robots that pull court precedents daily. Rebuild into version control.",
    status: "REBUILD",
    tags: ["ingest"],
  },
  {
    key: "embeddings",
    cluster: "EMBEDDINGS",
    title: "Embeddings / classification",
    role: "Embedding generation + theme classification",
    plain: "Turning text into vectors and tagging themes. Rebuild and fix the dimension.",
    status: "REBUILD",
    tags: ["embeddings", "ai"],
  },
  {
    key: "monitoring",
    cluster: "MONITORING",
    title: "Process monitoring / WhatsApp",
    role: "Monitored processes + theme-change WhatsApp alerts",
    plain: "Watching specific cases and pinging users on WhatsApp. Keep.",
    status: "KEEP",
    tags: ["monitoring"],
  },
  {
    key: "predatory",
    cluster: "PREDATORY",
    title: "Predatory-litigation detector",
    role: "5-module predatory litigation risk scoring",
    plain: "Flags abusive mass-litigation patterns. Keep.",
    status: "KEEP",
    tags: ["predatory", "ai"],
  },
];

interface BugSeed {
  title: string;
  detail: string;
  severity: "critical" | "high" | "medium" | "low";
  sourceRef: string;
  frontCluster: string;
}

const BUGS: BugSeed[] = [
  {
    title: "Uploads bucket is public (anon list/read/overwrite/delete)",
    detail: "Bucket set public=true with permissive RLS allowing anonymous CRUD on client files.",
    severity: "critical",
    sourceRef: "supabase/migrations/20260106164511_*.sql:4-6,15-36",
    frontCluster: "EMERGENCY",
  },
  {
    title: "API keys stored in plain text",
    detail: "user_api_keys.api_key is TEXT, unencrypted and recoverable indefinitely.",
    severity: "critical",
    sourceRef: "supabase/migrations/20251115015619_*.sql",
    frontCluster: "FRONT_2",
  },
  {
    title: "Enterprise plan self-promote bypass",
    detail: "user_subscriptions UPDATE RLS has no WITH CHECK; a user can set plan/quota themselves.",
    severity: "critical",
    sourceRef: "supabase/migrations/20251115020040_*.sql:25-27",
    frontCluster: "FRONT_2",
  },
  {
    title: "generate-petition: 5 providers, no auth, no quota",
    detail: "Accepts OpenAI/Anthropic/xAI/Gemini/Azure with no API-key check and no rate limit.",
    severity: "critical",
    sourceRef: "supabase/functions/generate-petition/index.ts:5,162-192",
    frontCluster: "FRONT_3",
  },
  {
    title: "No firm / escritório concept",
    detail: "No firm/org/team table anywhere; every lawyer is isolated with no shared quota/keys.",
    severity: "high",
    sourceRef: "supabase/migrations/* (schema-wide)",
    frontCluster: "FRONT_2",
  },
  {
    title: "Fake semantic search (LLM ranks full text)",
    detail: "semantic-search ignores embeddings and asks an LLM to rank truncated descriptions.",
    severity: "high",
    sourceRef: "supabase/functions/semantic-search/index.ts:107-173",
    frontCluster: "FRONT_1",
  },
  {
    title: "Quota not enforced on AI calls",
    detail: "generate-petition and find-applicable-precedents never call checkRateLimit.",
    severity: "critical",
    sourceRef: "supabase/functions/find-applicable-precedents/index.ts:18-147",
    frontCluster: "FRONT_3",
  },
  {
    title: "Embedding dimension mismatch",
    detail: "vector(768) columns vs text-embedding-3-small (1536-dim) — embeddings won't fit.",
    severity: "high",
    sourceRef: "supabase/migrations/20251115014026_*.sql",
    frontCluster: "FRONT_1",
  },
];

export async function seedDatabase(prisma: Prisma = db) {
  // Idempotent reset (FK-safe order).
  await prisma.bug.deleteMany();
  await prisma.edge.deleteMany();
  await prisma.note.deleteMany();
  await prisma.node.deleteMany();
  await prisma.tag.deleteMany();

  // --- ROADMAP fronts + subtasks ---
  const frontIdByCluster: Record<string, string> = {};
  for (let lane = 0; lane < FRONTS.length; lane++) {
    const front = FRONTS[lane];
    const created = await prisma.node.create({
      data: {
        view: "ROADMAP",
        cluster: front.cluster,
        title: front.title,
        role: front.role,
        plain: front.plain,
        status: "PENDING",
        priority: front.priority ?? 2,
        x: lane * LANE,
        y: 0,
        children: {
          create: front.children.map((child, i) => ({
            view: "ROADMAP",
            cluster: front.cluster,
            title: child.title,
            plain: child.plain,
            status: "PENDING",
            x: lane * LANE,
            y: 140 + i * ROW,
            ...(child.criterion
              ? {
                  tags: {
                    connectOrCreate: {
                      where: { label: "criterion" },
                      create: { label: "criterion", color: "#f5b942" },
                    },
                  },
                }
              : {}),
          })),
        },
      },
    });
    frontIdByCluster[front.cluster] = created.id;
  }

  // --- ARCHITECTURE inventory ---
  const archIdByKey: Record<string, string> = {};
  for (let i = 0; i < ARCH.length; i++) {
    const a = ARCH[i];
    const created = await prisma.node.create({
      data: {
        view: "ARCHITECTURE",
        cluster: a.cluster,
        title: a.title,
        role: a.role,
        plain: a.plain,
        status: a.status,
        sourceRef: a.sourceRef,
        x: (i % 4) * LANE,
        y: Math.floor(i / 4) * 170,
        tags: {
          connectOrCreate: a.tags.map((label) => ({
            where: { label },
            create: { label },
          })),
        },
      },
    });
    archIdByKey[a.key] = created.id;
  }

  // --- Bugs linked to fronts ---
  for (const b of BUGS) {
    await prisma.bug.create({
      data: {
        title: b.title,
        detail: b.detail,
        severity: b.severity,
        status: "OPEN",
        sourceRef: b.sourceRef,
        nodeId: frontIdByCluster[b.frontCluster],
      },
    });
  }

  // --- A few illustrative edges (cross-cluster wiring) ---
  await prisma.edge.create({
    data: {
      fromId: frontIdByCluster.FRONT_3,
      toId: frontIdByCluster.FRONT_2,
      kind: "DEPENDS",
      label: "cota por escritório depende de Frente 2",
    },
  });
  await prisma.edge.create({
    data: {
      fromId: archIdByKey["semantic-search"],
      toId: archIdByKey["rag-search"],
      kind: "REPLACES",
      label: "trocar por busca vetorial",
    },
  });
}
