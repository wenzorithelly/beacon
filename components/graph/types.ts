// Serializable payload passed from the server map page to the client canvas.

export interface BugPayload {
  id: string;
  title: string;
  severity: string;
  status: string;
  sourceRef: string | null;
}

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
  sourceRef: string | null;
  parentId: string | null;
  isCriterion: boolean;
  bugs: BugPayload[];
}

export interface MapEdgePayload {
  id: string;
  fromId: string;
  toId: string;
  kind: string;
  label: string | null;
}
