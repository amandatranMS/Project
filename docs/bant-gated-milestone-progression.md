# Feature Design: BANT-Gated Milestone Progression + Deadline Alerts

> **Status:** Proposed (not yet built) · **Branch:** `merve-features` · **Last refined:** 2026-08-13
>
> **How to resume:** This is a grounded design, not code. Nothing here is implemented yet.
> Every code reference below was verified against the current branch (see
> [§12 Verified code anchors](#12-verified-code-anchors)). Recommended first build step:
> **P1 — the hard gate** (§11), so the block is demoable before layering on the deadline sweep.

---

## 1. Summary (TL;DR)

Block a milestone from **committing or completing** until **B**udget / **A**uthority / **N**eed /
**T**imeline are captured, and make sure nobody is surprised by a deadline: proactively warn as the
target date (`estDate`) approaches and escalate when it passes.

The important realization: **BANT is already ~80% built** in this codebase as a *read-only score*.
The gap Merve is describing is **enforcement at progression** — plus tying that enforcement to the
**deadline lifecycle** so "past due" never means "silently committed with gaps."

Chosen posture (per the last decision): **hard gate** — block the transition until BANT is complete
(no soft override), unified with approaching/overdue deadline notifications.

---

## 2. Problem & context

**Origin (Merve's ask):** qualification information is not documented consistently. Before a milestone
progresses, the team should know:

- **Business need** — why the customer is doing this
- **Authority / ownership** — who owns it
- **Budget** — is there money behind it
- **Timeline** — when it needs to land

**Expected value:** the handoff to CSAs, customer success managers, and delivery teams carries enough
business context to execute — no "blind handoffs."

**Committed action:** a feature that (a) validates required qualification data, (b) identifies what's
missing, (c) warns the user before commitment, and (d) folds BANT-style checks into milestone
readiness.

---

## 3. Key insight — BANT is already ~80% built, it just doesn't *enforce*

The four BANT checks already exist as **deterministic, read-only scoring**, mapped to fields that
already exist (no new tables/columns):

| BANT | Existing field(s) checked | Where |
| --- | --- | --- |
| **Budget** | `Opportunity.estimatedRevenue` > 0 OR `Milestone.fitCharge` > 0 | `lib/handoffReadiness.ts`, `lib/milestoneHandoff.ts` |
| **Authority** | `Opportunity.aeOwner` / a `DealTeamMember` / `Milestone.owner` | same |
| **Need** | `Opportunity.businessProblem` OR `Milestone.workload` | same |
| **Timeline** | `Opportunity.closeDate` OR `Milestone.estDate` | same |

`scoreMilestoneHandoff()` (`lib/milestoneHandoff.ts`) even emits a paste-ready **"CSA Handoff Notes"**
scaffold containing a `BANT:` block, exposed at `GET /api/milestones/:id/handoff-readiness` and via the
agent tool `get_milestone_handoff_readiness`.

**But it's advisory only — a pure scoring function that never throws, so it never blocks a save.**
That is exactly the gap: *validate + identify + warn* exist; **enforce before progression** does not.

---

## 4. Goals & non-goals

**In scope**
- Hard block on progression (commit/complete) until BANT is captured.
- A live BANT checklist the form can render and refresh.
- Approaching / overdue deadline notifications + escalation.

**Non-goals**
- **No new tables/columns** — honors the 11-table rule; BANT reads existing fields, alerts reuse
  `AgentNotification`.
- No gate on **terminal** transitions — `Cancelled`, `Lost To Competitor`, `Hygiene/Duplicate` never
  need BANT.
- No agent self-writes — agents stay approval-gated.
- Status/commitment values stay free strings that mirror the workbook; the gate is **service logic**,
  not a DB constraint. Mock banner preserved.

---

## 5. Design principle — one choke point

Every progression path funnels through **`apps/api/src/services/milestones.service.ts`**:

- the **UI save**,
- the **agent-approved write** (the deferred `UpdateMilestone` executed when a human approves an
  `ApprovalRequest`), and
- the **time-sweep auto-commit** (`milestoneCommitment.service.ts`).

So the gate lives there **once** and every path inherits it.

**We already have the precedent.** `milestones.service.ts` already hard-blocks a transition today:
`assertCompetitorForLostStatus()` (`lib/lostToCompetitor.ts`) throws if you set status
`Lost To Competitor` without a competitor, and it's called from both `create()` and `update()`. The
BANT gate is the **same pattern, generalized**.

```mermaid
flowchart TD
    UI[UI save / milestone form] --> SVC
    AG[Agent proposal -> ApprovalRequest -> human approve] --> SVC
    SWEEP[Deadline sweep auto-commit] --> SVC
    SVC[milestones.service.ts create/update] --> GATE{BANT complete?}
    GATE -- yes --> WRITE[Apply write + audit]
    GATE -- no --> BLOCK[HttpError 422 + missing BANT details]
```

---

## 6. Part A — BANT completion gate (hard block)

**Trigger — what "progression" means.** The gate fires only when a write results in:

- `customerCommitment: Uncommitted -> Committed`, **or**
- `milestoneStatus -> Completed`.

All other edits (and terminal statuses) pass untouched — reuse the existing "touched-or-existing"
field resolution already in `update()`.

**BANT definition — reuse the existing field mapping** (no new columns):

| Check | Passes when |
| --- | --- |
| **Budget** | `Milestone.fitCharge` > 0 OR `Opportunity.estimatedRevenue` > 0 |
| **Authority** | `Milestone.owner` set OR a `DealTeamMember` exists |
| **Need** | `Milestone.workload` set OR `Opportunity.businessProblem` set |
| **Timeline** | `Milestone.estDate` set OR `Opportunity.closeDate` set |

**Enforcement points**
1. **New pure module** `lib/bantReadiness.ts` → `scoreBant(ctx)` returning
   `{ complete, missing[], present[] }`. Lift the four checks out of `milestoneHandoff.ts` so both
   share one source of truth. Deterministic, no writes — mirrors `handoffReadiness.ts`.
2. **New guard** `lib/bantGate.ts` → `assertBantReady(resultingStatus, resultingCommitment, bant)`
   that throws `HttpError(422, …)` — modeled 1:1 on `assertCompetitorForLostStatus`.
3. **Wire into** `milestones.service.ts` `create()` and `update()`, right beside the existing
   competitor assertion.
4. The 422 error carries structured `details.missing[]` (each: `item`, `whatsMissing`, `howToFix`,
   reusing the shape `handoffReadiness.ts` already returns) so the UI renders the checklist **without a
   second call**.

**Agent / approval path.** Because the same service method executes the deferred `UpdateMilestone`
when a human approves an `ApprovalRequest`, an approved-but-BANT-incomplete action is **still blocked**.
Additionally, surface BANT status **on the approval card** so the approver sees the gaps *before*
deciding. The agent never commits directly — unchanged.

**API surface.** Add `GET /api/milestones/:id/bant-readiness` (mirrors the existing `handoff-readiness`
route) so the form can render/refresh the checklist live and pre-flight the Save button.

---

## 7. Part B — Deadline lifecycle notifications

**Data — reuse `AgentNotification`** (table #8), no new columns. Verified fields:
`severity`, `notifyRole`, `message`, `status`, `reasonCode`, `relatedMilestoneId`, `opportunityId`,
`createdDate`.

**Thresholds (env-configurable, deterministic):**

| Window (vs `estDate`) | Severity | reasonCode |
| --- | --- | --- |
| ≤ 7 days | `Warning` | `DEADLINE_APPROACHING` |
| ≤ 2 days / due today | `Critical` | `DEADLINE_IMMINENT` |
| past due | `Critical` | `DEADLINE_PASSED` |
| past due **and** BANT incomplete | `Critical` | `BANT_BLOCKED_COMMIT` |

**Engine — extend the sweep that already exists.** `startCommitmentSweep()` in
`milestoneCommitment.service.ts` already runs at startup + every 60s (unref'd). Broaden it into a
**milestone health sweep**: for each non-terminal milestone with an `estDate`, emit/resolve the
notification for its bucket and handle the overdue case (Part C).

**Dedup & resolution (no new table).** Before inserting, check for an open `AgentNotification` with the
same `relatedMilestoneId` + `reasonCode` in the current day-bucket; drive `status`
(`New -> Acknowledged -> Resolved`) to avoid spam. **Auto-resolve** once the milestone commits or BANT
is completed.

**Escalation.** Reuse the Graph manager-email path in `managerNotifications.service.ts` for
`Critical`/overdue. Every emit is audited via `recordAgentAction` (system actor), exactly like the
existing auto-commit flip.

---

## 8. Part C — The critical interaction (where A + B unify)

Today `milestoneCommitment.service.ts` **auto-commits** `Uncommitted -> Committed` the moment `estDate`
passes (a system sweep, deliberately not approval-gated). With a hard BANT gate, that path would
**silently bypass qualification**. New rule:

```mermaid
flowchart TD
    A[Deadline sweep: past estDate, still Uncommitted, non-terminal] --> B{BANT complete?}
    B -- yes --> C[Auto-commit Uncommitted -> Committed + audit + auto-resolve alerts]
    B -- no --> D[Do NOT commit]
    D --> E[Raise Critical BANT_BLOCKED_COMMIT notification + manager escalation]
    E --> F[Milestone stays Uncommitted and visibly blocked]
```

So the deadline sweep **becomes the notification engine**, and the gate makes "past-due" mean
**"escalate + block,"** never "silently commit with gaps."

> Note: because the sweep only acts on milestones that already have a *past* `estDate`, the **Timeline**
> check is always satisfied on this path — the realistic gaps here are Budget / Authority / Need.

---

## 9. UX walkthrough (state by state)

1. **Editing** — the milestone form shows a live `B · A · N · T` chip (green when present, amber with
   the missing letters) + a deadline pill; each amber letter expands to `whatsMissing` / `howToFix`.
2. **Approaching (≤ 7d)** — amber "Due in 3d" pill + a `Warning` in the notification bell; the SE is
   nudged to finish BANT early.
3. **Commit / Complete with gaps** — **blocked**: a modal lists the missing BANT items with fixes;
   **Add details now** prefills the comments block from the `suggestedDescription` scaffold. No
   override (hard gate).
4. **Overdue + incomplete** — red "Overdue — commit blocked" pill; `Critical` notification + manager
   email; surfaces in a **Needs Qualification** filter / dashboard tile.
5. **BANT completed** — the gate opens; the SE commits/completes, or the next sweep auto-commits a
   past-due one and **auto-resolves** its alerts.

---

## 10. Governance & guardrails

- **11 tables intact** — BANT reads existing fields; alerts use `AgentNotification`; every system
  action is audited.
- **Single service choke point** ⇒ UI, agent-approval, and sweep all enforce identically.
- Agent still **cannot self-commit**; the approval card shows BANT + deadline status.
- Statuses stay free strings (mirror the workbook); the gate is service logic, **not** a DB constraint.
- Mock banner preserved; no real MSX/Dataverse data involved.

### Edge cases
- **No `estDate`** → Timeline fails (so it can't commit) and it's excluded from deadline alerts until a
  date is set.
- **Terminal statuses** bypass the gate (you can always Cancel / mark Lost).
- **Backdated `estDate` created as Committed** → the gate runs on `create()` too.
- **Notification storms** → controlled by day-bucket dedup + auto-resolve.

---

## 11. Phased rollout / files touched

| Phase | Scope | Files |
| --- | --- | --- |
| **P1 — Gate** | Hard block on progression (demoable) | new `lib/bantReadiness.ts`, new `lib/bantGate.ts`, wire into `services/milestones.service.ts`, extend `updateMilestoneSchema` in `validators/schemas.ts`, add `bant-readiness` route + controller, sync OpenAPI |
| **P2 — Alerts** | Deadline sweep + notifications | extend `services/milestoneCommitment.service.ts` sweep, `AgentNotification` write/resolution, manager escalation via `managerNotifications.service.ts` |
| **P3 — UI** | Surfaces | BANT chip + deadline pill + block modal in `OpportunityDetail.tsx` / milestone form, notification bell, Needs-Qualification filter |
| **P4 — Polish** | Governance surfaces | approval-card BANT badge, dashboard tile |

> **Transport-only fields (if a soft override is ever reintroduced):** the pattern to follow is the
> existing `MSX_ACTION::`-on-`errorMessage` trick — add optional `bantAck` / `bantOverrideReason` to the
> milestone update schema, consume them in the service, and encode them into the **audit text** rather
> than persisting new columns. For the current **hard-gate** posture this is *not* needed.

---

## 12. Verified code anchors

Confirmed present on `merve-features` @ the current HEAD while refining this doc:

| Claim | Verified anchor |
| --- | --- |
| Hard-block precedent exists | `assertCompetitorForLostStatus` in `lib/lostToCompetitor.ts`, used by `services/milestones.service.ts` (also `statusHistory`, `approvalRequests`) |
| BANT scoring + CSA handoff scaffold | `scoreMilestoneHandoff()` and the `BANT:` block in `lib/milestoneHandoff.ts` |
| Read-only readiness checklist shape | `lib/handoffReadiness.ts` — `ReadinessCheck { key, item, whatsMissing, howToFix, passed }`, keys include `budget \| authority \| need \| timeline` |
| Readiness endpoint to mirror | `GET /:id/handoff-readiness` on both `routes/milestones.routes.ts` and `routes/opportunities.routes.ts` |
| Notifications need no schema change | `AgentNotification` already has `severity`, `notifyRole`, `message`, `status`, `reasonCode`, `relatedMilestoneId`, `opportunityId`, `createdDate` |
| The sweep to extend | `startCommitmentSweep()` in `services/milestoneCommitment.service.ts` (startup + 60s, auto-commits `Uncommitted -> Committed` on past `estDate`) |

---

## 13. Open decisions to confirm before build

1. **Approaching windows / severities** — default 7d `Warning` / 2d `Critical`?
2. **Gate trigger set** — confirm it's **Committed-flip + Completed** only (not every forward status
   move).
3. **Notify roles + manager email escalation** — which roles, and is email on for `Critical`?
4. **Past-due-with-gaps behavior** — confirm Part C should *hold* the milestone as Uncommitted +
   escalate (recommended), rather than commit-with-a-flag.

---

### Next step
Build **P1 (the hard gate)** first so the block is demoable, then layer on the P2 deadline sweep.
