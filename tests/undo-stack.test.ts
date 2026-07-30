import { describe, expect, it } from "bun:test";
import { UndoStack, type UndoEntry } from "@/lib/undo-stack";

// A recording entry: appends to `log` so a test can assert WHICH thunk ran and in what order.
function entry(log: string[], label: string, coalesceKey?: string): UndoEntry {
  return {
    label,
    coalesceKey,
    undo: () => void log.push(`undo:${label}`),
    redo: () => void log.push(`redo:${label}`),
  };
}

// Injectable clock so the coalescing window is tested deterministically, not with sleeps.
function clock(start = 0) {
  const t = { now: start };
  return { t, read: () => t.now };
}

describe("UndoStack — basics", () => {
  it("starts empty", () => {
    const s = new UndoStack();
    expect(s.canUndo).toBe(false);
    expect(s.canRedo).toBe(false);
    expect(s.undoLabel).toBe(null);
    expect(s.redoLabel).toBe(null);
    expect(s.size).toBe(0);
  });

  it("undo() on an empty stack is a no-op returning null", async () => {
    const s = new UndoStack();
    expect(await s.undo()).toBe(null);
    expect(await s.redo()).toBe(null);
  });

  it("runs the entry's undo thunk, then its redo thunk", async () => {
    const log: string[] = [];
    const s = new UndoStack();
    s.push(entry(log, "A"));
    expect(s.canUndo).toBe(true);
    expect(s.undoLabel).toBe("A");

    await s.undo();
    expect(log).toEqual(["undo:A"]);
    expect(s.canUndo).toBe(false);
    expect(s.canRedo).toBe(true);
    expect(s.redoLabel).toBe("A");

    await s.redo();
    expect(log).toEqual(["undo:A", "redo:A"]);
    expect(s.canUndo).toBe(true);
    expect(s.canRedo).toBe(false);
  });

  it("undoes in LIFO order", async () => {
    const log: string[] = [];
    const s = new UndoStack();
    s.push(entry(log, "A"));
    s.push(entry(log, "B"));
    s.push(entry(log, "C"));
    await s.undo();
    await s.undo();
    expect(log).toEqual(["undo:C", "undo:B"]);
    expect(s.undoLabel).toBe("A");
    expect(s.redoLabel).toBe("B");
  });

  it("redoes in the order the entries were undone", async () => {
    const log: string[] = [];
    const s = new UndoStack();
    s.push(entry(log, "A"));
    s.push(entry(log, "B"));
    await s.undo();
    await s.undo();
    await s.redo();
    await s.redo();
    expect(log).toEqual(["undo:B", "undo:A", "redo:A", "redo:B"]);
  });

  it("awaits async thunks", async () => {
    const log: string[] = [];
    const s = new UndoStack();
    s.push({
      label: "async",
      undo: async () => {
        await Promise.resolve();
        log.push("undo");
      },
      redo: async () => {
        await Promise.resolve();
        log.push("redo");
      },
    });
    await s.undo();
    expect(log).toEqual(["undo"]);
  });

  it("clear() drops both stacks", async () => {
    const s = new UndoStack();
    s.push(entry([], "A"));
    await s.undo();
    s.push(entry([], "B"));
    s.clear();
    expect(s.canUndo).toBe(false);
    expect(s.canRedo).toBe(false);
    expect(s.size).toBe(0);
  });
});

describe("UndoStack — redo invalidation", () => {
  it("clears the redo stack on a new mutation", async () => {
    const log: string[] = [];
    const s = new UndoStack();
    s.push(entry(log, "A"));
    await s.undo();
    expect(s.canRedo).toBe(true);

    s.push(entry(log, "B"));
    expect(s.canRedo).toBe(false);
    expect(s.redoLabel).toBe(null);
  });

  it("does not coalesce a new edit across an undo, even with the same key", async () => {
    const log: string[] = [];
    const c = clock();
    const s = new UndoStack({ coalesceMs: 1000, now: c.read });
    s.push(entry(log, "title=a", "field:n1:title"));
    await s.undo();
    await s.redo();
    s.push(entry(log, "title=b", "field:n1:title"));
    // Two separate entries: the undo boundary the user just crossed is not swallowed.
    expect(s.size).toBe(2);
  });
});

