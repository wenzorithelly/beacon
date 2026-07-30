"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Boxes,
  ChevronRight,
  Bug,
  CircleDashed,
  CornerDownRight,
  ExternalLink,
  Flag,
  Layers,
  Milestone,
  MoreHorizontal,
  Plus,
  Sparkles,
  Tag,
  Users,
  X,
} from "lucide-react";
import {
  PanelHeader,
  PanelSection,
  PanelShell,
  PanelStat,
  PropRow,
  QUIET_TRIGGER,
  type PanelTab,
} from "@/components/graph/panel/primitives";
import { RichNodeEditor } from "@/components/graph/rich-node-editor";
import { FileTree } from "@/components/file-tree/file-tree";
import {
  ARCH_STATUSES,
  ROADMAP_STATUSES,
  STATUS_META,
  clusterLabel,
} from "@/lib/constants";
import { categoryColorClass } from "@/lib/category-color";
import { PRIORITY_HUE, PRIORITY_LABELS } from "@/lib/board-grouping";
import { STATUS_STRIPE } from "@/components/graph/node-card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { NodeFormDialog } from "@/components/graph/node-form-dialog";
import { useNodeEdit } from "@/components/graph/node-edit-context";
import { LAYER_META, normalizeLayer } from "@/lib/layer";
import { linearStateToStatus } from "@/lib/linear/mapping";
import { useLinearStates } from "@/lib/use-linear-states";
import { cn } from "@/lib/utils";
import type { MapNodePayload } from "@/components/graph/types";
import type { ReactNode } from "react";


export type SidebarTab = PanelTab;

// THE card detail is `NodeDetail` below — one two-pane body (reading column + properties rail),
// rendered by exactly two hosts:
//   • the WIDE CENTERED MODAL (components/columns/peek-panel.tsx) — the standalone /map boards
//     (canvas + columns, roadmap + architecture) open it and nothing is docked there anymore;
//   • this right-docked panel — kept ONLY for the EMBEDDED boards (/plan review, plan history,
//     /learn, shared boards), where the board is one half of a split screen and a full-viewport
//     modal would cover the other half. It is also the host of /plan's Comments tab and of the
//     nothing-selected Overview, neither of which is card detail.
// Composed from the shared panel primitives — see panel/primitives.tsx for the shell/header/row/
// section language it shares with the DB board's sidebar.
export function DetailSidebar({
  view,
  selected,
  allNodes,
  onClose,
  // When commentsContent is provided the panel renders a tab strip and switches
  // between Details and Comments. plan-workspace passes this in on /plan.
  commentsContent,
  commentsCount = 0,
  activeTab,
  onTabChange,
  onAddComment,
  onEditingDescription,
  topOffset,
}: {
  view: "ROADMAP" | "ARCHITECTURE";
  selected: MapNodePayload | null;
  allNodes: MapNodePayload[];
  onClose: () => void;
  commentsContent?: ReactNode;
  commentsCount?: number;
  activeTab?: SidebarTab;
  onTabChange?: (tab: SidebarTab) => void;
  /** On /plan: leave a comment anchored to the selected node (excerpt = its title). When set, a
      comment button shows in the panel header. */
  onAddComment?: (excerpt: string) => void;
  /** Called with a node id while THIS panel's inline description editor is open, and with null
      when it closes. The board registers it as a reconcile hold: the editor keeps its text in
      local state and re-seeds it from `node.plain`, so a live-refresh landing mid-paragraph
      would otherwise re-seed the editor and wipe what the user is typing. */
  onEditingDescription?: (id: string | null) => void;
  /** Top inset of the panel (overrides the default flush top) — used in /plan to clear
      the floating Plan pill. */
  topOffset?: number;
}) {
  const tabbed = !!commentsContent;
  const tab: SidebarTab = activeTab ?? "details";
  const parentTitle = selected?.parentId
    ? allNodes.find((n) => n.id === selected.parentId)?.title ?? null
    : null;

  return (
    <PanelShell topOffset={topOffset}>
      <PanelHeader
        tabs={tabbed ? { active: tab, count: commentsCount, onChange: (t) => onTabChange?.(t) } : null}
        breadcrumb={
          selected ? (
            <Breadcrumb node={selected} view={view} />
          ) : view === "ROADMAP" ? (
            "Roadmap"
          ) : (
            "Architecture"
          )
        }
        comment={
          onAddComment && selected && tab === "details"
            ? {
                title: `Comment on this ${view === "ARCHITECTURE" ? "component" : "feature"}`,
                onClick: () => onAddComment(selected.title),
              }
            : null
        }
        onClose={onClose}
      />

      {tab === "comments" && tabbed ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="px-4 py-3">{commentsContent}</div>
        </div>
      ) : selected ? (
        <NodeDetail
          key={selected.id}
          node={selected}
          view={view}
          parentTitle={parentTitle}
          stacked
          showBreadcrumb={tabbed}
          showTitle
          onEditingDescription={onEditingDescription}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="px-4 py-3">
            <Overview view={view} nodes={allNodes} />
          </div>
        </div>
      )}
    </PanelShell>
  );
}

