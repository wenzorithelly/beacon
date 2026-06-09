// Deterministic, rule-based risk flags — pure + client-safe (no fs, no AI, no CLI). Drives the
// "Risk Badges" overlay: it reads structured data the node already carries (column names, HTTP
// method, domain/path) and flags the dangerous ones so a vibe coder spots them at a glance.
// Nothing is summarized and nothing extra is run.

export interface RiskBadge {
  label: string;
  tone: "danger" | "warn";
  /** Hover text spelling out the rule (never color-alone). */
  title: string;
}

// Column names that imply secret material at rest.
const SECRET_RE = /pass(word)?|token|secret|api[_-]?key|credential|priv(ate)?[_-]?key|hash|salt/i;
// Auth-ish surfaces.
const AUTH_RE = /auth|login|logout|session|token|password|oauth|sso|credential/i;

export function tableRiskBadges(t: {
  domain: string | null;
  columns: ReadonlyArray<{ name: string }>;
}): RiskBadge[] {
  const out: RiskBadge[] = [];
  const secretCols = t.columns.filter((c) => SECRET_RE.test(c.name)).map((c) => c.name);
  if (secretCols.length) {
    out.push({ label: "secrets", tone: "danger", title: `stores credentials: ${secretCols.join(", ")}` });
  }
  if (t.domain && /auth/i.test(t.domain)) {
    out.push({ label: "auth", tone: "warn", title: "auth-domain table" });
  }
  return out;
}

export function endpointRiskBadges(e: { method: string; domain: string | null; path: string }): RiskBadge[] {
  const out: RiskBadge[] = [];
  if (/^delete$/i.test(e.method.trim())) {
    out.push({ label: "DELETE", tone: "danger", title: "destructive: deletes data" });
  }
  if ((e.domain && /auth/i.test(e.domain)) || AUTH_RE.test(e.path)) {
    out.push({ label: "auth", tone: "warn", title: "auth-related endpoint" });
  }
  return out;
}
