import { describe, expect, it } from "bun:test";
import { deriveEndpointUses } from "@/intel/extractors/endpoint-uses";

// Deterministic endpoint→table links: a route's table usage is read off the Drizzle table
// variables referenced (db.query.X / from(X) / insert|update|delete(X)) in the route file
// and its import radius — so the /db board draws real connections, not orphan pills.

const tableVars = { note: "Note", boardAnnotation: "BoardAnnotation" };

const files = new Map<string, string>([
  [
    "app/api/notes/route.ts",
    `import { createNote, listNotes } from "@/lib/notes";\nexport const GET = h(listNotes);\nexport const POST = h(createNote);`,
  ],
  [
    "lib/notes.ts",
    `import { note } from "@/lib/drizzle/schema";\nexport async function listNotes() { return db.query.note.findMany(); }\nexport async function createNote() { return db.insert(note).values({}); }`,
  ],
  ["app/api/version/route.ts", `export const GET = () => Response.json({ ok: true });`],
]);

const edges = [{ from: "app/api/notes/route.ts", to: "lib/notes.ts" }];

describe("deriveEndpointUses", () => {
  it("links a route to the tables its import radius touches, with combined access", () => {
    const uses = deriveEndpointUses({
      routeFiles: [...files.keys()].filter((p) => p.endsWith("route.ts")),
      edges,
      content: (p) => files.get(p) ?? null,
      tableVars,
    });
    expect(uses.get("app/api/notes/route.ts")).toEqual([
      { table: "Note", access: "read-write" },
    ]);
  });

  it("a route that touches no table gets no links (an honest orphan)", () => {
    const uses = deriveEndpointUses({
      routeFiles: ["app/api/version/route.ts"],
      edges,
      content: (p) => files.get(p) ?? null,
      tableVars,
    });
    expect(uses.get("app/api/version/route.ts")).toEqual([]);
  });

  it("write-only usage classifies as write", () => {
    const uses = deriveEndpointUses({
      routeFiles: ["app/api/x/route.ts"],
      edges: [],
      content: () => `import { boardAnnotation } from "@/lib/drizzle/schema";\nawait db.delete(boardAnnotation).where(eq(boardAnnotation.id, id));`,
      tableVars,
    });
    expect(uses.get("app/api/x/route.ts")).toEqual([
      { table: "BoardAnnotation", access: "write" },
    ]);
  });
});
