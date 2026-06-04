// Shared display metadata for node statuses, bug severities, and clusters.
// Used by the list, bugs overlay, and the map node cards.

export const VIEWS = ["ROADMAP", "ARCHITECTURE"] as const;
export type View = (typeof VIEWS)[number];

export const ROADMAP_STATUSES = [
  "PENDING",
  "IN_PROGRESS",
  "DONE",
  "BLOCKED",
  "CANCELLED",
  "DEPRIORITIZED",
] as const;

export const ARCH_STATUSES = ["KEEP", "REBUILD", "REPLACE", "DROP"] as const;

export const BUG_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "WONTFIX"] as const;

export const SEVERITIES = ["critical", "high", "medium", "low"] as const;

interface Meta {
  label: string;
  className: string;
}

// Node status (covers both ROADMAP and ARCHITECTURE values).
export const STATUS_META: Record<string, Meta> = {
  // roadmap
  DONE: { label: "Concluído", className: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300" },
  IN_PROGRESS: { label: "Em progresso", className: "border-sky-500/30 bg-sky-500/15 text-sky-300" },
  PENDING: { label: "Pendente", className: "border-amber-500/30 bg-amber-500/10 text-amber-200" },
  BLOCKED: { label: "Bloqueado", className: "border-orange-500/30 bg-orange-500/15 text-orange-300" },
  CANCELLED: { label: "Cancelado", className: "border-zinc-500/30 bg-zinc-500/10 text-zinc-400 line-through" },
  DEPRIORITIZED: { label: "Despriorizado", className: "border-zinc-600/40 bg-zinc-600/10 text-zinc-400" },
  // architecture disposition
  KEEP: { label: "Manter", className: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300" },
  REBUILD: { label: "Reconstruir", className: "border-violet-500/30 bg-violet-500/15 text-violet-300" },
  REPLACE: { label: "Substituir", className: "border-rose-500/30 bg-rose-500/15 text-rose-300" },
  DROP: { label: "Descartar", className: "border-zinc-500/30 bg-zinc-500/10 text-zinc-400 line-through" },
};

export const BUG_STATUS_META: Record<string, Meta> = {
  OPEN: { label: "Aberto", className: "border-red-500/30 bg-red-500/10 text-red-300" },
  IN_PROGRESS: { label: "Em progresso", className: "border-sky-500/30 bg-sky-500/15 text-sky-300" },
  RESOLVED: { label: "Resolvido", className: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300" },
  WONTFIX: { label: "Não corrigir", className: "border-zinc-500/30 bg-zinc-500/10 text-zinc-400" },
};

export const SEVERITY_META: Record<string, Meta> = {
  critical: { label: "Crítico", className: "border-red-500/40 bg-red-500/15 text-red-300" },
  high: { label: "Alto", className: "border-orange-500/30 bg-orange-500/15 text-orange-300" },
  medium: { label: "Médio", className: "border-amber-500/30 bg-amber-500/10 text-amber-200" },
  low: { label: "Baixo", className: "border-zinc-500/30 bg-zinc-500/10 text-zinc-300" },
};

// Severity ordering (highest first) for sorting / max-severity badge color.
export const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export const CLUSTER_LABEL: Record<string, string> = {
  // roadmap lanes
  EMERGENCY: "Emergência",
  FRONT_1: "Frente 1 · Busca",
  FRONT_2: "Frente 2 · Escritórios",
  FRONT_3: "Frente 3 · Cota IA",
  FRONT_4: "Frente 4 · Banco",
  CROSS_CUTTING: "Transversais / DoD",
  // architecture clusters
  AUTH: "Auth",
  FIRMS: "Escritórios",
  SEARCH: "Busca",
  STORAGE: "Armazenamento",
  PETITION: "Petições",
  BILLING: "Planos / Cota",
  ADMIN: "Admin",
  INGEST: "Ingestão",
  EMBEDDINGS: "Embeddings",
  MONITORING: "Monitoramento",
  PREDATORY: "Litigância predatória",
};

export function clusterLabel(cluster: string | null | undefined): string {
  if (!cluster) return "—";
  return CLUSTER_LABEL[cluster] ?? cluster;
}
