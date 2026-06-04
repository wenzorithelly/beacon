// Pure formatter — client-safe (no DB import).

export interface FeatureLite {
  title: string;
  role?: string | null;
  plain?: string | null;
  cluster?: string | null;
}

/** Claude Code prompt to implement the drafted features. */
export function featuresToPrompt(features: FeatureLite[]): string {
  const lines: string[] = [
    "Implement these features in the Juriscan backend (FastAPI + SQLAlchemy):",
    "",
  ];
  for (const f of features) {
    lines.push(`## ${f.title}${f.cluster ? ` (${f.cluster})` : ""}`);
    if (f.role) lines.push(`- Role: ${f.role}`);
    if (f.plain) lines.push(`- Behavior: ${f.plain}`);
    lines.push("");
  }
  lines.push(
    "Propose the routes, models, and services for each, following the existing project structure. Ask before large schema changes.",
  );
  return lines.join("\n");
}
