"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bug, MessageSquarePlus, Sparkles, X } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { MarkdownView } from "@/components/plan/markdown-view";
import {
  ARCH_STATUSES,
  ROADMAP_STATUSES,
  STATUS_META,
  clusterLabel,
} from "@/lib/constants";
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
  AlertDialogTrigger,
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
} from "@/app/actions/nodes";
import { cn } from "@/lib/utils";
import type { MapNodePayload } from "@/components/graph/types";
import type { ReactNode } from "react";

export type SidebarTab = "details" | "comments";

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
      "Comment on this …" button shows on the Details tab. */
  onAddComment?: (excerpt: string) => void;
  /** Top inset of the panel (overrides the default top-3) — used in /plan to clear
      the floating Plan pill. */
  topOffset?: number;
}) {
  const tabbed = !!commentsContent;
  const tab: SidebarTab = activeTab ?? "details";
  return (
    <GlassPanel
      // Size to content, capped at the space from `top` to 12px above the canvas bottom, and let
      // the body scroll past that — never a bottom-stretched empty panel, never cropped.
      className="absolute right-3 z-10 flex w-80 flex-col rounded-2xl"
      style={{ top: topOffset ?? 12, maxHeight: `calc(100% - ${(topOffset ?? 12) + 12}px)` }}
    >
      {tabbed ? (
        <div className="flex items-center justify-between border-b border-white/10 px-1 py-1">
          <div className="flex items-center gap-0.5">
            <TabBtn active={tab === "details"} onClick={() => onTabChange?.("details")}>
              Details
            </TabBtn>
            <TabBtn active={tab === "comments"} onClick={() => onTabChange?.("comments")}>
              Comments
              {commentsCount > 0 && (
                <span className="ml-1 rounded-full bg-white/10 px-1 text-[9px] font-semibold leading-4">
                  {commentsCount}
                </span>
              )}
            </TabBtn>
          </div>
          <button
            onClick={onClose}
            title="Close panel"
            className="mr-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between border-b border-white/10 px-3.5 py-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Details
          </span>
          <button
            onClick={onClose}
            title="Close panel"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="p-3">
          {tab === "comments" && tabbed ? (
            commentsContent
          ) : selected ? (
            <>
              {onAddComment && (
                <button
                  type="button"
                  onClick={() => onAddComment(selected.title)}
                  className="mb-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
                >
                  <MessageSquarePlus className="size-3.5" />
                  Comment on this {view === "ARCHITECTURE" ? "component" : "feature"}
                </button>
              )}
              <NodeDetail key={selected.id} node={selected} view={view} />
            </>
          ) : (
            <Overview view={view} nodes={allNodes} />
          )}
        </div>
      </div>
    </GlassPanel>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
        active
          ? "bg-white/10 text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function NodeDetail({
  node,
  view,
}: {
  node: MapNodePayload;
  view: "ROADMAP" | "ARCHITECTURE";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const { hasFrontend } = useNodeEdit();
  const layer = normalizeLayer(node.layer);

  const statuses = view === "ARCHITECTURE" ? ARCH_STATUSES : ROADMAP_STATUSES;

  const run = (fn: () => Promise<unknown>) =>
    startTransition(async () => {
      await fn();
      router.refresh();
    });

  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {clusterLabel(node.cluster)}
          {hasFrontend && layer && (
            <span className="ml-2 text-zinc-400">· {LAYER_META[layer].label}</span>
          )}
          {node.priority === 0 && (
            <span className="ml-2 text-[#ff7a90]">· critical path</span>
          )}
        </div>
        <h2 className="mt-1 text-lg font-semibold leading-tight">{node.title}</h2>
      </div>

      {node.source === "INIT" && (
        <div className="rounded-lg border border-violet-400/30 bg-violet-500/[0.06] p-2.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-violet-300">
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
              variant="outline"
              className="h-7 px-2.5 text-xs text-muted-foreground"
              disabled={pending}
              onClick={() => run(() => deleteNodeAction(node.id))}
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <span className="text-xs text-muted-foreground">Status</span>
        <Select
          value={node.status}
          onValueChange={(v) => v != null && run(() => setStatusAction(node.id, v))}
        >
          <SelectTrigger className="h-8" disabled={pending}>
            <SelectValue>{(v: string) => STATUS_META[v]?.label ?? v}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {statuses.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_META[s]?.label ?? s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {node.plain && (
        <div className="rounded-md border border-white/5 bg-card/40 px-2.5 py-2 text-sm">
          <MarkdownView markdown={node.plain} variant="compact" className="text-[12.5px]" />
        </div>
      )}
      {node.sourceRef && (
        <div className="rounded-md border border-border bg-card px-2 py-1.5 font-mono text-xs text-muted-foreground">
          {node.sourceRef}
        </div>
      )}

      {node.files.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Files ({node.files.length})
          </h3>
          <ul className="space-y-0.5">
            {node.files.map((f) => (
              <li key={f}>
                <button
                  onClick={() =>
                    fetch(`/api/open?path=${encodeURIComponent(f)}`).catch(() => {})
                  }
                  title={`Open ${f} in editor`}
                  className="block w-full truncate rounded px-1.5 py-0.5 text-left font-mono text-[11px] text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
                >
                  {f}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Bug flags — architecture components carry findings raised by the user or by an
          agent examining the code (beacon-init / beacon-refresh / describe_feature). */}
      {view === "ARCHITECTURE" && <BugFlagsSection node={node} />}

      {/* actions */}
      <div className="flex flex-wrap gap-1.5 pt-1">
        <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
          Edit
        </Button>
        <Button size="sm" variant="outline" onClick={() => setSubOpen(true)}>
          + Sub-node
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run(() => cancelAction(node.id))}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run(() => deprioritizeAction(node.id))}
        >
          Deprioritize
        </Button>
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button size="sm" variant="outline" className="text-red-300">
                Delete
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete “{node.title}”?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes the node and all its sub-nodes. It can’t be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => run(() => deleteNodeAction(node.id))}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

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
    <div>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Bug className="size-3.5 text-rose-300" />
        Bug flags{open.length > 0 && ` (${open.length} open)`}
      </h3>
      {node.bugFlags.length > 0 && (
        <ul className="space-y-1.5">
          {node.bugFlags.map((f) => (
            <li
              key={f.id}
              className={cn(
                "rounded-md border px-2 py-1.5",
                f.resolved
                  ? "border-white/5 bg-card/30 opacity-60"
                  : "border-rose-400/25 bg-rose-500/[0.05]",
              )}
            >
              <div className="flex items-center gap-1.5">
                <span
                  title={f.by === "agent" ? "Flagged by an agent examining the code" : "Flagged by you"}
                  className={cn(
                    "rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                    f.by === "agent" ? "bg-violet-500/15 text-violet-300" : "bg-sky-500/15 text-sky-300",
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
                    className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                  >
                    {f.resolved ? "Reopen" : "Resolve"}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    title="Delete flag"
                    onClick={() => act(() => fetch(`/api/bug-flags/${f.id}`, { method: "DELETE" }))}
                    className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-red-300"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              </div>
              <p
                className={cn(
                  "mt-1 text-[11.5px] leading-snug",
                  f.resolved && "line-through",
                )}
              >
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
          className="field-sizing-content min-h-7 w-full resize-none rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-[11.5px] outline-none placeholder:text-muted-foreground/60 focus:bg-white/[0.06]"
        />
        <Button
          size="sm"
          variant="outline"
          className="h-7 shrink-0 px-2 text-[11px]"
          disabled={busy || !note.trim()}
          onClick={addFlag}
        >
          Flag
        </Button>
      </div>
    </div>
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
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">
          {view === "ROADMAP" ? "Roadmap" : "Architecture"}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Click a node for details and actions. Drag to rearrange — positions are saved.
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-center">
        <Stat label="nodes" value={nodes.length} />
        <Stat label="critical" value={critical} />
      </dl>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-card py-2">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

