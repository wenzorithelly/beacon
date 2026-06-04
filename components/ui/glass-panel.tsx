import * as React from "react";
import { cn } from "@/lib/utils";

// Vendored frosted-glass surface (shadcn-style: own the component, not a runtime dep).
// Technique evaluated from shadcn-glass-ui / glasscn-ui / liquid-glass kits:
// backdrop frost (.glass) + a soft specular sheen + a faint film-grain overlay for
// realism, with the content layered above. Pass layout/size via className.

const NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

export function GlassPanel({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div className={cn("glass relative isolate overflow-hidden", className)} {...props}>
      {/* specular sheen — very subtle top-left falloff */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 rounded-[inherit]"
        style={{
          background:
            "radial-gradient(90% 60% at 0% 0%, oklch(1 0 0 / 0.04), transparent 42%)",
        }}
      />
      {/* film grain — subtle, keeps the frost from looking flat */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 rounded-[inherit] opacity-[0.035] mix-blend-overlay"
        style={{ backgroundImage: NOISE, backgroundSize: "120px 120px" }}
      />
      {children}
    </div>
  );
}
