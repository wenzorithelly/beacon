import { SeverityBadge, StatusBadge } from "@/components/badges";
import { clusterLabel } from "@/lib/constants";
import type { MapNodePayload } from "@/components/graph/types";

export function DetailSidebar({
  view,
  selected,
  allNodes,
}: {
  view: "ROADMAP" | "ARCHITECTURE";
  selected: MapNodePayload | null;
  allNodes: MapNodePayload[];
}) {
  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-l border-border bg-background/60 p-4">
      {selected ? (
        <NodeDetail node={selected} />
      ) : (
        <Overview view={view} nodes={allNodes} />
      )}
    </aside>
  );
}

function NodeDetail({ node }: { node: MapNodePayload }) {
  const openBugs = node.bugs.filter((b) => b.status !== "RESOLVED");
  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {clusterLabel(node.cluster)}
          {node.priority === 0 && (
            <span className="ml-2 text-[#ff7a90]">· caminho crítico</span>
          )}
        </div>
        <h2 className="mt-1 text-lg font-semibold leading-tight">{node.title}</h2>
        <div className="mt-2">
          <StatusBadge status={node.status} />
        </div>
      </div>

      {node.role && (
        <p className="text-sm text-foreground/90">{node.role}</p>
      )}
      {node.plain && (
        <p className="text-sm text-muted-foreground">{node.plain}</p>
      )}
      {node.sourceRef && (
        <div className="rounded-md border border-border bg-card px-2 py-1.5 font-mono text-xs text-muted-foreground">
          {node.sourceRef}
        </div>
      )}

      {openBugs.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Bugs ({openBugs.length})
          </h3>
          <ul className="space-y-2">
            {openBugs.map((bug) => (
              <li
                key={bug.id}
                className="rounded-md border border-border bg-card p-2 text-sm"
              >
                <div className="mb-1 flex items-center gap-2">
                  <SeverityBadge severity={bug.severity} />
                </div>
                <div className="font-medium leading-snug">{bug.title}</div>
                {bug.sourceRef && (
                  <div className="mt-1 font-mono text-[10px] text-muted-foreground/70">
                    {bug.sourceRef}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
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
  const openBugs = nodes.reduce(
    (n, node) => n + node.bugs.filter((b) => b.status !== "RESOLVED").length,
    0,
  );
  const topBugs = nodes
    .flatMap((n) => n.bugs.map((b) => ({ ...b, node: n })))
    .filter((b) => b.status !== "RESOLVED" && b.severity === "critical");

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">
          {view === "ROADMAP" ? "Roadmap de produção" : "Arquitetura de referência"}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Clique em um nó para ver detalhes. Arraste para reorganizar — as posições
          são salvas.
        </p>
      </div>

      <dl className="grid grid-cols-3 gap-2 text-center">
        <Stat label="nós" value={nodes.length} />
        <Stat label="críticos" value={critical} />
        <Stat label="bugs" value={openBugs} />
      </dl>

      {topBugs.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Issues críticos
          </h3>
          <ul className="space-y-1.5">
            {topBugs.map((b) => (
              <li key={b.id} className="text-sm">
                <span className="text-[#ff7a90]">•</span> {b.title}
              </li>
            ))}
          </ul>
        </div>
      )}
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
