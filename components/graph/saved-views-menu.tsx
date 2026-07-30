"use client";

import { useCallback, useState } from "react";
import { Bookmark, Check, Pencil, Star, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { CanvasPopover } from "./canvas-popover";
import type { SavedView, SavedViewBoard, SavedViewState } from "@/lib/saved-views";

// The Saved views popover: named snapshots of how this board is being looked at (filters, layer
// emphasis, arrange, hide-empty, folds, group-by). Presentational + its own server round-trips —
// it never touches board state. Applying hands the whole view back through `onApply` and the
// board decides what to do with it; saving reads the `current` snapshot the board passes down.
// Type-only import above, so the node-side store never reaches the client bundle.

async function call<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  if (!res.ok) throw new Error((await res.text()) || `Request failed (${res.status})`);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const iconBtn =
  "flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-[var(--ink-hover)] hover:text-foreground disabled:opacity-40";
const inputCls =
  "w-full rounded-md border border-border bg-[var(--ink-hover)] px-2 py-1 text-[12px] outline-none placeholder:text-muted-foreground/50 focus:bg-[var(--ink-active)]";

export function SavedViewsMenu({
  board,
  current,
  onApply,
  activeViewId = null,
}: {
  board: SavedViewBoard;
  /** The board's live view-state, in the serializable shape the store persists. */
  current: SavedViewState;
  /** Apply a saved view to the board. The menu owns no board state. */
  onApply: (view: SavedView) => void;
  /** Which view the board currently has applied, if any — for the row highlight. */
  activeViewId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<SavedView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const load = useCallback(async () => {
    try {
      setViews(await call<SavedView[]>(`/api/saved-views?board=${board}`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load saved views");
    }
  }, [board]);

  // Every mutation re-reads the list: the server owns the "one default per board" invariant, so
  // re-reading keeps the stars honest without mirroring that rule on the client.
  const mutate = useCallback(
    async (run: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await run();
        setError(null);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const save = () => {
    const name = newName.trim();
    if (!name) return;
    void mutate(async () => {
      await call<SavedView>("/api/saved-views", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ board, name, state: current }),
      });
      setNewName("");
    });
  };

  const patch = (id: string, body: Record<string, unknown>) =>
    mutate(() =>
      call<SavedView>("/api/saved-views", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      }),
    );

  const commitRename = (view: SavedView) => {
    const name = renameValue.trim();
    setRenamingId(null);
    if (!name || name === view.name) return;
    void patch(view.id, { name });
  };

  return (
    <CanvasPopover
      title="Saved views"
      open={open}
      // Fetch on first open — a board that never opens the menu pays nothing.
      onOpenChange={(next) => {
        setOpen(next);
        if (next && views === null) void load();
      }}
      trigger={(isOpen, toggle) => (
        <button
          type="button"
          onClick={toggle}
          aria-label="Saved views"
          aria-expanded={isOpen}
          title="Saved views — named filter + layout presets for this board"
          className={cn(
            "glass flex size-8 items-center justify-center rounded-lg transition-colors",
            isOpen || activeViewId ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Bookmark className="size-4" />
        </button>
      )}
    >
      {error && (
        <div role="alert" className="mb-2 text-[11px] text-red-400">
          {error}
        </div>
      )}

      <ul aria-busy={busy} className="max-h-64 space-y-0.5 overflow-y-auto">
        {views === null && <li className="px-1 py-1 text-[11px] text-muted-foreground">Loading…</li>}
        {views?.length === 0 && (
          <li className="px-1 py-1 text-[11px] text-muted-foreground">
            No saved views yet — save the current one below.
          </li>
        )}
        {views?.map((v) =>
          renamingId === v.id ? (
            <li key={v.id} className="flex items-center gap-1">
              <input
                autoFocus
                aria-label={`Rename ${v.name}`}
                value={renameValue}
                maxLength={60}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename(v);
                  if (e.key === "Escape") {
                    e.stopPropagation(); // cancel the rename, don't close the popover
                    setRenamingId(null);
                  }
                }}
                className={inputCls}
              />
              <button
                type="button"
                aria-label={`Save the new name for ${v.name}`}
                onClick={() => commitRename(v)}
                className={iconBtn}
              >
                <Check className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label="Cancel renaming"
                onClick={() => setRenamingId(null)}
                className={iconBtn}
              >
                <X className="size-3.5" />
              </button>
            </li>
          ) : (
            <li
              key={v.id}
              className={cn(
                "group flex items-center gap-1 rounded-md pr-1 transition-colors hover:bg-[var(--ink-hover)]",
                v.id === activeViewId && "bg-[var(--ink-active)]",
              )}
            >
              <button
                type="button"
                onClick={() => {
                  onApply(v);
                  setOpen(false);
                }}
                className="min-w-0 flex-1 truncate px-2 py-1 text-left text-[12px] text-muted-foreground transition-colors group-hover:text-foreground"
              >
                {v.name}
              </button>
              <button
                type="button"
                disabled={busy}
                aria-pressed={v.isDefault}
                aria-label={
                  v.isDefault
                    ? `Stop opening this board with ${v.name}`
                    : `Open this board with ${v.name} by default`
                }
                onClick={() => void patch(v.id, { isDefault: !v.isDefault })}
                className={cn(iconBtn, v.isDefault && "text-foreground")}
              >
                <Star className={cn("size-3.5", v.isDefault && "fill-current")} />
              </button>
              <button
                type="button"
                disabled={busy}
                aria-label={`Rename ${v.name}`}
                onClick={() => {
                  setRenameValue(v.name);
                  setRenamingId(v.id);
                }}
                className={iconBtn}
              >
                <Pencil className="size-3.5" />
              </button>
              <button
                type="button"
                disabled={busy}
                aria-label={`Delete ${v.name}`}
                onClick={() =>
                  void mutate(() =>
                    call(`/api/saved-views?id=${encodeURIComponent(v.id)}`, { method: "DELETE" }),
                  )
                }
                className={cn(iconBtn, "hover:text-red-400")}
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ),
        )}
      </ul>

      <div className="mt-2 flex items-center gap-1 border-t border-border pt-2">
        <input
          aria-label="Name for the current view"
          placeholder="Save current view as…"
          value={newName}
          maxLength={60}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape" && newName) {
              e.stopPropagation(); // clear the draft name first; a second Escape closes
              setNewName("");
            }
          }}
          className={inputCls}
        />
        <button
          type="button"
          disabled={busy || !newName.trim()}
          onClick={save}
          className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-[var(--ink-hover)] hover:text-foreground disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </CanvasPopover>
  );
}
