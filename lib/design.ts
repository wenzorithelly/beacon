import { z } from "zod";
import { accessForMethod } from "@/lib/access";

// The name-keyed proposal shape the terminal session pushes via `beacon_propose_plan`.
// It's positioned + given ids by lib/draft-store (graphToDoc) into a DraftDoc, which is
// what the /db canvas actually edits. Endpoints may declare which tables they touch via
// `uses` so the canvas can draw the links.

// A single column. The agent sometimes lists columns as bare strings ("id", "name uuid") instead
// of objects — coerce "<name> [type…]" into a column up front (preprocess) so the OUTPUT is always
// the full column shape and the table still renders instead of the whole block being dropped.
export const columnSchema = z.preprocess(
  (c) => {
    if (typeof c === "string") {
      const [name, ...rest] = c.trim().split(/\s+/);
      return { name, type: rest.join(" ") || "text" };
    }
    return c;
  },
  z.object({
    name: z.string().trim().min(1),
    type: z.string().trim().min(1),
    isPk: z.boolean().optional(),
    isFk: z.boolean().optional(),
    nullable: z.boolean().optional(),
    note: z.string().nullish(),
  }),
);

export const tableSchema = z.object({
  name: z.string().trim().min(1),
  domain: z.string().nullish(),
  description: z.string().nullish(),
  columns: z.array(columnSchema).default([]),
});

export const relationSchema = z.object({
  fromTable: z.string(),
  fromColumn: z.string(),
  toTable: z.string(),
  toColumn: z.string(),
  label: z.string().nullish(),
});

export const endpointSchema = z
  .object({
    method: z.string().trim().min(1),
    path: z.string().trim().min(1),
    domain: z.string().nullish(),
    description: z.string().nullish(),
    uses: z
      .array(
        z.object({
          table: z.string().trim().min(1),
          access: z.string().optional(),
        }),
      )
      .default([]),
  })
  // Unspecified access defaults to the verb's intent (PATCH/DELETE write, GET reads).
  .transform((e) => ({
    ...e,
    uses: e.uses.map((u) => ({ ...u, access: u.access ?? accessForMethod(e.method) })),
  }));

export const draftSchema = z.object({
  tables: z.array(tableSchema).default([]),
  relations: z.array(relationSchema).default([]),
  endpoints: z.array(endpointSchema).default([]),
});
export type DraftGraph = z.infer<typeof draftSchema>;
