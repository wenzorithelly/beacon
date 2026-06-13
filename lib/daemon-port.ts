import { connect } from "node:net";

// The shared daemon's preferred port. The CLI tries this first, then scans upward for a free one
// when it's taken — so a stray process (a previous run, another app, a `next dev` on 4319)
// doesn't wedge `beacon`. Kept dependency-free (node:net only) so both the CLI entry
// (bin/beacon.ts, via a computed mod() import) and the plan hook can use it cheaply.
export const DEFAULT_PORT = 4319;

// Does anything currently accept a TCP connection on host:port? Resolves true on connect, false
// on refusal/timeout. We detect by CONNECTING rather than binding: SO_REUSEADDR (Node's default)
// lets a probe bind a port alongside an existing listener whenever the addresses differ (a
// wildcard `::` daemon coexists with a 127.0.0.1 bind, and a 0.0.0.0 probe coexists with a
// 127.0.0.1 listener), so bind() gives false "free" answers — whereas a connection to localhost
// is exactly what every Beacon client makes, and it can't be fooled by how the server bound.
function isListening(host: string, port: number, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect({ host, port });
    let settled = false;
    const finish = (answered: boolean) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(answered);
    };
    sock.once("connect", () => finish(true));
    sock.once("error", () => finish(false)); // ECONNREFUSED / no IPv6 → nothing there
    sock.setTimeout(timeoutMs, () => finish(false));
  });
}

// Is a TCP port free for the daemon to claim? `localhost` resolves to BOTH 127.0.0.1 and ::1, so
// the port is free only if NEITHER family answers a connection. On a free port both connects are
// refused instantly (localhost), so scanning stays fast.
export async function isPortFree(port: number): Promise<boolean> {
  for (const host of ["127.0.0.1", "::1"]) {
    if (await isListening(host, port)) return false;
  }
  return true;
}

// The first free port at or after `preferred`, scanning up to `attempts` ports. Falls back to
// `preferred` if the whole range is busy — the spawn then surfaces the bind error as it did
// before, rather than silently doing nothing.
export async function findAvailablePort(preferred: number, attempts = 20): Promise<number> {
  for (let p = preferred; p < preferred + attempts; p++) {
    if (await isPortFree(p)) return p;
  }
  return preferred;
}
