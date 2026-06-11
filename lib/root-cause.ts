// Client-safe, pure. Agent-facing routes must report the REAL failure, not the ORM's
// "Failed query: <sql> params: <every bound value>" dump — an agent reading that dump
// can only guess at the cause (e.g. "description too long" when it was SQLITE_BUSY).

/** The deepest error in a `cause` chain, prefixed with its driver code when present. */
export function rootCauseMessage(e: unknown): string {
  let err: unknown = e;
  const seen = new Set<unknown>();
  while (err instanceof Error && err.cause !== undefined && !seen.has(err.cause)) {
    seen.add(err.cause);
    err = err.cause;
  }
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    return typeof code === "string" && !err.message.includes(code)
      ? `${code}: ${err.message}`
      : err.message;
  }
  if (e instanceof Error) return e.message;
  return String(err);
}