// category · layer · kind — the node's place, in one whispered line. Exported: the modal renders
// the very same eyebrow above its title.
export function Breadcrumb({ node, view }: { node: MapNodePayload; view: string }) {
  const { hasFrontend } = useNodeEdit();
  const layer = normalizeLayer(node.layer);
  const kind =
    view === "ARCHITECTURE"
      ? "component"
      : node.kind === "BUG"
        ? "bug"
        : node.parentId
          ? "sub-task"
          : "feature";
  return (
    <>
      {clusterLabel(node.cluster)}
      {hasFrontend && layer && <span> · {LAYER_META[layer].label}</span>}
      <span> · {kind}</span>
    </>
  );
}

/** The card title, click-to-edit — Linear style: no separate edit dialog, the text itself becomes
 *  the field. Shared by the modal's DialogTitle and this file's own `showTitle` heading, so there
 *  is exactly one editable-title implementation for both card-detail hosts. */
export function EditableTitle({
  node,
  className,
  field = "title",
}: {
  node: MapNodePayload;
  className?: string;
  /** `role` is the one-line summary under the title. It had NO inline control anywhere — its only
   *  editor was the Edit dialog, and removing that dialog left a writable field with no writer. */
  field?: "title" | "role";
}) {
  const { saveFields, readOnly } = useNodeEdit();
  const [editing, setEditing] = useState(false);
  const stored = (field === "title" ? node.title : node.role) ?? "";
  const [value, setValue] = useState(stored);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setValue(stored), [node.id, stored]);

  const commit = () => {
    setEditing(false);
    const v = value.trim();
    // A title is required, so an empty one reverts; role is optional and clears to null.
    if (field === "title") {
      if (v && v !== node.title) void saveFields(node.id, { title: v });
      else setValue(node.title);
      return;
    }
    if (v !== (node.role ?? "")) void saveFields(node.id, { role: v || null });
  };

  if (editing && !readOnly) {
    return (
      <input
        autoFocus
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setValue(stored);
            setEditing(false);
          }
        }}
        className={cn(
          "-mx-1 w-[calc(100%+0.5rem)] rounded bg-[var(--ink-hover)] px-1 outline-none",
          className,
        )}
      />
    );
  }
  return (
    <span
      role={readOnly ? undefined : "button"}
      tabIndex={readOnly ? undefined : 0}
      title={readOnly ? undefined : "Click to edit"}
      onClick={() => !readOnly && setEditing(true)}
      onKeyDown={(e) => {
        if (!readOnly && e.key === "Enter") setEditing(true);
      }}
      className={cn(
        // No hover tint on the reading surfaces — the text cursor is the whole affordance.
        !readOnly && "-mx-1 cursor-text rounded px-1",
        className,
      )}
    >
      {stored}
    </span>
  );
}

/** THE card detail body — Linear's issue view: a reading column (description, files, bug flags)
 *  beside a narrow properties rail, with the actions in a footer under both. Two panes from `md`
 *  up; `stacked` (the 340px dock) forces the single-column order, rail after the content. */
