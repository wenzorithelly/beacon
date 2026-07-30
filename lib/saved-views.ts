import { randomUUID } from "node:crypto";
import { z } from "zod";
import { readSavedViewsRaw, writeSavedViewsRaw } from "@/lib/board-layout-state";
import { NODE_LAYER } from "@/lib/schemas";

// Saved views: a NAMED snapshot of how a board is being looked at — the seven filter Sets +
// layer emphasis, the arrange dimension, hide-empty, the folded lanes, and (Columns board) its
// group-by. Per workspace, per board; one of them can be the board's default (what it opens
// with). Pure presentation state, so it rides in the existing board-layout-state.json rather
// than a Drizzle table — no migration, no schema, and it disappears with the workspace.
//
// Everything here is synchronous read-modify-write over that one file (see the accessors in
// lib/board-layout-state), which is why a "cap" is cheap to enforce and a concurrent write
// can't tear.

export const SAVED_VIEW_BOARDS = ["roadmap", "architecture", "db", "columns"] as const;
export type SavedViewBoard = (typeof SAVED_VIEW_BOARDS)[number];

export const MAX_SAVED_VIEWS = 50;
export const MAX_VIEW_NAME_LENGTH = 60;

/** A user-fixable problem (bad input, duplicate name, cap reached). `status` is the HTTP code
 *  the route should answer with; a MISSING id is NOT one of these — those return null/false so
 *  the route can 404 instead of pretending the write happened. */
export class SavedViewError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409 = 400,
  ) {
    super(message);
    this.name = "SavedViewError";
  }
}

const boardSchema = z.enum(SAVED_VIEW_BOARDS);

const nameSchema = z
  .string()
  .trim()
  .min(1, "a view needs a name")
  .max(MAX_VIEW_NAME_LENGTH, `a view name must be ${MAX_VIEW_NAME_LENGTH} characters or fewer`);

// Every field defaults, so a board only sends the dimensions it actually has (the Columns board
// has no `arrangedBy`; the roadmap has no `groupBy`) and still stores a complete, applyable view.
const stateSchema = z.object({
  filters: z
    .object({
      status: z.array(z.string()).default([]),
      cluster: z.array(z.string()).default([]),
      priority: z.array(z.number().int()).default([]),
      team: z.array(z.string()).default([]),
      project: z.array(z.string()).default([]),
      milestone: z.array(z.string()).default([]),
      state: z.array(z.string()).default([]),
    })
    .default({
      status: [],
      cluster: [],
      priority: [],
      team: [],
      project: [],
      milestone: [],
      state: [],
    }),
  layerEmphasis: NODE_LAYER.nullable().default(null),
  // Mirrors RoadmapGroupBy (lib/roadmap-layout) — the dimension the board was arranged by.
  arrangedBy: z.enum(["cluster", "status", "priority"]).nullable().default(null),
  hideEmpty: z.boolean().default(false),
  collapsed: z.array(z.string()).default([]),
  // Columns board only: which dimension its columns are grouped by.
  groupBy: z.string().trim().min(1).max(40).nullable().default(null),
});

const savedViewSchema = z.object({
  id: z.string().min(1),
  board: boardSchema,
  name: nameSchema,
  state: stateSchema,
  isDefault: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const createSchema = z.object({ board: boardSchema, name: nameSchema, state: stateSchema });
const patchSchema = z
  .object({ name: nameSchema, state: stateSchema, isDefault: z.boolean() })
  .partial()
  .refine((p) => p.name !== undefined || p.state !== undefined || p.isDefault !== undefined, {
    message: "nothing to update",
  });

export type SavedViewState = z.infer<typeof stateSchema>;
export type SavedView = z.infer<typeof savedViewSchema>;
export type SavedViewCreate = z.input<typeof createSchema>;
export type SavedViewPatch = z.input<typeof patchSchema>;

export function isSavedViewBoard(value: string): value is SavedViewBoard {
  return (SAVED_VIEW_BOARDS as readonly string[]).includes(value);
}

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new SavedViewError(parsed.error.issues[0]?.message ?? "invalid view");
  return parsed.data;
}

/** A hand-edited or half-upgraded blob must not brick the boards, so a blob that doesn't parse
 *  reads as "no saved views" and the next write replaces it. */
function readAll(): SavedView[] {
  const parsed = z.array(savedViewSchema).safeParse(readSavedViewsRaw() ?? []);
  return parsed.success ? parsed.data : [];
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function listSavedViews(board?: SavedViewBoard): SavedView[] {
  const all = readAll();
  return board ? all.filter((v) => v.board === board) : all;
}

/** The view a board should open with, if the user starred one. */
export function getDefaultSavedView(board: SavedViewBoard): SavedView | null {
  return readAll().find((v) => v.board === board && v.isDefault) ?? null;
}

export function createSavedView(input: SavedViewCreate): SavedView {
  const data = parse(createSchema, input);
  const all = readAll();
  if (all.length >= MAX_SAVED_VIEWS) {
    throw new SavedViewError(`this workspace already holds ${MAX_SAVED_VIEWS} saved views`, 409);
  }
  if (all.some((v) => v.board === data.board && sameName(v.name, data.name))) {
    throw new SavedViewError(`a view named "${data.name}" already exists on this board`, 409);
  }
  const now = new Date().toISOString();
  const view: SavedView = { id: randomUUID(), ...data, isDefault: false, createdAt: now, updatedAt: now };
  writeSavedViewsRaw([...all, view]);
  return view;
}

/** Rename / re-save the state / star-unstar. Returns null when the id is gone (→ 404), throws a
 *  SavedViewError for a bad or conflicting patch. `isDefault: true` un-stars the board's other
 *  views; `false` just clears this one. */
export function updateSavedView(id: string, patch: SavedViewPatch): SavedView | null {
  const data = parse(patchSchema, patch);
  const all = readAll();
  const index = all.findIndex((v) => v.id === id);
  if (index === -1) return null;
  const current = all[index];
  if (
    data.name !== undefined &&
    all.some((v) => v.id !== id && v.board === current.board && sameName(v.name, data.name!))
  ) {
    throw new SavedViewError(`a view named "${data.name}" already exists on this board`, 409);
  }
  const next: SavedView = {
    ...current,
    ...(data.name !== undefined && { name: data.name }),
    ...(data.state !== undefined && { state: data.state }),
    ...(data.isDefault !== undefined && { isDefault: data.isDefault }),
    updatedAt: new Date().toISOString(),
  };
  const list = data.isDefault
    ? all.map((v) => (v.board === current.board ? { ...v, isDefault: false } : v))
    : [...all];
  list[index] = next;
  writeSavedViewsRaw(list);
  return next;
}

export const renameSavedView = (id: string, name: string): SavedView | null =>
  updateSavedView(id, { name });

/** False when the id doesn't exist — the route 404s rather than reporting a phantom delete. */
export function deleteSavedView(id: string): boolean {
  const all = readAll();
  const next = all.filter((v) => v.id !== id);
  if (next.length === all.length) return false;
  writeSavedViewsRaw(next);
  return true;
}
