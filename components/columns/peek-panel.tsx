"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ListTree, Lock, Unlock } from "lucide-react";
import { Breadcrumb, EditableTitle, NodeDetail } from "@/components/graph/detail-sidebar";
import { PanelSection } from "@/components/graph/panel/primitives";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { PRIORITY_LABELS, STATUS_DOT, isBlocking } from "@/lib/board-grouping";
import { STATUS_META } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { MapNodePayload } from "@/components/graph/types";
import type { ReactNode } from "react";

/** One row in the Blocked by / Blocks / Sub-issues lists — click to jump to (or drill into) that
 *  card. `meta` overrides the right-aligned label, which defaults to the card's status — Sub-issue
 *  rows pass their priority instead. */
function DepRow({
  node,
  onJump,
  meta,
}: {
  node: MapNodePayload;
  onJump: () => void;
  meta?: ReactNode;
}) {
  const done = node.status === "DONE";
  return (
    <button
      type="button"
      onClick={onJump}
      title={`Open ${node.title}`}
      className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-[var(--ink-hover)]"
    >
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        style={{ background: STATUS_DOT[node.status] ?? "#71717a" }}
      />
      <span className={cn("min-w-0 flex-1 truncate", done && "text-muted-foreground line-through")}>
        {node.title}
      </span>
      <span className="shrink-0 text-[9px] uppercase tracking-wide text-muted-foreground">
        {meta ?? STATUS_META[node.status]?.label ?? node.status}
      </span>
    </button>
  );
}

export interface CardDetailModalProps {
  open: boolean;
  node: MapNodePayload;
  /** Roadmap cards carry the dependency rail; architecture components have no DEPENDS edges. */
  view?: "ROADMAP" | "ARCHITECTURE";
  byId: Map<string, MapNodePayload>;
  /** ids this card depends on / ids that depend on it (from dependencyGraph). */
  blockedBy: string[];
  blocks: string[];
  blocked: boolean;
  /** Select + reveal that card on the board (the caller closes this modal so the board shows). */
  onJump: (nodeId: string) => void;
  /** Registers the board's reconcile hold while the inline description editor is open. */
  onEditingDescription?: (id: string | null) => void;
  onClose: () => void;
}

/** THE card detail, everywhere: a WIDE CENTERED MODAL laid out like Linear's issue view — the
 *  description reading column on the left, the properties rail on the right, actions in a footer.
 *  The body is `NodeDetail` (components/graph/detail-sidebar.tsx), shared verbatim with the docked
 *  panel the embedded split-screen boards still use, so there is one card-detail implementation.
 *
 *  It is a modal, and specifically the shared ShadCN/base-ui Dialog: a portal to the body (no
 *  ancestor can clip it — it used to dock inside the board and render under the floating tab
 *  strip), a scrim, Escape + click-outside to close, a focus trap and focus restore.
 *
 *  It carries the DETAIL half of the dependency affordance — the Blocked by / Blocks lists, each
 *  row a jump to that card. The other half is the board spotlight, which is why selecting a card
 *  does NOT open this: you get the spotlight first, and open the detail deliberately. No connector
 *  lines are drawn between columns, by design. */
export function CardDetailModal({
  open,
  node,
  view = "ROADMAP",
  byId,
  blockedBy,
  blocks,
  blocked,
  onJump,
  onEditingDescription,
  onClose,
}: CardDetailModalProps) {
  // Sub-issue drill-in stays a LOCAL nav stack, derived from `parentId` rather than tracked as its
  // own array: `viewId` is the id of the card currently shown (null = the root the board selected),
  // and "back" is simply that card's real parent — no separate breadcrumb list to keep in sync.
  // Resets whenever the host selects a different root or the dialog is reopened.
  const [viewId, setViewId] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setViewId(null), [node.id, open]);
  const current = (viewId ? byId.get(viewId) : null) ?? node;
  // Compared by id, not `viewId === null` — clicking "back" out of a direct child sets `viewId`
  // to the root's OWN id (its real parent pointer), which must still read as "at root".
  const atRoot = current.id === node.id;

  // Blocked by / Blocks are computed by the host for the ROOT card only — showing them while
  // drilled into a child would attribute the wrong card's dependencies, so they're root-only too.
  const deps = atRoot ? blockedBy.map((id) => byId.get(id)).filter((n) => n != null) : [];
  const dependents = atRoot ? blocks.map((id) => byId.get(id)).filter((n) => n != null) : [];
  const parentTitle = current.parentId ? byId.get(current.parentId)?.title ?? null : null;
  const backTo = atRoot ? null : (byId.get(current.parentId ?? "") ?? node);

  const children = [...byId.values()].filter((n) => n.parentId === current.id);
  const childDone = children.filter((n) => n.status === "DONE").length;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        aria-modal="true"
        className="flex h-[82vh] w-full max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[900px]"
      >
        <div className="shrink-0 border-b border-border py-3 pl-5 pr-11">
          {backTo && (
            <button
              type="button"
              onClick={() => setViewId(current.parentId)}
              className="-ml-1 mb-1 flex items-center gap-1 rounded px-1 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-[var(--ink-hover)] hover:text-foreground"
            >
              <ArrowLeft className="size-3" />
              Back to {backTo.title}
            </button>
          )}
          <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Breadcrumb node={current} view={view} />
          </p>
          <DialogTitle className="mt-1 text-sm leading-snug font-semibold">
            <EditableTitle node={current} />
          </DialogTitle>
          {/* The one-line summary, shown only when the node HAS one. Its only editor used to be
              the Edit dialog; without this an agent-written role was permanently uneditable. */}
          {current.role ? (
            <EditableTitle
              node={current}
              field="role"
              className="mt-1 block text-xs font-normal text-muted-foreground"
            />
          ) : null}
          {atRoot && blocked && (
            <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium text-orange-700 dark:text-orange-300">
              <Lock className="size-3" />
              Blocked — {deps.filter((n) => isBlocking(n.status)).length} dependency(ies) not done
            </p>
          )}
        </div>

        <NodeDetail
          key={current.id}
          node={current}
          view={view}
          parentTitle={parentTitle}
          onEditingDescription={onEditingDescription}
          mainExtra={
            children.length > 0 && (
              <PanelSection
                title={
                  <>
                    <ListTree className="size-3" /> Sub-issues
                    <span className="tabular-nums">
                      ({childDone}/{children.length})
                    </span>
                  </>
                }
              >
                {children.map((n) => (
                  <DepRow
                    key={n.id}
                    node={n}
                    onJump={() => setViewId(n.id)}
                    meta={PRIORITY_LABELS[n.priority]?.split(" ")[0]}
                  />
                ))}
              </PanelSection>
            )
          }
          railExtra={
            <>
              {view === "ROADMAP" && deps.length > 0 && (
                <PanelSection
                  title={
                    <>
                      <Lock className="size-3" /> Blocked by
                      <span className="tabular-nums">({deps.length})</span>
                    </>
                  }
                >
                  {deps.map((n) => (
                    <DepRow key={n.id} node={n} onJump={() => onJump(n.id)} />
                  ))}
                </PanelSection>
              )}

              {view === "ROADMAP" && dependents.length > 0 && (
                <PanelSection
                  title={
                    <>
                      <Unlock className="size-3" /> Blocks
                      <span className="tabular-nums">({dependents.length})</span>
                    </>
                  }
                >
                  {dependents.map((n) => (
                    <DepRow key={n.id} node={n} onJump={() => onJump(n.id)} />
                  ))}
                </PanelSection>
              )}
            </>
          }
        />
      </DialogContent>
    </Dialog>
  );
}
