# Multi-Agent Sales Assistant (Mock)

A **synthetic mock** full-stack web application that recreates a simplified
**MSX-style workspace** for opportunity and milestone management across the
Microsoft sales motion — built for **anyone who works an opportunity on the MSX
platform**: Account Executives (AE), Solution Engineers (SE), Cloud Solution
Architects (CSA), Customer Success Account Managers (CSAM), and the wider account
team.

> ⚠️ **Mock only.** This project does **not** connect to real MSX, real customer
> data, Dataverse, Power Apps, Power Automate, or any production Microsoft system.
> All business data is fictional and imported from the bundled Excel workbook (the
> seed script just loads it).

## Who it's for

Anyone who works an opportunity on the MSX platform — across the full sales and
delivery lifecycle

## The problem I'm solving

### Business problem

Sales opportunities on the MSX platform often span many months and involve the whole
account team — Account Executives (AE), Solution Engineers (SE), Cloud Solution
Architects (CSA), Customer Success Account Managers (CSAM), and other business
stakeholders — each contributing at a different stage of the deal.

Over time, critical information becomes fragmented across emails, meetings, notes,
chats, milestone updates, and individual team members' knowledge. As opportunities
evolve, team members change roles, new people are brought onto accounts,
and ownership is transferred between teams.

As a result:

- Someone joining an account — a new AE, SE, CSA, or CSAM — often does not have a
  complete view of the opportunity history.
- Important design decisions, customer commitments, and technical discussions can be
  difficult to reconstruct months later.
- Knowledge is frequently retained by individuals rather than captured in a
  centralized, accessible way.
- Teams spend significant time searching for context instead of focusing on customer
  engagement and delivery.

**Handoff challenges.** Handoffs are a particularly common pain point — for example when
a deal passes from the pre-sales team (AE and SE) to the delivery and adoption team (CSA
and CSAM), or any time an account changes hands between roles. When a deal transitions
from pre-sales activities into deployment and adoption phases:

- Important customer context may not be transferred completely.
- Historical decisions and rationale can be lost.
- Stakeholders may not know why certain recommendations were made.
- Teams often rely on tribal knowledge and personal memory to understand what happened
  earlier in the engagement.

This creates operational risk, slows onboarding of new team members, and reduces
overall visibility into the health and progress of an opportunity.

**The core problem.** The challenge is not that information does not exist — it is that
information exists in too many places, across too many systems, and is difficult to
transform into a clear, actionable understanding of:

- What has happened?
- What is happening now?
- What risks exist?
- What actions should be taken next?
- Who needs to be involved?

Without a centralized and intelligent way to surface this information, opportunity
management becomes dependent on manual effort, individual experience, and institutional
memory.

> **In one sentence:** Opportunities on the MSX platform generate large amounts of
> valuable information over long sales and delivery cycles, but that knowledge is often
> fragmented across people and systems, creating visibility gaps, inefficient handoffs,
> and loss of critical context when teams change or opportunities transition between
> roles — whether AE, SE, CSA, CSAM, or anyone else on the account.

### Technical problem

The technical problem is not just "build an AI assistant." The real challenge is
building an **agentic system that can reason across business data, call tools, return
structured outputs, and remain governable**.

A single monolithic chatbot would be too broad — it could mix responsibilities, produce
inconsistent outputs, and make it harder to control what each part of the system is
allowed to do. This project instead frames the work as smaller, focused specialist
roles coordinated by an **orchestrator**. This is the **conceptual / target design**;
the shipped chat engine flattens these roles into a single governed agent that exposes
the same tools (the three actual agent implementations and their status are catalogued
in [`HANDOFF.md`](HANDOFF.md)):

- a **milestone specialist** — owns the full milestone lifecycle: reads milestones and
  requests creations, updates, and deletions (all through human approval);
- a **governance specialist** — the read-only authority on the approval queue: lists
  pending approvals and reports approval status/history across every governed action;
- an **opportunity specialist** — reads opportunities and requests creation of
  opportunities and updates to opportunity and deal-team fields (through human approval);
- a **communications specialist** — drafts Outlook email and Teams messages, then
  submits them for human approval; and
- a **dashboard specialist** — answers aggregate metric and pipeline-health questions.

