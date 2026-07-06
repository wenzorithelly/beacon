// Serializable payload passed from the server map page to the client canvas.

import type { FeatureSignals } from "@/lib/feature-signals";

export interface BugFlagPayload {
  id: string;
  by: string; // "user" | "agent"
  note: string;
  resolved: boolean;
}

export interface MapNodePayload {
  id: string;
  view: string;
  kind: string; // FEATURE | BUG
  cluster: string | null;
  // frontend | backend | fullstack | null — rendered only when the workspace has a frontend.
  layer: string | null;
  title: string;
  role: string | null;
  plain: string | null;
  status: string;
  priority: number;
  x: number;
  y: number;
  source: string;
  sourceRef: string | null;
  // Linear issue owner (assignee) for the owner-avatar chip — set on source="LINEAR" cards.
  assigneeName?: string | null;
  assigneeAvatarUrl?: string | null;
  parentId: string | null;
  isCriterion: boolean;
  files: string[];
  // Deterministic rollup signals (untested file count, auth-touch) for the card badges.
  signals?: FeatureSignals;
  // Blast-radius metrics for ARCHITECTURE cards — distinct external files importing into /
  // depended on by this component's attached files (computed from the live code graph in the
  // server page; absent on roadmap nodes and when no files are attached).
  importsIn?: number;
  importsOut?: number;
  // Bug/investigation flags raised on this node (user via the sidebar, agent via
  // init/refresh/describe). Open ones drive the card's bug badge.
  bugFlags: BugFlagPayload[];
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
