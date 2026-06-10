import { z } from "zod";
import { renderBoardEdits, type SubtaskAddition } from "@/lib/plan-feedback";
import { readDraftDoc } from "@/lib/draft-store";
import { readPlanMeta } from "@/lib/plan-meta";
import {
  clearStoredAnnotations,
  readStoredAnnotations,
  renderAnnotationFeedback,
  writeStoredAnnotations,
} from "@/lib/plan-annotations-store";
import { db, runWithWorkspace } from "@/lib/db-drizzle";
import { workspaceIdFromRequest } from "@/lib/workspaces";
import type { DraftDoc } from "@/components/graph/db-types";

export const dynamic = "force-dynamic";

// Beacon-native annotation store. The annotation panel PUTs the user's text-range comments
// here whenever they edit; on Submit it also marks them as `submitted` so the verdict resolver
// sees the feedback on its next poll and hands it back to the agent. The submit payload also
// carries the user's current /db draft doc so canvas edits flow back alongside the text
// annotations. Every handler is pinned to the request's workspace so the MCP poll and the
// browser read/write the same workspace's annotation file.

const annotationSchema = z.object({
  id: z.string(),
  excerpt: z.string(),
  comment: z.string(),
  kind: z.enum(["comment", "deletion"]).optional(),
});

// Loose schema for the client-sent current DraftDoc — already validated more strictly
// when the user clicks Approve in draft-store. Here we just want enough shape to diff.
const clientDraftSchema = z
  .object({
    proposedAt: z.number(),
    status: z.string(),
    tables: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        domain: z.string().nullable(),
        description: z.string().nullable(),
        x: z.number(),
        y: z.number(),
        columns: z.array(
          z.object({
            name: z.string(),
            type: z.string(),
            isPk: z.boolean(),
            isFk: z.boolean(),
            nullable: z.boolean(),
            note: z.string().nullable(),
          }),
        ),
      }),
    ),
    relations: z.array(
      z.object({
        id: z.string(),
        fromTableId: z.string(),
        toTableId: z.string(),
        fromColumn: z.string(),
        toColumn: z.string(),
        label: z.string().nullable(),
      }),
    ),
    endpoints: z.array(
      z.object({
        id: z.string(),
        method: z.string(),
        path: z.string(),
        domain: z.string().nullable(),
        description: z.string().nullable(),
        x: z.number(),
        y: z.number(),
        links: z.array(z.object({ tableId: z.string(), access: z.string() })),
      }),
    ),
  })
  .nullish();

const bodySchema = z.object({
  annotations: z.array(annotationSchema),
  globalComment: z.string().optional(),
  // Optional — only the submit-time POST sends it. The debounced PUT doesn't bother.
  draft: clientDraftSchema,
  // "Explain This Node" — per-node questions bundled into the feedback (plan-loop piggyback).
  questions: z.array(z.object({ target: z.string(), question: z.string() })).optional(),
  // The round (plan meta proposedAt) the client was looking at when it submitted. Lets the
  // server refuse a submit from a tab still showing an older round (the agent re-proposed
  // meanwhile) instead of stamping stale feedback onto the new round.
  round: z.number().optional(),
});

// Walk the DRAFT roadmap layer + every child of those drafts so the agent sees the
// canvas-side changes the user made: features they added/removed/renamed and subtasks
// they attached. Pairs with the DB diff to produce the full board-edits block.
async function collectBoardEdits(currentDoc: DraftDoc | null): Promise<string> {
  const meta = readPlanMeta();
  const originalFeatures = meta?.originalFeatures ?? [];

  const draftFeatures = await db.query.node.findMany({
    where: (n, { and: a, eq: eqf }) => a(eqf(n.source, "DRAFT"), eqf(n.view, "ROADMAP")),
    columns: { id: true, title: true },
  });
  const currentFeatures = draftFeatures.map((f) => f.title);

  let addedSubtasks: SubtaskAddition[] = [];
  if (draftFeatures.length) {
    const ids = draftFeatures.map((f) => f.id);
    const titleById = new Map(draftFeatures.map((f) => [f.id, f.title]));
    const children = await db.query.node.findMany({
      where: (n, { inArray: inArr }) => inArr(n.parentId, ids),
      columns: { title: true, parentId: true },
    });
    addedSubtasks = children.map((c) => ({
      parentTitle: titleById.get(c.parentId ?? "") ?? "(unknown)",
      title: c.title,
    }));
  }

  const originalDoc = readDraftDoc();
  return renderBoardEdits({
    originalFeatures,
    currentFeatures,
    addedSubtasks,
    originalDoc,
    currentDoc,
  });
}

