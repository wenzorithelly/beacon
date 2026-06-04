import { db } from "@/lib/db";

/**
 * Seeds the database-design map with a proposed Juriscan v2 schema
 * (FastAPI + SQLAlchemy + Alembic, Postgres). Firms-centric multi-tenant model
 * that resolves the proposal's reform: real "escritório" isolation, hashed API
 * keys, server-side quota, pgvector precedents, LGPD audit trail.
 *
 * Idempotent. A future introspection job can replace this by upserting from the
 * SQLAlchemy metadata + FastAPI routes.
 */

type Prisma = typeof db;

interface Col {
  name: string;
  type: string;
  isPk?: boolean;
  isFk?: boolean;
  nullable?: boolean;
  note?: string;
}
interface Table {
  name: string;
  domain: string;
  x: number;
  y: number;
  description: string;
  columns: Col[];
}

const TABLES: Table[] = [
  {
    name: "firms",
    domain: "firms",
    x: 0,
    y: 300,
    description: "Law firm (escritório) — the tenant. Holds plan + aggregated quota.",
    columns: [
      { name: "id", type: "UUID", isPk: true, nullable: false },
      { name: "name", type: "TEXT", nullable: false },
      { name: "plan", type: "TEXT", nullable: false, note: "free|pro|enterprise" },
      { name: "monthly_quota", type: "INTEGER", nullable: false },
      { name: "current_usage", type: "INTEGER", nullable: false },
      { name: "quota_reset_at", type: "TIMESTAMPTZ", nullable: false },
      { name: "created_at", type: "TIMESTAMPTZ", nullable: false },
    ],
  },
  {
    name: "users",
    domain: "auth",
    x: 360,
    y: 40,
    description: "A lawyer. Belongs to exactly one firm.",
    columns: [
      { name: "id", type: "UUID", isPk: true, nullable: false },
      { name: "firm_id", type: "UUID", isFk: true, nullable: false },
      { name: "email", type: "CITEXT", nullable: false, note: "unique" },
      { name: "hashed_password", type: "TEXT", nullable: false },
      { name: "role", type: "TEXT", nullable: false, note: "admin|member" },
      { name: "created_at", type: "TIMESTAMPTZ", nullable: false },
    ],
  },
  {
    name: "api_keys",
    domain: "auth",
    x: 360,
    y: 320,
    description: "Per-firm API keys. Stored HASHED (fixes plaintext-key bug).",
    columns: [
      { name: "id", type: "UUID", isPk: true, nullable: false },
      { name: "firm_id", type: "UUID", isFk: true, nullable: false },
      { name: "name", type: "TEXT", nullable: false },
      { name: "key_hash", type: "TEXT", nullable: false, note: "bcrypt/argon2" },
      { name: "last_used_at", type: "TIMESTAMPTZ" },
      { name: "is_active", type: "BOOLEAN", nullable: false },
    ],
  },
  {
    name: "firm_invites",
    domain: "firms",
    x: 360,
    y: 600,
    description: "Pending member invitations (token + expiry).",
    columns: [
      { name: "id", type: "UUID", isPk: true, nullable: false },
      { name: "firm_id", type: "UUID", isFk: true, nullable: false },
      { name: "email", type: "CITEXT", nullable: false },
      { name: "token", type: "TEXT", nullable: false },
      { name: "expires_at", type: "TIMESTAMPTZ", nullable: false },
      { name: "accepted_at", type: "TIMESTAMPTZ" },
    ],
  },
  {
    name: "precedents",
    domain: "search",
    x: 760,
    y: 20,
    description: "Court precedents (STF/STJ/TST) with native pgvector embedding.",
    columns: [
      { name: "id", type: "UUID", isPk: true, nullable: false },
      { name: "court", type: "TEXT", nullable: false, note: "STF|STJ|TST" },
      { name: "theme_number", type: "INTEGER" },
      { name: "title", type: "TEXT", nullable: false },
      { name: "canonical_text", type: "TEXT" },
      { name: "law_branch", type: "TEXT" },
      { name: "embedding", type: "vector(1536)", note: "text-embedding-3-large" },
      { name: "updated_at", type: "TIMESTAMPTZ", nullable: false },
    ],
  },
  {
    name: "searches",
    domain: "search",
    x: 760,
    y: 300,
    description: "Search usage log (latency + cost) — drives quota + analytics.",
    columns: [
      { name: "id", type: "UUID", isPk: true, nullable: false },
      { name: "firm_id", type: "UUID", isFk: true, nullable: false },
      { name: "user_id", type: "UUID", isFk: true, nullable: false },
      { name: "query", type: "TEXT", nullable: false },
      { name: "results_count", type: "INTEGER", nullable: false },
      { name: "latency_ms", type: "INTEGER" },
      { name: "cost_cents", type: "NUMERIC" },
      { name: "created_at", type: "TIMESTAMPTZ", nullable: false },
    ],
  },
  {
    name: "uploads",
    domain: "storage",
    x: 760,
    y: 580,
    description: "Uploaded case documents (private bucket, owner-scoped).",
    columns: [
      { name: "id", type: "UUID", isPk: true, nullable: false },
      { name: "firm_id", type: "UUID", isFk: true, nullable: false },
      { name: "user_id", type: "UUID", isFk: true, nullable: false },
      { name: "filename", type: "TEXT", nullable: false },
      { name: "storage_path", type: "TEXT", nullable: false },
      { name: "status", type: "TEXT", nullable: false },
      { name: "created_at", type: "TIMESTAMPTZ", nullable: false },
    ],
  },
  {
    name: "petitions",
    domain: "petitions",
    x: 1160,
    y: 120,
    description: "AI-generated petitions (single consolidated provider).",
    columns: [
      { name: "id", type: "UUID", isPk: true, nullable: false },
      { name: "firm_id", type: "UUID", isFk: true, nullable: false },
      { name: "user_id", type: "UUID", isFk: true, nullable: false },
      { name: "prompt", type: "TEXT", nullable: false },
      { name: "content", type: "TEXT" },
      { name: "provider", type: "TEXT", nullable: false },
      { name: "tokens_used", type: "INTEGER" },
      { name: "created_at", type: "TIMESTAMPTZ", nullable: false },
    ],
  },
  {
    name: "monitored_processes",
    domain: "monitoring",
    x: 760,
    y: 860,
    description: "Cases a firm watches; theme-change alerts via email/WhatsApp.",
    columns: [
      { name: "id", type: "UUID", isPk: true, nullable: false },
      { name: "firm_id", type: "UUID", isFk: true, nullable: false },
      { name: "process_number", type: "TEXT", nullable: false },
      { name: "notify_email", type: "BOOLEAN", nullable: false },
      { name: "notify_whatsapp", type: "BOOLEAN", nullable: false },
      { name: "created_at", type: "TIMESTAMPTZ", nullable: false },
    ],
  },
  {
    name: "audit_log",
    domain: "admin",
    x: 1160,
    y: 460,
    description: "LGPD audit trail; user-delete cascades through tenant data.",
    columns: [
      { name: "id", type: "UUID", isPk: true, nullable: false },
      { name: "firm_id", type: "UUID", isFk: true, nullable: false },
      { name: "user_id", type: "UUID", isFk: true },
      { name: "action", type: "TEXT", nullable: false },
      { name: "entity", type: "TEXT", nullable: false },
      { name: "created_at", type: "TIMESTAMPTZ", nullable: false },
    ],
  },
];

