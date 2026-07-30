"use client";

import { Lock, Unlock } from "lucide-react";
import { Breadcrumb, NodeDetail } from "@/components/graph/detail-sidebar";
import { PanelSection } from "@/components/graph/panel/primitives";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { STATUS_DOT, isBlocking } from "@/lib/board-grouping";
import { STATUS_META } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { MapNodePayload } from "@/components/graph/types";

/** One row in the Blocked by / Blocks lists — click to jump to that card on the board. */
function DepRow({ node, onJump }: { node: MapNodePayload; onJump: () => void }) {
  const done = node.status === "DONE";
  return (
    <button
      type="button"
      onClick={onJump}
      title={`Show ${node.title} on the board`}
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
        {STATUS_META[node.status]?.label ?? node.status}
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
  const deps = blockedBy.map((id) => byId.get(id)).filter((n) => n != null);
  const dependents = blocks.map((id) => byId.get(id)).filter((n) => n != null);
  const parentTitle = node.parentId ? byId.get(node.parentId)?.title ?? null : null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        aria-modal="true"
        className="flex h-[82vh] w-full max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[900px]"
      >
        <div className="shrink-0 border-b border-border py-3 pl-5 pr-11">
          <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Breadcrumb node={node} view={view} />
          </p>
          <DialogTitle className="mt-1 text-sm leading-snug font-semibold">{node.title}</DialogTitle>
          {blocked && (
            <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium text-orange-700 dark:text-orange-300">
              <Lock className="size-3" />
              Blocked — {deps.filter((n) => isBlocking(n.status)).length} dependency(ies) not done
            </p>
          )}
        </div>

        <NodeDetail
          key={node.id}
          node={node}
          view={view}
          parentTitle={parentTitle}
          onEditingDescription={onEditingDescription}
          railExtra={
            view === "ROADMAP" ? (
              <>
                <PanelSection
                  title={
                    <>
                      <Lock className="size-3" /> Blocked by
                      {deps.length > 0 && <span className="tabular-nums">({deps.length})</span>}
                    </>
                  }
                >
                  {deps.length === 0 ? (
                    <p className="px-1.5 text-xs text-muted-foreground">
                      Nothing — this is startable.
                    </p>
                  ) : (
                    deps.map((n) => <DepRow key={n.id} node={n} onJump={() => onJump(n.id)} />)
                  )}
                </PanelSection>

                <PanelSection
                  title={
                    <>
                      <Unlock className="size-3" /> Blocks
                      {dependents.length > 0 && (
                        <span className="tabular-nums">({dependents.length})</span>
                      )}
                    </>
                  }
                >
                  {dependents.length === 0 ? (
                    <p className="px-1.5 text-xs text-muted-foreground">Nothing depends on this.</p>
                  ) : (
                    dependents.map((n) => <DepRow key={n.id} node={n} onJump={() => onJump(n.id)} />)
                  )}
                </PanelSection>
              </>
            ) : null
          }
        />
      </DialogContent>
    </Dialog>
  );
}
