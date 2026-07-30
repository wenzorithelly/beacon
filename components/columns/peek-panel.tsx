"use client";

import { CircleDashed, Flag, Layers, Lock, PenLine, Unlock } from "lucide-react";
import { PanelSection, PropRow, QUIET_TRIGGER } from "@/components/graph/panel/primitives";
import { RichNodeEditor } from "@/components/graph/rich-node-editor";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PRIORITY_HUE,
  PRIORITY_LABELS,
  STATUS_DOT,
  isBlocking,
  type GroupField,
} from "@/lib/board-grouping";
import { ROADMAP_STATUSES, STATUS_META } from "@/lib/constants";
import { LAYER_META, normalizeLayer } from "@/lib/layer";
import { cn } from "@/lib/utils";
import type { MapNodePayload } from "@/components/graph/types";

function Dot({ color }: { color: string }) {
  return <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: color }} />;
}

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
      <Dot color={STATUS_DOT[node.status] ?? "#71717a"} />
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
  byId: Map<string, MapNodePayload>;
  /** ids this card depends on / ids that depend on it (from dependencyGraph). */
  blockedBy: string[];
  blocks: string[];
  blocked: boolean;
  hasFrontend: boolean;
  readOnly: boolean;
  onChangeField: (nodeId: string, field: GroupField, value: string | number | null) => void;
  /** Select + reveal that card on the board (the caller closes this modal so the board shows). */
  onJump: (nodeId: string) => void;
  /** Opens the real (rich) description editor — this modal renders the description read-only. */
  onEditDescription: (nodeId: string) => void;
  onClose: () => void;
}

/** The card detail: a CENTERED MODAL, not a docked panel — it used to render inside the board and
 *  was clipped by the floating board tab strip (user report). The shared ShadCN/base-ui Dialog
 *  gives it a portal to the body (no ancestor can clip it), a scrim, Escape + click-outside to
 *  close, a focus trap and focus restore.
 *
 *  It carries the DETAIL half of the dependency affordance — the Blocked by / Blocks lists, each
 *  row a jump to that card. The other half is the board spotlight, which is why selecting a card
 *  does NOT open this: you get the spotlight first, and open the detail deliberately. No connector
 *  lines are drawn between columns, by design. */
export function CardDetailModal({
  open,
  node,
  byId,
  blockedBy,
  blocks,
  blocked,
  hasFrontend,
  readOnly,
  onChangeField,
  onJump,
  onEditDescription,
  onClose,
}: CardDetailModalProps) {
  const layer = normalizeLayer(node.layer);
  const deps = blockedBy.map((id) => byId.get(id)).filter((n) => n != null);
  const dependents = blocks.map((id) => byId.get(id)).filter((n) => n != null);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        aria-modal="true"
        className="flex max-h-[80vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[560px]"
      >
        <div className="shrink-0 border-b border-border py-3 pl-5 pr-11">
          <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {node.cluster || "Roadmap"}
          </p>
          <DialogTitle className="mt-1 text-sm leading-snug font-semibold">{node.title}</DialogTitle>
          {blocked && (
            <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium text-orange-700 dark:text-orange-300">
              <Lock className="size-3" />
              Blocked — {deps.filter((n) => isBlocking(n.status)).length} dependency(ies) not done
            </p>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          <div className="space-y-0.5">
            <PropRow icon={CircleDashed} label="Status">
              <Select
                value={node.status}
                disabled={readOnly}
                onValueChange={(v) => onChangeField(node.id, "status", v)}
              >
                <SelectTrigger aria-label="Status" className={QUIET_TRIGGER}>
                  <SelectValue>
                    {(v: string) => (
                      <span className="flex items-center gap-1.5">
                        <Dot color={STATUS_DOT[v] ?? "#71717a"} />
                        {STATUS_META[v]?.label ?? v}
                      </span>
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {ROADMAP_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_META[s]?.label ?? s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </PropRow>

            <PropRow icon={Flag} label="Priority">
              <Select
                value={String(node.priority)}
                disabled={readOnly}
                onValueChange={(v) => onChangeField(node.id, "priority", Number(v))}
              >
                <SelectTrigger aria-label="Priority" className={QUIET_TRIGGER}>
                  <SelectValue>
                    {(v: string) => (
                      <span className="flex items-center gap-1.5">
                        <Dot color={PRIORITY_HUE[Number(v)] ?? "#71717a"} />
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

            {hasFrontend && (
              <PropRow icon={Layers} label="Layer">
                <span className="px-1.5 text-xs">
                  {layer ? (
                    LAYER_META[layer].label
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </span>
              </PropRow>
            )}
          </div>

          <PanelSection
            title={
              <>
                <Lock className="size-3" /> Blocked by
                {deps.length > 0 && <span className="tabular-nums">({deps.length})</span>}
              </>
            }
          >
            {deps.length === 0 ? (
              <p className="px-1.5 text-xs text-muted-foreground">Nothing — this is startable.</p>
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

          <PanelSection title="Description">
            {node.plain ? (
              <RichNodeEditor value={node.plain} editable={false} onChange={() => {}} />
            ) : (
              <p className="px-1.5 text-xs text-muted-foreground">No description yet.</p>
            )}
            {!readOnly && (
              <button
                type="button"
                onClick={() => onEditDescription(node.id)}
                className="mt-1.5 flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-[var(--ink-hover)] hover:text-[var(--accent-2,#ff7a45)]"
              >
                <PenLine className="size-3" />
                {node.plain ? "Edit description" : "Write a description"}
              </button>
            )}
          </PanelSection>
        </div>
      </DialogContent>
    </Dialog>
  );
}