interface Rel {
  from: string;
  fromCol: string;
  to: string;
  toCol: string;
}
const RELATIONS: Rel[] = [
  { from: "users", fromCol: "firm_id", to: "firms", toCol: "id" },
  { from: "api_keys", fromCol: "firm_id", to: "firms", toCol: "id" },
  { from: "firm_invites", fromCol: "firm_id", to: "firms", toCol: "id" },
  { from: "searches", fromCol: "firm_id", to: "firms", toCol: "id" },
  { from: "searches", fromCol: "user_id", to: "users", toCol: "id" },
  { from: "uploads", fromCol: "firm_id", to: "firms", toCol: "id" },
  { from: "uploads", fromCol: "user_id", to: "users", toCol: "id" },
  { from: "petitions", fromCol: "firm_id", to: "firms", toCol: "id" },
  { from: "petitions", fromCol: "user_id", to: "users", toCol: "id" },
  { from: "monitored_processes", fromCol: "firm_id", to: "firms", toCol: "id" },
  { from: "audit_log", fromCol: "firm_id", to: "firms", toCol: "id" },
  { from: "audit_log", fromCol: "user_id", to: "users", toCol: "id" },
];

interface Ep {
  method: string;
  path: string;
  domain: string;
  x: number;
  y: number;
  description: string;
  uses: [string, string][]; // [tableName, access]
}
const ENDPOINTS: Ep[] = [
  { method: "POST", path: "/auth/register", domain: "auth", x: -460, y: 0, description: "Create firm + first admin user", uses: [["firms", "write"], ["users", "write"]] },
  { method: "POST", path: "/auth/login", domain: "auth", x: -460, y: 110, description: "Authenticate", uses: [["users", "read"]] },
  { method: "POST", path: "/auth/password-reset", domain: "auth", x: -460, y: 220, description: "Reset password end-to-end", uses: [["users", "write"]] },
  { method: "POST", path: "/firms/{id}/invites", domain: "firms", x: -460, y: 330, description: "Invite a member", uses: [["firm_invites", "write"], ["firms", "read"]] },
  { method: "POST", path: "/invites/accept", domain: "firms", x: -460, y: 440, description: "Accept invite → create user", uses: [["firm_invites", "write"], ["users", "write"]] },
  { method: "GET", path: "/firms/{id}/usage", domain: "firms", x: -460, y: 550, description: "Aggregated firm consumption", uses: [["firms", "read"], ["searches", "read"], ["petitions", "read"]] },
  { method: "POST", path: "/api-keys", domain: "auth", x: -460, y: 660, description: "Mint a hashed API key", uses: [["api_keys", "write"], ["firms", "read"]] },
  { method: "POST", path: "/search", domain: "search", x: -460, y: 770, description: "pgvector similarity search (quota-checked)", uses: [["precedents", "read"], ["searches", "write"], ["firms", "read-write"]] },
  { method: "POST", path: "/petitions", domain: "petitions", x: -460, y: 880, description: "Generate petition (quota-checked)", uses: [["petitions", "write"], ["uploads", "read"], ["firms", "read-write"]] },
  { method: "POST", path: "/uploads", domain: "storage", x: -460, y: 990, description: "Upload a case document", uses: [["uploads", "write"], ["firms", "read"]] },
  { method: "GET", path: "/processes", domain: "monitoring", x: -460, y: 1100, description: "List monitored processes", uses: [["monitored_processes", "read"]] },
  { method: "DELETE", path: "/users/{id}", domain: "admin", x: -460, y: 1210, description: "LGPD delete (cascade)", uses: [["users", "write"], ["audit_log", "write"]] },
];

