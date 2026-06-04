// Client-safe editor options (no node imports).
export const EDITOR_OPTIONS = [
  { id: "auto", label: "Auto-detectar" },
  { id: "cursor", label: "Cursor" },
  { id: "vscode", label: "VS Code" },
  { id: "windsurf", label: "Windsurf" },
  { id: "zed", label: "Zed" },
] as const;

export const EDITOR_IDS: string[] = EDITOR_OPTIONS.map((e) => e.id);
