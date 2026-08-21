# Stakeholder Feedback → Consolidated Roadmap

> **Status:** Living document · **Last updated:** 2026-08-21
>
> **What this is.** A single consolidated view of *everything still needed*, merging four
> stakeholder syncs (Janet Cassar, Rachel, Jeff Boekke, Merve) with the roadmap that was
> already captured on the `merve-features` branch. Every item is marked against what is
> **actually in the code today**, so the "what's left" column is real and not aspirational.
>
> **Companion doc:** [`bant-gated-milestone-progression.md`](./bant-gated-milestone-progression.md)
> — the detailed design for the BANT gate (its §14 broader roadmap and §15 follow-ups are
> folded into [§4](#4-consolidated-gap-register) and [§8](#8-open-decisions) below).

---

## 1. Sources & branch provenance

| Source | Captured in | Branch state |
| --- | --- | --- |
| **Merve** sync | `docs/bant-gated-milestone-progression.md` §§1–13 (BANT gate design) + §14 (6 more candidates) + §15 (follow-ups) | `merve-features` — **fully merged into `main`** (0 commits ahead, 6 behind). Nothing is stranded on that branch. |
| **Janet Cassar** | this doc | new |
| **Rachel** | this doc | new |
| **Jeff Boekke** | this doc | new |

**Unmerged work to be aware of** (each is 1 commit ahead of `main`):

- `Email/Teams` — live Teams delivery, wider Graph scopes, M365 UI polish.
- `ui-changes` — milestone timeline, sort toggles, Assistant chat improvements.

> **Terminology.** The transcripts use *ECIF* and *ESIF* interchangeably. The codebase
> standardizes on **ECIF** (End Customer Investment Funds); treat "ESIF" in the feedback as
> the same thing.

---

## 2. Baseline — what is actually built today

Verified against `main` while writing this doc. This is the honest starting line.

### Built and working

| Capability | Anchor |
| --- | --- |
| **Handoff readiness (opportunity)** — 7 checks: intent, budget, authority, need, timeline, evidence, contacts | `lib/handoffReadiness.ts`, `GET /api/opportunities/:id/handoff-readiness`, agent tool `get_handoff_readiness` |
| **Handoff readiness (milestone)** — per-milestone CSA-critical info + paste-ready "CSA Handoff Notes" scaffold with a `BANT:` block | `lib/milestoneHandoff.ts`, `GET /api/milestones/:id/handoff-readiness`, agent tool `get_milestone_handoff_readiness` |
| **ECIF readiness** — 2 prerequisite checks, Local-vs-Global hint, paste-ready Work Scope draft, >$50K/2-milestone reminder | `lib/ecifReadiness.ts`, agent tool `get_ecif_readiness` |
| **Human-in-the-loop approval gate** — agent never writes; deferred actions encoded `MSX_ACTION::` on `ApprovalRequest.errorMessage`, executed only on human approve | `services/approvalRequests.service.ts` |
| **Full audit trail** — every governed action (including reads) written to `AgentActionAuditLog` | `lib/audit.ts` → `recordAgentAction` |
| **New-opportunity notification** — Teams broadcast when an opportunity is created | `services/opportunityBroadcast.service.ts` |
| **Manager executive summary** — email to the seller's manager, manager resolved via real Graph `/me/manager` | `services/managerNotifications.service.ts` |
| **Purview + Defender controls** — OBO delegated token so Purview DLP *enforces* per signed-in user; Defender AI threat protection gets jailbreak/prompt-injection signal; end-user security context on every model call | `lib/foundryAuth.ts`, `services/chat/defenderScreen.ts`, `services/chat/foundryProxy.ts`, `lib/requestContext.ts` |
| **Graph reads (REST)** — `me`, `hierarchy`, `manager`, Outlook `messages`, Teams `chats`, `teamsMessages` (chats *with* message bodies) | `services/graph.service.ts`, `controllers/graph.controller.ts` |
| **Graph sends** — `sendMail`, `notifyTeams`, `notifyTenantTeams`, all confirm-gated | `services/graph.service.ts` |
| **Commitment sweep** — every 60s, auto-flips past-due `Uncommitted → Committed` | `services/milestoneCommitment.service.ts` |
| **Hard-block precedent** — a status transition is already blocked when data is missing | `lib/lostToCompetitor.ts` → `assertCompetitorForLostStatus()` |

### Designed but NOT built

| Item | Evidence |
| --- | --- |
| **BANT progression gate** (hard block on commit/complete) | Design complete in `bant-gated-milestone-progression.md` §§1–13. **No `lib/bantGate.ts` or `lib/bantReadiness.ts` exists.** BANT is read-only scoring only — it never blocks a save. |
| **Deadline lifecycle alerts** (approaching / overdue / escalation) | Designed as Part B. The sweep exists but only *auto-commits*; it emits no approaching-deadline warning. |

### The most important structural gap

> **The Graph read methods are NOT exposed as agent tools.** `msxTools.ts` registers 13 tools —
> all MSX CRUD + the three readiness tools — and **zero** Graph tools. So the agent can *send*
> mail/Teams (via the approval gate) but **cannot read** Outlook or Teams. Every "analyze my
> emails and meetings" ask (Rachel #1, Merve 14.6, Jeff's notification engine) is blocked on
> this one wiring gap, even though the underlying `graphService.messages()` /
> `graphService.teamsMessages()` reads already exist and are already audited.

---

## 3. The ECIF rework — Rachel's critique

This is the sharpest, most specific, most actionable piece of feedback received, and it is
correct. Detailing it in full because it changes the *shape* of the feature, not just its inputs.

### What the code does today

`assessEcifReadiness()` runs exactly two checks:

| Check | Passes when |
| --- | --- |
| `partner` — Delivery partner identified | any milestone has `deliveredBy ∈ {Partner, Joint}` **or** a `partnerName` |
| `workScope` — Work scope started | any milestone has **both** `milestoneCategory` **and** `estDate` |

`score = passed / 2 × 100`, and `ready = (both pass)`.

### Why that is wrong

Rachel's point: **the work scope is created *after* partner conversations and *after* ECIF work
has already begun.** So the check is circular — the system says *"not ready, no work scope,"* and
the honest answer is *"of course not, that's literally the next step."* A feature that tells a
seller they're 50% ready because they haven't done the thing they came to the tool to start is
noise.

Three consequences, all fixable:

1. **`workScope` is a blocker when it should be a next action.** It should move out of the
   scored prerequisites and become a *staged* item.
2. **`salesStage` is never read.** It's on `Opportunity` (`schema.prisma:34`), it's validated
   (`SALES_STAGES`), it's filterable — and `ecifReadiness.ts` ignores it entirely. Rachel named
   sales stage as the *strongest* readiness signal.
3. **A percentage answers the wrong question.** Rachel: `"Stuck waiting for partner signature
   for 21 days"` is worth more to a seller than `"ECIF readiness = 63%"`.

### Proposed shape

Replace pass/fail scoring with a **staged checklist + a stall detector + a guidance layer**:

```
✅ Sales stage suitable        Empower & Achieve — pilots/POCs/deployment happen here
✅ Delivery partner identified  Contoso Partners
⚠  Work scope not started yet   ← expected at this stage, not a failure
➡  Next action: begin the Work Scope in ECIF Central
🔴 Stuck 21 days: partner signature outstanding since 2026-07-31
```

**Sales-stage weighting** (ordinal mapping to the MCEM stages in `SALES_STAGES` — see
[§8](#8-open-decisions), needs confirming with Rachel):

| Stage | `SALES_STAGES` value | Rachel's read |
| --- | --- | --- |
| 1 | Listen & Consult | too early |
| 2 | Inspire & Design | often too early |
| 3 | Empower & Achieve | **strong ECIF candidate** |
| 4 | Realize Value | **strong ECIF candidate** |
| 5 | Manage & Optimize | *(not discussed)* |

**Stall detection** — all source fields already exist on `OpportunityMilestone`, no schema change:
`blockedSince`, `blockedReason`, `blockedOwner`, `expectedResolutionDate`, `escalated`, `estDate`.
Compute days-stuck, surface the owner, and recommend the escalation.

**Guidance layer (Jeff's ask)** — go beyond prerequisites to answer *which* ECIF applies:
pre-sales vs post-sales, the funding bucket, what work scope and milestones are required.

**Workflow tracking (Rachel's reframe)** — she sees ECIF as *workflow orchestration*, not
readiness scoring: identify partner → draft work scope → track approvals → monitor signatures →
track milestones → track POEs → detect delays → recommend escalations. The readiness check is
step 0 of that pipeline, not the product.

---

## 4. Consolidated gap register

Every ask from all four stakeholders. **Status** is against `main` today.

### A. ECIF / ESIF

| # | Ask | Who | Status | Lands in | Size |
| --- | --- | --- | --- | --- | --- |
| A1 | Work scope = next action, not blocker | Rachel | ❌ blocker today | `lib/ecifReadiness.ts` | S |
| A2 | Weight sales stage heavily (3–4 = strong candidate) | Rachel | ❌ `salesStage` never read | `lib/ecifReadiness.ts` | S |
| A3 | "Where is it stuck?" — days-stuck, owner, escalation | Rachel | ❌ none | new stall detector; fields exist | M |
| A4 | ESIF **type** guidance: pre-sales vs post-sales, funding bucket | Jeff | ❌ none | guidance layer on readiness | M |
| A5 | Required work scope + milestone guidance for the chosen type | Jeff | 🟡 partial — `workScopeDraft` exists but is generic | `lib/ecifReadiness.ts` | M |
| A6 | ECIF **workflow tracking**: approvals, signatures, POEs, delays | Rachel | ❌ none | new service; approval-gated | L |
| A7 | Local vs Global request type | — | ✅ built | `suggestRequestType()` | — |
| A8 | Paste-ready Work Scope draft | — | ✅ built | `buildWorkScopeDraft()` | — |

### B. Handoff (CSA / CSAM) — *highest-ranked by both Janet and Jeff*

| # | Ask | Who | Status | Lands in | Size |
| --- | --- | --- | --- | --- | --- |
| B1 | BANT analysis | Janet | ✅ built (read-only) | `handoffReadiness.ts`, `milestoneHandoff.ts` | — |
| B2 | Readiness scoring + missing-item detection | Janet, Jeff | ✅ built | same | — |
| B3 | Customer intent, what was sold, contacts, commitment tracking | Janet | ✅ built (`intent`/`evidence`/`contacts` checks) | same | — |
| B4 | **Enforce** BANT before progression (hard gate) | Merve | ❌ designed, not built | `bant-gated-milestone-progression.md` §§1–13 → new `lib/bantGate.ts` | M |
| B5 | Carry **partner info** through handoff | Jeff | 🟡 `partnerName` exists on milestone, not a handoff check | `handoffReadiness.ts` | S |
| B6 | Carry **deployment plans** through handoff | Jeff | ❌ none | `handoffReadiness.ts` / scaffold | M |
| B7 | Carry **ECIF details** through handoff | Jeff | ❌ not linked | join ECIF result into handoff scaffold | S |
| B8 | Carry **customer timelines / commitments** | Jeff, Janet | 🟡 `timeline` check exists; commitments not narrative | `milestoneHandoff.ts` | S |
| B9 | **CSA visibility *before* handoff** — notify CSA pre-commitment | Merve (14.1) | ❌ none | `AgentNotification.notifyRole` + alert sweep | S *(after C1)* |

### C. Notifications & alerts

| # | Ask | Who | Status | Lands in | Size |
| --- | --- | --- | --- | --- | --- |
| C1 | Approaching / overdue deadline alerts + escalation | Merve | ❌ designed, not built (Part B) | extend `milestoneCommitment.service.ts` sweep | M |
| C2 | **Status-change alerts** (e.g. committed → uncommitted) | Jeff | ❌ none | new trigger; `MilestoneStatusHistory` already records transitions | M |
| C3 | Risk alerts / handoff alerts / missing-prerequisite alerts | Jeff | ❌ none | same engine as C2 | M |
| C4 | New-opportunity notification | Janet | ✅ built | `opportunityBroadcast.service.ts` | — |
| C5 | Manager executive summary on loss | Janet | ✅ built (Lost To Competitor only) | `managerNotifications.service.ts` | — |
| C6 | Broaden manager summaries beyond Lost-To-Competitor | Janet (implied) | ❌ single trigger today | `managerNotifications.service.ts` | S |
| C7 | Stakeholder notifications, watchlists, team subscriptions, "who's involved?" | Rachel | ❌ none — **watchlists/subscriptions would need storage** | see [§6](#6-constraint-collisions) | M–L |

### D. Pipeline hygiene & account memory — *Rachel's #1 and #2*

| # | Ask | Who | Status | Lands in | Size |
| --- | --- | --- | --- | --- | --- |
| D1 | **Expose Graph reads as agent tools** *(unblocks D2–D5, Merve 14.6)* | — | ❌ **0 Graph tools registered** | `services/chat/msxTools.ts` | **S — highest leverage** |
| D2 | Analyze Outlook emails / Teams chats / meeting transcripts | Rachel, Merve (14.6) | 🟡 reads exist, agent can't call them | `graph.service.ts` + D1 | M |
| D3 | "Based on your meetings this week, we recommend these changes to opportunity X" + one-click accept/reject | Rachel | ❌ none | `AiMilestoneRecommendation` + `ApprovalRequest` — **pattern already exists** | M |
| D4 | Recommend stage progression (e.g. Stage 3 → Stage 4) from real signal | Rachel | ❌ none | deferred `UpdateOpportunity` via approval gate | M |
| D5 | Suggest blockers, next steps, executive summaries from conversation | Rachel | ❌ none | same pipeline | M |
| D6 | **Account memory** — timeline, meeting summaries, decisions, searchable history | Rachel | ❌ none — **collides with the 11-table rule** | see [§6](#6-constraint-collisions) | L |

### E. Opportunity lifecycle & data quality

| # | Ask | Who | Status | Lands in | Size |
| --- | --- | --- | --- | --- | --- |
| E1 | Lifecycle states **Uncommitted → Committed → At Risk → Upside** | Janet | 🟡 **partial and mismatched** — see note below | `packages/shared`, new rollup | M |
| E2 | Automated progression recommendations | Janet | ❌ none | overlaps D4 | M |
| E3 | Opportunity health monitoring | Janet | 🟡 dashboard counts At Risk / Blocked | `dashboard.service.ts` | M |
| E4 | Data-quality enforcement near close dates | Janet | ❌ none | new scan on `closeDate`; reuses BANT gate pattern | M |
| E5 | Required-field validation before milestone transitions | Janet | ❌ = B4 (the BANT gate) | `lib/bantGate.ts` | M |
| E6 | Duplicate milestone detection → propose `Hygiene/Duplicate` | Merve (14.4) | ❌ none; status value already exists | detection heuristic + approval | S–M |
| E7 | Automatic milestone intelligence — summaries, blocked report, roll-ups, update history | Merve (14.2) | 🟡 `MilestoneStatusHistory` + `DashboardMetricSnapshot` exist, unused for this | read endpoints + agent tool | M |

> **E1 is not a simple addition.** Today `CUSTOMER_COMMITMENTS = ['Committed', 'Uncommitted']`
> and lives on the **milestone**, while `'At Risk'` is a **`MILESTONE_STATUSES`** value — two
> different fields. `'Upside'` does not exist anywhere, and there is **no opportunity-level
> commitment state at all**. Janet's four states are the MSX *opportunity-level forecast
> category*. Implementing this means adding an opportunity-level rollup concept, not extending
> an existing list. Needs a decision (see [§8](#8-open-decisions)).

### F. Unified contract — Janet's explicit new request

| # | Ask | Who | Status | Lands in | Size |
| --- | --- | --- | --- | --- | --- |
| F1 | **"Is there Unified?" Yes/No** before partner discussions | Janet | ❌ **the word "Unified" appears nowhere in the codebase** | needs a data decision | M |
| F2 | Visibility into whether Unified services are included | Janet | ❌ none | same | M |
| F3 | Fold Unified validation into ECIF readiness | Janet | ❌ none | `lib/ecifReadiness.ts` | S *(after F1)* |
| F4 | **Unified opportunity capture** — let CSAs record opportunities spotted during delivery | Merve (14.5) | 🟡 `CreateOpportunity` approval-gated action already exists; friction is the problem | discovery-gated | M |

> **F1 and F4 converge.** Janet approaches Unified from the *seller* side ("does a Unified
> contract exist before I talk to a partner?"); Merve approaches it from the *CSA* side
> ("capture the Unified opportunity I just found"). Both need the same missing concept: **Unified
> support contract presence must be representable on the record.** Resolve it once. Janet also
> asked that the Unified idea be raised with **Kevin Ireland**.

### G. Platform / audience

| # | Ask | Who | Status | Notes |
| --- | --- | --- | --- | --- |
| G1 | Role-based experience: SE / SSP / CSA / CSAM / Manager views | Jeff | 🟡 `AgentNotification.notifyRole` + `DealTeamMember.role` exist; no role-scoped UI | M |
| G2 | Dashboard surfaces *guidance*, not just data — program recommendations, ECIF eligibility, risks, sales-motion guidance | Jeff | 🟡 dashboard is metrics-only | M |
| G3 | Plug into Jeff + Tanner's leadership/SSP visibility work (avoid MSXI latency) | Jeff | ❌ integration not scoped | discovery |
| G4 | Code reuse + handoff after internship: how it installs, what carries forward | Jeff | 🟡 `HANDOFF.md` + `README.md` exist | S — refresh before end of internship |
| G5 | Partner visibility *(constrained — no Partner table)* | Merve (14.3) | 🟡 embedded `partnerName` only | discovery → fold into E7 |
| G6 | Purview + Defender security controls | Janet | ✅ built | keep in every demo — Janet rated it highly |

---

## 5. Cross-cutting themes

Where multiple stakeholders independently converged — these are the strongest signals.

1. **CSA/CSAM handoff is the #1 business problem.** Janet: *"our biggest operational challenge."*
   Jeff: *"the biggest place information gets lost."* Merve: the origin of the BANT gate. Three of
   four, unprompted. **The readiness scoring is built; the enforcement (B4) and the content
   richness (B5–B8) are not.** This is where the remaining effort pays back most.

2. **Sellers want the system to update itself.** Rachel blocks out every Friday to hand-update
   MSX; Janet wants opportunities created with correct data automatically; Jeff wants
   status-change alerts fired without anyone asking. All three are the same product: **read real
   signal → propose a change → human approves.** The approval half is fully built; the *read
   real signal* half is one tool registration away (D1).

3. **"Readiness score" is the wrong output.** Rachel said it about ECIF explicitly; Jeff implied
   it for the dashboard (*surface guidance, not data*). The consistent request is a **next
   action** and a **blocker**, not a percentage.

4. **Unified is a genuine hole.** Requested independently by Janet (seller side) and Merve (CSA
   side), and completely unrepresented in the data model.

---

## 6. Constraint collisions

Items that fight the project's hard rules and therefore need an explicit decision before build.

| Item | Rule it collides with | Options |
| --- | --- | --- |
| **D6 Account memory / tribal knowledge** | **Exactly 11 tables.** A meeting-summary/decision timeline is naturally a 12th table. | (a) Generate on demand from Graph, persist nothing; (b) reuse `CollaborationNote` (it already has `noteType`, `teamArea`, `noteSummary`, `suggestedAudience`) as the memory store; (c) accept it as out of scope. **(b) is the best fit** and adds no tables. |
| **F1 Unified contract flag** | 11 tables **and** the schema mirrors the workbook. | (a) Add a workbook column + `Opportunity` field (schema change, but no new table); (b) encode in an existing free-text field (fragile); (c) derive from `azureCapacityType`-style controlled list. **(a) is cleanest** — needs sign-off since it changes `schema.prisma`. |
| **E1 Opportunity lifecycle states** | Milestone-level `customerCommitment` already exists; adding an opportunity-level state risks two conflicting sources of truth. | (a) Add `Opportunity.commitmentState`; (b) **derive** it from milestone rollup (no schema change); (c) reuse `Opportunity.status`. **(b) avoids drift.** |
| **C7 Watchlists / team subscriptions** | 11 tables — a subscription list is a new table. | Derive from `DealTeamMember` + Entra/Graph hierarchy instead of storing subscriptions. |
| **D2 Graph transcript reads** | Option B is *allowed*, but: gated behind an authenticated user, audited via `recordAgentAction`, and **never persisted into the 11 mock tables**. | Already the established pattern in `graph.service.ts` — follow it exactly. Anything proposed from a transcript goes through the approval gate. |
| **G5 Partner visibility** | **No `Partner` table**, ever. | Embedded `partnerName` / risk fields on `Opportunity` / `OpportunityMilestone` only. |

---

## 7. Recommended sequencing

Ordered by *(stakeholder demand × unblocking power) ÷ effort*.

### Phase 1 — Fix what's demonstrably wrong (days)

1. **A1 + A2 — ECIF readiness rework.** Stage the checklist so work scope is a *next action*, and
   weight `salesStage`. Small, self-contained in `lib/ecifReadiness.ts`, and directly answers the
   most specific critique received.
2. **D1 — Register Graph reads as agent tools.** The single highest-leverage change in this
   document: one file, and it unblocks D2–D5, C2–C3, and Merve 14.6.
3. **B7 + B5 — Join ECIF + partner context into the handoff scaffold.** Cheap, and hits the
   #1 cross-cutting theme.

### Phase 2 — The enforcement + alert backbone (1–2 weeks)

4. **B4 — BANT progression gate.** Design is already complete (§§1–13 of the companion doc);
   build `lib/bantGate.ts` and wire the one choke point in `milestones.service.ts`. Also
   satisfies E5.
5. **C1 — Deadline lifecycle alerts.** Part B of the same design; extends the existing sweep.
6. **C2 + C3 — Status-change / risk / handoff alert engine.** Jeff's most concrete new idea;
   `MilestoneStatusHistory` already captures the transitions to fire on.
7. **B9 — CSA visibility before handoff.** Small once C1 exists (a `notifyRole` addition).

### Phase 3 — The pipeline-hygiene product (Rachel's #1) (2–3 weeks)

8. **D3 — Weekly opportunity review.** Graph reads → `AiMilestoneRecommendation` →
   `ApprovalRequest` → one-click accept/reject. Every piece of that chain already exists except
   the analysis step.
9. **D4 + D5 — Stage-progression and blocker/next-step recommendations.**
10. **A3 — ECIF stall detection** ("stuck 21 days on partner signature").
11. **E7 + E6 — Milestone intelligence and duplicate detection.**

### Phase 4 — Requires a decision first

12. **F1 → F3 → F4 — Unified.** Blocked on the data-model decision in §6 *and* on Merve's
    walkthrough of the Unified process (her §15 commitment). Raise with **Kevin Ireland**.
13. **E1 + E2 + E3 — Opportunity lifecycle states.** Blocked on the derive-vs-store decision.
14. **E4 — Close-date data-quality enforcement.** Reuses the BANT gate pattern; sequence after B4.
15. **D6 — Account memory.** Blocked on the `CollaborationNote`-reuse decision.
16. **A4 + A5 + A6 — ECIF type guidance and workflow orchestration.** The largest ECIF item;
    needs process detail from Rachel and Jeff.

### Continuous

- **G4 — Keep `HANDOFF.md` / `README.md` current.** Jeff explicitly asked how the work carries
  forward after the internship. Refresh before the end date.
- **G6 — Keep Purview/Defender in every demo.** Consistently the strongest reaction from Janet.
- Merge or retire the `Email/Teams` and `ui-changes` branches so `main` is the whole story.

---

## 8. Open decisions

Carried forward from the companion doc §13, plus new ones raised by this feedback.

**From the BANT design (still open)**

1. Approaching-deadline windows and severities — default 7d `Warning` / 2d `Critical`?
2. Gate trigger set — confirm it's **Committed-flip + Completed** only.
3. Which roles get notified, and is email escalation on for `Critical`?
4. Past-due-with-gaps — hold as Uncommitted + escalate (recommended), or commit with a flag?

**New**

5. **Sales-stage mapping (blocks A2).** Rachel referred to numbered stages 1–4. `SALES_STAGES`
   holds the five MCEM names. Confirm the ordinal mapping in §3 is what she meant — specifically
   that "Stage 3/4" = *Empower & Achieve* / *Realize Value* — and decide how *Manage & Optimize*
   scores.
6. **Unified representation (blocks F1–F4).** Schema field vs derived vs free-text — see §6.
7. **Lifecycle states (blocks E1).** Derive from milestone rollup, or store on `Opportunity`?
   And where does `'Upside'` come from, given nothing in the model expresses it?
8. **Account memory (blocks D6).** Reuse `CollaborationNote`, or generate on demand and persist
   nothing?
9. **ECIF: readiness check or workflow tracker?** Rachel's framing implies the latter is the real
   product. Decide the ambition level before building A4–A6.
10. **Does anything write back to real systems?** Everything so far is mock business data +
    real Graph. Jeff's leadership-visibility integration (G3) would be the first thing to test
    that boundary — confirm it stays read-only/mock.

---

## 9. Follow-up commitments

**Merve** — Unified process walkthrough; CSA workflow clarification; automation input; review of
final materials. *(Blocks F4.)*

**Amanda** — document findings (this doc + the companion); build the BANT readiness gate;
research the Unified process; investigate transcript-driven automation; produce this roadmap
before end of internship.

**Raise with Kevin Ireland** — the Unified contract check (Janet's explicit referral).

**Jeff / Tanner** — align the dashboard with their leadership + SSP visibility work (G3).
