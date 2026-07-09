"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Boxes,
  Bug,
  CircleDashed,
  CornerDownRight,
  ExternalLink,
  Flag,
  Layers,
  Maximize2,
  Milestone,
  MoreHorizontal,
  Pencil,
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
import { PRIORITIES, STATUS_STRIPE } from "@/components/graph/node-card";
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
import {
  acceptSuggestionAction,
  cancelAction,
  deleteNodeAction,
  deprioritizeAction,
  setStatusAction,
  updateNodeAction,
} from "@/app/actions/nodes";
import { cn } from "@/lib/utils";
import type { MapNodePayload } from "@/components/graph/types";
import type { ReactNode } from "react";

export type SidebarTab = PanelTab;

// Right-docked, full-height detail panel for the roadmap/architecture boards (Linear-style
// properties panel). Composed from the shared panel primitives — see panel/primitives.tsx for
// the shell/header/row/section language it shares with the DB board's sidebar.
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-4 py-3">
          {tab === "comments" && tabbed ? (
            commentsContent
          ) : selected ? (
            <NodeDetail
              key={selected.id}
              node={selected}
              view={view}
              parentTitle={parentTitle}
              showBreadcrumb={tabbed}
            />
          ) : (
            <Overview view={view} nodes={allNodes} />
          )}
        </div>
      </div>
    </PanelShell>
  );
}

