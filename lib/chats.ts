import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDirFor } from "@/lib/workspaces";

// Beacon-started chats (the "Novo sessão" / fork threads). They live as ordinary Claude
// Code session transcripts, but headless ones carry no title — so we remember the ids we
// created (per workspace) with a title from the first message, and tag them in the list.

export interface ChatRef {
  id: string;
  title: string;
  createdAt: string;
}

function chatsPath(workspaceId: string): string {
  return join(dataDirFor(workspaceId), "chats.json");
}

export function listChats(workspaceId: string): ChatRef[] {
  try {
    const raw = JSON.parse(readFileSync(chatsPath(workspaceId), "utf8"));
    return Array.isArray(raw) ? (raw as ChatRef[]) : [];
  } catch {
    return [];
  }
}

/** Remember a Beacon-created chat (no-op if already tracked). Title from the 1st prompt. */
export function recordChat(
  workspaceId: string,
  id: string,
  title: string,
  now = new Date().toISOString(),
): void {
  const list = listChats(workspaceId);
  if (list.some((c) => c.id === id)) return;
  mkdirSync(dataDirFor(workspaceId), { recursive: true });
  const ref: ChatRef = { id, title: title.trim().slice(0, 60) || "chat", createdAt: now };
  writeFileSync(chatsPath(workspaceId), JSON.stringify([ref, ...list], null, 2));
}

export function chatTitles(workspaceId: string): Map<string, string> {
  return new Map(listChats(workspaceId).map((c) => [c.id, c.title]));
}
