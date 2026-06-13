import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";

process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-has-frontend-"));

import { db } from "@/lib/db";
import { codeFile, projectMeta } from "@/lib/drizzle/schema";
import { initInputSchema } from "@/lib/init";
import {
  getProjectMeta,
  resolveClassificationRoots,
  resolveHasFrontend,
  setProjectMeta,
} from "@/lib/project-meta";
import { resetDb } from "./helpers";

beforeEach(async () => {
  await resetDb();
  await db.delete(codeFile);
  await db.delete(projectMeta);
});

describe("setProjectMeta hasFrontend", () => {
  it("persists an explicit true/false", async () => {
    await setProjectMeta({ hasFrontend: true });
    expect((await getProjectMeta()).hasFrontend).toBe(true);
    await setProjectMeta({ hasFrontend: false });
    expect((await getProjectMeta()).hasFrontend).toBe(false);
  });

  it("leaves the flag unchanged when not provided", async () => {
    await setProjectMeta({ hasFrontend: true });
    await setProjectMeta({ overview: "just the overview" });
    const meta = await getProjectMeta();
    expect(meta.hasFrontend).toBe(true);
    expect(meta.overview).toBe("just the overview");
  });
});

describe("resolveHasFrontend", () => {
  it("returns the explicit flag when set, ignoring code files", async () => {
    await db.insert(codeFile).values({ path: "app/page.tsx" });
    await setProjectMeta({ hasFrontend: false });
    expect(await resolveHasFrontend()).toBe(false);

    await db.delete(codeFile);
    await setProjectMeta({ hasFrontend: true });
    expect(await resolveHasFrontend()).toBe(true);
  });

  it("falls back to code-graph path detection when unset", async () => {
    await db.insert(codeFile).values([{ path: "lib/db.ts" }, { path: "main.py" }]);
    expect(await resolveHasFrontend()).toBe(false);

    await db.insert(codeFile).values({ path: "components/card.tsx" });
    expect(await resolveHasFrontend()).toBe(true);
  });

  it("returns false with no meta row and no code files", async () => {
    expect(await resolveHasFrontend()).toBe(false);
  });
});

describe("classificationRoots", () => {
  it("defaults to an empty list when unset", async () => {
    expect(await resolveClassificationRoots()).toEqual([]);
    expect((await getProjectMeta()).classificationRoots).toBe("[]");
  });

  it("persists and reads back the declared roots", async () => {
    await setProjectMeta({ classificationRoots: ["frontend", "backend/app"] });
    expect(await resolveClassificationRoots()).toEqual(["frontend", "backend/app"]);
  });

  it("leaves the roots unchanged when a later call omits them", async () => {
    await setProjectMeta({ classificationRoots: ["frontend"] });
    await setProjectMeta({ overview: "x" });
    expect(await resolveClassificationRoots()).toEqual(["frontend"]);
  });

  it("init/refresh schema omits roots as undefined so a refresh that doesn't re-declare preserves them", () => {
    // default-[] would be truthy and overwrite prior roots on every refresh — nullish avoids that.
    expect(initInputSchema.parse({}).classificationRoots).toBeUndefined();
    expect(initInputSchema.parse({ classificationRoots: ["frontend"] }).classificationRoots).toEqual([
      "frontend",
    ]);
  });
});
