import { describe, expect, it } from "bun:test";
import { extractNextRoutes } from "@/intel/extractors/next-routes";

// Deterministic Next.js App Router endpoint extraction: every app/api/**/route.ts that
// exports an HTTP method becomes an endpoint, with [param] segments normalized to {param}.
describe("extractNextRoutes", () => {
  it("maps route files to METHOD + path pairs", () => {
    const out = extractNextRoutes([
      {
        path: "app/api/notes/route.ts",
        content: `export const GET = pinned(async () => {});\nexport const POST = pinned(async () => {});`,
      },
      {
        path: "app/api/notes/[id]/route.ts",
        content: `export async function PATCH(req: Request) {}\nexport const DELETE = pinned(async () => {});`,
      },
    ]);
    const keys = out.map((e) => `${e.method} ${e.path}`).sort();
    expect(keys).toEqual([
      "DELETE /api/notes/{id}",
      "GET /api/notes",
      "PATCH /api/notes/{id}",
      "POST /api/notes",
    ]);
  });

  it("drops route groups, catch-alls become {param}, non-api and non-route files ignored", () => {
    const out = extractNextRoutes([
      { path: "app/api/(internal)/jobs/[...path]/route.ts", content: "export const GET = h();" },
      { path: "app/plan/page.tsx", content: "export default function P() {}" },
      { path: "lib/api-workspace.ts", content: "export const GET = nope;" },
    ]);
    expect(out).toEqual([
      {
        method: "GET",
        path: "/api/jobs/{path}",
        uses: [],
        file: "app/api/(internal)/jobs/[...path]/route.ts",
      },
    ]);
  });
});
