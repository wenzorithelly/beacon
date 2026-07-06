"use client";

import { MessageSquarePlus, X } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { TabBtn } from "@/components/ui/tab-button";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

// Shared primitives for the right-docked detail panels (roadmap/architecture DetailSidebar and
// the DB board's DbDetailSidebar) — one place owns the Linear-style panel language: a flush
// full-height glass shell, a quiet header (breadcrumb or tabs + calm icon actions), compact
// icon·label·value property rows, hairline-divided sections, and bare stats. Both sidebars
// compose these instead of copying layout code.

export type PanelTab = "details" | "comments";

// The quiet text-button look for inline property dropdowns — Linear-style: no border, no fill at
// rest, a soft ink wash on hover.
export const QUIET_TRIGGER =
  "!h-6 w-fit max-w-full !gap-1 rounded-md !border-0 !bg-transparent !px-1.5 !py-0 text-xs font-medium !shadow-none transition-colors hover:!bg-[var(--ink-hover)] [&_svg]:size-3";

/** Flush right-docked, full-height shell — the panel's ONE glass surface. `topOffset` insets the
    top edge (used on /plan to clear the floating plan pill); default is flush to the container. */
export function PanelShell({
  topOffset,
  children,
  style,
}: {
  topOffset?: number;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <GlassPanel
      className="absolute bottom-0 right-0 z-10 flex w-[340px] flex-col rounded-none border-y-0 border-r-0"
      style={{ top: topOffset ?? 0, ...style }}
    >
      {children}
    </GlassPanel>
  );
}

/** Quiet header bar: a Details/Comments tab strip (plan review) or a whispered breadcrumb, with
    the calm comment + close icon actions pulled to the right. */
export function PanelHeader({
  tabs,
  breadcrumb,
  comment,
  onClose,
}: {
  /** When set, renders the Details/Comments strip instead of the breadcrumb. */
  tabs?: { active: PanelTab; count: number; onChange: (tab: PanelTab) => void } | null;
  breadcrumb: ReactNode;
  /** Calm comment affordance (icon button), shown on the Details tab only. */
  comment?: { title: string; onClick: () => void } | null;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center gap-1 border-b border-border py-2 pl-3 pr-2">
      {tabs ? (
        <div className="flex min-w-0 items-center gap-0.5">
          <TabBtn active={tabs.active === "details"} onClick={() => tabs.onChange("details")}>
            Details
          </TabBtn>
          <TabBtn active={tabs.active === "comments"} onClick={() => tabs.onChange("comments")}>
            Comments
            {tabs.count > 0 && (
              <span className="ml-1 rounded-full bg-[var(--ink-active)] px-1 text-[9px] font-semibold leading-4">
                {tabs.count}
              </span>
            )}
          </TabBtn>
        </div>
      ) : (
        <span className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {breadcrumb}
        </span>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        {comment && (
          <button
            type="button"
            title={comment.title}
            onClick={comment.onClick}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-[var(--ink-hover)] hover:text-[var(--accent-2,#ff7a45)]"
          >
            <MessageSquarePlus className="size-4" />
          </button>
        )}
        <button
          onClick={onClose}
          title="Close panel"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-[var(--ink-hover)] hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}

/** One Linear-style property line: icon + muted label left, the value fills the rest. */
export function PropRow({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-7 items-center gap-2 text-xs">
      <span className="flex w-[88px] shrink-0 items-center gap-1.5 text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </span>
      <div className="flex min-w-0 flex-1 items-center">{children}</div>
    </div>
  );
}

/** Hairline-divided section: whitespace + one whispered label, never a nested box. */
export function PanelSection({
  title,
  children,
  className,
}: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mt-4 border-t border-border pt-3", className)}>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}

/** Bare stat (value over label) for the nothing-selected overview — no box. */
export function PanelStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
    </div>
  );
}
