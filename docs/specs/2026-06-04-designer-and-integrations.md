# DB Designer + Integrations control panel (spec)

Two additions to the Juriscan control app. Both reuse one new piece.

## Shared: `lib/ai-structured.ts` — `structured({system, prompt, schema, model, provider})`
Server-side structured-output call that dispatches to the **Claude Code subscription**
(`claude -p --output-format json --json-schema`) or the **Anthropic API** (forced tool
use), using the model from the UI dropdown (`AppSetting`). Returns the parsed object or null.
Reuses `resolveProvider` (intel) + an exported `runClaudeCli`.

## 1. DB Designer — draft layer on `/db`
- Models `DraftTable` / `DraftColumn` / `DraftRelation` (isolated from real `DbTable*`, so
  drafts don't collide on name and are clearable; they persist so they survive the live SSE).
- `POST /api/design {description}` → `structured()` with a design system + the design JSON
  schema → replace Draft* → return. `DELETE /api/design` clears.
- `/db` toolbar: **Desenhar** panel (textarea + Gerar), **Copiar ▾** (Claude Code prompt /
  DBML / SQL DDL — pure formatters in `lib/prompt-format.ts`), **Limpar**.
- `/db` page loads drafts; `DbMapClient` renders DRAFT table nodes (dashed/blue, "rascunho")
  + draft FK edges, alongside manual/live.

## 2. Integrations — `/settings`
- `Integration` model (`key` unique, `name`, `category`, `enabled`, `config` JSON). Seed
  `sentry`, `email`, `ai-provider`. The intel model/provider stays in `AppSetting`.
- `/settings` page (nav "Config"): a card per integration — enable toggle, config inputs
  (from a client-safe `INTEGRATION_SPECS` field list), **Copiar setup** (a paste-ready setup
  prompt per integration). Plus a "Banco / IA" card reading `AppSetting` (model + provider).
- `GET /api/integrations`, `POST /api/integrations/[key]` (validated).

## Testing
Pure formatters (Claude/DBML/SQL) + setup-prompt builder (unit); design generate/persist/clear
+ integration get/set (test DB); `structured()` envelope parse. Live generation verified via
the subscription against a sample description.
