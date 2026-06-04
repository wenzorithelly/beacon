import { db } from "@/lib/db";
import { MapClient } from "@/components/graph/map-client";
import { getFeatureDraft } from "@/lib/feature-design";
import type { MapEdgePayload, MapNodePayload } from "@/components/graph/types";

export const dynamic = "force-dynamic";

export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const sp = await searchParams;
  const view = sp.view === "ARCHITECTURE" ? "ARCHITECTURE" : "ROADMAP";

  const nodes = await db.node.findMany({
    where: { view },
    include: {
      tags: { select: { label: true } },
      bugs: {
        select: { id: true, title: true, severity: true, status: true, sourceRef: true },
      },
    },
  });
  const dbEdges = await db.edge.findMany({
    where: { from: { view }, to: { view } },
  });

  const payload: MapNodePayload[] = nodes.map((n) => ({
    id: n.id,
    view: n.view,
    cluster: n.cluster,
    title: n.title,
    role: n.role,
    plain: n.plain,
    status: n.status,
    priority: n.priority,
    x: n.x,
    y: n.y,
    source: n.source,
    sourceRef: n.sourceRef,
    parentId: n.parentId,
    isCriterion: n.tags.some((t) => t.label === "criterion"),
    bugs: n.bugs,
  }));

  const edges: MapEdgePayload[] = dbEdges.map((e) => ({
    id: e.id,
    fromId: e.fromId,
    toId: e.toId,
    kind: e.kind,
    label: e.label,
  }));

  const featureDraft = view === "ARCHITECTURE" ? await getFeatureDraft() : { features: [] };

  return <MapClient view={view} nodes={payload} edges={edges} featureDraft={featureDraft} />;
}
