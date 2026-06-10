import { describe, expect, it } from "bun:test";
import { isSchemaCandidate, schemaCandidates } from "@/intel/schema-candidates";

describe("schema candidates", () => {
  it("keeps ORM model files, prisma schemas and Next api routes; drops the rest", () => {
    expect(isSchemaCandidate("lib/drizzle/schema.ts")).toBe(true);
    expect(isSchemaCandidate("prisma/schema.prisma")).toBe(true);
    expect(isSchemaCandidate("app/models/user.py")).toBe(true);
    expect(isSchemaCandidate("app/api/notes/[id]/route.ts")).toBe(true);
    expect(isSchemaCandidate("components/graph/db-map-client.tsx")).toBe(false);
    expect(isSchemaCandidate("lib/utils.ts")).toBe(false);
    expect(isSchemaCandidate("app/plan/page.tsx")).toBe(false);
  });

  it("caps the candidate list", () => {
    const many = Array.from({ length: 500 }, (_, i) => `app/models/m${i}.py`);
    expect(schemaCandidates(many).length).toBe(300);
  });
});
