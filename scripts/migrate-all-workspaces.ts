#!/usr/bin/env bun
// One-shot maintenance: provision/migrate every registered workspace DB using the
// same in-process migration path the daemon uses (lib/drizzle/provision). Useful
// after a release whose migrations haven't reached workspaces the browser hasn't
// re-opened via the CLI yet.
import { listWorkspaces, ensureWorkspaceDb } from "@/lib/workspaces";

for (const w of listWorkspaces()) {
  const r = await ensureWorkspaceDb(w.id);
  console.log(w.id, w.path, r.ok ? "ok" : `ERROR: ${r.error}`);
}