This mirrors how [Microsoft Foundry Agent Service](https://learn.microsoft.com/en-us/azure/foundry/agents/overview)
describes agents: applications that use models, instructions, and tools to reason about
user requests, access external data, call tools, and make multi-step decisions.

### Security problem

Once agents can read context, call tools, produce recommendations, and potentially
trigger actions, they stop looking like chatbots and start looking like **enterprise
actors** — which creates real risk:

- The agent may access more data than it should.
- The agent may expose sensitive data in its output.
- The agent may perform actions without enough human review.
- The agent may use broad permissions instead of least-privilege access.
- The organization may lack visibility into what the agent did, why it did it, and what
  data or tools it used.
- If the agent is not deployed or registered properly, governance tools may not have
  enough visibility into it.

This project treats security as a first-class part of the story: every governed action
is **human-in-the-loop approval-gated** and **audited** (see
[Agent governance flow](#agent-governance-flow)), and the roadmap layers real Microsoft
governance controls on top (see [Security controls](#security-controls)).

## My approach

I created a **synthetic mock full-stack web application** that recreates a simplified
MSX-style workspace for opportunity and milestone management across the MSX sales
motion. The goal of the multi-agent app is to **improve the selling experience for
everyone on the account team** — AE, SE, CSA, CSAM, and beyond — concentrated on the
creation of opportunities, milestones, and milestone status changes.

## What you can do in the app

The app is a workspace for sales opportunities and their milestones, with an AI
assistant alongside it. Here is everything it offers, in plain language, screen by screen.

**Sign in.** You sign in with your Microsoft work account. (For local development, sign-in
can be switched off and the app just opens.) A banner across the top always reminds you
that every sales record is made-up practice data.

**Dashboard.** The landing page shows the health of your pipeline at a glance: how many
opportunities and milestones you have, the total pipeline value, and how many milestones
are at risk, blocked, or waiting for approval. Below the numbers are charts — milestones
by status, how much work is complete, milestones by risk, opportunities by solution area,
and pipeline value by sales stage. Click any slice or bar to filter the whole page to that
data, stack several filters together, and clear them with one button.

**Opportunities.** A searchable, filterable list of every deal. Search by name, account,
or ID, and narrow the list by account, solution area, sales stage, competitor,
status, and more. Open one to see its full picture: customer and deal details, its
milestones, the people on the deal team, notes, and AI suggestions. From here you can
create a new opportunity, edit it, add milestones or team members, or delete it
(optionally removing everything attached to it).

**Milestones.** The list of the individual pieces of work inside each deal — searchable
and filterable by status. Open one to see all its details, including any blocker (who is
blocked, since when, and when it should clear) and its risk. You can create and edit
milestones and move one through its stages (On Track, At Risk, Blocked, Completed, and so
on) with a row of buttons. Every status change is written to a history log on the
milestone so you can see what changed, when, by whom, and why.

**Losing a deal to a competitor.** If you mark a milestone "Lost to competitor," the app
asks you to name the competitor and then offers to email the manager a short summary of
what happened. It looks the manager up automatically from your Microsoft directory, and
nothing is sent until you acknowledge and confirm.

**Approvals — the human stays in control.** This is the heart of the app. The AI
assistant never changes data or sends a message on its own; anything it wants to do shows
up here as a request for you to review. Expand a request to see exactly what it would
create or change, then **approve** it (which actually carries it out), **reject** it, or
send it back for **changes**. Some approvals ask for one more confirmation first — for
example, before emailing a manager or posting to Teams.

**Tell the team about a new opportunity.** When a new opportunity is created, the app can
post a short "here's a new deal" message to your teammates in Microsoft Teams. You are
always asked first, and you can create the opportunity without posting if you prefer (more
detail under [Notify the team on a new opportunity](#notify-the-team-on-a-new-opportunity-teams)).

**Activity log.** A complete, timestamped record of everything the assistant and the app
did — every read, every change, every message sent — including, where relevant, the
conversation that led to it. Click any entry to see the details.

**The AI assistant.** A chat panel is available on every screen. Ask it things in plain
language like "show milestones at risk," "summarize my open opportunities," or "what needs
approval right now?" It answers as you type (and you can stop it mid-answer), keeps a
history of your past chats, and lets you copy any reply. Behind the scenes it can read the
Outlook mail and Teams chats relevant to your question (only with your sign-in, and only
to help answer you), check whether a deal is ready to hand off to the delivery team, check
funding readiness, and draft new records or messages. As always, anything that would
change data or send a message is routed to the **Approvals** screen for a person to
approve first.

## Security controls

Real Microsoft governance layered on top of the app-level approval + audit gate.
See **[docs/security.md](docs/security.md)** for the enable + test runbook.

- **Microsoft Entra ID** — agents authenticate as governed identities (managed
  identity / workload-identity federation), so **conditional access** (e.g.
  geographic and IP-address restrictions) and least-privilege apply.
- **Microsoft Defender for Cloud → Defender XDR** — threat protection for AI
  services, enabled via `ENABLE_DEFENDER_FOR_AI` (Bicep) or
  `az security pricing create -n AI --tier Standard`. Raises jailbreak /
  data-leakage / credential-theft alerts on the AIServices account, so it covers
  **both** the hosted agent and the direct engine. The direct engine also stamps
  each model call with the signed-in user's `user_security_context` so alerts are
  attributable to the real seller.
- **Microsoft Purview (DLP for AI)** — the Defender "data security for AI
  interactions" bridge shares **model-level** prompts/responses with Purview, so DLP
  for PII/PCI applies to the **direct** engine *and* to the model calls the Foundry
  agent makes under the hood. Needs a Purview license. _Note:_ Purview does not yet
  capture the **agent as its own entity** (identity, tool calls, orchestration), and
  PII/PCI matches surface in the **Purview portal** (DSPM for AI / DLP alerts), not in
  Defender for Cloud. See [docs/security.md](docs/security.md).


## The MSX model

- **Opportunities** are the parent business records.
- **Opportunity Milestones** are the central MSX-like working records.
- **Agents** can read context, create recommendations, submit approval requests, and
  create new mock milestone records **only after approval**.
- **Every agent action is logged** for auditability and governance.

## Data model — 11 tables 

Risk, blocker, competitor, and partner data is embedded directly into `Opportunity`
/ `OpportunityMilestone` to keep the POC manageable. 

1. Opportunity
2. Opportunity Milestone
3. Milestone Status History
4. AI Milestone Recommendation
5. Approval Request
6. Collaboration Note
7. Deal Team Member
8. Agent Notification
9. Agent Run Log
10. Agent Action Audit Log
11. Dashboard Metric Snapshot

## Tech stack

React + TypeScript · Node.js + Express + TypeScript · **PostgreSQL (Azure Database
for PostgreSQL, cloud)** · Prisma · Zod · REST API + OpenAPI.

## Project structure

```
apps/web           React frontend
apps/api           Express backend (layered: routes → controllers → services)
apps/foundry-agent Microsoft Foundry hosted agent (default chat engine)
packages/shared    shared TypeScript types + allowed-value unions
prisma/            schema.prisma + seed.ts (calls the workbook importer)
scripts/           parseWorkbook.ts + workbookMappings.ts (Excel → Prisma import)
data/              the Excel workbook (single source of truth)
openapi/           msx-milestone-assistant.openapi.yaml
docs/              architecture.md, api-test.md, demo-script.md, security.md
redteam/           adversarial testing that exercises the Defender/Purview controls
```

## Getting started

Requires Node.js 18+ and a **PostgreSQL** database (see
[Database — Azure PostgreSQL (cloud)](#database--azure-postgresql-cloud) below). Copy
`.env.example` → `.env` and set `DATABASE_URL` to your connection string **before**
running setup.

```bash
# 1. Install deps, generate the Prisma client, push the schema to your
#    PostgreSQL database, and load the mock data from the workbook
npm run setup

# 2. Run the API (http://localhost:4000) and web app (http://localhost:5173)
npm run dev
```

Then open **http://localhost:5173**.

### Useful scripts

| Script                     | Description                                            |
| -------------------------- | ------------------------------------------------------ |
| `npm run setup`            | install + prisma generate + db push + import-workbook  |
| `npm run dev`              | run API + web concurrently                             |
| `npm run dev:api`          | run only the API                                       |
| `npm run dev:web`          | run only the web app                                   |
| `npm run import-workbook`  | reset tables and reload from the Excel workbook        |
| `npm run db:seed`          | seed the DB (runs the workbook import)                 |
| `npm run db:reset`         | force-reset the schema then reload the workbook        |
| `npm run prisma:generate`  | regenerate the Prisma client after schema changes      |
| `npm run db:push`          | push the Prisma schema to the PostgreSQL database      |
| `npm run build`            | build shared, api, and web                             |

## Database — Azure PostgreSQL (cloud)

> **Deviation from the original plan.** This project started on a local **SQLite**
> file (`prisma/dev.db`). It now runs against a **cloud PostgreSQL** database —
> **Azure Database for PostgreSQL Flexible Server** — so the API, the hosted Foundry
> agent, and multiple machines can all share one live dataset instead of a per-laptop
> file. The mock-only rule is unchanged: just the 11 synthetic tables live there, and
> no real MSX / customer data is ever stored.

### What changed

| Before (SQLite)                | After (Azure PostgreSQL)                                |
| ------------------------------ | ------------------------------------------------------- |
| `provider = "sqlite"`          | `provider = "postgresql"` in `prisma/schema.prisma`     |
| `DATABASE_URL="file:./dev.db"` | `postgresql://…@<server>.postgres.database.azure.com…`  |
| Local file, single machine     | Managed cloud server, shared across clients             |
| No network / TLS               | `sslmode=require` (TLS) enforced                         |

The Prisma models, the 11-table rule, the workbook import pipeline, and the REST API
are all unchanged — only the datasource moved.

### Connection string

`DATABASE_URL` lives in `.env`, which is **gitignored and never committed**. Format:

```
postgresql://<admin-user>:<url-encoded-password>@<your-server>.postgres.database.azure.com:5432/<database>?sslmode=require
```

- **TLS is required** (`sslmode=require`) — Azure rejects non-TLS connections.
- **URL-encode** special characters in the password (e.g. `@` → `%40`).
- The password is supplied locally at runtime and is never committed; `.env.example`
  ships only a safe placeholder.

### Point it at your own database

1. Create an **Azure Database for PostgreSQL Flexible Server** and an empty database.
2. Allow your client IP in the server firewall (or "Allow public access from Azure
   services" for hosted components).
3. Copy `.env.example` → `.env` and set `DATABASE_URL` to your connection string.
4. Create the schema and load the mock data:

   ```bash
   npm run prisma:generate   # regenerate the client for the postgres provider
   npm run db:push           # create all 11 tables in the cloud database
   npm run import-workbook   # load the synthetic records from the Excel workbook
   ```

`npm run setup` runs the generate → push → import steps in one go once `DATABASE_URL`
is set. Use `npm run db:reset` to force-reset the cloud schema and reload the workbook.

## Data import pipeline (workbook is the single source of truth)

Records are **not** hardcoded. They are imported from the Excel workbook:

```
Excel Workbook  →  XLSX Parser  →  JSON Objects  →  Prisma (connect)  →  PostgreSQL
 data/*.xlsx        scripts/          per-row map       @unique keys      (Azure, cloud)
                 parseWorkbook.ts   workbookMappings.ts
```

- **Workbook:** `data/MSX_Mirror_Necessary_Tables_Import_10_More_Entries.xlsx`
  (one worksheet per table).
- **Mappings:** `scripts/workbookMappings.ts` maps every Excel column to a Prisma
  field, with type hints (`string | int | float | bool | date | datetime`).
- **Parser:** `scripts/parseWorkbook.ts` reads each sheet, converts values
  (Excel serial dates, `Yes/No` → boolean, blank/`---` → null), resolves lookups
  with Prisma `connect` against `@unique` business keys, and inserts in strict
  dependency order.
- **Seed:** `prisma/seed.ts` simply calls the importer.

Run it:

```bash
npm run import-workbook   # reset all tables, then reload from the workbook
```

Expected output:

```
====================================
Import Complete
====================================
Opportunities: 15
Milestones: 15
... (15 per table)
```

## Agent governance flow

The whole point of the POC: agents are useful but **gated**.

1. Agent **reads context** → audited as `Read`.
2. Agent recommendations are surfaced from the workbook (`AI Milestone Recommendation`).
3. Approval requests carry an `approvalStatus` (`Pending` / `Approved` / `Rejected`).
4. Agent tries to create a milestone **before approval** → **403 Denied** (audited).
5. A **human approves** on the Approvals page.
6. Agent **fulfills** the approved request → milestone created, audited as
   `CreateMilestone`.

## Notify the team on a new opportunity (Teams)

To boost visibility, creating an opportunity can broadcast the full opportunity
details to a teammate over Microsoft Teams. It is **consent-gated on both paths** so
a real message never goes out without a human deciding:

- **Human creates it** — after clicking **Create**, a popup asks whether to send the
  visibility message. Agreeing calls `POST /api/opportunities/:id/announce` and the
  Teams DM is sent as the signed-in user. Declining just closes the form.
- **An agent creates it** — whether the in-app assistant or the Foundry hosted
  agent, the agent never sends. A **Pending** `ApprovalRequest` carrying a deferred
  `NotifyTeams` action is queued; the same consent popup appears when a human
  approves it on the **Approvals** page, and only then is it delivered.
## API

REST API served at `http://localhost:4000/api`. Full contract in
[`openapi/msx-milestone-assistant.openapi.yaml`](openapi/msx-milestone-assistant.openapi.yaml).

## Documentation

- [`HANDOFF.md`](HANDOFF.md) — **start here to take over the project** — handoff +
  deployment guide covering keeping it live (operate & own) and archiving it (rebuild
  from scratch + teardown)
- [`docs/architecture.md`](docs/architecture.md) — design, data model + diagrams
- [`docs/api-test.md`](docs/api-test.md) — endpoint-by-endpoint tests
- [`docs/security.md`](docs/security.md) — Defender for AI + Purview DLP enable/test runbook
- [`redteam/README.md`](redteam/README.md) — adversarial testing that makes those
  security detections fire on demand
