import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";

process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-layer-"));

import { db } from "@/lib/db";
import { projectMeta } from "@/lib/drizzle/schema";
import { getFeatureDraft, persistFeatureDraft } from "@/lib/feature-design";
import { persistArchitecture, persistRoadmap } from "@/lib/init";
import { addSubtasksUnder, startFeature, upsertArchitectureComponents } from "@/lib/map-ops";
import { createNode } from "@/lib/mutations";
import { setProjectMeta } from "@/lib/project-meta";
import { resetDb } from "./helpers";

beforeEach(async () => {
  await resetDb();
  await db.delete(projectMeta);
});

// Every agent surface that creates roadmap cards or architecture components must be able
// to carry the frontend/backend layer — mirroring how kind: BUG threads through them.

describe("propose_plan / ```beacon block — featureItemSchema layer", () => {
  it("persists layer on draft features and defaults to null", async () => {
    await persistFeatureDraft({
      features: [
        { title: "Login screen", cluster: "AUTH", priority: 1, layer: "frontend" },
        { title: "Session API", cluster: "AUTH", priority: 1, layer: "BACKEND" },
        { title: "Unlayered", cluster: "AUTH", priority: 2 },
      ],
    });
    const fe = await db.query.node.findFirst({ where: (t, { eq }) => eq(t.title, "Login screen") });
    const be = await db.query.node.findFirst({ where: (t, { eq }) => eq(t.title, "Session API") });
    const none = await db.query.node.findFirst({ where: (t, { eq }) => eq(t.title, "Unlayered") });
    expect(fe?.layer).toBe("frontend");
    expect(be?.layer).toBe("backend"); // case-tolerant
    expect(none?.layer).toBeNull();
  });

  it("drops an invalid layer to null instead of failing the parse", async () => {
    await persistFeatureDraft({
      features: [{ title: "Weird", cluster: "AUTH", priority: 2, layer: "middleware" }],
    });
    const n = await db.query.node.findFirst({ where: (t, { eq }) => eq(t.title, "Weird") });
    expect(n?.layer).toBeNull();
  });

  it("round-trips layer through getFeatureDraft", async () => {
    await persistFeatureDraft({
      features: [{ title: "Login screen", cluster: "AUTH", priority: 1, layer: "fullstack" }],
    });
    const draft = await getFeatureDraft();
    expect(draft.features[0].layer).toBe("fullstack");
  });
});

describe("beacon_init_persist — roadmap items + components with layer", () => {
  it("persists layer on roadmap items", async () => {
    await persistRoadmap([
      { title: "Settings screen", category: "UI", priority: 2, layer: "frontend" },
      { title: "No layer", category: "UI", priority: 2 },
    ]);
    const fe = await db.query.node.findFirst({
      where: (t, { eq }) => eq(t.title, "Settings screen"),
    });
    const none = await db.query.node.findFirst({ where: (t, { eq }) => eq(t.title, "No layer") });
    expect(fe?.layer).toBe("frontend");
    expect(none?.layer).toBeNull();
  });

  it("persists layer on architecture components", async () => {
    await persistArchitecture([
      { title: "Plan UI", domain: "UI", layer: "frontend", files: [] },
      { title: "Draft store", domain: "DATA", layer: "backend", files: [] },
    ]);
    const ui = await db.query.node.findFirst({ where: (t, { eq }) => eq(t.title, "Plan UI") });
    const store = await db.query.node.findFirst({
      where: (t, { eq }) => eq(t.title, "Draft store"),
    });
    expect(ui?.layer).toBe("frontend");
    expect(store?.layer).toBe("backend");
  });
});

describe("beacon_describe_feature — architecture upsert layer", () => {
  it("sets layer on insert and keeps the prior layer when an update omits it", async () => {
    await upsertArchitectureComponents([{ title: "MCP server", domain: "MCP", layer: "backend" }]);
    let n = await db.query.node.findFirst({ where: (t, { eq }) => eq(t.title, "MCP server") });
    expect(n?.layer).toBe("backend");

    await upsertArchitectureComponents([{ title: "MCP server", domain: "MCP", role: "updated" }]);
    n = await db.query.node.findFirst({ where: (t, { eq }) => eq(t.title, "MCP server") });
    expect(n?.layer).toBe("backend"); // omitted on update → preserved

    await upsertArchitectureComponents([
      { title: "MCP server", domain: "MCP", layer: "fullstack" },
    ]);
    n = await db.query.node.findFirst({ where: (t, { eq }) => eq(t.title, "MCP server") });
    expect(n?.layer).toBe("fullstack"); // explicit update wins
  });
});

describe("beacon_start_feature — layer", () => {
  it("creates a new node with the given layer", async () => {
    const r = await startFeature({ title: "Share token API", cluster: "PLAN", layer: "backend" });
    expect(r.action).toBe("created");
    const n = await db.query.node.findFirst({
      where: (t, { eq }) => eq(t.title, "Share token API"),
    });
    expect(n?.layer).toBe("backend");
  });

  it("a sub-task nested under a front inherits the parent's layer", async () => {
    await createNode({ view: "ROADMAP", title: "Share links", cluster: "PLAN", layer: "fullstack" });
    const r = await startFeature({ title: "Mint token route", front: "Share links" });
    expect(r.action).toBe("created");
    const n = await db.query.node.findFirst({
      where: (t, { eq }) => eq(t.title, "Mint token route"),
    });
    expect(n?.layer).toBe("fullstack");
  });

  it("rejects a new top-level feature without layer when the workspace has a frontend", async () => {
    await setProjectMeta({ hasFrontend: true });
    const r = await startFeature({ title: "Share token API", cluster: "PLAN" });
    expect(r.action).toBe("rejected");
    if (r.action === "rejected") expect(r.message).toContain("layer");
  });

  it("does not require layer when the workspace has no frontend", async () => {
    await setProjectMeta({ hasFrontend: false });
    const r = await startFeature({ title: "Share token API", cluster: "PLAN" });
    expect(r.action).toBe("created");
  });
});

describe("beacon_add_subtasks — layer per item", () => {
  it("items inherit the parent's layer unless they override it", async () => {
    const parent = await createNode({
      view: "ROADMAP",
      title: "Share links",
      cluster: "PLAN",
      layer: "backend",
    });
    const r = await addSubtasksUnder({
      parentId: parent.id,
      items: [{ title: "Token route" }, { title: "Share page", layer: "frontend" }],
    });
    expect(r.ok).toBe(true);
    const inherited = await db.query.node.findFirst({
      where: (t, { eq }) => eq(t.title, "Token route"),
    });
    const overridden = await db.query.node.findFirst({
      where: (t, { eq }) => eq(t.title, "Share page"),
    });
    expect(inherited?.layer).toBe("backend");
    expect(overridden?.layer).toBe("frontend");
  });
});
