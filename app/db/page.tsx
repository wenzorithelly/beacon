import { db } from "@/lib/db";
import { DbMapClient } from "@/components/graph/db-map-client";
import type {
  DbRelationPayload,
  DbTablePayload,
  EndpointPayload,
} from "@/components/graph/db-types";

export const dynamic = "force-dynamic";

export default async function DbPage() {
  const tablesRaw = await db.dbTable.findMany({
    include: { columns: { orderBy: { ord: "asc" } } },
  });
  const relationsRaw = await db.dbRelation.findMany();
  const endpointsRaw = await db.endpoint.findMany({ include: { tables: true } });

  const tables: DbTablePayload[] = tablesRaw.map((t) => ({
    id: t.id,
    name: t.name,
    domain: t.domain,
    description: t.description,
    source: t.source,
    x: t.x,
    y: t.y,
    columns: t.columns.map((c) => ({
      name: c.name,
      type: c.type,
      isPk: c.isPk,
      isFk: c.isFk,
      nullable: c.nullable,
      note: c.note,
    })),
  }));

  const relations: DbRelationPayload[] = relationsRaw.map((r) => ({
    id: r.id,
    fromTableId: r.fromTableId,
    toTableId: r.toTableId,
    fromColumn: r.fromColumn,
    toColumn: r.toColumn,
    label: r.label,
  }));

  const endpoints: EndpointPayload[] = endpointsRaw.map((e) => ({
    id: e.id,
    method: e.method,
    path: e.path,
    domain: e.domain,
    description: e.description,
    source: e.source,
    x: e.x,
    y: e.y,
    tables: e.tables.map((u) => ({ tableId: u.tableId, access: u.access })),
  }));

  return <DbMapClient tables={tables} relations={relations} endpoints={endpoints} />;
}