describe("UndoStack — coalescing", () => {
  it("folds same-key pushes inside the window into ONE entry", () => {
    const log: string[] = [];
    const c = clock();
    const s = new UndoStack({ coalesceMs: 600, now: c.read });
    s.push(entry(log, "t=T", "field:n1:title"));
    c.t.now = 100;
    s.push(entry(log, "t=Ti", "field:n1:title"));
    c.t.now = 200;
    s.push(entry(log, "t=Tit", "field:n1:title"));
    expect(s.size).toBe(1);
  });

  it("keeps the FIRST undo (true pre-state) and the LAST redo", async () => {
    const log: string[] = [];
    const c = clock();
    const s = new UndoStack({ coalesceMs: 600, now: c.read });
    s.push(entry(log, "t=T", "field:n1:title"));
    c.t.now = 100;
    s.push(entry(log, "t=Ti", "field:n1:title"));
    c.t.now = 200;
    s.push(entry(log, "t=Tit", "field:n1:title"));

    await s.undo();
    expect(log).toEqual(["undo:t=T"]); // back to the value before typing started
    await s.redo();
    expect(log).toEqual(["undo:t=T", "redo:t=Tit"]); // forward to the last value typed
    expect(s.undoLabel).toBe("t=Tit"); // the entry carries the newest label
  });

  it("slides the window: each same-key push extends it", () => {
    const log: string[] = [];
    const c = clock();
    const s = new UndoStack({ coalesceMs: 600, now: c.read });
    s.push(entry(log, "a", "k"));
    c.t.now = 500;
    s.push(entry(log, "b", "k"));
    c.t.now = 1000; // 500ms after the previous push, not 1000ms after the first
    s.push(entry(log, "c", "k"));
    expect(s.size).toBe(1);
  });

  it("does not coalesce once the window has lapsed", () => {
    const log: string[] = [];
    const c = clock();
    const s = new UndoStack({ coalesceMs: 600, now: c.read });
    s.push(entry(log, "a", "k"));
    c.t.now = 601;
    s.push(entry(log, "b", "k"));
    expect(s.size).toBe(2);
  });

  it("does not coalesce different keys", () => {
    const log: string[] = [];
    const c = clock();
    const s = new UndoStack({ coalesceMs: 600, now: c.read });
    s.push(entry(log, "title", "field:n1:title"));
    s.push(entry(log, "status", "field:n1:status"));
    s.push(entry(log, "other node", "field:n2:title"));
    expect(s.size).toBe(3);
  });

  it("never coalesces entries with no coalesceKey", () => {
    const log: string[] = [];
    const c = clock();
    const s = new UndoStack({ coalesceMs: 600, now: c.read });
    s.push(entry(log, "a"));
    s.push(entry(log, "b"));
    expect(s.size).toBe(2);
  });
});

describe("UndoStack — bounds", () => {
  it("drops the OLDEST entry past the limit", async () => {
    const log: string[] = [];
    const s = new UndoStack({ limit: 3 });
    for (const l of ["A", "B", "C", "D"]) s.push(entry(log, l));
    expect(s.size).toBe(3);
    await s.undo();
    await s.undo();
    await s.undo();
    expect(log).toEqual(["undo:D", "undo:C", "undo:B"]); // A fell off the bottom
    expect(s.canUndo).toBe(false);
  });

  it("defaults to a limit of 50", () => {
    const s = new UndoStack();
    for (let i = 0; i < 80; i++) s.push(entry([], `e${i}`));
    expect(s.size).toBe(50);
  });
});

describe("UndoStack — re-entrancy", () => {
  it("ignores a push made from inside an undo thunk", async () => {
    const s = new UndoStack();
    let pushed = false;
    s.push({
      label: "A",
      undo: () => {
        // The undo runs the same mutation path that records history — without the guard
        // this would push a fresh entry and wipe the redo the user just earned.
        s.push(entry([], "recorded-by-mistake"));
        pushed = true;
      },
      redo: () => {},
    });
    await s.undo();
    expect(pushed).toBe(true);
    expect(s.size).toBe(0);
    expect(s.canRedo).toBe(true);
    expect(s.redoLabel).toBe("A");
  });

  it("ignores a nested undo() while one is applying", async () => {
    const log: string[] = [];
    const s = new UndoStack();
    s.push(entry(log, "A"));
    s.push({
      label: "B",
      undo: async () => {
        log.push("undo:B");
        expect(await s.undo()).toBe(null); // re-entrant call refused
      },
      redo: () => {},
    });
    await s.undo();
    expect(log).toEqual(["undo:B"]);
    expect(s.undoLabel).toBe("A");
  });
});

describe("UndoStack — onChange", () => {
  it("notifies on push, undo and redo", async () => {
    let n = 0;
    const s = new UndoStack({ onChange: () => n++ });
    s.push(entry([], "A"));
    const afterPush = n;
    expect(afterPush).toBeGreaterThan(0);
    await s.undo();
    expect(n).toBeGreaterThan(afterPush);
    const afterUndo = n;
    await s.redo();
    expect(n).toBeGreaterThan(afterUndo);
  });

  it("does not notify when undo() finds nothing to do", async () => {
    let n = 0;
    const s = new UndoStack({ onChange: () => n++ });
    await s.undo();
    expect(n).toBe(0);
  });
});