// category · layer · kind — the node's place, in one whispered line.
function Breadcrumb({ node, view }: { node: MapNodePayload; view: string }) {
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

function NodeDetail({
  node,
  view,
  parentTitle,
  showBreadcrumb,
}: {
  node: MapNodePayload;
  view: "ROADMAP" | "ARCHITECTURE";
  parentTitle: string | null;
  showBreadcrumb: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  // Description: rendered clean by default; click to edit (the toolbar appears only then).
  const [editingDesc, setEditingDesc] = useState(false);
  const [plain, setPlain] = useState(node.plain ?? "");
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setPlain(node.plain ?? ""), [node.id, node.plain]);
  const { hasFrontend, openFocus } = useNodeEdit();

  const statuses = view === "ARCHITECTURE" ? ARCH_STATUSES : ROADMAP_STATUSES;
  const linearIssue =
    node.source === "LINEAR" && node.sourceRef
      ? node.sourceRef.match(/\/issue\/([^/]+)/)?.[1] ?? "Linear issue"
      : null;

  const run = (fn: () => Promise<unknown>) =>
    startTransition(async () => {
      await fn();
      router.refresh();
    });

  const commitDesc = () => {
    setEditingDesc(false);
    const v = plain.trim() || null;
    if (v !== (node.plain ?? null)) run(() => updateNodeAction(node.id, { plain: v }));
  };

  return (
    <div>
      {showBreadcrumb && (
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Breadcrumb node={node} view={view} />
        </div>
      )}
      <h2 className="text-base font-semibold leading-snug">{node.title}</h2>

      {node.source === "INIT" && view === "ROADMAP" && (
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
              onClick={() => run(() => acceptSuggestionAction(node.id))}
            >
              Accept
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2.5 text-xs text-muted-foreground"
              disabled={pending}
              onClick={() => run(() => deleteNodeAction(node.id))}
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {/* ── Properties — compact icon · label · value rows ── */}
      <div className="mt-3 space-y-px">
        <PropRow icon={CircleDashed} label="Status">
          <Select
            value={node.status}
            onValueChange={(v) => v != null && run(() => setStatusAction(node.id, v))}
          >
            <SelectTrigger className={QUIET_TRIGGER} disabled={pending}>
              <SelectValue>
                {(v: string) => (
                  <span className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className="size-2 rounded-full"
                      style={{ background: STATUS_STRIPE[v] ?? "#71717a" }}
                    />
                    {STATUS_META[v]?.label ?? v}
                  </span>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {statuses.map((s) => (
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
                v != null && run(() => updateNodeAction(node.id, { priority: Number(v) }))
              }
            >
              <SelectTrigger className={QUIET_TRIGGER} disabled={pending}>
                <SelectValue>
                  {(v: string) => PRIORITIES.find((p) => String(p.v) === v)?.l ?? v}
                </SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p.v} value={String(p.v)}>
                    {p.l}
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
                  updateNodeAction(node.id, {
                    layer: v === "none" ? null : (v as "frontend" | "backend" | "fullstack"),
                  }),
                )
              }
            >
              <SelectTrigger className={QUIET_TRIGGER} disabled={pending}>
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

        {/* Real Linear workflow state + container identity — display fidelity on top of the
            editable Beacon Status row above (only rows that actually exist on the issue). */}
        {node.source === "LINEAR" && node.externalMeta?.state && (
          <PropRow icon={CircleDashed} label="State">
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{ background: node.externalMeta.state.color }}
              />
              {node.externalMeta.state.name}
            </span>
          </PropRow>
        )}
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

      {/* ── Description — clean render, edit on click, toolbar only while editing ── */}
      <PanelSection
        title={
          <>
            Description
            <button
              type="button"
              title="Edit in focus mode"
              onClick={() =>
                openFocus({
                  id: node.id,
                  title: node.title,
                  value: plain,
                  editable: true,
                  onCommit: (v) => {
                    setPlain(v);
                    const next = v.trim() || null;
                    if (next !== (node.plain ?? null))
                      run(() => updateNodeAction(node.id, { plain: next }));
                  },
                })
              }
              className="ml-auto rounded p-0.5 text-muted-foreground transition-colors hover:bg-[var(--ink-hover)] hover:text-[var(--accent-2,#ff7a45)]"
            >
              <Maximize2 className="size-3.5" />
            </button>
          </>
        }
      >
        {editingDesc ? (
          <RichNodeEditor
            key="edit"
            value={plain}
            onChange={setPlain}
            onBlur={commitDesc}
            autoFocus
          />
        ) : plain.trim() ? (
          <div
            role="button"
            tabIndex={0}
            title="Click to edit"
            onClick={() => setEditingDesc(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setEditingDesc(true);
            }}
            className="-mx-1.5 cursor-text rounded-md px-1.5 py-1 transition-colors hover:bg-[var(--ink-hover)]"
          >
            <RichNodeEditor key="view" value={plain} onChange={() => {}} editable={false} />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditingDesc(true)}
            className="-mx-1.5 w-full rounded-md px-1.5 py-1 text-left text-xs text-muted-foreground/60 transition-colors hover:bg-[var(--ink-hover)] hover:text-muted-foreground"
          >
            Add a description…
          </button>
        )}
      </PanelSection>

      {node.files.length > 0 && (
        <PanelSection title={`Files (${node.files.length})`}>
          <FileTree files={node.files.map((p) => ({ path: p }))} />
        </PanelSection>
      )}

      {/* Bug flags — architecture components carry findings raised by the user or by an
          agent examining the code (beacon-init / beacon-refresh / describe_feature). */}
      {view === "ARCHITECTURE" && <BugFlagsSection node={node} />}

      {/* ── Actions — primaries quiet in the footer, destructive behind the overflow menu ── */}
      <div className="mt-4 flex items-center gap-1 border-t border-border pt-3">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setEditOpen(true)}
        >
          <Pencil className="size-3.5" />
          Edit
        </Button>
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
              <div className="absolute bottom-full right-0 z-20 mb-1 w-44 rounded-lg border border-border bg-popover p-1 shadow-xl">
                <MenuItem
                  disabled={pending}
                  onClick={() => {
                    setMenuOpen(false);
                    run(() => deprioritizeAction(node.id));
                  }}
                >
                  Deprioritize
                </MenuItem>
                <MenuItem
                  disabled={pending}
                  onClick={() => {
                    setMenuOpen(false);
                    run(() => cancelAction(node.id));
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
            <AlertDialogAction onClick={() => run(() => deleteNodeAction(node.id))}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {editOpen && (
        <NodeFormDialog
          open
          onOpenChange={setEditOpen}
          mode="edit"
          view={view}
          heading="Edit node"
          nodeId={node.id}
          hasFrontend={hasFrontend}
          defaults={{
            title: node.title,
            role: node.role,
            plain: node.plain,
            status: node.status,
            cluster: node.cluster,
            kind: node.kind,
            layer: node.layer,
          }}
        />
      )}
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

function BugFlagsSection({ node }: { node: MapNodePayload }) {
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
              </div>
              <p className={cn("mt-1 text-[11.5px] leading-snug", f.resolved && "line-through")}>
                {f.note}
              </p>
            </li>
          ))}
        </ul>
      )}
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
