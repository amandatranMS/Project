# Copilot instructions — MSX Milestone Assistant

## What this project is
A **synthetic mock** full-stack web app that recreates a simplified **MSX-style
workspace** for Solution Engineering opportunity + milestone management. It replaces
an original Power Apps / Dataverse plan (blocked by DLP) with a self-contained
React + Express + SQLite + Prisma app.

## Hard rules — do not violate
- **Never** connect to or reference real MSX, real customer data, Dataverse, Power
  Apps, or Power Automate. The business records (opportunities, milestones, etc.)
  stay synthetic and mock-only.
- **Authorized real integration (Option B):** Microsoft **Entra ID sign-in** (MSAL)
  and **Microsoft Graph** (Teams, Outlook, user hierarchy) ARE allowed against the
  team's Foundry tenant. Identity and Graph are real; the MSX business data remains
  mock. Real Graph reads must be audited via `recordAgentAction` and gated behind an
  authenticated user. Do not persist real Graph data into the 11 mock tables.

- **Exactly 11 tables.** Do not add tables. Never introduce `Account`, `Partner`,
  `Competitor`, `Milestone Blocker`, or `Milestone Risk Assessment`. Risk, blocker,
  competitor, and partner data is embedded directly on `Opportunity` /
  `OpportunityMilestone`.
- The 11 tables are: Opportunity, OpportunityMilestone, MilestoneStatusHistory,
  AiMilestoneRecommendation, ApprovalRequest, CollaborationNote, DealTeamMember,
  AgentNotification, AgentRunLog, AgentActionAuditLog, DashboardMetricSnapshot.

## Data — the Excel workbook is the single source of truth
- Records are imported from `data/MSX_Mirror_Necessary_Tables_Import_10_More_Entries.xlsx`,
  NOT hardcoded. `prisma/seed.ts` just calls the importer.
- Pipeline: Excel → `scripts/parseWorkbook.ts` (xlsx) → JSON → Prisma `connect` → SQLite.
- Column→field maps live in `scripts/workbookMappings.ts`. The schema mirrors the
  workbook columns; each table has a `@unique` business id (opportunityBusinessId,
  milestoneBusinessId, recommendationBusinessId, etc.) and children resolve lookups
  with Prisma `connect` (e.g. `opportunity: { connect: { opportunityName } }`).
- Load order: Opportunity → Milestone → StatusHistory → Recommendation → Approval →
  Note → DealTeam → Notification → RunLog → Audit → Snapshot.
- Blank/"---" → null; Yes/No → boolean; dates accept ISO, "YYYY-MM-DD HH:mm", or Excel serial.

## Agent governance (must be preserved)
- Agents may read context (`GET /api/opportunities/:id/context`), create
  recommendations, and submit approval requests.
- **Every agent action that changes data or sends a message is approval-gated.**
  The agent never mutates/sends directly — it submits an `ApprovalRequest` carrying
  a deferred `action` (`CreateOpportunity`, `SendOutlookMail`, `NotifyTeams`,
  `UpdateMilestone`, `UpdateOpportunity`, `UpdateDealTeamMember`, `DeleteMilestone`;
  milestone *creation* still goes via recommendation). The action
  is stored on the existing `ApprovalRequest.errorMessage` column, tagged
  `MSX_ACTION::` + JSON (no new columns/tables).
- A real change happens **only** when a human decides an approval request via
  `PATCH /api/approval-requests/:id/approve`. Approving either executes the deferred
  action (create/send/update/delete, audited by its kind) or, for a recommendation-backed
  request, performs the mock milestone writeback and audits it as `CreateMilestone`.
  `reject` / `needs-changes` never execute anything (`needs-changes` preserves the
  encoded action for a later approval).
- **Every** governed action is written to `AgentActionAuditLog` via
  `recordAgentAction` (`apps/api/src/lib/audit.ts`).

## Backend architecture (layered)
- Entry: `apps/api/src/server.ts` → `app.ts` (registers `/api` routes + error handler).
- Layers: `routes/*.routes.ts` → `controllers/*.controller.ts` → `services/*.service.ts`.
- Shared helpers in `apps/api/src/lib/`: `prisma`, `responses` (sendOk/asyncHandler),
  `httpError`, `errorHandler`, `audit`, `ids` (genId), `connect` (Prisma connect helpers).
- Zod schemas live in `apps/api/src/validators/schemas.ts`.
- **Every response uses the envelope**: success `{ "success": true, "data": ... }`,
  error `{ "success": false, "error": "plain message" }`. The web client unwraps `.data`.

## Tech + conventions
- Frontend: React + TypeScript (Vite) in `apps/web`.
- Backend: Node + Express + TypeScript in `apps/api`, ESM (`"type": "module"`),
  NodeNext resolution — local imports use `.js` extensions.
- ORM: Prisma, schema at `prisma/schema.prisma`, SQLite (`prisma/dev.db`).
- Validation: Zod in `apps/api/src/validators/schemas.ts`. SQLite has no enums, so
  status/type fields are Strings; the controlled choice lists live in
  `packages/shared` and are enforced by Zod `z.enum`.
- Keep the REST API and `openapi/msx-milestone-assistant.openapi.yaml` in sync.

## Commands
- `npm run setup` — install + prisma generate + db push + import-workbook.
- `npm run dev` — API on :4000 and web on :5173 concurrently.
- `npm run import-workbook` — reset tables and reload from the Excel workbook.
- `npm run db:seed` / `npm run seed` — same as import (workbook-driven).
- `npm run db:reset` — force-reset the schema then reload the workbook.
- After changing `schema.prisma`, run `npm run prisma:generate` and `npm run db:push`.

## When adding features
- Add a Zod schema in `validators/schemas.ts`, then a `service`, `controller`, and
  `*.routes.ts`, and register it in `apps/api/src/routes/index.ts`. Return data via
  `sendOk` so the response envelope stays consistent. Then update the OpenAPI file
  and (if user-facing) the web UI.
- Preserve the mock banner and the human-in-the-loop approval gate.
