import { closeSync, fstatSync, openSync, readSync } from "node:fs";

// Read a byte range of a (possibly multi-MB) file without slurping it whole — used to scan Claude
// Code session transcripts. `start < 0` counts from EOF (a tail); `start >= 0` reads forward from
// that byte offset. Shared by the Stop-hook plan-nudge (tail) and the ask-mirror answered check
// (from the mirror's push offset), so the fd dance lives in exactly one place.
export function readFileRange(path: string, start: number, maxBytes: number): string {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const from = start < 0 ? Math.max(0, size + start) : Math.min(start, size);
    const len = Math.min(maxBytes, size - from);
    if (len <= 0) return "";
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, from);
    return buf.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

/** The last `maxBytes` of a file. */
export const readFileTail = (path: string, maxBytes: number): string =>
  readFileRange(path, -maxBytes, maxBytes);
