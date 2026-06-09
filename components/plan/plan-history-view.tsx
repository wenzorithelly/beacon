"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArrowLeft, Check, X, MapPinned, Database } from "lucide-react";
import { MarkdownView } from "@/components/plan/markdown-view";
import { planHref } from "@/components/plan/use-plan-ws";
import { cn } from "@/lib/utils";
import type { DraftDoc } from "@/components/graph/db-types";
import type { FeatureGraph } from "@/lib/feature-design";

interface HistoryItem {
  id: string;
  description: string;
  verdict: "approved" | "discarded";
  archivedAt: number;
}

interface ArchivedPlan extends HistoryItem {
  markdown: string;
  globalComment?: string;
  draftDoc?: DraftDoc;
  featureGraph?: FeatureGraph;
}

type Tab = "markdown" | "map" | "db";

// When there's no pending plan, /plan becomes a history browser: list of past plans on
// the left; selected plan's markdown and board snapshot on the right (tabbed). When the
// user navigates here while a plan IS pending (via the Plans-list button), `pendingPlan`
// renders a small back-link so they can return without losing the current proposal.

export function PlanHistoryView({ pendingPlan = false }: { pendingPlan?: boolean } = {}) {
  const router = useRouter();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ArchivedPlan | null>(null);
  const [tab, setTab] = useState<Tab>("markdown");

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/plan/history");
        if (!res.ok) return;
        const body = (await res.json()) as { items: HistoryItem[] };
        setItems(body.items);
        if (body.items.length && !selectedId) setSelectedId(body.items[0].id);
      } catch {
        /* ignore */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    void (async () => {
      const res = await fetch(`/api/plan/history?id=${encodeURIComponent(selectedId)}`);
      if (!res.ok) return;
      setSelected((await res.json()) as ArchivedPlan);
    })();
  }, [selectedId]);

  const grouped = useMemo(() => groupByDate(items), [items]);

  const backToCurrent = pendingPlan ? (
    <button
      onClick={() => router.push(planHref())}
      className="glass pointer-events-auto fixed left-3 top-3 z-30 flex h-10 items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold text-sky-300 transition-colors hover:bg-sky-500/15"
      title="Return to the plan that's still pending review"
    >
      <ArrowLeft className="size-3.5" /> Back to current plan
    </button>
  ) : null;

  if (items.length === 0) {
    return (
      <>
        {backToCurrent}
        <div className="flex h-screen items-center justify-center px-6 pt-14 text-center">
          <div className="max-w-md text-sm text-muted-foreground">
            <Archive className="mx-auto mb-3 size-7 text-muted-foreground/40" />
            <div className="mb-2 text-base font-semibold text-foreground">No plans yet.</div>
            Ask the agent to propose a feature in your terminal session — it lands here via
            MCP and you can review + annotate on both sides. Past plans get archived to this
            page for browsing.
          </div>
        </div>
      </>
    );
  }

  return (
    // Full-bleed like /map and the pending-plan board: the floating top nav (fixed
    // top-3) overlays the page, so pt-14 pushes both columns below it instead of the
    // old solid header bars colliding with the nav.
    <div className="flex h-screen min-h-0 pt-14">
      {backToCurrent}
      {/* Floating controls on the top-nav row (like /map's top-center tabs + the board's
          pills): plan-view tabs centered, verdict + date top-right, smaller. */}
      {selected && (
        <>
          <div className="glass pointer-events-auto fixed left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-full p-1">
            <TabBtn active={tab === "markdown"} onClick={() => setTab("markdown")}>
              Plan
            </TabBtn>
            <TabBtn active={tab === "map"} onClick={() => setTab("map")} icon={<MapPinned className="size-3" />}>
              Features
            </TabBtn>
            <TabBtn active={tab === "db"} onClick={() => setTab("db")} icon={<Database className="size-3" />}>
              Schema
            </TabBtn>
          </div>
          <div className="glass pointer-events-auto fixed right-3 top-3 z-30 flex h-9 items-center gap-2 rounded-full px-3">
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                selected.verdict === "approved"
                  ? "bg-emerald-500/15 text-emerald-300"
                  : "bg-red-500/15 text-red-300",
              )}
            >
              {selected.verdict}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {new Date(selected.archivedAt).toLocaleString()}
            </span>
          </div>
        </>
      )}
      <aside className="flex w-64 min-w-0 shrink-0 flex-col border-r border-white/5 bg-card/30">
        <div className="border-b border-white/5 px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
          Plan history · {items.length}
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {grouped.map(([label, group]) => (
            <li key={label}>
              <div className="px-3 pb-1 pt-3 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                {label}
              </div>
              <ul>
                {group.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => setSelectedId(p.id)}
                      className={cn(
                        "flex w-full items-start gap-1.5 px-3 py-1.5 text-left text-[12px] transition-colors",
                        selectedId === p.id
                          ? "bg-white/[0.06] text-foreground"
                          : "text-muted-foreground hover:bg-white/[0.03] hover:text-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 inline-flex size-3.5 shrink-0 items-center justify-center rounded-full",
                          p.verdict === "approved"
                            ? "bg-emerald-500/15 text-emerald-300"
                            : "bg-red-500/15 text-red-300",
                        )}
                        title={p.verdict}
                      >
                        {p.verdict === "approved" ? <Check className="size-2.5" /> : <X className="size-2.5" />}
                      </span>
                      <span className="line-clamp-2">{p.description}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </aside>

      {selected ? (
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === "markdown" && (
              <div className="px-5 py-4">
                <MarkdownView markdown={selected.markdown} />
                {selected.markdown.replace(/^#[^\n]*\n?/, "").trim() === "" && (
                  <p className="mt-2 text-[13px] text-muted-foreground">
                    {(selected.featureGraph?.features?.length ?? 0) === 0 &&
                    (selected.draftDoc?.tables?.length ?? 0) === 0 &&
                    (selected.draftDoc?.endpoints?.length ?? 0) === 0
                      ? "This plan was approved without a detailed write-up — no features or schema were attached either."
                      : "This plan has no written body. See the Features and Schema tabs for what it proposed."}
                  </p>
                )}
                {selected.globalComment && (
                  <div className="mt-4 rounded-lg border border-white/5 bg-card/40 p-3">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Overall feedback
                    </div>
                    <div className="text-[12px] whitespace-pre-wrap">{selected.globalComment}</div>
                  </div>
                )}
              </div>
            )}
            {tab === "map" && (
              <ArchivedFeatures featureGraph={selected.featureGraph} />
            )}
            {tab === "db" && (
              <ArchivedSchema draftDoc={selected.draftDoc} />
            )}
          </div>
        </section>
      ) : (
        <section className="flex min-h-0 min-w-0 flex-1 items-center justify-center text-sm text-muted-foreground">
          Select a plan on the left to view it.
        </section>
      )}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
        active ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

// Compact card view of the archived features — no React Flow needed for a frozen snapshot.
function ArchivedFeatures({ featureGraph }: { featureGraph?: FeatureGraph }) {
  const features = featureGraph?.features ?? [];
  if (features.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        No features were proposed in this plan.
      </div>
    );
  }
  return (
    <div className="grid gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
      {features.map((f, i) => (
        <div
          key={i}
          className="rounded-lg border border-sky-500/20 bg-card/50 p-3"
        >
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-300">
              feature
            </span>
            {f.cluster && (
              <span className="text-[10px] text-muted-foreground">{f.cluster}</span>
            )}
          </div>
          <div className="text-sm font-semibold leading-tight">{f.title}</div>
          {f.role && (
            <div className="mt-1 text-[11px] text-muted-foreground">{f.role}</div>
          )}
          {f.plain && (
            <div className="mt-2 text-[12px] text-foreground/80">{f.plain}</div>
          )}
        </div>
      ))}
    </div>
  );
}

// Compact card view of the archived tables + endpoints.
function ArchivedSchema({ draftDoc }: { draftDoc?: DraftDoc }) {
  const tables = draftDoc?.tables ?? [];
  const endpoints = draftDoc?.endpoints ?? [];
  if (tables.length === 0 && endpoints.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        No schema was proposed in this plan.
      </div>
    );
  }
  return (
    <div className="space-y-5 px-5 py-4">
      {tables.length > 0 && (
        <section>
          <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
            Tables · {tables.length}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tables.map((t) => (
              <div key={t.id} className="rounded-lg border border-white/5 bg-card/40 p-3">
                <div className="mb-1 flex items-center gap-1.5">
                  <span className="font-mono text-[13px] font-semibold">{t.name}</span>
                  {t.domain && (
                    <span className="text-[10px] text-muted-foreground">{t.domain}</span>
                  )}
                </div>
                {t.description && (
                  <div className="mb-1.5 text-[11px] text-muted-foreground">{t.description}</div>
                )}
                <ul className="space-y-0.5 text-[11px]">
                  {t.columns.map((c, i) => (
                    <li key={i} className="flex items-baseline gap-1.5">
                      <code className="rounded bg-white/5 px-1 font-mono text-[11px]">{c.name}</code>
                      <span className="text-muted-foreground">{c.type}</span>
                      {c.isPk && <span className="text-amber-300/80 text-[9px]">PK</span>}
                      {c.isFk && <span className="text-sky-300/80 text-[9px]">FK</span>}
                      {!c.nullable && <span className="text-muted-foreground/60 text-[9px]">NOT NULL</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
      {endpoints.length > 0 && (
        <section>
          <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
            Endpoints · {endpoints.length}
          </div>
          <ul className="space-y-1.5">
            {endpoints.map((e) => (
              <li
                key={e.id}
                className="flex items-center gap-2 rounded-md border border-white/5 bg-card/40 px-2.5 py-1.5 text-[12px]"
              >
                <span className="rounded px-1.5 py-0.5 text-[10px] font-bold" style={methodStyle(e.method)}>
                  {e.method}
                </span>
                <span className="font-mono">{e.path}</span>
                {e.description && (
                  <span className="ml-2 text-[11px] text-muted-foreground">{e.description}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

const METHOD_COLORS: Record<string, string> = {
  GET: "#7bd389",
  POST: "#4ea1ff",
  PUT: "#ffb86b",
  PATCH: "#ffb86b",
  DELETE: "#ff3860",
};
function methodStyle(m: string): React.CSSProperties {
  const c = METHOD_COLORS[m.toUpperCase()] ?? "#8a8a8a";
  return { background: `${c}22`, color: c };
}

// Bucket plans by date label so the sidebar reads chronologically.
function groupByDate(items: HistoryItem[]): [string, HistoryItem[]][] {
  const buckets = new Map<string, HistoryItem[]>();
  for (const p of items) {
    const d = new Date(p.archivedAt);
    const label = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    if (!buckets.has(label)) buckets.set(label, []);
    buckets.get(label)!.push(p);
  }
  return Array.from(buckets.entries());
}
