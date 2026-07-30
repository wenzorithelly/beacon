// A bounded stack of invertible board mutations.
//
// The one design rule: an entry is built AT THE MOMENT of the mutation, capturing the real
// pre-state in its `undo` closure. Nothing here recomputes an inverse after the fact, so the
// stack never has to model the board — it just holds thunks. That keeps this file free of
// React AND of fetch: it does not know how to talk to the server, which is what makes it
// unit-testable (see tests/undo-stack.test.ts) and reusable from any canvas.
//
// The React seam (keyboard bindings, re-render on change) lives in components/graph/use-undo.ts.

export interface UndoEntry {
  /** Human label for the action, e.g. "Move 3 cards". Shown in a menu/tooltip if one exists. */
  readonly label: string;
  /** Revert the mutation. Owns its own optimistic-update + server write, exactly like the
   *  forward path did — the stack only sequences it. Must be idempotent-safe to await. */
  undo: () => void | Promise<void>;
  /** Re-apply it. */
  redo: () => void | Promise<void>;
  /** Rapid pushes sharing this key inside the coalescing window fold into ONE entry, so
   *  typing a title is one undo step and not forty. Convention: `field:<nodeId>:<fieldName>`.
   *  Omit it for anything that should always be its own step (create, delete, drag, edge). */
  readonly coalesceKey?: string;
}

export interface UndoStackOptions {
  /** Max undo depth; the oldest entry falls off past this. Default 50. */
  limit?: number;
  /** Same-key pushes within this many ms fold together. Sliding — each push extends it.
   *  Default 600. */
  coalesceMs?: number;
  /** Injectable clock (tests). Default Date.now. */
  now?: () => number;
  /** Called after any change to canUndo/canRedo/labels so a UI can re-render. */
  onChange?: () => void;
}

export class UndoStack {
  private past: UndoEntry[] = [];
  private future: UndoEntry[] = [];
  private lastPushAt = Number.NEGATIVE_INFINITY;
  private busy = false;

  private readonly limit: number;
  private readonly coalesceMs: number;
  private readonly now: () => number;
  private readonly onChange?: () => void;

  constructor(opts: UndoStackOptions = {}) {
    this.limit = opts.limit ?? 50;
    this.coalesceMs = opts.coalesceMs ?? 600;
    this.now = opts.now ?? Date.now;
    this.onChange = opts.onChange;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  get undoLabel(): string | null {
    return this.past.at(-1)?.label ?? null;
  }
  get redoLabel(): string | null {
    return this.future.at(-1)?.label ?? null;
  }
  /** Current undo depth. */
  get size(): number {
    return this.past.length;
  }
  /** True while an undo/redo thunk is in flight. */
  get applying(): boolean {
    return this.busy;
  }

  /**
   * Record a mutation. Ignored while an undo/redo is applying — an undo thunk that routes
   * through the same helper that records history would otherwise append a bogus entry and
   * wipe the redo the user just earned.
   */
  push(entry: UndoEntry): void {
    if (this.busy) return;
    const at = this.now();
    const top = this.past.at(-1);
    if (
      entry.coalesceKey &&
      top?.coalesceKey === entry.coalesceKey &&
      at - this.lastPushAt <= this.coalesceMs
    ) {
      // Fold: keep the OLDER undo (the true pre-edit state) and take the NEWER redo + label.
      this.past[this.past.length - 1] = { ...entry, undo: top.undo };
    } else {
      this.past.push(entry);
      if (this.past.length > this.limit) this.past.shift();
    }
    this.lastPushAt = at;
    this.future.length = 0;
    this.onChange?.();
  }

  async undo(): Promise<UndoEntry | null> {
    if (this.busy) return null;
    const e = this.past.pop();
    if (!e) return null;
    this.future.push(e);
    // Crossing an undo boundary ends any coalescing run: the next edit is its own step.
    this.lastPushAt = Number.NEGATIVE_INFINITY;
    await this.run(e.undo);
    return e;
  }

  async redo(): Promise<UndoEntry | null> {
    if (this.busy) return null;
    const e = this.future.pop();
    if (!e) return null;
    this.past.push(e);
    this.lastPushAt = Number.NEGATIVE_INFINITY;
    await this.run(e.redo);
    return e;
  }

  clear(): void {
    this.past.length = 0;
    this.future.length = 0;
    this.lastPushAt = Number.NEGATIVE_INFINITY;
    this.onChange?.();
  }

  private async run(thunk: () => void | Promise<void>): Promise<void> {
    this.busy = true;
    this.onChange?.(); // the entry already moved between stacks — reflect it now
    try {
      await thunk();
    } finally {
      this.busy = false;
      this.onChange?.();
    }
  }
}
