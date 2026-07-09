# Demo Script — MSX Milestone Assistant (Mock)

A ~5 minute walkthrough for showing the proof of concept. Everything is synthetic;
there is no connection to real MSX, Dataverse, or customer data.

## Setup (once)

```bash
npm run setup   # install, generate Prisma client, create SQLite DB, seed data
npm run dev     # starts API (http://localhost:4000) + web (http://localhost:5173)
```

Open http://localhost:5173.

## Talk track

### 1. Framing (30s)
"Because of DLP restrictions I couldn't use Power Apps and Dataverse, so I rebuilt
the MSX-style experience as a full-stack web app: React + Express + SQLite + Prisma.
It keeps the same MSX mental model — opportunities as parent records and
opportunity milestones as the central working records — but with only 11 tables so
the POC stays manageable."

### 2. Dashboard (30s)
- Point out live metrics: open opportunities, pipeline value, milestones at risk,
  blocked milestones, and **pending approvals** (the governance signal).

### 3. Opportunities → detail (60s)
- Open **Contoso Cloud Modernization**.
- Show that partner, competitor, and risk info live **directly on the opportunity**
  (no separate Account/Partner/Competitor tables).
- Scroll to milestones, deal team, recommendations, and notes.

### 4. Milestone detail + status history (45s)
- Open a milestone (e.g. Architecture Review).
- Note the embedded **blocker** and **risk** fields (no separate blocker/risk tables).
- Change status; show the new row appear in **Status History** for auditability.

### 5. The agent governance story (2 min) — the centerpiece
Use `docs/api-test.md` in a terminal, or narrate against the seeded data:
1. Agent **reads context** (audited).
2. Agent **creates a recommendation** ("Add a Deployment Readiness milestone").
3. Agent **submits an approval request** — status Pending.
4. Agent tries to **create the milestone before approval → BLOCKED (403)**, and the
   attempt is recorded in the audit log as `Denied`.
5. On the **Approvals** page, a human clicks **Approve**.
6. Click **Create milestone** — now the agent path succeeds and a real milestone
   record is created.
7. Open **Agent Audit Log** and show the full trail:
   `ReadContext → CreateRecommendation → SubmitApproval → Denied → CreateMilestone`.

### 6. Close (15s)
"So agents can read, recommend, and request — but a human stays in the loop for any
write to the business records, and every single agent action is logged for
governance. That is the core pattern I wanted to prove out."

## Reset between demos

```bash
npm run db:reset
```