export async function seedDatabaseDesign(prisma: Prisma = db) {
  await prisma.endpointTable.deleteMany();
  await prisma.endpoint.deleteMany();
  await prisma.dbRelation.deleteMany();
  await prisma.dbColumn.deleteMany();
  await prisma.dbTable.deleteMany();

  const tableIdByName: Record<string, string> = {};
  for (const t of TABLES) {
    const created = await prisma.dbTable.create({
      data: {
        name: t.name,
        domain: t.domain,
        description: t.description,
        x: t.x,
        y: t.y,
        columns: {
          create: t.columns.map((c, i) => ({
            name: c.name,
            type: c.type,
            isPk: c.isPk ?? false,
            isFk: c.isFk ?? false,
            nullable: c.nullable ?? true,
            note: c.note,
            ord: i,
          })),
        },
      },
    });
    tableIdByName[t.name] = created.id;
  }

  for (const r of RELATIONS) {
    await prisma.dbRelation.create({
      data: {
        fromTableId: tableIdByName[r.from],
        toTableId: tableIdByName[r.to],
        fromColumn: r.fromCol,
        toColumn: r.toCol,
        label: `${r.fromCol} → ${r.to}.${r.toCol}`,
      },
    });
  }

  for (const e of ENDPOINTS) {
    await prisma.endpoint.create({
      data: {
        method: e.method,
        path: e.path,
        domain: e.domain,
        description: e.description,
        x: e.x,
        y: e.y,
        tables: {
          create: e.uses.map(([tableName, access]) => ({
            tableId: tableIdByName[tableName],
            access,
          })),
        },
      },
    });
  }
}
