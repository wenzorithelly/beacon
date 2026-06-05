import { execSync } from "node:child_process";
import { join } from "node:path";
import { db } from "@/lib/db";
import { repoRoot } from "@/lib/project";

export const dynamic = "force-dynamic";

// Powers the chat @-mention. Returns tables / features / endpoints / bugs from the
// active workspace + repo files, each with a `detail` string that gets injected into
// the prompt so Claude Code sees the real data (columns, bug text, file path…).
export interface Mention {
  type: "table" | "feature" | "endpoint" | "bug" | "file";
  id: string;
  label: string;
  detail: string;
}

function repoFiles(root: string): string[] {
  try {
    return execSync("git ls-files --cached --others --exclude-standard", {
      cwd: root,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") || "").toLowerCase().trim();
  const hit = (s: string) => !q || s.toLowerCase().includes(q);
  const root = repoRoot();

  const [tables, features, endpoints, bugs] = await Promise.all([
    db.dbTable.findMany({ include: { columns: { orderBy: { ord: "asc" } } }, take: 200 }),
    db.node.findMany({ take: 300, orderBy: { updatedAt: "desc" } }),
    db.endpoint.findMany({ take: 300 }),
    db.bug.findMany({ take: 300 }),
  ]);

  const items: Mention[] = [];

  for (const t of tables) {
    if (!hit(t.name)) continue;
    const cols = t.columns
      .map((c) => `${c.name} (${c.type}${c.isPk ? ", pk" : ""}${c.isFk ? ", fk" : ""})`)
      .join(", ");
    items.push({ type: "table", id: t.id, label: t.name, detail: `tabela \`${t.name}\`: ${cols}` });
  }
  for (const n of features) {
    if (!hit(n.title)) continue;
    items.push({
      type: "feature",
      id: n.id,
      label: n.title,
      detail: `feature \`${n.title}\`${n.cluster ? ` [${n.cluster}]` : ""} — status ${n.status}${n.role ? `; ${n.role}` : ""}`,
    });
  }
  for (const e of endpoints) {
    const label = `${e.method} ${e.path}`;
    if (!hit(label)) continue;
    items.push({
      type: "endpoint",
      id: e.id,
      label,
      detail: `endpoint ${label}${e.description ? ` — ${e.description}` : ""}`,
    });
  }
  for (const b of bugs) {
    if (!hit(b.title)) continue;
    items.push({
      type: "bug",
      id: b.id,
      label: b.title,
      detail: `bug \`${b.title}\` (${b.severity})${b.detail ? `: ${b.detail}` : ""}${b.sourceRef ? ` @ ${b.sourceRef}` : ""}`,
    });
  }
  for (const f of repoFiles(root).filter(hit).slice(0, 40)) {
    items.push({ type: "file", id: f, label: f, detail: `arquivo: ${join(root, f)}` });
  }

  return Response.json({ items: items.slice(0, 50) });
}
