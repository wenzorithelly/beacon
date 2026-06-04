import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { BUG_STATUS_META, SEVERITY_META, STATUS_META } from "@/lib/constants";

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const meta = STATUS_META[status] ?? { label: status, className: "" };
  return (
    <Badge variant="outline" className={cn(meta.className, className)}>
      {meta.label}
    </Badge>
  );
}

export function SeverityBadge({ severity, className }: { severity: string; className?: string }) {
  const meta = SEVERITY_META[severity] ?? { label: severity, className: "" };
  return (
    <Badge variant="outline" className={cn(meta.className, className)}>
      {meta.label}
    </Badge>
  );
}

export function BugStatusBadge({ status, className }: { status: string; className?: string }) {
  const meta = BUG_STATUS_META[status] ?? { label: status, className: "" };
  return (
    <Badge variant="outline" className={cn(meta.className, className)}>
      {meta.label}
    </Badge>
  );
}
