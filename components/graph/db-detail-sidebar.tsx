import type { ReactNode } from "react";
import { KeyRound, Link2, MessageSquarePlus, X } from "lucide-react";
import {
  ACCESS_COLOR,
  METHOD_COLOR,
  domainColor,
  type DbRelationPayload,
  type DbSelection,
  type DbTablePayload,
  type EndpointPayload,
} from "@/components/graph/db-types";
import { GlassPanel } from "@/components/ui/glass-panel";
import { DbDraftActions } from "@/components/graph/db-draft-actions";
import { cn } from "@/lib/utils";
import type { DraftGraph } from "@/lib/design";

type DbSidebarTab = "details" | "comments";

export function DbDetailSidebar({
  selected,
  tables,
  relations,
  endpoints,
  draftGraph,
  onClose,
  // /plan only: Comments tab content (CommentsList) + count, the active tab, and a callback to
  // comment on the selected table/endpoint — mirrors the roadmap DetailSidebar so canvas feedback
  // works on the DB board too.
  commentsContent,
  commentsCount = 0,
  activeTab,
  onTabChange,
  onAddComment,
  // Top inset (px). /plan overlays a floating Approve/Discard pill at the top, so it passes a
  // larger offset to keep this panel BELOW those action icons (mirrors the roadmap sidebar).
  topOffset,
}: {
  selected: DbSelection;
  tables: DbTablePayload[];
  relations: DbRelationPayload[];
  endpoints: EndpointPayload[];
  draftGraph: DraftGraph;
  onClose: () => void;
  commentsContent?: ReactNode;
  commentsCount?: number;
  activeTab?: DbSidebarTab;
  onTabChange?: (tab: DbSidebarTab) => void;
  onAddComment?: (excerpt: string) => void;
  topOffset?: number;
}) {
  const nameById = new Map(tables.map((t) => [t.id, t.name]));
  const tabbed = !!commentsContent;
  const tab: DbSidebarTab = activeTab ?? "details";

  // What a "Comment on this …" click anchors to: the table name, or "METHOD /path" for an endpoint.
  const selectedExcerpt =
    selected?.kind === "table"
      ? tables.find((t) => t.id === selected.id)?.name ?? null
      : selected?.kind === "endpoint"
        ? (() => {
            const e = endpoints.find((x) => x.id === selected.id);
            return e ? `${e.method} ${e.path}` : null;
          })()
        : null;

  let body: React.ReactNode;
  if (selected?.kind === "table") {
    const table = tables.find((t) => t.id === selected.id);
    body = table ? (
      <TableDetail
        table={table}
        relations={relations}
        endpoints={endpoints}
        nameById={nameById}
      />
    ) : null;
  } else if (selected?.kind === "endpoint") {
    const ep = endpoints.find((e) => e.id === selected.id);
    body = ep ? <EndpointDetail ep={ep} nameById={nameById} /> : null;
  } else {
    body = <Overview tables={tables} relations={relations} endpoints={endpoints} />;
  }

  return (
    <GlassPanel
      // Size to content, capped at the space from `top` to 12px above the canvas bottom, and let
      // the body scroll past that — never a bottom-stretched empty panel, never cropped.
      className="absolute right-3 z-10 flex w-80 flex-col rounded-2xl"
      style={{ top: topOffset ?? 12, maxHeight: `calc(100% - ${(topOffset ?? 12) + 12}px)` }}
    >
      {tabbed ? (
        <div className="flex items-center justify-between border-b border-white/10 px-1 py-1">
          <div className="flex items-center gap-0.5">
            <DbTabBtn active={tab === "details"} onClick={() => onTabChange?.("details")}>
              Details
            </DbTabBtn>
            <DbTabBtn active={tab === "comments"} onClick={() => onTabChange?.("comments")}>
              Comments
              {commentsCount > 0 && (
                <span className="ml-1 rounded-full bg-white/10 px-1 text-[9px] font-semibold leading-4">
                  {commentsCount}
                </span>
              )}
            </DbTabBtn>
          </div>
          <button
            onClick={onClose}
            title="Close panel"
            className="mr-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between border-b border-white/10 px-3.5 py-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Panel
          </span>
          <button
            onClick={onClose}
            title="Close panel"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "comments" && tabbed ? (
          <div className="p-3">{commentsContent}</div>
        ) : (
          <>
            {draftGraph.tables.length > 0 && (
              <div className="border-b border-white/10 p-3.5">
                <DbDraftActions draftGraph={draftGraph} />
              </div>
            )}
            <div className="p-4">
              {onAddComment && selectedExcerpt && (
                <button
                  type="button"
                  onClick={() => onAddComment(selectedExcerpt)}
                  className="mb-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
                >
                  <MessageSquarePlus className="size-3.5" />
                  Comment on this {selected?.kind === "endpoint" ? "endpoint" : "table"}
                </button>
              )}
              {body}
            </div>
          </>
        )}
      </div>
    </GlassPanel>
  );
}

function DbTabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
        active ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function TableDetail({
  table,
  relations,
  endpoints,
  nameById,
}: {
  table: DbTablePayload;
  relations: DbRelationPayload[];
  endpoints: EndpointPayload[];
  nameById: Map<string, string>;
}) {
  const fksOut = relations.filter((r) => r.fromTableId === table.id);
  const fksIn = relations.filter((r) => r.toTableId === table.id);
  const usedBy = endpoints
    .map((e) => ({ e, u: e.tables.find((u) => u.tableId === table.id) }))
    .filter((x) => x.u);

  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs uppercase tracking-wide" style={{ color: domainColor(table.domain) }}>
          {table.domain ?? "table"}
        </div>
        <h2 className="font-mono text-lg font-semibold">{table.name}</h2>
        {table.description && (
          <p className="mt-1 text-sm text-muted-foreground">{table.description}</p>
        )}
      </div>

      <Section title={`Columns (${table.columns.length})`}>
        <ul className="space-y-0.5">
          {table.columns.map((c) => (
            <li key={c.name} className="flex items-center gap-1.5 text-xs">
              {c.isPk ? (
                <KeyRound className="size-3 text-amber-400" />
              ) : c.isFk ? (
                <Link2 className="size-3 text-sky-400" />
              ) : (
                <span className="size-3" />
              )}
              <span className="font-mono">{c.name}</span>
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                {c.type}
                {!c.nullable && " ·NN"}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      {fksOut.length > 0 && (
        <Section title="References (FK out)">
          <ul className="space-y-1 text-xs">
            {fksOut.map((r) => (
              <li key={r.id} className="font-mono text-muted-foreground">
                {r.fromColumn} → {nameById.get(r.toTableId)}.{r.toColumn}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {fksIn.length > 0 && (
        <Section title="Referenced by (FK in)">
          <ul className="space-y-1 text-xs">
            {fksIn.map((r) => (
              <li key={r.id} className="font-mono text-muted-foreground">
                {nameById.get(r.fromTableId)}.{r.fromColumn}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {usedBy.length > 0 && (
        <Section title={`Used by endpoints (${usedBy.length})`}>
          <ul className="space-y-1 text-xs">
            {usedBy.map(({ e, u }) => (
              <li key={e.id} className="flex items-center gap-1.5">
                <span style={{ color: METHOD_COLOR[e.method] }} className="font-bold">
                  {e.method}
                </span>
                <span className="truncate font-mono">{e.path}</span>
                <span className="ml-auto" style={{ color: ACCESS_COLOR[u!.access] }}>
                  {u!.access}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function EndpointDetail({
  ep,
  nameById,
}: {
  ep: EndpointPayload;
  nameById: Map<string, string>;
}) {
  return (
    <div className="space-y-3">
      <div>
        <span
          className="rounded px-1.5 py-0.5 text-[11px] font-bold"
          style={{ background: `${METHOD_COLOR[ep.method]}22`, color: METHOD_COLOR[ep.method] }}
        >
          {ep.method}
        </span>
        <h2 className="mt-2 font-mono text-base font-semibold">{ep.path}</h2>
        {ep.description && (
          <p className="mt-1 text-sm text-muted-foreground">{ep.description}</p>
        )}
      </div>
      <Section title={`Tables used (${ep.tables.length})`}>
        <ul className="space-y-1 text-xs">
          {ep.tables.map((u) => (
            <li key={u.tableId} className="flex items-center gap-1.5">
              <span className="font-mono">{nameById.get(u.tableId)}</span>
              <span className="ml-auto" style={{ color: ACCESS_COLOR[u.access] }}>
                {u.access}
              </span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function Overview({
  tables,
  relations,
  endpoints,
}: {
  tables: DbTablePayload[];
  relations: DbRelationPayload[];
  endpoints: EndpointPayload[];
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Database</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Live schema derived from your code. Click a table or endpoint to see details.
          Drag to rearrange — positions are saved.
        </p>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-center">
        <Stat label="tables" value={tables.length} />
        <Stat label="FKs" value={relations.length} />
        <Stat label="endpoints" value={endpoints.length} />
      </dl>
      <Section title="Legend">
        <ul className="space-y-1 text-xs text-muted-foreground">
          <li className="flex items-center gap-1.5">
            <KeyRound className="size-3 text-amber-400" /> primary key
          </li>
          <li className="flex items-center gap-1.5">
            <Link2 className="size-3 text-sky-400" /> foreign key
          </li>
          <li>— gray line: FK relation between tables</li>
          <li>– – dashed line: endpoint uses table (read/write)</li>
        </ul>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] py-2">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}
