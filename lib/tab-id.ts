"use client";

// A tab's own anonymous, session-scoped identity — generated once and kept in sessionStorage, so
// it's stable for the tab's lifetime but distinct from every other tab (including another tab of
// the SAME workspace). Nothing server-side ever needs to learn or store this id; it exists purely
// so a tab can recognize "this broadcast names ME" when a caller (any caller — this module has no
// idea who) asks the /api/tab/park endpoint to exclude one specific tab from a park broadcast.

export const TAB_ID_KEY = "beacon:tab-id";

export function currentTabId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = sessionStorage.getItem(TAB_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(TAB_ID_KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}
