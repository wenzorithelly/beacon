import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "bun:test";
import { parseOpenApi } from "@/intel/extractors/openapi";
import { scanFiles } from "@/intel/extractors/files";
import { mergeSnapshot } from "@/intel/merge";
import type { Snapshot } from "@/lib/ingest";

const here = dirname(fileURLToPath(import.meta.url));

describe("parseOpenApi", () => {
  it("extracts method/path/domain and skips non-HTTP verbs", () => {
    const spec = {
      paths: {
        "/firms": { post: { tags: ["firms"], summary: "create" }, get: {} },
        "/x": { trace: {} },
      },
    };
    const eps = parseOpenApi(spec);
    expect(eps).toContainEqual({
      method: "POST",
      path: "/firms",
      domain: "firms",
      description: "create",
    });
    expect(eps.find((e) => e.method === "GET" && e.path === "/firms")).toBeTruthy();
    expect(eps.find((e) => e.path === "/x")).toBeFalsy();
  });
});

describe("scanFiles", () => {
  it("gathers source files under a root", () => {
    const files = scanFiles(resolve(here, "fixtures/backend"), {
      maxFiles: 50,
      maxBytes: 100_000,
    });
    expect(files.map((f) => f.path).sort()).toEqual(["api.py", "models.py"]);
    expect(files.find((f) => f.path === "models.py")!.content).toContain("firms");
  });
});

describe("mergeSnapshot", () => {
  it("prefers OpenAPI for the endpoint list but keeps AI table-usage", () => {
    const ai: Snapshot = {
      tables: [{ name: "firms", columns: [{ name: "id", type: "UUID" }] }],
      relations: [],
      endpoints: [
        {
          method: "POST",
          path: "/firms",
          domain: null,
          description: null,
          uses: [{ table: "firms", access: "write" }],
        },
      ],
    };
    const facts = [
      { method: "POST", path: "/firms", domain: "firms", description: "create" },
      { method: "GET", path: "/health", domain: null, description: null },
    ];
    const merged = mergeSnapshot(ai, facts);
    expect(merged.endpoints).toHaveLength(2);
    const firms = merged.endpoints!.find((e) => e.path === "/firms")!;
    expect(firms.domain).toBe("firms"); // OpenAPI domain wins
    expect(firms.uses).toHaveLength(1); // AI usage preserved
    expect(merged.tables).toHaveLength(1);
  });
});
