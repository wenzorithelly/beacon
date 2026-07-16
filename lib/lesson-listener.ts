import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeJsonAtomic } from "@/lib/atomic-write";
import { dataDir } from "@/lib/project";

// A beacon_explain invocation is a listener for the current round of Learn questions. The desktop
// shell uses this heartbeat to avoid delivering the same question through the terminal while the
// original blocking MCP call can still return it. If that call dies, its timestamp expires and the
// shell takes over from lesson-questions.json. Multiple agent sessions may listen concurrently.
export const LESSON_LISTENER_TTL_MS = 12_000;
export const LESSON_HANDOFF_GRACE_MS = 90_000;

interface ListenerFile {
  listeners: Record<string, { ts: number; handoffUntil?: number }>;
}

function path(): string {
  return join(dataDir(), "lesson-listener.json");
}

function read(): ListenerFile {
  try {
    const raw = JSON.parse(readFileSync(path(), "utf8")) as Partial<ListenerFile>;
    const listeners: ListenerFile["listeners"] = {};
    for (const [id, entry] of Object.entries(raw.listeners ?? {})) {
      if (typeof entry?.ts === "number") {
        listeners[id] = {
          ts: entry.ts,
          ...(typeof entry.handoffUntil === "number" ? { handoffUntil: entry.handoffUntil } : {}),
        };
      }
    }
    return { listeners };
  } catch {
    return { listeners: {} };
  }
}

/** Refresh one blocking MCP invocation. Pruning here keeps abandoned listeners from accumulating
 * forever; their expiry is precisely what releases durable terminal fallback delivery. */
export function heartbeatLessonListener(listenerId: string, now = Date.now()): void {
  const listeners = Object.fromEntries(
    Object.entries(read().listeners).filter(([, listener]) => now - listener.ts < LESSON_LISTENER_TTL_MS),
  );
  listeners[listenerId] = { ts: now };
  writeJsonAtomic(path(), { listeners } satisfies ListenerFile);
}

/** The MCP call has returned the questions to its agent. Keep an explicit lease while that agent
 * starts answering, so the desktop fallback does not inject a duplicate halfway through the turn.
 * If the turn dies, the lease eventually expires and the persisted queue is still recovered. */
export function holdLessonListener(listenerId: string, now = Date.now()): void {
  const listeners = read().listeners;
  listeners[listenerId] = { ts: now, handoffUntil: now + LESSON_HANDOFF_GRACE_MS };
  writeJsonAtomic(path(), { listeners } satisfies ListenerFile);
}

/** Remove an invocation that ended without handing a question back to its agent. A question result
 * intentionally keeps its final heartbeat for one TTL: the tool response is then allowed to reach
 * the agent before the desktop fallback is eligible to inject the same queue. */
export function clearLessonListener(listenerId: string): void {
  const listeners = read().listeners;
  if (!(listenerId in listeners)) return;
  delete listeners[listenerId];
  writeJsonAtomic(path(), { listeners } satisfies ListenerFile);
}
