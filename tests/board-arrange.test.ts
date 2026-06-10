import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";

// The db one-shot sig lives in the workspace data dir — isolate it.
process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-db-arrange-"));

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { dbColumn, dbRelation, dbTable, endpoint, endpointTable } from "@/lib/drizzle/schema";
import { arrangeDbBoard, ensureDbBoardArranged } from "@/lib/board-arrange";
import { BOARD_ALGO_VERSIONS, readBoardLayout, writeBoardLayout } from "@/lib/board-layout-state";
import { estimateTableHeight } from "@/lib/table-layout";

beforeEach(async () => {
  await db.delete(endpointTable);
  await db.delete(endpoint);
  await db.delete(dbColumn);
  await db.delete(dbRelation);
  await db.delete(dbTable);
  writeBoardLayout("db", { sig: null });
});

async function seed() {
  const [users] = await db
    .insert(dbTable)
    .values({ name: "User", domain: "AUTH", source: "INTROSPECTION", x: 5000, y: 0 })
    .returning();
  const [posts] = await db
    .insert(dbTable)
    .values({ name: "Post", domain: "CONTENT", source: "INTROSPECTION", x: -3000, y: 50 })
    .returning();
  const [login] = await db
    .insert(endpoint)
    .values({ method: "POST", path: "/auth/login", source: "INTROSPECTION", x: 0, y: 0 })
    .returning();
  await db.insert(endpointTable).values({ endpointId: login.id, tableId: users.id, access: "read" });
  const [loose] = await db
    .insert(endpoint)
    .values({ method: "GET", path: "/health", source: "INTROSPECTION", x: 1, y: 1 })
    .returning();
  return { users, posts, login, loose };
}

describe("arrangeDbBoard (domain clusters + docked endpoints)", () => {
  it("docks an endpoint at its primary table and separates domains", async () => {
    const { users, posts, login } = await seed();
    const moved = await arrangeDbBoard();
    expect(moved).toBeGreaterThan(0);
    const u = (await db.query.dbTable.findFirst({ where: (t, { eq }) => eq(t.id, users.id) }))!;
    const p = (await db.query.dbTable.findFirst({ where: (t, { eq }) => eq(t.id, posts.id) }))!;
    const l = (await db.query.endpoint.findFirst({ where: (t, { eq }) => eq(t.id, login.id) }))!;
    // Docked: same x as its table, directly below it.
    expect(l.x).toBe(u.x);
    expect(l.y).toBeGreaterThanOrEqual(u.y + estimateTableHeight(0));
    // Domains are separate blocks.
    expect(u.x === p.x && u.y === p.y).toBe(false);
  });

  it("parks a no-usage endpoint in the trailing unattached strip", async () => {
    const { loose } = await seed();
    await arrangeDbBoard();
    const l = (await db.query.endpoint.findFirst({ where: (t, { eq }) => eq(t.id, loose.id) }))!;
    const tables = await db.query.dbTable.findMany();
    const maxTableBottom = Math.max(...tables.map((t) => t.y + estimateTableHeight(0)));
    expect(l.y).toBeGreaterThan(maxTableBottom);
  });
});

describe("ensureDbBoardArranged (one-shot)", () => {
  it("arranges once, records the sig, then never moves cards again", async () => {
    const { users } = await seed();
    await ensureDbBoardArranged();
    expect(readBoardLayout("db").sig).toBe(BOARD_ALGO_VERSIONS.db);
    // The user drags a table somewhere deliberate…
    await db.update(dbTable).set({ x: 7777, y: 88 }).where(eq(dbTable.id, users.id));
    await ensureDbBoardArranged(); // …a later load must not undo it.
    const u = (await db.query.dbTable.findFirst({ where: (t, { eq }) => eq(t.id, users.id) }))!;
    expect({ x: u.x, y: u.y }).toEqual({ x: 7777, y: 88 });
  });

  it("keeps the one-shot pending while the board is empty", async () => {
    await ensureDbBoardArranged();
    expect(readBoardLayout("db").sig).toBeNull();
  });
});
