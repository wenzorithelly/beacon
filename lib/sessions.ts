import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { repoRoot } from "@/lib/project";

// Reads Claude Code session transcripts for the current project from
// ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl and reports their state.
// Only metadata is extracted (title, branch, mode, timestamps, counts) — never
// conversation content. Big transcripts are read head+tail, not fully parsed.

const PROJECTS = join(homedir(), ".claude", "projects");
const COORD = join(homedir(), ".claude-coordination", "state.json");
const LIVE_WINDOW_MS = 3 * 60 * 1000; // active if written in the last 3 min

export interface SessionInfo {
  id: string;
  title: string;
  cwd: string;
  branch: string | null;
  kind: "interactive" | "headless";
  messages: number | null;
  startedAt: string | null;
  lastActivityAt: string;
  mode: string | null;
  live: boolean;
  task?: string;
  status?: string;
}

export function projectRoot(): string {
  return repoRoot();
}

// Claude Code encodes the launch cwd into the project-dir name (non-alphanumerics → "-").
function encodePath(p: string): string {
  return p.replace(/[^a-zA-Z0-9]/g, "-");
}

function readChunk(file: string, start: number, len: number): string {
  if (len <= 0) return "";
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(len);
    const n = readSync(fd, buf, 0, len, start);
    return buf.toString("utf8", 0, n);
  } finally {
    closeSync(fd);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseLines(text: string): any[] {
  return text
    .split("\n")
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function coordForRoot(root: string): { task?: string; status?: string } | null {
  try {
    const j = JSON.parse(readFileSync(COORD, "utf8"));
    const agents = Object.values(j.agents ?? {}) as Array<{
      directory?: string;
      task?: string;
      status?: string;
      last_seen?: string;
    }>;
    const match = agents
      .filter((a) => typeof a.directory === "string" && a.directory.startsWith(root))
      .filter((a) => a.status === "active");
    return match[0] ?? null;
  } catch {
    return null;
  }
}

export function listProjectSessions(): SessionInfo[] {
  if (!existsSync(PROJECTS)) return [];
  const root = projectRoot();
  const enc = encodePath(root);
  const now = Date.now();

  let dirs: string[];
  try {
    dirs = readdirSync(PROJECTS).filter((d) => d === enc || d.startsWith(`${enc}-`));
  } catch {
    return [];
  }

  const out: SessionInfo[] = [];
  for (const d of dirs) {
    const dir = join(PROJECTS, d);
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const f of files) {
      const file = join(dir, f);
      let st;
      try {
        st = statSync(file);
      } catch {
        continue;
      }
      const size = st.size;
      const head = parseLines(readChunk(file, 0, Math.min(16384, size)));
      const tail = parseLines(readChunk(file, Math.max(0, size - 65536), Math.min(65536, size)));

      let cwd = "";
      let branch: string | null = null;
      let startedAt: string | null = null;
      for (const l of head) {
        if (!cwd && l.cwd) cwd = l.cwd;
        if (branch === null && l.gitBranch) branch = l.gitBranch;
        if (!startedAt && l.timestamp) startedAt = l.timestamp;
      }

      let title = "";
      let mode: string | null = null;
      let lastTs: string | null = null;
      let messages: number | null = null;
      for (const l of tail) {
        if (l.type === "ai-title" && l.aiTitle) title = l.aiTitle;
        if (l.type === "permission-mode" && l.permissionMode) mode = l.permissionMode;
        if (l.timestamp) lastTs = l.timestamp;
        if (l.type === "system" && typeof l.messageCount === "number") messages = l.messageCount;
      }

      if (cwd && !cwd.startsWith(root)) continue;

      const lastActivityAt = lastTs ?? st.mtime.toISOString();
      out.push({
        id: f.replace(/\.jsonl$/, ""),
        title: title || "(sem título)",
        cwd: cwd || "?",
        branch,
        kind: title ? "interactive" : "headless",
        messages,
        startedAt,
        lastActivityAt,
        mode,
        live: now - new Date(lastActivityAt).getTime() < LIVE_WINDOW_MS,
      });
    }
  }

  out.sort((a, b) => +new Date(b.lastActivityAt) - +new Date(a.lastActivityAt));

  // Attach the project's active coordination task to the most-recent live interactive session.
  const coord = coordForRoot(root);
  if (coord) {
    const target = out.find((s) => s.live && s.kind === "interactive") ?? out[0];
    if (target) {
      target.task = coord.task;
      target.status = coord.status;
    }
  }

  return out;
}
