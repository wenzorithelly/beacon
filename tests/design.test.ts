import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { clearDraft, getDraft, persistDraft, type DraftGraph } from "@/lib/design";
import { toClaudePrompt, toDbml, toSql } from "@/lib/prompt-format";

const GRAPH: DraftGraph = {
  tables: [
    {
      name: "firms",
      domain: "firms",
      columns: [
        { name: "id", type: "UUID", isPk: true, nullable: false },
        { name: "name", type: "TEXT", nullable: false },
      ],
    },
    {
      name: "users",
      domain: "auth",
      columns: [
        { name: "id", type: "UUID", isPk: true, nullable: false },
        { name: "firm_id", type: "UUID", isFk: true, nullable: false },
      ],
    },
  ],
  relations: [{ fromTable: "users", fromColumn: "firm_id", toTable: "firms", toColumn: "id" }],
};

beforeEach(clearDraft);

describe("persistDraft / getDraft", () => {
  it("persists then reads back the draft graph", async () => {
    await persistDraft(GRAPH);
    const g = await getDraft();
    expect(g.tables.map((t) => t.name).sort()).toEqual(["firms", "users"]);
    expect(g.relations).toHaveLength(1);
    expect(g.relations[0]).toMatchObject({ fromTable: "users", toTable: "firms" });
  });

  it("clearDraft removes everything", async () => {
    await persistDraft(GRAPH);
    await clearDraft();
    expect(await db.draftTable.count()).toBe(0);
    expect(await db.draftRelation.count()).toBe(0);
  });

  it("replaces the previous draft on re-persist", async () => {
    await persistDraft(GRAPH);
    await persistDraft({
      tables: [{ name: "only", columns: [{ name: "id", type: "UUID", isPk: true }] }],
      relations: [],
    });
    expect(await db.draftTable.count()).toBe(1);
  });
});

describe("prompt formatters", () => {
  it("toClaudePrompt mentions tables, FKs, and the stack", () => {
    const p = toClaudePrompt(GRAPH);
    expect(p).toContain("firms");
    expect(p).toContain("users.firm_id -> firms.id");
    expect(p).toContain("SQLAlchemy");
  });

  it("toDbml emits Table + Ref", () => {
    const d = toDbml(GRAPH);
    expect(d).toContain("Table firms {");
    expect(d).toContain("Ref: users.firm_id > firms.id");
  });

  it("toSql emits CREATE TABLE + FOREIGN KEY", () => {
    const s = toSql(GRAPH);
    expect(s).toContain("CREATE TABLE users (");
    expect(s).toContain("FOREIGN KEY (firm_id) REFERENCES firms(id)");
  });
});
