import { KeyRound, Link2 } from "lucide-react";
import {
  ACCESS_COLOR,
  METHOD_COLOR,
  domainColor,
  type DbRelationPayload,
  type DbSelection,
  type DbTablePayload,
  type EndpointPayload,
} from "@/components/graph/db-types";
import {
  PanelHeader,
  PanelSection,
  PanelShell,
  PanelStat,
  type PanelTab,
} from "@/components/graph/panel/primitives";
import { DbDraftActions } from "@/components/graph/db-draft-actions";
import type { DraftGraph } from "@/lib/design";
import type { ReactNode } from "react";

type DbSidebarTab = PanelTab;

// Right-docked, full-height detail panel for the DB board — composed from the same shared panel
// primitives as the roadmap DetailSidebar (see panel/primitives.tsx), so both boards speak one
// panel language: flush glass shell, quiet header, hairline-divided sections, no nested boxes.
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

  const selectedTable = selected?.kind === "table" ? tables.find((t) => t.id === selected.id) : null;
  const selectedEp = selected?.kind === "endpoint" ? endpoints.find((e) => e.id === selected.id) : null;

  // What a "comment on this …" click anchors to: the table name, or "METHOD /path" for an endpoint.
  const selectedExcerpt = selectedTable
    ? selectedTable.name
    : selectedEp
      ? `${selectedEp.method} ${selectedEp.path}`
      : null;

  return (
    <PanelShell topOffset={topOffset}>
      <PanelHeader
        tabs={tabbed ? { active: tab, count: commentsCount, onChange: (t) => onTabChange?.(t) } : null}
        breadcrumb={
          selectedTable ? (
            <>
              <span style={{ color: domainColor(selectedTable.domain) }}>
                {selectedTable.domain ?? "table"}
              </span>
              <span> · table</span>
            </>
          ) : selectedEp ? (
            <>
              {selectedEp.domain ?? "api"}
              <span> · endpoint</span>
            </>
          ) : (
            "Database"
          )
        }
        comment={
          onAddComment && selectedExcerpt && tab === "details"
            ? {
                title: `Comment on this ${selected?.kind === "endpoint" ? "endpoint" : "table"}`,
                onClick: () => onAddComment(selectedExcerpt),
              }
            : null
        }
        onClose={onClose}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "comments" && tabbed ? (
          <div className="px-4 py-3">{commentsContent}</div>
        ) : (
          <>
            {draftGraph.tables.length > 0 && (
              <div className="border-b border-border px-4 py-3">
                <DbDraftActions draftGraph={draftGraph} />
              </div>
            )}
            <div className="px-4 py-3">
              {selectedTable ? (
                <TableDetail
                  table={selectedTable}
                  relations={relations}
                  endpoints={endpoints}
                  nameById={nameById}
                />
              ) : selectedEp ? (
                <EndpointDetail ep={selectedEp} nameById={nameById} />
              ) : (
                <Overview tables={tables} relations={relations} endpoints={endpoints} />
              )}
            </div>
          </>
        )}
      </div>
    </PanelShell>
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
    <div>
      <h2 className="font-mono text-base font-semibold leading-snug">{table.name}</h2>
      {table.description && (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{table.description}</p>
      )}

      <PanelSection title={`Columns (${table.columns.length})`}>
        <ul className="space-y-0.5">
          {table.columns.map((c) => (
            <li key={c.name} className="flex items-center gap-1.5 text-xs">
              {c.isPk ? (
                <KeyRound className="size-3 text-amber-500 dark:text-amber-400" />
              ) : c.isFk ? (
                <Link2 className="size-3 text-sky-500 dark:text-sky-400" />
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
      </PanelSection>

      {fksOut.length > 0 && (
        <PanelSection title="References (FK out)">
          <ul className="space-y-1 text-xs">
            {fksOut.map((r) => (
              <li key={r.id} className="font-mono text-muted-foreground">
                {r.fromColumn} → {nameById.get(r.toTableId)}.{r.toColumn}
              </li>
            ))}
          </ul>
        </PanelSection>
      )}

      {fksIn.length > 0 && (
        <PanelSection title="Referenced by (FK in)">
          <ul className="space-y-1 text-xs">
            {fksIn.map((r) => (
              <li key={r.id} className="font-mono text-muted-foreground">
                {nameById.get(r.fromTableId)}.{r.fromColumn}
              </li>
            ))}
          </ul>
        </PanelSection>
      )}

      {usedBy.length > 0 && (
        <PanelSection title={`Used by endpoints (${usedBy.length})`}>
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
        </PanelSection>
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
    <div>
      <span
        className="rounded px-1.5 py-0.5 text-[11px] font-bold"
        style={{ background: `${METHOD_COLOR[ep.method]}22`, color: METHOD_COLOR[ep.method] }}
      >
        {ep.method}
      </span>
      <h2 className="mt-2 font-mono text-sm font-semibold leading-snug">{ep.path}</h2>
      {ep.description && (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{ep.description}</p>
      )}
      <PanelSection title={`Tables used (${ep.tables.length})`}>
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
      </PanelSection>
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
    <div>
      <h2 className="text-base font-semibold">Database</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Live schema derived from your code. Click a table or endpoint to see details.
        Drag to rearrange — positions are saved.
      </p>
      <dl className="mt-4 flex gap-8 border-t border-border pt-3">
        <PanelStat label="tables" value={tables.length} />
        <PanelStat label="FKs" value={relations.length} />
        <PanelStat label="endpoints" value={endpoints.length} />
      </dl>
      <PanelSection title="Legend">
        <ul className="space-y-1 text-xs text-muted-foreground">
          <li className="flex items-center gap-1.5">
            <KeyRound className="size-3 text-amber-500 dark:text-amber-400" /> primary key
          </li>
          <li className="flex items-center gap-1.5">
            <Link2 className="size-3 text-sky-500 dark:text-sky-400" /> foreign key
          </li>
          <li>— gray line: FK relation between tables</li>
          <li>– – dashed line: endpoint uses table (read/write)</li>
        </ul>
      </PanelSection>
    </div>
  );
}
