import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

// The small pill tab button shared by the plan workspace, plan history, the canvas detail sidebar,
// and the read-only shared plan view (each previously kept its own near-identical copy). `icon` is
// optional — sidebar tabs are text-only, board/plan tabs lead with an icon. `pill` matches the
// active background's own radius to a fully-rounded container (History/Changes, Features/Schema,
// Map/Database) so it nests inside the container's curve instead of showing a small rounded-md
// corner poking a notch out of the pill's much larger radius (user report, 2026-07-09). The panel
// sidebar's Details/Comments tabs sit in a flat, non-rounded toolbar — they keep the default
// rounded-md, which is correct there.
export function TabBtn({
  active,
  onClick,
  icon,
  children,
  pill = false,
}: {
  active: boolean;
  onClick: () => void;
  icon?: ReactNode;
  children: ReactNode;
  pill?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium transition-colors",
        pill ? "rounded-full" : "rounded-md",
        active ? "bg-[var(--ink-active)] text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {children}
    </button>
  );
}
