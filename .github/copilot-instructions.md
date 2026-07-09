# Copilot instructions — MSX Milestone Assistant

## What this project is
A **synthetic mock** full-stack web app that recreates a simplified **MSX-style
workspace** for Solution Engineering opportunity + milestone management. It replaces
an original Power Apps / Dataverse plan (blocked by DLP) with a self-contained
React + Express + SQLite + Prisma app.

## Hard rules — do not violate
- **Never** connect to or reference real MSX, real customer data, Dataverse, Power
  Apps, Power Automate, or any production Microsoft system. This is a mock only.
- **Exactly 11 tables.** Do not add tables. Never introduce `Account`, `Partner`,
  `Competitor`, `Milestone Blocker`, or `Milestone Risk Assessment`. Risk, blocker,
  competitor, and partner data is embedded directly on `Opportunity` /
  `OpportunityMilestone`.
- The 11 tables are: Opportunity, OpportunityMilestone, MilestoneStatusHistory,
  AiMilestoneRecommendation, ApprovalRequest, CollaborationNote, DealTeamMember,
  AgentNotification, AgentRunLog, AgentActionAuditLog, DashboardMetricSnapshot.

## Agent governance (must be preserved)
- Agents may read context, create recommendations, and submit approval requests.
- Agents may create a real milestone **only** by fulfilling an **Approved**
  approval request (`POST /api/agent/approvals/:id/fulfill`). Fulfilling a
  non-approved request must return 403 and be audited as `Denied`.
- **Every** agent action must be written to `AgentActionAuditLog` via
  `recordAgentAction` (`apps/api/src/lib/audit.ts`).

## Tech + conventions
- Frontend: React + TypeScript (Vite) in `apps/web`.
- Backend: Node + Express + TypeScript in `apps/api`, ESM (`"type": "module"`),
  NodeNext resolution — local imports use `.js` extensions.
- ORM: Prisma, schema at `prisma/schema.prisma`, SQLite (`prisma/dev.db`).
- Validation: Zod in `apps/api/src/schemas.ts`. SQLite has no enums, so status/type
  fields are Strings; allowed values live in `packages/shared` and are enforced by Zod.
- Keep the REST API and `openapi/msx-milestone-assistant.openapi.yaml` in sync.

## Commands
- `npm run setup` — install + prisma generate + db push + seed.
- `npm run dev` — API on :4000 and web on :5173 concurrently.
- `npm run db:reset` — reset and reseed the SQLite database.
- After changing `schema.prisma`, run `npm run prisma:generate` and `npm run db:push`.

## When adding features
- Add a Zod schema, a route under `apps/api/src/routes`, wire it in
  `apps/api/src/app.ts`, then update the OpenAPI file and (if user-facing) the web UI.
- Preserve the mock banner and the human-in-the-loop approval gate.
