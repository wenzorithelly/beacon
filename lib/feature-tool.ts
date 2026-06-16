// The single `beacon_feature` MCP tool is a thin dispatcher over the routes that already back
// the feature lifecycle. This PURE mapper turns an (action, args) pair into the {path, body} to
// POST — keeping bin/mcp.ts (HTTP-only, hard to unit-test) trivial and the semantics testable.
//
// Lifecycle: add → start → done, with subtasks for breakdown.
//   add      → create a card; defaults to BACKLOG (PENDING); a title match is REPORTED, never
//              activated (flagExisting:false), so adding never demotes/starts an existing card.
//   start    → mark a card IN_PROGRESS (create-or-flag); always active.
//   subtasks → add child tasks under a card.
//   done     → complete feature(s) + register files/architecture.

export type FeatureAction = "add" | "start" | "subtasks" | "done";

export interface FeatureToolArgs {
  // add / start
  title?: string;
  id?: string;
  category?: string;
  priority?: number;
  front?: string;
  detail?: string;
  kind?: string;
  layer?: string;
  status?: string; // add only: "backlog" | "active"
  // subtasks
  parentId?: string;
  parentTitle?: string;
  items?: unknown[];
  // done
  features?: unknown[];
  description?: string;
  files?: string[];
  architecture?: unknown[];
}

export function planFeatureRequest(
  action: FeatureAction,
  args: FeatureToolArgs,
): { path: string; body: unknown } {
  switch (action) {
    case "add":
      return {
        path: "/api/map/start",
        body: {
          title: args.title,
          id: args.id,
          front: args.front,
          detail: args.detail,
          category: args.category,
          priority: args.priority,
          kind: args.kind,
          layer: args.layer,
          status: args.status ?? "backlog",
          flagExisting: false,
        },
      };
    case "start":
      return {
        path: "/api/map/start",
        body: {
          title: args.title,
          id: args.id,
          front: args.front,
          detail: args.detail,
          category: args.category,
          priority: args.priority,
          kind: args.kind,
          layer: args.layer,
          status: "active",
          flagExisting: true,
        },
      };
    case "subtasks":
      return {
        path: "/api/nodes/subtasks",
        body: { parentId: args.parentId, parentTitle: args.parentTitle, items: args.items },
      };
    case "done":
      return {
        path: "/api/map/describe",
        body: args.features?.length
          ? { features: args.features }
          : {
              description: args.description,
              files: args.files,
              id: args.id,
              title: args.title,
              architecture: args.architecture,
            },
      };
    default:
      throw new Error(`unknown beacon_feature action "${action}"`);
  }
}
