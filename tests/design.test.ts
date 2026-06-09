import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";

// Isolate the JSON draft store (dataDir()/draft.json) into a throwaway dir.
process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-draft-"));

import { db } from "@/lib/db";
import { dbTable, endpoint, endpointTable } from "@/lib/drizzle/schema";
import { type DraftGraph, draftSchema } from "@/lib/design";
import { accessForMethod } from "@/lib/access";
import {
  approveDraft,
  backfillEndpointAccess,
  clearDraftDoc,
  describeApprovedDoc,
  discardDraft,
  draftState,
  readDraftDoc,
  writeProposal,
} from "@/lib/draft-store";
import { GET as entitiesGET } from "@/app/api/entities/route";
import { toClaudePrompt, toDbml, toSql } from "@/lib/prompt-format";

const GRAPH: DraftGraph = {
  tables: [
    {
      name: "dt_orgs",
      domain: "firms",
      columns: [
        { name: "id", type: "UUID", isPk: true, nullable: false },
        { name: "name", type: "TEXT", nullable: false },
      ],
    },
    {
      name: "dt_members",
      domain: "auth",
      columns: [
        { name: "id", type: "UUID", isPk: true, nullable: false },
        { name: "org_id", type: "UUID", isFk: true, nullable: false },
      ],
    },
  ],
  relations: [{ fromTable: "dt_members", fromColumn: "org_id", toTable: "dt_orgs", toColumn: "id" }],
  endpoints: [
    {
      method: "POST",
      path: "/dt_orgs/{id}/members",
      uses: [
        { table: "dt_orgs", access: "read" },
        { table: "dt_members", access: "write" },
      ],
    },
  ],
};

beforeEach(() => clearDraftDoc());

describe("writeProposal / readDraftDoc", () => {
  it("positions a name-keyed proposal into a doc with ids + resolved links", () => {
    writeProposal(GRAPH);
    const doc = readDraftDoc();
    expect(doc).not.toBeNull();
    expect(doc!.status).toBe("pending");
    expect(doc!.tables.map((t) => t.name).sort()).toEqual(["dt_members", "dt_orgs"]);

    // relation resolved by name -> table ids
    const orgId = doc!.tables.find((t) => t.name === "dt_orgs")!.id;
    const memberId = doc!.tables.find((t) => t.name === "dt_members")!.id;
    expect(doc!.relations).toHaveLength(1);
    expect(doc!.relations[0]).toMatchObject({ fromTableId: memberId, toTableId: orgId });

    // endpoint usage links resolved to table ids
    expect(doc!.endpoints).toHaveLength(1);
    expect(doc!.endpoints[0].links.map((l) => l.tableId).sort()).toEqual([memberId, orgId].sort());
  });

  it("draftState reflects pending → discarded", () => {
    writeProposal(GRAPH);
    expect(draftState().state).toBe("pending");
    discardDraft();
    expect(readDraftDoc()).toBeNull();
    expect(draftState().state).toBe("discarded");
  });
});

describe("approveDraft", () => {
  it("persists the edited draft into the real schema and clears it", async () => {
    const doc = writeProposal(GRAPH);
    const counts = await approveDraft(doc);
    expect(counts).toEqual({ tables: 2, relations: 1, endpoints: 1 });

    const orgs = await db.query.dbTable.findFirst({
      where: (t, { eq }) => eq(t.name, "dt_orgs"),
      with: { columns: true, fksIn: true },
    });
    expect(orgs).not.toBeUndefined();
    expect(orgs!.source).toBe("MANUAL");
    expect(orgs!.columns.some((c) => c.isPk)).toBe(true);
    expect(orgs!.fksIn.length).toBe(1); // dt_members.org_id -> dt_orgs.id

    const ep = await db.query.endpoint.findFirst({
      where: (t, { eq }) => eq(t.path, "/dt_orgs/{id}/members"),
      with: { tables: { with: { table: true } } },
    });
    expect(ep).not.toBeUndefined();
    expect(ep!.tables.map((t) => t.table.name).sort()).toEqual(["dt_members", "dt_orgs"]);

    // draft cleared, verdict recorded as approved
    expect(readDraftDoc()).toBeNull();
    expect(draftState().state).toBe("approved");
  });
});

describe("describeApprovedDoc (what Claude is handed on approval)", () => {
  it("renders columns (incl. notes), FKs by name, and endpoints", () => {
    const doc = writeProposal(GRAPH);
    doc.tables[0].columns[1].note = "company name"; // dt_orgs.name — notes were being dropped
    const text = describeApprovedDoc(doc);
    expect(text).toContain("dt_orgs");
    expect(text).toContain("name");
    expect(text).toContain("company name");
    expect(text).toContain("dt_members.org_id → dt_orgs.id");
    expect(text).toContain("POST /dt_orgs/{id}/members");
  });
});

