"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  splitBlocks,
  isHeading,
  headingLevel,
  planHeadingAnchor,
  stripInline,
} from "@/components/plan/markdown-view";

// Section navigator shown to the left of the markdown when it's the full width of the screen
// (the user expanded it, or there's no board). Built from the plan's headings; clicking an
// entry smooth-scrolls the prose to that heading and a scroll-spy keeps the current section
// highlighted. The anchor ids (planHeadingAnchor) are the SAME ones AnnotationPanel stamps on
// the heading elements, so both sides resolve to the same target.

interface TocItem {
  id: string;
  level: number;
  label: string;
}

export function PlanToc({ markdown }: { markdown: string }) {
  const items = useMemo<TocItem[]>(
    () =>
      splitBlocks(markdown)
        .map((b, i) => ({ b, i }))
        .filter(({ b }) => isHeading(b.kind))
        .map(({ b, i }) => ({
          id: planHeadingAnchor(i),
          level: headingLevel(b.kind),
          label: stripInline(b.text),
        }))
        .filter((it) => it.label.length > 0),
    [markdown],
  );

  const [active, setActive] = useState<string | null>(null);

  // Scroll-spy: highlight the heading nearest the top of the viewport. The rootMargin biases
  // the "active" band toward the upper part of the scroll area so the highlight tracks reading.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined" || items.length === 0) return;
    const els = items
      .map((it) => document.getElementById(it.id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-12% 0px -70% 0px", threshold: 0 },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [items]);

  const jump = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    setActive(id);
  };

  return (
    <aside className="flex w-60 shrink-0 flex-col overflow-y-auto border-r border-white/5 bg-background pt-16">
      <div className="px-4 pb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Sections
      </div>
      {items.length === 0 ? (
        <p className="px-4 text-[12px] text-muted-foreground/70">
          No headings in this plan.
        </p>
      ) : (
        <nav className="space-y-0.5 px-2 pb-6">
          {items.map((it) => (
            <button
              key={it.id}
              onClick={() => jump(it.id)}
              title={it.label}
              style={{ paddingLeft: `${0.5 + it.level * 0.75}rem` }}
              className={cn(
                "block w-full truncate rounded py-1 pr-2 text-left text-[12px] leading-snug transition-colors",
                active === it.id
                  ? "bg-white/10 font-medium text-foreground"
                  : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground",
              )}
            >
              {it.label}
            </button>
          ))}
        </nav>
      )}
    </aside>
  );
}
