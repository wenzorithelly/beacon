import { describe, expect, it } from "bun:test";
import { listChats, recordChat, chatTitles } from "@/lib/chats";

// BEACON_HOME is isolated to a temp dir in tests/bun-setup.ts, so this writes there.
describe("beacon chat tracking", () => {
  it("records, lists, and maps chat titles per workspace", () => {
    const ws = "wschat1";
    expect(listChats(ws)).toEqual([]);

    recordChat(ws, "sess-a", "Design a users table", "2026-01-01T00:00:00.000Z");
    recordChat(ws, "sess-b", "Fix the billing bug", "2026-01-02T00:00:00.000Z");

    const list = listChats(ws);
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe("sess-b"); // newest first
    expect(chatTitles(ws).get("sess-a")).toBe("Design a users table");
  });

  it("is idempotent per id and truncates long titles", () => {
    const ws = "wschat2";
    recordChat(ws, "sess-x", "first title");
    recordChat(ws, "sess-x", "second title should be ignored");
    expect(listChats(ws)).toHaveLength(1);
    expect(chatTitles(ws).get("sess-x")).toBe("first title");

    recordChat(ws, "sess-long", "x".repeat(200));
    expect((chatTitles(ws).get("sess-long") ?? "").length).toBeLessThanOrEqual(60);
  });

  it("keeps workspaces separate", () => {
    recordChat("wsA", "shared-looking", "A");
    recordChat("wsB", "shared-looking", "B");
    expect(chatTitles("wsA").get("shared-looking")).toBe("A");
    expect(chatTitles("wsB").get("shared-looking")).toBe("B");
  });
});
