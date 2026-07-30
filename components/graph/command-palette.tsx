"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { filterCommands, type BoardCommand, type CommandGroup } from "@/lib/board-commands";
import { cn } from "@/lib/utils";

// ⌘K palette over the board's command registry (lib/board-commands). The registry decides
// WHAT can run; this only searches, groups and runs it.
//
// It owns its own open state and its own ⌘K binding, and reports every transition through
// `onOpenChange` so the board can suppress its single-key shortcuts while the palette has
// the keyboard (`useBoardKeys({ enabled: !paletteOpen })`) — do NOT also pass `onPalette` to
// that hook, or ⌘K fires twice.
//
// The dialog itself is the ShadCN/base-ui one: role="dialog", focus trap, Escape to close,
// focus restored to whatever was focused before it opened.

const GROUP_LABEL: Record<CommandGroup, string> = {
  navigation: "Jump to",
  card: "Selected card",
  board: "Board",
  create: "Create",
};

export function CommandPalette({
  commands,
  onOpenChange,
  placeholder = "Search commands and cards…",
}: {
  /** Rebuilt by the caller from live board state — see buildCommands(). */
  commands: BoardCommand[];
  /** Fired on every open/close, so the caller can disable the board's single-key shortcuts. */
  onOpenChange?: (open: boolean) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const setOpenState = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (!next) setQuery("");
      setActive(0);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  // ⌘K / Ctrl-K toggles. No is-typing guard here on purpose: unlike the board's single-key
  // shortcuts, a meta chord never collides with typing, and the palette must still close
  // with ⌘K while its own (focused) input owns the keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return;
      e.preventDefault();
      setOpenState(!open);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpenState]);

  // Ranked hits, then grouped. A Map keeps insertion order, so with a query the group holding
  // the best match comes first (the top row is always the best match); with no query the
  // registry's own order (navigation → card → board → create) is preserved.
  const sections = useMemo(() => {
    const by = new Map<CommandGroup, BoardCommand[]>();
    for (const c of filterCommands(commands, query)) {
      const bucket = by.get(c.group);
      if (bucket) bucket.push(c);
      else by.set(c.group, [c]);
    }
    return Array.from(by, ([group, items]) => ({ group, items }));
  }, [commands, query]);

  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const activeIdx = flat.length ? Math.min(active, flat.length - 1) : 0;
  const activeId = flat[activeIdx]?.id;

  // Keep the highlighted row on screen while arrowing through a long list.
  useEffect(() => {
    if (!activeId) return;
    listRef.current?.querySelector(`[data-cmd-id="${CSS.escape(activeId)}"]`)?.scrollIntoView({
      block: "nearest",
    });
  }, [activeId]);

  const run = (cmd: BoardCommand) => {
    setOpenState(false);
    cmd.run();
  };

  return (
    <Dialog open={open} onOpenChange={setOpenState}>
      <DialogContent
        aria-modal="true"
        showCloseButton={false}
        className="gap-0 overflow-hidden p-0 sm:max-w-lg"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>

        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Search className="size-4 shrink-0 text-muted-foreground/70" />
          <input
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls="command-palette-list"
            aria-activedescendant={activeId ? `command-palette-opt-${activeId}` : undefined}
            aria-autocomplete="list"
            aria-label="Search commands"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                if (!flat.length) return;
                const next = activeIdx + (e.key === "ArrowDown" ? 1 : -1);
                setActive((next + flat.length) % flat.length);
              } else if (e.key === "Enter") {
                e.preventDefault();
                const cmd = flat[activeIdx];
                if (cmd) run(cmd);
              }
            }}
            placeholder={placeholder}
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/50"
          />
        </div>

        <div
          id="command-palette-list"
          role="listbox"
          aria-label="Commands"
          ref={listRef}
          className="max-h-[min(60vh,26rem)] overflow-y-auto p-1.5"
        >
          {!flat.length && (
            <div className="px-2 py-6 text-center text-[12px] text-muted-foreground">
              No matching commands
            </div>
          )}
          {sections.map((section) => (
            <div key={section.group} className="mb-1 last:mb-0">
              <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
                {GROUP_LABEL[section.group]}
              </div>
              {section.items.map((cmd) => {
                const on = cmd.id === activeId;
                return (
                  <button
                    key={cmd.id}
                    type="button"
                    id={`command-palette-opt-${cmd.id}`}
                    data-cmd-id={cmd.id}
                    role="option"
                    aria-selected={on}
                    tabIndex={-1}
                    onMouseMove={() => setActive(flat.indexOf(cmd))}
                    onClick={() => run(cmd)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
                      on ? "bg-[var(--ink-active)] text-foreground" : "text-muted-foreground",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{cmd.label}</span>
                    {cmd.hint && (
                      <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground/50">
                        {cmd.hint}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