describe("Gap A — approval verdict carries the edited schema", () => {
  it("includes a column the user added on the canvas", async () => {
    const doc = writeProposal(GRAPH);
    doc.tables[1].columns.push({
      name: "role",
      type: "TEXT",
      isPk: false,
      isFk: false,
      nullable: false,
      note: "admin|member",
    });
    await approveDraft(doc);
    const st = draftState();
    expect(st.state).toBe("approved");
    expect(st.state === "approved" && st.detail).toContain("role");
    expect(st.state === "approved" && st.detail).toContain("admin|member");
  });

  it("approval payload no longer carries a 'you proposed X, user changed Y' diff — that signal is feedback-only now", async () => {
    writeProposal(GRAPH);
    const edited = JSON.parse(JSON.stringify(readDraftDoc()!));
    const orgs = edited.tables.find((t: { name: string }) => t.name === "dt_orgs")!;
    orgs.columns.push({
      name: "is_active",
      type: "BOOLEAN",
      isPk: false,
      isFk: false,
      nullable: false,
      note: null,
    });

    await approveDraft(edited);
    const st = draftState();
    expect(st.state).toBe("approved");
    if (st.state !== "approved") return;

    const detail = st.detail ?? "";
    // The final schema must still appear (the column the user added).
    expect(detail).toContain("is_active");
    // But the "Changes the user made" diff section must NOT — Approve = "build this",
    // not "compare to your original proposal". The diff flows through Submit feedback.
    expect(detail).not.toMatch(/changes the user made/i);
  });
});

describe("Gap B — entities tables endpoint surfaces column notes", () => {
  it("returns the note Claude needs when re-reading the schema", async () => {
    const doc = writeProposal(GRAPH);
    doc.tables[0].columns[0].note = "primary key";
    await approveDraft(doc);
    const res = await entitiesGET(new Request("http://t/api/entities?kind=tables"));
    const body = (await res.json()) as {
      items: Array<{ name: string; columns: Array<{ name: string; note?: string | null }> }>;
    };
    const orgs = body.items.find((t) => t.name === "dt_orgs");
    expect(orgs).toBeDefined();
    expect(orgs!.columns.some((c) => c.note === "primary key")).toBe(true);
  });
});

describe("endpoint access is inferred from the HTTP method", () => {
  it("accessForMethod: safe verbs read, mutating verbs write (case-insensitive)", () => {
    expect(accessForMethod("GET")).toBe("read");
    expect(accessForMethod("HEAD")).toBe("read");
    expect(accessForMethod("options")).toBe("read");
    expect(accessForMethod("POST")).toBe("write");
    expect(accessForMethod("put")).toBe("write");
    expect(accessForMethod("PATCH")).toBe("write");
    expect(accessForMethod("DELETE")).toBe("write");
  });

  it("draftSchema defaults a link's access from the method but respects explicit values", () => {
    const g = draftSchema.parse({
      endpoints: [
        { method: "PATCH", path: "/orgs/{id}", uses: [{ table: "organizations" }] },
        { method: "GET", path: "/orgs/{id}", uses: [{ table: "organizations" }] },
        { method: "POST", path: "/search", uses: [{ table: "firms", access: "read-write" }] },
      ],
    });
    expect(g.endpoints[0].uses[0].access).toBe("write"); // PATCH → write (was the bug)
    expect(g.endpoints[1].uses[0].access).toBe("read"); // GET → read
    expect(g.endpoints[2].uses[0].access).toBe("read-write"); // explicit kept
  });
});

describe("backfillEndpointAccess (repair already-stored endpoints)", () => {
  it("bumps mutating endpoints stuck on read to write, leaving GETs and explicit values", async () => {
    const [t] = await db.insert(dbTable).values({ name: "ba_orgs", source: "MANUAL" }).returning();
    const [patchEp] = await db
      .insert(endpoint)
      .values({ method: "PATCH", path: "/ba/{id}", source: "MANUAL" })
      .returning();
    await db.insert(endpointTable).values({ endpointId: patchEp.id, tableId: t.id, access: "read" });
    const [getEp] = await db
      .insert(endpoint)
      .values({ method: "GET", path: "/ba", source: "MANUAL" })
      .returning();
    await db.insert(endpointTable).values({ endpointId: getEp.id, tableId: t.id, access: "read" });
    const [deleteEp] = await db
      .insert(endpoint)
      .values({ method: "DELETE", path: "/ba/{id}/x", source: "MANUAL" })
      .returning();
    await db
      .insert(endpointTable)
      .values({ endpointId: deleteEp.id, tableId: t.id, access: "read-write" });

    const fixed = await backfillEndpointAccess();
    expect(fixed).toBeGreaterThanOrEqual(1);

    const link = async (method: string, path: string) =>
      (await db.query.endpoint.findFirst({
        where: (e, { and, eq }) => and(eq(e.method, method), eq(e.path, path)),
        with: { tables: true },
      }))!.tables[0].access;
    expect(await link("PATCH", "/ba/{id}")).toBe("write"); // defaulted read → write
    expect(await link("GET", "/ba")).toBe("read"); // GET stays read
    expect(await link("DELETE", "/ba/{id}/x")).toBe("read-write"); // explicit preserved
  });
});

describe("prompt formatters", () => {
  it("toClaudePrompt mentions tables, FKs, and the project's stack", () => {
    const p = toClaudePrompt(GRAPH);
    expect(p).toContain("dt_orgs");
    expect(p).toContain("dt_members.org_id -> dt_orgs.id");
    expect(p).toContain("existing stack");
  });

  it("toDbml emits Table + Ref", () => {
    const d = toDbml(GRAPH);
    expect(d).toContain("Table dt_orgs {");
    expect(d).toContain("Ref: dt_members.org_id > dt_orgs.id");
  });

  it("toSql emits CREATE TABLE + FOREIGN KEY", () => {
    const s = toSql(GRAPH);
    expect(s).toContain("CREATE TABLE dt_members (");
    expect(s).toContain("FOREIGN KEY (org_id) REFERENCES dt_orgs(id)");
  });
});
