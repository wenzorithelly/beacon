"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pin, PinOff, Plus, StickyNote, Trash2, X } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { NoteEditor } from "@/components/notes/note-editor";
import { useNotes } from "@/components/notes/notes-context";
import { cn } from "@/lib/utils";

interface Note {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  ord: number;
  updatedAt: string;
}

// Server order: pinned first, then most-recently-updated (mirrors lib/notes.listNotes).
function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) =>
    a.pinned !== b.pinned ? Number(b.pinned) - Number(a.pinned) : b.updatedAt.localeCompare(a.updatedAt),
  );
}

// Global slide-out notebook. Cookie-scoped to the browser's active workspace (plain fetches,
// no x-beacon-workspace header), so the notes match the repo the agent @-mentions. Edits
// autosave debounced; the same markdown the editor stores is what note://{slug} serves.
export function NotesDrawer() {
  const { open, close } = useNotes();
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Debounced, per-note accumulating autosave (title + body merge into one PATCH).
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pending = useRef<Record<string, Partial<Note>>>({});

  const flush = useCallback((id: string) => {
    clearTimeout(timers.current[id]);
    const patch = pending.current[id];
    if (!patch) return;
    delete pending.current[id];
    void fetch(`/api/notes/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => {});
  }, []);

  const scheduleSave = useCallback(
    (id: string, patch: Partial<Note>) => {
      pending.current[id] = { ...pending.current[id], ...patch };
      clearTimeout(timers.current[id]);
      timers.current[id] = setTimeout(() => flush(id), 500);
    },
    [flush],
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notes", { cache: "no-store" });
      if (!res.ok) return;
      const rows = (await res.json()) as Note[];
      setNotes(sortNotes(rows));
      setSelectedId((cur) => cur ?? rows[0]?.id ?? null);
    } catch {
      /* ignore network blips */
    }
  }, []);

  // Refetch each time the drawer opens (picks up notes the agent or another tab changed);
  // flush every pending save when it closes so nothing in flight is lost.
  useEffect(() => {
    // load()'s setState happens after an await (fetch) — the rule can't see the async
    // boundary through the call and flags it as synchronous.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) void load();
    else Object.keys(pending.current).forEach(flush);
  }, [open, load, flush]);

  const create = useCallback(async () => {
    const res = await fetch("/api/notes", { method: "POST" }).catch(() => null);
    if (!res?.ok) return;
    const note = (await res.json()) as Note;
    setNotes((prev) => sortNotes([note, ...prev]));
    setSelectedId(note.id);
  }, []);

  const remove = useCallback(
    async (id: string) => {
      clearTimeout(timers.current[id]);
      delete pending.current[id];
      setNotes((prev) => {
        const next = prev.filter((n) => n.id !== id);
        setSelectedId((cur) => (cur === id ? next[0]?.id ?? null : cur));
        return next;
      });
      await fetch(`/api/notes/${id}`, { method: "DELETE" }).catch(() => {});
    },
    [],
  );

  const patchLocal = useCallback(
    (id: string, patch: Partial<Note>) => {
      setNotes((prev) =>
        sortNotes(prev.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: new Date().toISOString() } : n))),
      );
      scheduleSave(id, patch);
    },
    [scheduleSave],
  );

  const togglePin = useCallback(
    (n: Note) => patchLocal(n.id, { pinned: !n.pinned }),
    [patchLocal],
  );

  const selected = notes.find((n) => n.id === selectedId) ?? null;

  return (
    <div
      aria-hidden={!open}
      className={cn(
        "fixed inset-y-0 right-0 z-40 flex transition-transform duration-300 ease-out",
        open ? "translate-x-0" : "pointer-events-none translate-x-full",
      )}
    >
      <GlassPanel className="flex h-full w-[420px] flex-col rounded-l-2xl border-l border-white/10">
        {/* header */}
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2.5">
          <StickyNote className="size-4 text-[var(--accent-2,#ff7a45)]" />
          <span className="text-sm font-semibold tracking-tight">Notes</span>
          <span className="ml-auto" />
          <button
            type="button"
            onClick={create}
            aria-label="New note"
            title="New note"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
          >
            <Plus className="size-4" />
          </button>
          <button
            type="button"
            onClick={close}
            aria-label="Close notes"
            title="Close"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* note list */}
        <div className="max-h-44 shrink-0 overflow-y-auto border-b border-white/10 p-1.5">
          {notes.length === 0 ? (
            <p className="px-2 py-3 text-[13px] text-muted-foreground">
              No notes yet. Hit <span className="text-foreground">+</span> to start one.
            </p>
          ) : (
            notes.map((n) => (
              <div
                key={n.id}
                className={cn(
                  "group flex items-center gap-1 rounded-md px-2 py-1.5 text-[13px]",
                  n.id === selectedId ? "bg-white/[0.09] text-foreground" : "text-muted-foreground hover:bg-white/[0.04]",
                )}
              >
                <button
                  type="button"
                  onClick={() => setSelectedId(n.id)}
                  className="min-w-0 flex-1 truncate text-left"
                >
                  {n.pinned && <Pin className="mr-1 inline size-3 -translate-y-px" />}
                  {n.title || "Untitled"}
                </button>
                <button
                  type="button"
                  onClick={() => togglePin(n)}
                  aria-label={n.pinned ? "Unpin" : "Pin"}
                  title={n.pinned ? "Unpin" : "Pin"}
                  className="rounded p-1 opacity-0 transition hover:bg-white/[0.08] hover:text-foreground group-hover:opacity-100"
                >
                  {n.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => remove(n.id)}
                  aria-label="Delete note"
                  title="Delete"
                  className="rounded p-1 opacity-0 transition hover:bg-white/[0.08] hover:text-red-300 group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* editor */}
        {selected ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
            <input
              value={selected.title}
              onChange={(e) => patchLocal(selected.id, { title: e.target.value })}
              placeholder="Untitled"
              className="w-full bg-transparent text-base font-semibold tracking-tight text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
            />
            <NoteEditor
              key={selected.id}
              value={selected.body}
              onChange={(markdown) => patchLocal(selected.id, { body: markdown })}
            />
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-[13px] text-muted-foreground">
            Select a note, or create one. Then <span className="px-1 text-foreground">@</span>-mention it
            in your terminal to turn it into features.
          </div>
        )}
      </GlassPanel>
    </div>
  );
}
