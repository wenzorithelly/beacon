import { execSync } from "node:child_process";
import type { SourceFile } from "@/intel/extractors/files";

// Behavioral hotspots (CodeScene-style): churn × complexity. Code that is both
// complicated AND changed often is where tech debt actually costs you time.

export function gitChurn(root: string, maxCommits = 800): Map<string, number> {
  const churn = new Map<string, number>();
  try {
    const out = execSync(`git log -n ${maxCommits} --pretty=format: --name-only --no-merges`, {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 1 << 27,
    }).toString();
    for (const line of out.split("\n")) {
      const p = line.trim();
      if (p) churn.set(p, (churn.get(p) ?? 0) + 1);
    }
  } catch {
    /* not a git repo / git unavailable */
  }
  return churn;
}

// Cheap complexity proxy: lines + weighted control-flow density (no AST needed).
export function complexity(content: string): number {
  const lines = content.split("\n").length;
  const branches = (content.match(/\b(if|else|for|while|case|catch|elif|switch|when)\b|&&|\|\|/g) ?? [])
    .length;
  return lines + branches * 4;
}

export interface Hotspot {
  path: string;
  churn: number;
  complexity: number;
  score: number; // 0..1 (normalized to the hottest file)
}

export function scoreHotspots(files: SourceFile[], churn: Map<string, number>): Hotspot[] {
  const raw = files.map((f) => {
    const ch = churn.get(f.path) ?? 0;
    const cx = complexity(f.content);
    return { path: f.path, churn: ch, complexity: cx, score: ch * cx };
  });
  const max = Math.max(1, ...raw.map((r) => r.score));
  return raw
    .filter((r) => r.churn > 0 && r.score > 0)
    .map((r) => ({ ...r, score: Math.round((r.score / max) * 100) / 100 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 30);
}
