import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

// The small pill tab button shared by the plan workspace, plan history, the canvas detail sidebar,
// and the read-only shared plan view (each previously kept its own near-identical copy). `icon` is
// optional — sidebar tabs are text-only, board/plan tabs lead with an icon.
export function TabBtn({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
        active ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {children}
    </button>
  );
}
