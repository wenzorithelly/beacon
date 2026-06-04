export interface RemoteSettings {
  intelModel: string;
  intelProvider: string;
}

// The watcher reads the model/provider chosen in the control-app UI each run,
// so switching the dropdown takes effect on the next file save (no restart).
export async function fetchSettings(controlUrl: string): Promise<RemoteSettings | null> {
  try {
    const res = await fetch(`${controlUrl}/api/settings`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    const d = await res.json();
    if (typeof d?.intelModel !== "string") return null;
    return { intelModel: d.intelModel, intelProvider: d.intelProvider ?? "auto" };
  } catch {
    return null;
  }
}