// GET — used by the panel to hydrate state, AND by the verdict resolver to read feedback.
export async function GET(req: Request) {
  return runWithWorkspace(workspaceIdFromRequest(req), async () => {
    const s = readStoredAnnotations();
    // Heal a poisoned store: submitted=true whose feedback renders empty is a state the
    // verdict resolver ignores (it requires submitted && feedback), so reporting it as
    // submitted would gate the panel forever with nothing to act on. POST now rejects
    // such submits; this covers stores written before that guard existed.
    const feedback = s.submitted ? renderAnnotationFeedback(s) : "";
    const submitted = s.submitted && !!feedback.trim();
    return Response.json({
      annotations: s.annotations,
      globalComment: s.globalComment,
      submitted,
      submittedAt: submitted ? s.submittedAt : undefined,
      feedback: submitted ? feedback : "",
    });
  });
}

// PUT — panel writes in-progress state (not yet submitted). Idempotent. Ignores `draft`
// since the board diff only matters at submit time.
export async function PUT(req: Request) {
  const body = bodySchema.parse(await req.json());
  return runWithWorkspace(workspaceIdFromRequest(req), async () => {
    const prev = readStoredAnnotations();
    writeStoredAnnotations({
      ...prev,
      annotations: body.annotations,
      globalComment: body.globalComment ?? "",
      submitted: false,
      questions: body.questions ?? prev.questions ?? [],
    });
    return new Response(null, { status: 204 });
  });
}

// POST — final submit. Captures board edits on the spot and sets `submitted` so the verdict
// resolver wakes up and hands the feedback back to the terminal session.
export async function POST(req: Request) {
  const body = bodySchema.parse(await req.json());
  return runWithWorkspace(workspaceIdFromRequest(req), async () => {
    // Stale-round guard: the agent re-proposed since this tab rendered — refuse to stamp
    // the old round's feedback onto the new round. The client reloads on 409.
    const meta = readPlanMeta();
    if (typeof body.round === "number" && (meta?.proposedAt ?? 0) > 0 && body.round !== meta!.proposedAt) {
      return Response.json(
        { error: "stale round — the plan was re-proposed since this page loaded" },
        { status: 409 },
      );
    }
    // Cast: the wire schema accepts any string for `status` to be forgiving, but a draft
    // posted from /db is always in the DraftDoc union (pending|approved|discarded).
    const draft = (body.draft ?? null) as DraftDoc | null;
    const boardEdits = await collectBoardEdits(draft);
    const candidate = {
      annotations: body.annotations,
      globalComment: body.globalComment ?? "",
      submitted: true as const,
      submittedAt: Date.now(),
      boardEdits,
      questions: body.questions ?? [],
    };
    // A submit that says NOTHING (no comments/deletions, no note, no questions, no board
    // diff) must not be written: submitted=true with empty feedback is invisible to the
    // verdict resolver, so it would gate the panel forever without ever resolving.
    if (!renderAnnotationFeedback(candidate).trim()) {
      return Response.json(
        { error: "nothing to submit — add a comment, note, question, or board edit first" },
        { status: 400 },
      );
    }
    writeStoredAnnotations(candidate);
    return Response.json({ ok: true, boardEdits });
  });
}

// DELETE — wipe the annotation file (used by the Discard flow).
export async function DELETE(req: Request) {
  return runWithWorkspace(workspaceIdFromRequest(req), async () => {
    clearStoredAnnotations();
    return new Response(null, { status: 204 });
  });
}
