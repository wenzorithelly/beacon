import { db } from "@/lib/db";
import { clusterLabel, SEVERITIES, SEVERITY_RANK } from "@/lib/constants";
import { BugStatusBadge, SeverityBadge } from "@/components/badges";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function BugsPage() {
  const bugs = await db.bug.findMany({ include: { node: true } });
  bugs.sort(
    (a, b) =>
      (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) ||
      a.title.localeCompare(b.title),
  );

  const bySeverity = SEVERITIES.map((sev) => ({
    sev,
    count: bugs.filter((b) => b.severity === sev).length,
  })).filter((s) => s.count > 0);

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Bugs conhecidos</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          {bugs.length} issues confirmados ·{" "}
          {bySeverity.map((s, i) => (
            <span key={s.sev}>
              {i > 0 && " · "}
              {s.count} {s.sev}
            </span>
          ))}
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Severidade</TableHead>
              <TableHead>Issue</TableHead>
              <TableHead className="w-44">Frente</TableHead>
              <TableHead>Origem (file:line)</TableHead>
              <TableHead className="w-28">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bugs.map((bug) => (
              <TableRow key={bug.id}>
                <TableCell>
                  <SeverityBadge severity={bug.severity} />
                </TableCell>
                <TableCell>
                  <div className="font-medium">{bug.title}</div>
                  {bug.detail && (
                    <div className="mt-0.5 text-xs text-muted-foreground">{bug.detail}</div>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {clusterLabel(bug.node?.cluster)}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground/80">
                  {bug.sourceRef}
                </TableCell>
                <TableCell>
                  <BugStatusBadge status={bug.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
