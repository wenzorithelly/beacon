import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { contextDocTargets, stripAgentsPointer } from "@/lib/assets";
import { db } from "@/lib/db-drizzle";
import { repoName, repoRoot } from "@/lib/project";
import { getProjectMeta } from "@/lib/project-meta";

// Generates a Beacon-managed project context block, written DIRECTLY into the repo's context
// doc(s) — AGENTS.md (cross-tool standard, read by Cursor/Codex/Aider…) and/or CLAUDE.md (the
// only file Claude Code reads) per contextDocTargets. Marker-delimited so it never clobbers your
// own content, and it never leaves an `@AGENTS.md` pointer behind.

const START = "<!-- beacon:start -->";
const END = "<!-- beacon:end -->";

function deriveCommands(root: string): Record<string, string> {
  const cmds: Record<string, string> = {};
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    for (const k of ["dev", "build", "test", "lint", "start"]) {
      if (pkg.scripts?.[k]) cmds[k] = `npm run ${k}`;
    }
  } catch {
    /* no package.json */
  }
  try {
    const mk = readFileSync(join(root, "Makefile"), "utf8");
    for (const k of ["dev", "up", "build", "test", "lint"]) {
      if (new RegExp(`^${k}:`, "m").test(mk)) cmds[k] = `make ${k}`;
    }
  } catch {
    /* no Makefile */
  }
  if (!cmds.test && (existsSync(join(root, "pyproject.toml")) || existsSync(join(root, "requirements.txt")))) {
    cmds.test = "pytest";
  }
  return cmds;
}

/** The Beacon-managed markdown body (architecture + db + commands + conventions). */
export async function buildContext(): Promise<string> {
  const meta = await getProjectMeta();
  let conventions: string[] = [];
  try {
    conventions = JSON.parse(meta.conventions);
  } catch {
    conventions = [];
  }

  const arch = await db.query.node.findMany({
    where: (t, { eq }) => eq(t.view, "ARCHITECTURE"),
    with: { files: { columns: { path: true } } },
    orderBy: (t, { asc }) => asc(t.cluster),
  });
  const tables = await db.query.dbTable.findMany({
    with: { columns: { orderBy: (c, { asc }) => asc(c.ord) } },
    orderBy: (t, { asc }) => asc(t.name),
  });
  const endpoints = await db.query.endpoint.findMany({
    orderBy: (t, { asc }) => [asc(t.domain), asc(t.path)],
  });
  const cmds = deriveCommands(repoRoot());

  const lines: string[] = [`## Project: ${repoName()}`];
  if (meta.overview) lines.push("", meta.overview);

  if (Object.keys(cmds).length) {
    lines.push("", "### Commands");
    for (const [k, v] of Object.entries(cmds)) lines.push(`- ${k}: \`${v}\``);
  }

  if (arch.length) {
    lines.push("", "### Architecture");
    const byDomain = new Map<string, typeof arch>();
    for (const n of arch) {
      const d = n.cluster ?? "MISC";
      if (!byDomain.has(d)) byDomain.set(d, []);
      byDomain.get(d)!.push(n);
    }
    for (const [domain, comps] of byDomain) {
      lines.push(`- **${domain}**`);
      for (const c of comps) {
        const files = c.files.map((f) => f.path).slice(0, 6).join(", ");
        lines.push(`  - ${c.title}${c.role ? ` — ${c.role}` : ""}${files ? ` (${files})` : ""}`);
      }
    }
  }

  if (tables.length) {
    lines.push("", "### Database");
    for (const t of tables) {
      lines.push(`- \`${t.name}\`: ${t.columns.map((c) => c.name).slice(0, 12).join(", ")}`);
    }
  }

  if (endpoints.length) {
    lines.push("", "### Endpoints");
    for (const e of endpoints.slice(0, 40)) lines.push(`- ${e.method} ${e.path}`);
  }

  if (conventions.length) {
    lines.push("", "### Conventions & gotchas");
    for (const c of conventions) lines.push(`- ${c}`);
  }

  lines.push("", "_Maintained by Beacon — edit outside the markers; this block is regenerated._");
  return lines.join("\n");
}

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function upsertBlock(file: string, block: string, headerIfNew: string) {
  // The generated body must NEVER contain the literal markers: a convention line quoting
  // them once made the non-greedy replace cut at the EMBEDDED end-marker and leak the
  // block's tail below the section — one more copy per regeneration. Strip the comment
  // wrapper from any quoted marker so only the real delimiters exist in the file.
  const safe = block.replaceAll(START, "`beacon:start`").replaceAll(END, "`beacon:end`");
  const section = `${START}\n${safe}\n${END}`;
  let content = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (content.includes(START) && content.includes(END)) {
    // Greedy first-START → last-END: identical to non-greedy on a healthy file (one block),
    // and collapses any accumulated duplicated/nested fragments back to a single block.
    content = content.replace(new RegExp(`${escRe(START)}[\\s\\S]*${escRe(END)}`), () => section);
  } else {
    content = content.trim() ? `${content.trim()}\n\n${section}\n` : `${headerIfNew}\n\n${section}\n`;
  }
  writeFileSync(file, content);
}

/** Write the context block into the repo's context doc(s), strip any stale `@AGENTS.md` pointer,
 *  and return the files written. */
export async function writeContextFiles(opts: { onlyIfManaged?: boolean } = {}): Promise<string[]> {
  const root = repoRoot();
  let targets = contextDocTargets(root);

  // In auto/keep-fresh mode, only refresh files Beacon already manages — never newly adopt a file
  // (or bootstrap a fresh repo).
  if (opts.onlyIfManaged) {
    targets = targets.filter((f) => existsSync(f) && readFileSync(f, "utf8").includes(START));
    if (!targets.length) return [];
  }

  const body = await buildContext();
  for (const target of targets) {
    upsertBlock(target, body, `# ${basename(target)}`);
  }
  stripAgentsPointer(root);
  return targets;
}
