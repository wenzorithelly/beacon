import { describe, expect, it } from "bun:test";
import { extractModelSchema } from "@/intel/extractors/models";

// Deterministic schema extraction must catch EVERY table the code declares — the bug it replaces
// is the AI pass silently dropping tables (juriscan: 9 of 21 ingested).

describe("extractModelSchema — SQLAlchemy", () => {
  const base = {
    path: "app/models/base.py",
    content: `
class Base(DeclarativeBase): pass
class BaseModel(Base):
    __abstract__ = True
    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
`,
  };
  const legalType = {
    path: "app/models/legal_type.py",
    content: `
class LegalType(BaseModel):
    __tablename__ = "legal_types"
    code: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    category: Mapped[str] = mapped_column(String(20), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
`,
  };
  const legalDoc = {
    path: "app/models/legal_document.py",
    content: `
class LegalDocument(BaseModel):
    __tablename__ = "legal_documents"
    legal_type_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("legal_types.id"), nullable=False)
    canonical_payload: Mapped[dict | None] = mapped_column(_JSON_OR_JSONB, nullable=True)
`,
  };

  it("inherits BaseModel columns (id + audit), ordered id-first / audit-last", () => {
    const { tables } = extractModelSchema([base, legalType]);
    const t = tables.find((t) => t.name === "legal_types")!;
    expect(t.columns.map((c) => c.name)).toEqual([
      "id", "code", "name", "category", "description", "created_at", "updated_at", "deleted_at",
    ]);
    // Real legal_types has NO is_active (the approved-plan version wrongly added it).
    expect(t.columns.some((c) => c.name === "is_active")).toBe(false);
  });

  it("maps SQLAlchemy types to SQL types and flags the PK", () => {
    const { tables } = extractModelSchema([base, legalType]);
    const cols = Object.fromEntries(tables[0].columns.map((c) => [c.name, c]));
    expect(cols.id).toMatchObject({ type: "uuid", isPk: true });
    expect(cols.code.type).toBe("varchar(40)");
    expect(cols.description).toMatchObject({ type: "text", nullable: true });
    expect(cols.created_at.type).toBe("timestamptz");
  });

  it("derives FK relations and flags JSONB", () => {
    const { tables, relations } = extractModelSchema([base, legalType, legalDoc]);
    expect(relations).toContainEqual({
      fromTable: "legal_documents", fromColumn: "legal_type_id", toTable: "legal_types", toColumn: "id",
    });
    const doc = tables.find((t) => t.name === "legal_documents")!;
    expect(doc.columns.find((c) => c.name === "canonical_payload")?.type).toBe("jsonb");
    expect(doc.columns.find((c) => c.name === "legal_type_id")?.isFk).toBe(true);
  });

  it("catches ALL declared tables (no silent drops)", () => {
    const { tables } = extractModelSchema([base, legalType, legalDoc]);
    expect(tables.map((t) => t.name).sort()).toEqual(["legal_documents", "legal_types"]);
  });
});

describe("extractModelSchema — Prisma", () => {
  const schema = {
    path: "prisma/schema.prisma",
    content: `
model Node {
  id       String  @id @default(cuid())
  title    String
  priority Int     @default(2)
  parentId String?
  parent   Node?   @relation("tree", fields: [parentId], references: [id])
  notes    Note[]
  @@map("nodes")
}
model Note {
  id     String @id
  body   String
}
`,
  };

  it("extracts models (with @@map), scalar columns, PKs, and @relation FKs", () => {
    const { tables, relations } = extractModelSchema([schema]);
    const node = tables.find((t) => t.name === "nodes")!;
    expect(node).toBeDefined();
    expect(node.columns.map((c) => c.name)).toEqual(["id", "title", "priority", "parentId"]);
    expect(node.columns.find((c) => c.name === "id")?.isPk).toBe(true);
    expect(node.columns.find((c) => c.name === "priority")?.type).toBe("integer");
    expect(node.columns.find((c) => c.name === "parentId")?.nullable).toBe(true);
    expect(relations).toContainEqual({ fromTable: "nodes", fromColumn: "parentId", toTable: "Node", toColumn: "id" });
  });

  it("prefers Prisma over SQLAlchemy when both are present", () => {
    const { tables } = extractModelSchema([schema, { path: "x.py", content: 'class X(BaseModel):\n  __tablename__ = "x"\n  a: Mapped[str] = mapped_column(Text)' }]);
    expect(tables.some((t) => t.name === "nodes")).toBe(true);
    expect(tables.some((t) => t.name === "x")).toBe(false);
  });
});
