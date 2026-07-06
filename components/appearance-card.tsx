"use client";

import { useEffect, useState } from "react";
import { Palette } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DEFAULT_SURFACE,
  DEFAULT_THEME,
  getSurface,
  getTheme,
  setSurface as persistSurface,
  setTheme as persistTheme,
  type Surface,
  type Theme,
} from "@/lib/appearance";
import { cn } from "@/lib/utils";

const ACCENT = "#ff7a45";

// Literal preview colors — a swatch shows what the option LOOKS like, so it stays fixed regardless
// of the theme currently applied (a Light swatch reads light even while you're viewing in Dark).
const PREVIEW = {
  light: { bg: "#eeece6", card: "#ffffff", ink: "#3a3a3a", border: "#dcd9d2" },
  dark: { bg: "#1f1f22", card: "#2c2c30", ink: "#e6e6e6", border: "#3a3a3f" },
} as const;

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "auto", label: "Auto" },
];

const SURFACE_OPTIONS: { value: Surface; label: string; hint: string }[] = [
  { value: "glass", label: "Glass", hint: "Frosted blur" },
  { value: "tinted", label: "Tinted", hint: "Flat, no blur" },
  { value: "solid", label: "Solid", hint: "Opaque panels" },
];

// A mini theme mock: page background, a lifted card, an ink line + the brand accent bar.
function ThemeSwatch({ theme }: { theme: Theme }) {
  if (theme === "auto") {
    // Split diagonally so Auto reads as "follows the system" — light on one side, dark on the other.
    return (
      <span className="relative block h-10 w-full overflow-hidden rounded-md border border-black/10">
        <span className="absolute inset-0" style={{ background: PREVIEW.light.bg }} />
        <span
          className="absolute inset-0"
          style={{ background: PREVIEW.dark.bg, clipPath: "polygon(100% 0, 100% 100%, 0 100%)" }}
        />
        <span
          className="absolute left-1.5 top-1.5 h-1.5 w-6 rounded-full"
          style={{ background: ACCENT }}
        />
      </span>
    );
  }
  const p = PREVIEW[theme];
  return (
    <span
      className="block h-10 w-full overflow-hidden rounded-md border"
      style={{ background: p.bg, borderColor: p.border }}
    >
      <span
        className="mx-1.5 mt-1.5 flex h-6 flex-col justify-center gap-1 rounded px-1.5"
        style={{ background: p.card, border: `1px solid ${p.border}` }}
      >
        <span className="h-1 w-3/4 rounded-full" style={{ background: p.ink, opacity: 0.55 }} />
        <span className="h-1 w-5 rounded-full" style={{ background: ACCENT }} />
      </span>
    </span>
  );
}

// A mini surface mock over a dot-grid, so glass/tinted/solid read as "how much shows through".
function SurfaceSwatch({ surface }: { surface: Surface }) {
  const panel =
    surface === "solid"
      ? { background: PREVIEW.dark.card }
      : surface === "tinted"
        ? { background: "rgba(44,44,48,0.72)" }
        : {
            background: "linear-gradient(180deg, rgba(255,255,255,0.10), rgba(44,44,48,0.55))",
            backdropFilter: "blur(3px)",
          };
  return (
    <span
      className="relative block h-10 w-full overflow-hidden rounded-md border border-black/20"
      style={{
        backgroundColor: PREVIEW.dark.bg,
        backgroundImage: "radial-gradient(rgba(255,255,255,0.22) 1px, transparent 1px)",
        backgroundSize: "6px 6px",
      }}
    >
      <span
        className="absolute inset-x-2 top-2 bottom-2 rounded"
        style={{ ...panel, border: "1px solid rgba(255,255,255,0.12)" }}
      />
    </span>
  );
}

function OptionButton({
  selected,
  label,
  hint,
  onClick,
  children,
}: {
  selected: boolean;
  label: string;
  hint?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "flex flex-1 flex-col gap-2 rounded-lg border p-2 text-left transition-colors",
        selected
          ? "border-[var(--accent-2,#ff7a45)] bg-[color-mix(in_oklab,var(--accent-2,#ff7a45)_10%,transparent)]"
          : "border-border hover:bg-[var(--ink-hover)]",
      )}
    >
      {children}
      <span className="flex items-center justify-between gap-1 px-0.5">
        <span className="text-xs font-medium">{label}</span>
        {selected && (
          <span aria-hidden className="size-1.5 rounded-full bg-[var(--accent-2,#ff7a45)]" />
        )}
      </span>
      {hint && <span className="px-0.5 text-[10px] leading-tight text-muted-foreground">{hint}</span>}
    </button>
  );
}

// Appearance settings: theme (Light / Dark / Auto) + surface (Glass / Tinted / Solid). Both apply
// instantly to <html> and persist in localStorage (no save button, no server round-trip).
export function AppearanceCard() {
  // Seed from the defaults so the first client render matches the server markup (dark/glass), then
  // adopt the real stored values after mount — same pattern the workspace switcher uses.
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  const [surface, setSurface] = useState<Surface>(DEFAULT_SURFACE);
  useEffect(() => {
    // Adopt the stored values after mount (client-only localStorage) — SSR seeded the defaults.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(getTheme());
    setSurface(getSurface());
  }, []);

  const pickTheme = (t: Theme) => {
    setTheme(t);
    persistTheme(t);
  };
  const pickSurface = (s: Surface) => {
    setSurface(s);
    persistSurface(s);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Palette className="size-4 text-[var(--accent-2,#ff7a45)]" />
          Appearance
        </CardTitle>
        <CardDescription>
          Theme and surface for this browser. Changes apply instantly and are remembered here.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Theme</p>
          <div className="flex gap-2">
            {THEME_OPTIONS.map((o) => (
              <OptionButton
                key={o.value}
                selected={theme === o.value}
                label={o.label}
                hint={o.value === "auto" ? "Follows your system" : undefined}
                onClick={() => pickTheme(o.value)}
              >
                <ThemeSwatch theme={o.value} />
              </OptionButton>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Surface</p>
          <div className="flex gap-2">
            {SURFACE_OPTIONS.map((o) => (
              <OptionButton
                key={o.value}
                selected={surface === o.value}
                label={o.label}
                hint={o.hint}
                onClick={() => pickSurface(o.value)}
              >
                <SurfaceSwatch surface={o.value} />
              </OptionButton>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
