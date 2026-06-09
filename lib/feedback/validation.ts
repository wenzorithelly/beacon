import { z } from "zod";

// Anonymous feedback is unauthenticated and public, so validate tightly: a non-empty,
// length-capped message (trimmed first), and a vote that is strictly up or down.
export const feedbackBodySchema = z.string().trim().min(1).max(2000);

export const voteDirSchema = z.object({ dir: z.enum(["up", "down"]) });
export type VoteDir = z.infer<typeof voteDirSchema>["dir"];
