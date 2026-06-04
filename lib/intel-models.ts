// Pure constants — safe to import from client components (no DB).

export const INTEL_MODELS = [
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "claude-opus-4-8", label: "Opus 4.8" },
] as const;

export const INTEL_MODEL_IDS: string[] = INTEL_MODELS.map((m) => m.id);

export const INTEL_PROVIDERS: string[] = ["auto", "claude-cli", "api"];

export function modelLabel(id: string): string {
  return INTEL_MODELS.find((m) => m.id === id)?.label ?? id;
}
