// Serializable payload passed from the server map page to the client canvas.

import type { FeatureSignals } from "@/lib/feature-signals";

export interface MapNodePayload {
  id: string;
  view: string;
  cluster: string | null;
  title: string;
  role: string | null;
  plain: string | null;
  status: string;
  priority: number;
  x: number;
  y: number;
  source: string;
  sourceRef: string | null;
  parentId: string | null;
  isCriterion: boolean;
  files: string[];
  // Deterministic rollup signals (untested file count, auth-touch) for the card badges.
  signals?: FeatureSignals;
}

export interface MapEdgePayload {
  id: string;
  fromId: string;
  toId: string;
  kind: string;
  label: string | null;
  sourceHandle: string | null;
  targetHandle: string | null;
}
