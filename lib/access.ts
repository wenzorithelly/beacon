// Read/write/read-write is a per-link field on an endpoint→table usage, NOT the HTTP
// method. But when nobody sets it explicitly, the only sane default comes from the verb:
// safe methods read, mutating methods write. Used as the default in the design schema,
// for canvas-drawn links, and to repair endpoints that were stored before this existed.

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function accessForMethod(method: string): "read" | "write" {
  return READ_METHODS.has(method.trim().toUpperCase()) ? "read" : "write";
}
