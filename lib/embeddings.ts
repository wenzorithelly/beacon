// Local semantic-search embedder. Loads Xenova/all-MiniLM-L6-v2 in-process
// (~22MB cached on first use, ~50-100ms per text after that). Stays local so
// the Beacon panel has no API-key dependency and no per-query network hop.
// Vectors live in `Node.embedding` as JSON strings; cosine is computed in JS
// at query time — at hundreds of nodes per workspace, sqlite-vec is overkill.

type FeatureExtractionPipeline = (
  text: string | string[],
  opts?: { pooling?: "mean" | "cls"; normalize?: boolean },
) => Promise<{ data: Float32Array | number[] }>;

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

async function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const { pipeline } = await import("@huggingface/transformers");
      // 384-dim sentence embeddings. The "feature-extraction" task with
      // mean-pooled + normalized output is the canonical sentence-encoder shape.
      return (await pipeline(
        "feature-extraction",
        "Xenova/all-MiniLM-L6-v2",
      )) as unknown as FeatureExtractionPipeline;
    })().catch((e) => {
      pipelinePromise = null; // let the next call retry on transient failure
      throw e;
    });
  }
  return pipelinePromise;
}

/** Compute a 384-dim sentence embedding. Returns null on failure (caller falls back to lexical). */
export async function embedText(text: string): Promise<number[] | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const embedder = await getEmbedder();
    const out = await embedder(trimmed, { pooling: "mean", normalize: true });
    return Array.from(out.data);
  } catch (e) {
    console.error("[embeddings] failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Build the embedding input text from a node's queryable fields. */
export function nodeEmbeddingInput(node: {
  title: string;
  role?: string | null;
  plain?: string | null;
  cluster?: string | null;
}): string {
  return [node.title, node.role, node.plain, node.cluster].filter(Boolean).join(". ");
}

/** Cosine similarity, defensive against zero vectors and dimension mismatch. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function encodeVector(v: number[]): string {
  return JSON.stringify(v);
}

export function decodeVector(raw: string | null | undefined): number[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    if (parsed.some((x) => typeof x !== "number" || !Number.isFinite(x))) return null;
    return parsed as number[];
  } catch {
    return null;
  }
}

/**
 * Re-embed a Node from its current title/plain/role/cluster. Idempotent; swallows
 * errors so a failed embed never breaks the write that triggered it.
 */
export async function reembedNode(id: string): Promise<void> {
  try {
    const { db } = await import("@/lib/db");
    const { node } = await import("@/lib/drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const row = await db.query.node.findFirst({
      where: (t, { eq: eqf }) => eqf(t.id, id),
      columns: { title: true, role: true, plain: true, cluster: true },
    });
    if (!row) return;
    const vec = await embedText(nodeEmbeddingInput(row));
    if (!vec) return;
    await db.update(node).set({ embedding: encodeVector(vec) }).where(eq(node.id, id));
  } catch (e) {
    console.error("[embeddings] reembed failed:", id, e instanceof Error ? e.message : e);
  }
}

/** Rank candidates by cosine. Returns null when the query embedding fails. */
export async function rankByQuery<T extends { embedding: string | null }>(
  query: string,
  candidates: T[],
): Promise<Array<{ item: T; score: number }> | null> {
  const queryVec = await embedText(query);
  if (!queryVec) return null;
  const scored: Array<{ item: T; score: number }> = [];
  for (const item of candidates) {
    const v = decodeVector(item.embedding);
    if (!v) continue;
    scored.push({ item, score: cosineSimilarity(queryVec, v) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}
