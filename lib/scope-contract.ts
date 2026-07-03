import { eq } from "drizzle-orm";
import { db, type DB } from "@/lib/db-drizzle";
import { planContract } from "@/lib/drizzle/schema";

// Per-plan scope contracts. One row per approved plan = durable history. `declaredFiles` is frozen
// at approval; `authorizedExtras` grows ONLY when the user authorizes an off-scope edit at the
// pre-edit prompt. Exactly one row is `active` (the one the gate enforces); writeContract holds
// that invariant in code. Written server-side at approval — no MCP/agent surface mutates it.

export interface ActiveContract {
  planId: string;
  declaredFiles: string[];
  authorizedExtras: string[];
}

function parseList(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

export async function getActiveContract(prisma: DB = db): Promise<ActiveContract | null> {
  const row = await prisma.query.planContract.findFirst({ where: (t, { eq }) => eq(t.active, true) });
  if (!row) return null;
  return {
    planId: row.planId,
    declaredFiles: parseList(row.declaredFiles),
    authorizedExtras: parseList(row.authorizedExtras),
  };
}

// A specific plan's contract by its planId (= its archive id). Lets the Changes view scope to a
// plan the user SELECTED in history, not just the one currently executing. Returns null for a
// plan that carried no contract (e.g. a discarded plan).
export async function getContractByPlanId(planId: string, prisma: DB = db): Promise<ActiveContract | null> {
  const row = await prisma.query.planContract.findFirst({ where: (t, { eq }) => eq(t.planId, planId) });
  if (!row) return null;
  return {
    planId: row.planId,
    declaredFiles: parseList(row.declaredFiles),
    authorizedExtras: parseList(row.authorizedExtras),
  };
}

// The files a plan declared (declared ∪ user-authorized extras), de-duped and sorted — the list
// the Changes view shows for a plan that ISN'T the one currently executing (its live diff is gone).
export function contractFiles(c: ActiveContract): string[] {
  return Array.from(new Set([...c.declaredFiles, ...c.authorizedExtras])).sort((a, b) => a.localeCompare(b));
}

export async function writeContract(
  input: { planId: string; declaredFiles: string[] },
  prisma: DB = db,
): Promise<void> {
  // Retire every prior active contract, then upsert this plan's row as the active one. Re-approving
  // the same planId refreshes its declared files and resets its authorized extras.
  await prisma.update(planContract).set({ active: false }).where(eq(planContract.active, true));
  const declaredFiles = JSON.stringify(input.declaredFiles);
  await prisma
    .insert(planContract)
    .values({ planId: input.planId, declaredFiles, authorizedExtras: "[]", active: true })
    .onConflictDoUpdate({
      target: planContract.planId,
      set: { declaredFiles, authorizedExtras: "[]", active: true },
    });
}

/** Append a user-authorized off-scope file to the contract (idempotent). This is the ONLY way the
 *  contract grows after approval — and it's driven by the user's authorization, never the agent. */
export async function authorizeFile(planId: string, path: string, prisma: DB = db): Promise<void> {
  const row = await prisma.query.planContract.findFirst({ where: (t, { eq }) => eq(t.planId, planId) });
  if (!row) return;
  const extras = parseList(row.authorizedExtras);
  if (extras.includes(path)) return;
  extras.push(path);
  await prisma
    .update(planContract)
    .set({ authorizedExtras: JSON.stringify(extras) })
    .where(eq(planContract.planId, planId));
}

export async function retireContract(planId: string, prisma: DB = db): Promise<void> {
  await prisma.update(planContract).set({ active: false }).where(eq(planContract.planId, planId));
}

/** Retire whatever contract is currently active (the plan's work is registered done). The row
 *  survives as history; it just stops gating edits until the next plan is approved. */
export async function retireActiveContract(prisma: DB = db): Promise<void> {
  await prisma.update(planContract).set({ active: false }).where(eq(planContract.active, true));
}

// ── Pure decision core ───────────────────────────────────────────────────────
// Kept pure (no db) so it's unit-testable and the same logic can run anywhere. Always-on: the
// caller only resolves the active contract — there is no toggle. Fail-open when there's no active
// contract or it declared nothing.
export interface DecideEditInput {
  /** repo-relative POSIX path of the file about to be edited */
  filePath: string;
  contract: ActiveContract | null;
}

export function decideEdit(input: DecideEditInput): { decision: "allow" | "ask"; reason?: string } {
  const { filePath, contract } = input;
  if (!contract) return { decision: "allow" };
  const allowed = new Set([...contract.declaredFiles, ...contract.authorizedExtras]);
  if (allowed.size === 0) return { decision: "allow" }; // fail-open: nothing was declared
  if (allowed.has(filePath)) return { decision: "allow" };
  return {
    decision: "ask",
    reason:
      `⚠️ This edit touches \`${filePath}\`, which is outside this plan's declared scope. ` +
      `Authorize this divergence? (The contract is human-owned — only your approval can widen it.)`,
  };
}
