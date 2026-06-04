import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { parseOpenApi } from "@/intel/extractors/openapi";
import { scanFiles } from "@/intel/extractors/files";
import { mergeSnapshot } from "@/intel/merge";
import { buildUserPrompt, runAi } from "@/intel/ai";
import { parseClaudeEnvelope } from "@/intel/ai-cli";
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

describe("runAi", () => {
  it("parses the emit_graph tool call into a snapshot", async () => {
    const fakeClient = {
      messages: {
        create: async () => ({
          content: [
            {
              type: "tool_use",
              name: "emit_graph",
              input: {
                tables: [{ name: "firms", columns: [{ name: "id", type: "UUID", isPk: true }] }],
                relations: [],
                endpoints: [{ method: "POST", path: "/firms", uses: [{ table: "firms", access: "write" }] }],
              },
            },
          ],
        }),
      },
    } as unknown as Anthropic;

    const snap = await runAi([{ path: "m.py", content: "x" }], [], {
      model: "test",
      client: fakeClient,
    });
    expect(snap?.tables?.[0]?.name).toBe("firms");
    expect(snap?.endpoints?.[0]?.uses?.[0]?.table).toBe("firms");
  });

  it("returns null when no API key and no client are available", async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(await runAi([], [], { model: "test" })).toBeNull();
    } finally {
      if (prev) process.env.ANTHROPIC_API_KEY = prev;
    }
  });
});

describe("buildUserPrompt", () => {
  it("includes file contents and the known-endpoint list", () => {
    const prompt = buildUserPrompt(
      [{ path: "models.py", content: "class Firm" }],
      [{ method: "POST", path: "/firms", domain: null, description: null }],
    );
    expect(prompt).toContain("models.py");
    expect(prompt).toContain("class Firm");
    expect(prompt).toContain("POST /firms");
  });
});

describe("parseClaudeEnvelope (claude-cli provider — uses your subscription)", () => {
  it("reads structured_output from the CLI json envelope", () => {
    const env = JSON.stringify({
      type: "result",
      structured_output: {
        tables: [{ name: "firms", columns: [{ name: "id", type: "UUID", isPk: true }] }],
        relations: [],
        endpoints: [],
      },
    });
    expect(parseClaudeEnvelope(env)?.tables?.[0]?.name).toBe("firms");
  });

  it("falls back to parsing the result JSON string", () => {
    const env = JSON.stringify({
      type: "result",
      result: JSON.stringify({
        tables: [],
        relations: [],
        endpoints: [{ method: "GET", path: "/x", uses: [] }],
      }),
    });
    expect(parseClaudeEnvelope(env)?.endpoints?.[0]?.path).toBe("/x");
  });

  it("returns null when the envelope carries no structured data", () => {
    expect(parseClaudeEnvelope(JSON.stringify({ type: "result", result: "" }))).toBeNull();
  });
});