export function NodeDetail({
  node,
  view,
  parentTitle,
  stacked = false,
  showBreadcrumb = false,
  showTitle = false,
  railExtra,
  mainExtra,
  onEditingDescription,
}: {
  node: MapNodePayload;
  view: "ROADMAP" | "ARCHITECTURE";
  parentTitle: string | null;
  /** Never split into two panes — the narrow docked panel. */
  stacked?: boolean;
  /** Render the category · layer · kind eyebrow here (the dock's header shows it instead when it
      is displaying the Details/Comments tab strip; the modal puts it in its own header). */
  showBreadcrumb?: boolean;
  /** Render the title here (the modal's title is its DialogTitle). */
  showTitle?: boolean;
  /** Extra rail content under the properties — the modal's Blocked by / Blocks lists. */
  railExtra?: ReactNode;
  /** Extra reading-column content, below the description — the modal's Sub-issues list, Linear-style. */
  mainExtra?: ReactNode;
  onEditingDescription?: (id: string | null) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [subOpen, setSubOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  // Collapsed by default — see the rail's Files block.
  const [filesOpen, setFilesOpen] = useState(false);
  // Description: rendered clean by default; click to edit (the toolbar appears only then).
  const [editingDesc, setEditingDesc] = useState(false);
  const [plain, setPlain] = useState(node.plain ?? "");
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setPlain(node.plain ?? ""), [node.id, node.plain]);
  // …and THAT re-seed is exactly why the board has to know this editor is open: while it is, the
  // paragraph being typed is the user's, not the server's. Registering the hold suppresses the
  // `plain` field for this node in the next reconcile, so an agent's `beacon_feature done` write
  // landing mid-sentence can no longer re-seed the editor out from under the typing.
  useEffect(() => {
    if (!editingDesc || !onEditingDescription) return;
    onEditingDescription(node.id);
    return () => onEditingDescription(null);
  }, [editingDesc, node.id, onEditingDescription]);
  // All mutations go through the NodeEditContext (tab-pinned /api/nodes routes with
  // optimistic update + rollback) — NEVER server actions, which pin by the browser-wide
  // beacon_ws cookie and write to the wrong workspace in a tab pinned via ?ws.
  const { hasFrontend, readOnly, acceptSuggestion, saveFields, removeNode } =
    useNodeEdit();

  const statuses = view === "ARCHITECTURE" ? ARCH_STATUSES : ROADMAP_STATUSES;
  const linearIssue =
    node.source === "LINEAR" && node.sourceRef
      ? node.sourceRef.match(/\/issue\/([^/]+)/)?.[1] ?? "Linear issue"
      : null;
  // The workspace's status vocabulary: the Linear team's real workflow states. Empty unless Linear
  // is connected, which is exactly when the picker falls back to Beacon's own statuses. Keyed by
  // the card's OWN team when it has one (the scope can span teams), else the workspace's primary.
  const linearStates = useLinearStates(node.externalMeta?.team?.id);
  // What the trigger shows. Prefer the state stored on the card (the exact one the user or Linear
  // set — several states share a type, so re-deriving from node.status would rewrite the choice);
  // fall back to mapping the Beacon status onto the vocabulary for a card that has never carried one.
  const stored = node.externalMeta?.state ?? null;
  const currentState =
    linearStates.find((s) => s.id === stored?.id) ??
    (stored?.name ? { id: stored.id ?? "", name: stored.name, color: stored.color, type: stored.type, position: 0 } : null) ??
    linearStates.find((s) => linearStateToStatus(s.type) === node.status) ??
    null;

  const saveLinearState = async (stateId: string) => {
    await fetch("/api/linear/status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nodeId: node.id, stateId }),
    });
  };

  const run = (fn: () => Promise<unknown>) =>
    startTransition(async () => {
      await fn();
      router.refresh();
    });

  const commitDesc = () => {
    setEditingDesc(false);
    const v = plain.trim() || null;
    if (v !== (node.plain ?? null)) run(() => saveFields(node.id, { plain: v }));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-y-auto",
          !stacked && "md:flex-row md:overflow-hidden",
        )}
      >
        {/* ── LEFT — the reading column: what you actually read, in a reading gutter ── */}
        <div className={cn("min-w-0 flex-1 px-5 pb-3 pt-3", !stacked && "md:min-h-0 md:overflow-y-auto")}>
          {showBreadcrumb && (
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Breadcrumb node={node} view={view} />
            </div>
          )}
          {showTitle && (
            <h2 className="text-base font-semibold leading-snug">
              <EditableTitle node={node} />
              {node.role ? (
                <EditableTitle
                  node={node}
                  field="role"
                  className="mt-0.5 block text-xs font-normal text-muted-foreground"
                />
              ) : null}
            </h2>
          )}

          {node.source === "INIT" && view === "ROADMAP" && !readOnly && (
            <div className="mt-3 rounded-lg border border-violet-400/25 bg-violet-500/[0.05] p-2.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-violet-700 dark:text-violet-300">
                <Sparkles className="size-3.5" /> AI suggestion
              </div>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                Suggested direction surfaced when mapping the repo. Accept to turn it into your
                own feature, or dismiss.
              </p>
              <div className="mt-2 flex gap-1.5">
                <Button
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  disabled={pending}
                  onClick={() => run(() => acceptSuggestion(node.id))}
                >
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2.5 text-xs text-muted-foreground"
                  disabled={pending}
                  onClick={() => run(() => removeNode(node.id))}
                >
                  Dismiss
                </Button>
              </div>
            </div>
          )}

          {/* ── Description — the document. ONE always-mounted editor, never a read-only render
              swapped for an editable one on click. That swap is what made the caret jump: the
              editable render adds a toolbar above the prose, shifting every line down, so the
              click point no longer named the word you clicked — and no amount of coordinate
              mapping fixes a layout that moves underneath you. Same element throughout means the
              browser places the caret natively, exactly where you click. ── */}
          <div>
            <div className="max-w-[72ch]">
              {plain.trim() || !readOnly ? (
                <RichNodeEditor
                  value={plain}
                  onChange={setPlain}
                  onFocus={() => setEditingDesc(true)}
                  onBlur={() => {
                    setEditingDesc(false);
                    commitDesc();
                  }}
                  editable={!readOnly}
                  roomy
                />
              ) : (
                <p className="text-[15px] text-muted-foreground">No description yet.</p>
              )}
            </div>
          </div>

          {mainExtra}

          {/* Bug flags — architecture components carry findings raised by the user or by an
              agent examining the code (beacon-init / beacon-refresh / describe_feature). */}
          {view === "ARCHITECTURE" && <BugFlagsSection node={node} readOnly={!!readOnly} />}
        </div>

        {/* ── RIGHT — the properties rail ── */}
        <aside
          className={cn(
            "shrink-0 border-t border-border px-4 py-3",
            !stacked && "md:min-h-0 md:w-[280px] md:overflow-y-auto md:border-l md:border-t-0",
          )}
        >
          <div className="space-y-px">
            {/* Once Linear is connected the whole workspace speaks LINEAR'S status vocabulary —
                the team's real workflow states, in the team's own order, on every card. Beacon's
                five statuses are the internal mapping underneath, not what the user picks from.
                A Beacon-native card speaks it too and is never pushed to Linear (see
                app/api/linear/status/route.ts). No connection → Beacon's own statuses. */}
            <PropRow icon={CircleDashed} label="Status">
              <Select
                value={linearStates.length ? (currentState?.id ?? "") : node.status}
                onValueChange={(v) =>
                  v != null &&
                  run(() =>
                    linearStates.length ? saveLinearState(v) : saveFields(node.id, { status: v }),
                  )
                }
              >
                <SelectTrigger
                  aria-label="Status"
                  className={QUIET_TRIGGER}
                  disabled={pending || readOnly}
                >
                  <SelectValue>
                    {(v: string) => {
                      const dot = currentState?.color ?? STATUS_STRIPE[v] ?? "#71717a";
                      const label = currentState?.name ?? STATUS_META[v]?.label ?? v;
                      return (
                        <span className="flex items-center gap-1.5">
                          <span aria-hidden className="size-2 rounded-full" style={{ background: dot }} />
                          {label}
                        </span>
                      );
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {linearStates.length
                    ? linearStates.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          <span className="flex items-center gap-1.5">
                            <span
                              aria-hidden
                              className="size-2 rounded-full"
                              style={{ background: s.color }}
                            />
                            {s.name}
                          </span>
                        </SelectItem>
                      ))
                    : statuses.map((s) => (
                        <SelectItem key={s} value={s}>
                          {STATUS_META[s]?.label ?? s}
                        </SelectItem>
                      ))}
                </SelectContent>
              </Select>
            </PropRow>

            {view !== "ARCHITECTURE" && (
              <PropRow icon={Flag} label="Priority">
                <Select
                  value={String(node.priority)}
                  onValueChange={(v) =>
                    v != null && run(() => saveFields(node.id, { priority: Number(v) }))
                  }
                >
                  <SelectTrigger
                    aria-label="Priority"
                    className={QUIET_TRIGGER}
                    disabled={pending || readOnly}
                  >
                    <SelectValue>
                      {(v: string) => (
                        <span className="flex items-center gap-1.5">
                          <span
                            aria-hidden
                            className="size-2 rounded-full"
                            style={{ background: PRIORITY_HUE[Number(v)] ?? "#71717a" }}
                          />
                          {PRIORITY_LABELS[Number(v)] ?? v}
                        </span>
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    {PRIORITY_LABELS.map((l, v) => (
                      <SelectItem key={v} value={String(v)}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </PropRow>
            )}

            {hasFrontend && (
              <PropRow icon={Layers} label="Layer">
                <Select
                  value={normalizeLayer(node.layer) ?? "none"}
                  onValueChange={(v) =>
                    v != null &&
                    run(() =>
                      saveFields(node.id, {
                        layer: v === "none" ? null : (v as "frontend" | "backend" | "fullstack"),
                      }),
                    )
                  }
                >
                  <SelectTrigger
                    aria-label="Layer"
                    className={QUIET_TRIGGER}
                    disabled={pending || readOnly}
                  >
                    <SelectValue>
                      {(v: string) =>
                        v === "none" ? (
                          <span className="text-muted-foreground">No layer</span>
                        ) : (
                          LAYER_META[v as keyof typeof LAYER_META]?.label ?? v
                        )
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectItem value="none">— no layer</SelectItem>
                    {Object.entries(LAYER_META).map(([v, m]) => (
                      <SelectItem key={v} value={v}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </PropRow>
            )}

            {node.cluster && (
              <PropRow icon={Tag} label="Category">
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    categoryColorClass(node.cluster),
                  )}
                >
                  {node.cluster}
                </span>
              </PropRow>
            )}

            {parentTitle && (
              <PropRow icon={CornerDownRight} label="Parent">
                <span className="truncate">{parentTitle}</span>
              </PropRow>
            )}

            {/* No separate "State" row — the Status row above IS the Linear state. What's left
                here is container identity, which Beacon has no field of its own for. */}
            {node.source === "LINEAR" && node.externalMeta?.team && (
              <PropRow icon={Users} label="Team">
                <span className="truncate">{node.externalMeta.team.name}</span>
              </PropRow>
            )}
            {node.source === "LINEAR" && node.externalMeta?.project && (
              <PropRow icon={Boxes} label="Project">
                <span className="truncate">{node.externalMeta.project.name}</span>
              </PropRow>
            )}
            {node.source === "LINEAR" && node.externalMeta?.milestone && (
              <PropRow icon={Milestone} label="Milestone">
                <span className="truncate">{node.externalMeta.milestone.name}</span>
              </PropRow>
            )}

            {linearIssue ? (
              <PropRow icon={ExternalLink} label="Linear">
                <a
                  href={node.sourceRef!}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-xs transition-colors hover:bg-[var(--ink-hover)] hover:text-[var(--accent-2,#ff7a45)]"
                >
                  {linearIssue}
                  <ExternalLink className="size-3" />
                </a>
              </PropRow>
            ) : node.sourceRef ? (
              <PropRow icon={ExternalLink} label="Source">
                <span className="truncate font-mono text-[11px] text-muted-foreground">
                  {node.sourceRef}
                </span>
              </PropRow>
            ) : null}
          </div>

          {/* Files live in the RAIL, folded shut. A 7-file tree expands to ~20 nested rows —
              reference data that dwarfed the prose when it sat in the reading column. The count
              stays visible on the header so you know it's there without opening it. */}
          {node.files.length > 0 && (
            <div className="mt-3 border-t border-border pt-2">
              <button
                type="button"
                aria-expanded={filesOpen}
                onClick={() => setFilesOpen((o) => !o)}
                className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronRight
                  className={cn("size-3 shrink-0 transition-transform", filesOpen && "rotate-90")}
                />
                Files
                <span className="tabular-nums text-muted-foreground/70">
                  ({node.files.length})
                </span>
              </button>
              {filesOpen && (
                // Deep paths are long and the rail is ~280px — scroll inside, never widen the modal.
                <div className="mt-1 max-h-64 overflow-auto pr-1 text-xs">
                  <FileTree files={node.files.map((p) => ({ path: p }))} />
                </div>
              )}
            </div>
          )}

          {railExtra}
        </aside>
      </div>

      {/* ── Actions — primaries quiet in the footer, destructive behind the overflow menu ──
          No "Edit" button: it used to open a full form dialog duplicating fields already
          editable in place (title above, status/priority/layer in the rail, description below) —
          a modal opening another modal over the same node. Sub-node stays: it creates a NEW
          node, not a second way to edit this one. */}
      {!readOnly && (
        <div className="flex shrink-0 items-center gap-1 border-t border-border px-4 py-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setSubOpen(true)}
          >
            <Plus className="size-3.5" />
            Sub-node
          </Button>
          <div className="relative ml-auto">
            <button
              type="button"
              title="More actions"
              onClick={() => setMenuOpen((o) => !o)}
              className={cn(
                "rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-[var(--ink-hover)] hover:text-foreground",
                menuOpen && "bg-[var(--ink-active)] text-foreground",
              )}
            >
              <MoreHorizontal className="size-4" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute bottom-full right-0 z-20 mb-1 w-44 rounded-lg border border-border bg-popover p-1">
                  <MenuItem
                    disabled={pending}
                    onClick={() => {
                      setMenuOpen(false);
                      run(() => saveFields(node.id, { status: "DEPRIORITIZED", priority: 3 }));
                    }}
                  >
                    Deprioritize
                  </MenuItem>
                  <MenuItem
                    disabled={pending}
                    onClick={() => {
                      setMenuOpen(false);
                      run(() => saveFields(node.id, { status: "CANCELLED" }));
                    }}
                  >
                    Cancel node
                  </MenuItem>
                  <MenuItem
                    destructive
                    disabled={pending}
                    onClick={() => {
                      setMenuOpen(false);
                      setDelOpen(true);
                    }}
                  >
                    Delete…
                  </MenuItem>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <AlertDialog open={delOpen} onOpenChange={setDelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{node.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the node and all its sub-nodes. It can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => run(() => removeNode(node.id))}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {subOpen && (
        <NodeFormDialog
          open
          onOpenChange={setSubOpen}
          mode="create"
          view={view}
          heading="New sub-node"
          parentId={node.id}
          position={{ x: node.x, y: node.y + 120 }}
          hasFrontend={hasFrontend}
          defaults={{ cluster: node.cluster, layer: node.layer }}
        />
      )}
    </div>
  );
}

function MenuItem({
  onClick,
  disabled,
  destructive,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center rounded-md px-2 py-1.5 text-left text-xs transition-colors disabled:opacity-50",
        destructive
          ? "text-red-600 hover:bg-red-500/10 dark:text-red-300"
          : "text-foreground hover:bg-[var(--ink-hover)]",
      )}
    >
      {children}
    </button>
  );
}

function BugFlagsSection({ node, readOnly }: { node: MapNodePayload; readOnly: boolean }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const open = node.bugFlags.filter((f) => !f.resolved);

  const act = (fn: () => Promise<unknown>) => {
    setBusy(true);
    void fn()
      .then(() => router.refresh())
      .finally(() => setBusy(false));
  };

  const addFlag = () => {
    const v = note.trim();
    if (!v) return;
    act(async () => {
      const res = await fetch("/api/bug-flags", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nodeId: node.id, by: "user", note: v }),
      });
      if (res.ok) setNote("");
    });
  };

  if (readOnly && node.bugFlags.length === 0) return null;

  return (
    <PanelSection
      title={
        <>
          <Bug className="size-3.5 text-rose-600 dark:text-rose-300" />
          Bug flags{open.length > 0 && ` (${open.length} open)`}
        </>
      }
    >
      {node.bugFlags.length > 0 && (
        <ul className="space-y-1.5">
          {node.bugFlags.map((f) => (
            <li
              key={f.id}
              className={cn(
                "rounded-md px-2 py-1.5",
                f.resolved ? "opacity-50" : "bg-rose-500/[0.06]",
              )}
            >
              <div className="flex items-center gap-1.5">
                <span
                  title={f.by === "agent" ? "Flagged by an agent examining the code" : "Flagged by you"}
                  className={cn(
                    "rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                    f.by === "agent"
                      ? "bg-violet-500/15 text-violet-700 dark:text-violet-300"
                      : "bg-sky-500/15 text-sky-700 dark:text-sky-300",
                  )}
                >
                  {f.by === "agent" ? "agent" : "you"}
                </span>
                {!readOnly && (
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        act(() =>
                          fetch(`/api/bug-flags/${f.id}`, {
                            method: "PATCH",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({ resolved: !f.resolved }),
                          }),
                        )
                      }
                      className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-[var(--ink-hover)] hover:text-foreground"
                    >
                      {f.resolved ? "Reopen" : "Resolve"}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      title="Delete flag"
                      onClick={() => act(() => fetch(`/api/bug-flags/${f.id}`, { method: "DELETE" }))}
                      className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-[var(--ink-hover)] hover:text-red-600 dark:hover:text-red-300"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                )}
              </div>
              <p className={cn("mt-1 text-[11.5px] leading-snug", f.resolved && "line-through")}>
                {f.note}
              </p>
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <div className="mt-1.5 flex items-start gap-1.5">
          <textarea
            rows={1}
            value={note}
            placeholder="Flag a bug or something worth investigating…"
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                addFlag();
              }
            }}
            className="field-sizing-content min-h-7 w-full resize-none rounded-md bg-[var(--ink-hover)] px-2 py-1 text-[11.5px] outline-none placeholder:text-muted-foreground/60 focus:bg-[var(--ink-active)]"
          />
          <Button
            size="sm"
            variant="ghost"
            className="h-7 shrink-0 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            disabled={busy || !note.trim()}
            onClick={addFlag}
          >
            Flag
          </Button>
        </div>
      )}
    </PanelSection>
  );
}

function Overview({
  view,
  nodes,
}: {
  view: "ROADMAP" | "ARCHITECTURE";
  nodes: MapNodePayload[];
}) {
  const critical = nodes.filter((n) => n.priority === 0).length;

  return (
    <div>
      <h2 className="text-base font-semibold">
        {view === "ROADMAP" ? "Roadmap" : "Architecture"}
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Click a node for details and actions. Drag to rearrange — positions are saved.
      </p>
      <dl className="mt-4 flex gap-8 border-t border-border pt-3">
        <PanelStat label="nodes" value={nodes.length} />
        <PanelStat label="critical" value={critical} />
      </dl>
    </div>
  );
}
