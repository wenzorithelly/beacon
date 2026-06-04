import { KeyRound, Link2 } from "lucide-react";
import {
  ACCESS_COLOR,
  METHOD_COLOR,
  domainColor,
  type DbRelationPayload,
  type DbTablePayload,
  type EndpointPayload,
} from "@/components/graph/db-types";
import type { DbSelection } from "@/components/graph/db-map-client";

export function DbDetailSidebar({
  selected,
  tables,
  relations,
  endpoints,
}: {
  selected: DbSelection;
  tables: DbTablePayload[];
  relations: DbRelationPayload[];
  endpoints: EndpointPayload[];
}) {
  const nameById = new Map(tables.map((t) => [t.id, t.name]));

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
    <aside className="w-80 shrink-0 overflow-y-auto border-l border-border bg-background/60 p-4">
      {body}
    </aside>
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
          {table.domain ?? "tabela"}
        </div>
        <h2 className="font-mono text-lg font-semibold">{table.name}</h2>
        {table.description && (
          <p className="mt-1 text-sm text-muted-foreground">{table.description}</p>
        )}
      </div>

      <Section title={`Colunas (${table.columns.length})`}>
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
        <Section title="Referencia (FK saída)">
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
        <Section title="Referenciada por (FK entrada)">
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
        <Section title={`Usada por endpoints (${usedBy.length})`}>
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
      <Section title={`Tabelas usadas (${ep.tables.length})`}>
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
        <h2 className="text-sm font-semibold">Banco de dados (proposta v2)</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Esquema FastAPI + SQLAlchemy + Alembic. Clique numa tabela ou endpoint para
          ver detalhes. Arraste para reorganizar — as posições são salvas.
        </p>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-center">
        <Stat label="tabelas" value={tables.length} />
        <Stat label="FKs" value={relations.length} />
        <Stat label="endpoints" value={endpoints.length} />
      </dl>
      <Section title="Legenda">
        <ul className="space-y-1 text-xs text-muted-foreground">
          <li className="flex items-center gap-1.5">
            <KeyRound className="size-3 text-amber-400" /> chave primária
          </li>
          <li className="flex items-center gap-1.5">
            <Link2 className="size-3 text-sky-400" /> chave estrangeira
          </li>
          <li>— linha cinza: relação FK entre tabelas</li>
          <li>– – linha tracejada: endpoint usa tabela (read/write)</li>
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
    <div className="rounded-md border border-border bg-card py-2">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}
