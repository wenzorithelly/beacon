import { db } from "@/lib/db";
import { clusterLabel } from "@/lib/constants";
import { StatusBadge } from "@/components/badges";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

function BugDot({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="inline-flex size-5 items-center justify-center rounded-full bg-red-500/20 text-[11px] font-semibold text-red-300">
      {count}
    </span>
  );
}

export default async function ListPage() {
  const fronts = await db.node.findMany({
    where: { view: "ROADMAP", parentId: null },
    orderBy: { x: "asc" },
    include: {
      _count: { select: { bugs: true } },
      children: {
        orderBy: { y: "asc" },
        include: {
          tags: true,
          _count: { select: { bugs: true } },
        },
      },
    },
  });

  const arch = await db.node.findMany({
    where: { view: "ARCHITECTURE" },
    orderBy: [{ cluster: "asc" }, { title: "asc" }],
  });

  const subtaskCount = fronts.reduce((n, f) => n + f.children.length, 0);
  const openBugs = await db.bug.count({ where: { status: { not: "RESOLVED" } } });

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Estado do projeto</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {fronts.length} frentes · {subtaskCount} tarefas · {arch.length} componentes de
          arquitetura · {openBugs} bugs abertos
        </p>
      </div>

      {/* ROADMAP */}
      <section className="mb-12">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Roadmap de produção
        </h2>
        <div className="grid gap-4">
          {fronts.map((front) => (
            <Card key={front.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {front.title}
                      {front.priority === 0 && (
                        <Badge
                          variant="outline"
                          className="border-[var(--critical,#ff3860)]/40 bg-[var(--critical,#ff3860)]/10 text-[#ff7a90]"
                        >
                          caminho crítico
                        </Badge>
                      )}
                    </CardTitle>
                    {front.role && (
                      <CardDescription className="mt-1">{front.role}</CardDescription>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <BugDot count={front._count.bugs} />
                    <StatusBadge status={front.status} />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="divide-y divide-border/60 text-sm">
                  {front.children.map((child) => {
                    const isCriterion = child.tags.some((t) => t.label === "criterion");
                    return (
                      <li
                        key={child.id}
                        className="flex items-center justify-between gap-3 py-2"
                      >
                        <span className="flex items-center gap-2">
                          {isCriterion && (
                            <span
                              title="Critério de sucesso"
                              className="inline-block size-1.5 rounded-full bg-[var(--accent,#f5b942)]"
                            />
                          )}
                          {child.title}
                        </span>
                        <span className="flex items-center gap-2">
                          <BugDot count={child._count.bugs} />
                          <StatusBadge status={child.status} />
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* ARCHITECTURE */}
      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Arquitetura de referência
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {arch.map((node) => (
            <Card key={node.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{node.title}</CardTitle>
                    <CardDescription className="mt-1">
                      {clusterLabel(node.cluster)}
                    </CardDescription>
                  </div>
                  <StatusBadge status={node.status} />
                </div>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {node.plain}
                {node.sourceRef && (
                  <div className="mt-2 font-mono text-xs text-muted-foreground/70">
                    {node.sourceRef}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
