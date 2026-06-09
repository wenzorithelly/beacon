import { pipeline } from "@huggingface/transformers";
import { isNotNull, and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { node } from "@/lib/drizzle/schema";

const QUERY = process.argv[2] ?? "semantic search embeddings";

const db = getDb("file:/Users/wenzorithelly/.beacon/1eac6452f826/db.sqlite");

const embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
const out = await embedder(QUERY, { pooling: "mean", normalize: true });
const queryVec = Array.from(out.data as Float32Array);

function cos(a: number[], b: number[]) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] ** 2;
    nb += b[i] ** 2;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const features = await db.query.node.findMany({
  where: (t) => and(eq(t.view, "ROADMAP"), isNotNull(t.embedding)),
});
const scored = features
  .map((f) => ({
    title: f.title,
    score: cos(queryVec, JSON.parse(f.embedding!) as number[]),
  }))
  .sort((a, b) => b.score - a.score);

console.log(`Query: "${QUERY}"`);
for (const s of scored) console.log(`  ${s.score.toFixed(3)}  ${s.title}`);
process.exit(0);
