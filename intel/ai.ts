import Anthropic from "@anthropic-ai/sdk";
import { snapshotSchema, type Snapshot } from "@/lib/ingest";
import type { SourceFile } from "@/intel/extractors/files";
import type { EndpointFact } from "@/intel/extractors/openapi";

// The intelligent layer: Claude reads the source (any language) and emits a
// structured model of the data layer. Forced tool use guarantees the shape.

export const SYSTEM = `You are a code-intelligence extractor for a backend codebase (it may be written in Python, Rust, C#, TypeScript, Go, or any language).

Read the provided source files and produce a structured model of the system's DATA LAYER:
- Database tables, inferred from ORM models (SQLAlchemy, Prisma, GORM, EF Core, Diesel, ...), raw SQL, or migration files. For each table give its real database name and its columns (name, type, isPk, isFk, nullable).
- Foreign-key relationships between tables (from column -> to table.column).
- HTTP API endpoints (method + path) and, for each, which tables it reads and/or writes (access: "read" | "write" | "read-write").

Rules:
- Only include tables, columns, relationships, and endpoints you can actually see in the code. NEVER invent or assume entities that aren't present.
- Use each table's real database name (e.g. the SQLAlchemy __tablename__ or the migration's create_table name).
- If a list of known endpoints (from OpenAPI) is provided, treat it as authoritative for the endpoint set and focus your effort on mapping each one to the tables it touches.
- Group tables/endpoints into a short "domain" when obvious (auth, firms, search, billing, ...).
- Return your result ONLY by calling the emit_graph tool. If the codebase has no data layer yet, call emit_graph with empty arrays.`;

const EMIT_GRAPH_TOOL: Anthropic.Tool = {
  name: "emit_graph",
  description: "Emit the extracted data-layer graph (tables, relations, endpoints).",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      tables: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            domain: { type: ["string", "null"] },
            description: { type: ["string", "null"] },
            columns: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  name: { type: "string" },
                  type: { type: "string" },
                  isPk: { type: "boolean" },
                  isFk: { type: "boolean" },
                  nullable: { type: "boolean" },
                  note: { type: ["string", "null"] },
                },
                required: ["name", "type"],
              },
            },
          },
          required: ["name", "columns"],
        },
      },
      relations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            fromTable: { type: "string" },
            fromColumn: { type: "string" },
            toTable: { type: "string" },
            toColumn: { type: "string" },
            label: { type: ["string", "null"] },
          },
          required: ["fromTable", "fromColumn", "toTable", "toColumn"],
        },
      },
      endpoints: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            method: { type: "string" },
            path: { type: "string" },
            domain: { type: ["string", "null"] },
            description: { type: ["string", "null"] },
            uses: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  table: { type: "string" },
                  access: { type: "string" },
                },
                required: ["table"],
              },
            },
          },
          required: ["method", "path"],
        },
      },
    },
    required: ["tables", "relations", "endpoints"],
  },
};

/** The raw JSON schema for the graph — reused by the claude-cli provider's --json-schema. */
export const GRAPH_SCHEMA = EMIT_GRAPH_TOOL.input_schema;

/** Build the user message — exported for testing. */
export function buildUserPrompt(files: SourceFile[], endpointFacts: EndpointFact[]): string {
  const endpointsText = endpointFacts.length
    ? `Known endpoints (authoritative, from OpenAPI):\n${endpointFacts
        .map((e) => `${e.method} ${e.path}`)
        .join("\n")}`
    : "No OpenAPI endpoints provided — infer endpoints from the route definitions in the code.";
  const filesText = files
    .map((f) => `=== ${f.path} ===\n${f.content}`)
    .join("\n\n");
  return `${endpointsText}\n\nSOURCE FILES (${files.length}):\n\n${filesText}`;
}

/**
 * Returns the AI-extracted snapshot, or null if no API key is configured
 * (graceful degradation — the deterministic extractors still run).
 */
export async function runAi(
  files: SourceFile[],
  endpointFacts: EndpointFact[],
  opts: { model: string; client?: Anthropic },
): Promise<Snapshot | null> {
  if (!opts.client && !process.env.ANTHROPIC_API_KEY) return null;
  const client = opts.client ?? new Anthropic();

  const response = await client.messages.create({
    model: opts.model,
    max_tokens: 16000,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    tools: [EMIT_GRAPH_TOOL],
    tool_choice: { type: "tool", name: "emit_graph" },
    messages: [{ role: "user", content: buildUserPrompt(files, endpointFacts) }],
  });

  const block = response.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") return null;
  return snapshotSchema.parse(block.input);
}
