import { z } from "zod";
import {
  endpointSchema,
  relationSchema,
  tableSchema,
  type DraftGraph,
} from "@/lib/design";
import { featureItemSchema, type FeatureGraph } from "@/lib/feature-design";

// Deterministic (NO AI) extraction of a structured ```beacon block embedded in a plan-mode
// markdown plan. The ExitPlanMode hook event carries only markdown — there is no structured
// channel out of plan mode (MCP sampling is unsupported + deprecated) — so the agent embeds
// one fenced ```beacon block of JSON ({ tables, relations, endpoints, features }) in the plan
// it already writes. We parse + validate it with the SAME Zod schemas beacon_propose_plan
// uses, then STRIP the block from the prose so the JSON is never shown in the annotation
// panel. Any failure degrades to { prose: markdown } — a malformed block must never block the
// plan from reaching the user.

export interface ExtractedPlan {
  prose: string;
  draft?: DraftGraph;
  features?: FeatureGraph["features"];
  // Repo-relative files the agent declares this plan will touch (the scope contract). Captured
  // from a top-level `"contract"` array in the block; frozen at approval when the guard is on.
  contract?: string[];
}

// Strong, low-false-positive signals that a plan TOUCHES THE DATABASE — used to enforce that a
// plan describing schema also SHIPS it structurally (in `tables`), not just in prose. Curated
// to fire on real schema language (migrations, constraints, model files, column types) and NOT
// on generic words like "model"/"data"/"column" alone.
const DB_SCHEMA_SIGNAL =
  /(\bmigrations?\b|\balembic\b|make revision|prisma migrate|unique\s?constraint|foreign\s?keys?|primary\s?keys?|\bFKs?\b|\bJSONB\b|create\s+table|alter\s+table|add\s+(a\s+)?column|new\s+(table|model|column)|app\/models\/|\bBaseModel\b|DeclarativeBase|schema\.prisma|@@unique|natural\s+keys?|\bpgvector\b|\bTSVECTOR\b|\bDbTable\b)/i;

/** True when `text` clearly describes database schema (tables/models/migrations/columns). */
export function mentionsDbSchema(text: string | null | undefined): boolean {
  return !!text && DB_SCHEMA_SIGNAL.test(text);
}

// A fenced ```beacon … ``` block. The opening fence may carry trailing whitespace; the
// closing fence is a line that is just ```. Only the first block is used. Case-insensitive
// on the label, multiline body (non-greedy).
const BEACON_FENCE = /^[ \t]*```beacon[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```[ \t]*$/im;

// Parse an array PER-ITEM, keeping only the items that validate. One malformed table/relation/
// feature must not nuke the whole block — that used to drop the ENTIRE board to raw prose when
// the agent got a single field slightly wrong (a string column, an off-scale priority, a
// relation in a different shape). Non-arrays → [].
function parseEach<T>(value: unknown, schema: z.ZodType<T>): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const item of value) {
    const r = schema.safeParse(item);
    if (r.success) out.push(r.data);
  }
  return out;
}

export function extractBeaconBlock(markdown: string): ExtractedPlan {
  const match = markdown.match(BEACON_FENCE);
  if (!match) return { prose: markdown };

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return { prose: markdown };
  }
  const obj = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;

  // Each section is parsed independently and per-item, so a bad relation can't drop good tables,
  // and a bad table can't drop good features — the board renders everything Beacon understood.
  const tables = parseEach(obj.tables, tableSchema);
  const relations = parseEach(obj.relations, relationSchema);
  const endpoints = parseEach(obj.endpoints, endpointSchema);
  const features = parseEach(obj.features, featureItemSchema);
  const contract = Array.isArray(obj.contract)
    ? obj.contract.filter((s): s is string => typeof s === "string" && !!s.trim()).map((s) => s.trim())
    : undefined;

  const draft: DraftGraph | undefined =
    tables.length || endpoints.length || relations.length
      ? { tables, relations, endpoints }
      : undefined;
  const featureList: FeatureGraph["features"] | undefined = features.length ? features : undefined;
  const contractList = contract?.length ? contract : undefined;

  // Nothing usable — leave the prose untouched (and visible) rather than silently dropping it.
  // A contract-only block is still "usable": strip it and carry the declared scope.
  if (!draft && !featureList && !contractList) return { prose: markdown };

  const prose = markdown
    .replace(BEACON_FENCE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { prose, draft, features: featureList, contract: contractList };
}
