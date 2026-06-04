"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SeverityBadge } from "@/components/badges";
import {
  ARCH_STATUSES,
  ROADMAP_STATUSES,
  STATUS_META,
  clusterLabel,
} from "@/lib/constants";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { NodeFormDialog } from "@/components/graph/node-form-dialog";
import {
  cancelAction,
  deleteNodeAction,
  deprioritizeAction,
  setStatusAction,
} from "@/app/actions/nodes";
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
        <NodeDetail key={selected.id} node={selected} view={view} />
      ) : (
        <Overview view={view} nodes={allNodes} />
      )}
    </aside>
  );
}

function NodeDetail({
  node,
  view,
}: {
  node: MapNodePayload;
  view: "ROADMAP" | "ARCHITECTURE";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);

  const statuses = view === "ARCHITECTURE" ? ARCH_STATUSES : ROADMAP_STATUSES;
  const openBugs = node.bugs.filter((b) => b.status !== "RESOLVED");

  const run = (fn: () => Promise<unknown>) =>
    startTransition(async () => {
      await fn();
      router.refresh();
    });

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
      </div>

      <div className="space-y-1.5">
        <span className="text-xs text-muted-foreground">Status</span>
        <Select
          value={node.status}
          onValueChange={(v) => run(() => setStatusAction(node.id, v))}
        >
          <SelectTrigger className="h-8" disabled={pending}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {statuses.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_META[s]?.label ?? s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {node.role && <p className="text-sm text-foreground/90">{node.role}</p>}
      {node.plain && <p className="text-sm text-muted-foreground">{node.plain}</p>}
      {node.sourceRef && (
        <div className="rounded-md border border-border bg-card px-2 py-1.5 font-mono text-xs text-muted-foreground">
          {node.sourceRef}
        </div>
      )}

      {/* actions */}
      <div className="flex flex-wrap gap-1.5 pt-1">
        <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
          Editar
        </Button>
        <Button size="sm" variant="outline" onClick={() => setSubOpen(true)}>
          + Subnó
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run(() => cancelAction(node.id))}
        >
          Cancelar
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run(() => deprioritizeAction(node.id))}
        >
          Despriorizar
        </Button>
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button size="sm" variant="outline" className="text-red-300">
                Excluir
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir “{node.title}”?</AlertDialogTitle>
              <AlertDialogDescription>
                Isto remove o nó e todos os seus subnós. Não pode ser desfeito.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => run(() => deleteNodeAction(node.id))}
              >
                Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {openBugs.length > 0 && (
        <div className="pt-1">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Bugs ({openBugs.length})
          </h3>
          <ul className="space-y-2">
            {openBugs.map((bug) => (
              <li
                key={bug.id}
                className="rounded-md border border-border bg-card p-2 text-sm"
              >
                <div className="mb-1">
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

      {editOpen && (
        <NodeFormDialog
          open
          onOpenChange={setEditOpen}
          mode="edit"
          view={view}
          heading="Editar nó"
          nodeId={node.id}
          defaults={{
            title: node.title,
            role: node.role,
            plain: node.plain,
            status: node.status,
            cluster: node.cluster,
          }}
        />
      )}
      {subOpen && (
        <NodeFormDialog
          open
          onOpenChange={setSubOpen}
          mode="create"
          view={view}
          heading="Novo subnó"
          parentId={node.id}
          position={{ x: node.x, y: node.y + 120 }}
          defaults={{ cluster: node.cluster }}
        />
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
    .flatMap((n) => n.bugs)
    .filter((b) => b.status !== "RESOLVED" && b.severity === "critical");

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">
          {view === "ROADMAP" ? "Roadmap de produção" : "Arquitetura de referência"}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Clique em um nó para ver detalhes e ações. Arraste para reorganizar — as
          posições são salvas.
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
