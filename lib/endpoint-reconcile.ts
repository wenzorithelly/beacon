import { eq } from "drizzle-orm";
import { db, type DB } from "@/lib/db-drizzle";
import { endpoint } from "@/lib/drizzle/schema";

// Plans and code rarely share a path prefix: a feature designed as `/orgs` ships at
// `/api/v1/orgs`. We collapse a planned (MANUAL) endpoint into its code-derived
// (INTROSPECTION) twin when the verbs match and the code path ends with the planned path
// on a segment boundary, ignoring path-param names.

const normalize = (path: string) => path.replace(/\{[^}]*\}/g, "{}");

export function isImplementedBy(
  planned: { method: string; path: string },
  code: { method: string; path: string },
): boolean {
  if (planned.method.toUpperCase() !== code.method.toUpperCase()) return false;
  const p = normalize(planned.path);
  const c = normalize(code.path);
  // planned paths start with "/", so endsWith() already lands on a segment boundary.
  return c === p || c.endsWith(p);
}

export interface ReconcileReport {
  collapsed: number;
  mappings: { planned: string; code: string }[];
}

/**
 * Deletes planned endpoints (anything not code-derived — drafts approved as MANUAL, init/
 * session scaffolds) once they have an INTROSPECTION twin, so the canvas shows reality
 * instead of duplicates. Unbuilt plans are left intact. Returns what was collapsed (also
 * surfaces the planned→code path discrepancy to the caller).
 */
export async function reconcilePlannedEndpoints(prisma: DB = db): Promise<ReconcileReport> {
  const [planned, code] = await Promise.all([
    prisma.query.endpoint.findMany({ where: (t, { ne }) => ne(t.source, "INTROSPECTION") }),
    prisma.query.endpoint.findMany({ where: (t, { eq }) => eq(t.source, "INTROSPECTION") }),
  ]);

  const report: ReconcileReport = { collapsed: 0, mappings: [] };
  for (const m of planned) {
    const twin = code.find((c) => isImplementedBy(m, c));
    if (!twin) continue;
    await prisma.delete(endpoint).where(eq(endpoint.id, m.id));
    report.collapsed++;
    report.mappings.push({ planned: `${m.method} ${m.path}`, code: `${twin.method} ${twin.path}` });
  }
  return report;
}
