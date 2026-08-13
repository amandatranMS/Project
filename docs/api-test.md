# API Test Guide — Multi-Agent Sales Assistant (Mock)

Endpoint-by-endpoint tests for the local mock API at `http://localhost:4000`. Nothing
here touches real MSX, Dataverse, or customer data — only the 11 synthetic tables.

> **Response envelope.** Every response is wrapped: success is
> `{ "success": true, "data": ... }`, error is `{ "success": false, "error": "message" }`.
> The examples below show the request; the payload you care about is always under `data`.

> **Windows PowerShell users:** use `curl.exe` (not the `curl` alias, which maps to
> `Invoke-WebRequest`), or use the `Invoke-RestMethod` equivalents.

## 0. Health

```bash
curl http://localhost:4000/api/health
```

## 1. Opportunities

```bash
# List (optional filters: status, salesStage, solutionArea)
curl http://localhost:4000/api/opportunities
curl "http://localhost:4000/api/opportunities?salesStage=Propose"

# Get one (replace <OPP_ID> with an id from the list)
curl http://localhost:4000/api/opportunities/<OPP_ID>

# Full 360° context — opportunity + milestones, history, recommendations,
# approvals, notes, deal team, notifications, run logs, and audit logs
curl http://localhost:4000/api/opportunities/<OPP_ID>/context

# Next auto-assigned TPID (used when creating without one)
curl http://localhost:4000/api/opportunities/next-tpid
```

### Create an opportunity

Only `opportunityName` is required; the TPID is auto-assigned when omitted.

```bash
curl -X POST http://localhost:4000/api/opportunities \
  -H "Content-Type: application/json" \
  -d '{
    "opportunityName": "Northwind AI Adoption",
    "customerName": "Northwind Traders",
    "industry": "Retail",
    "solutionArea": "Azure",
    "salesStage": "Qualify",
    "status": "Open",
    "estimatedRevenue": 250000,
    "aeOwner": "Demo AE",
    "assignedSE": "Demo SE"
  }'
```

### Readiness checks (read-only, audited)

```bash
curl http://localhost:4000/api/opportunities/<OPP_ID>/handoff-readiness
curl http://localhost:4000/api/opportunities/<OPP_ID>/ecif-readiness
```

## 2. Milestones

```bash
# List (optional filters: opportunityId, milestoneStatus)
curl "http://localhost:4000/api/milestones?opportunityId=<OPP_ID>"

# Get one (with history, recommendations, approvals, notes)
curl http://localhost:4000/api/milestones/<MILESTONE_ID>

# One-milestone CSA handoff-readiness score
curl http://localhost:4000/api/milestones/<MILESTONE_ID>/handoff-readiness
```

### Create a milestone

`milestoneName` and `opportunityName` are required; the milestone connects to its
opportunity by name.

```bash
curl -X POST http://localhost:4000/api/milestones \
  -H "Content-Type: application/json" \
  -d '{
    "milestoneName": "Discovery Workshop",
    "opportunityName": "Northwind AI Adoption",
    "milestoneCategory": "Workshop",
    "milestoneStatus": "On Track",
    "workload": "Azure Migration",
    "customerCommitment": "Committed",
    "owner": "Demo SE"
  }'
```

> Moving a milestone to `"Lost To Competitor"` (on create, PATCH, or a status change)
> **requires** a non-empty `competitorName`, otherwise the request is rejected with
> **422**.

### Change a milestone status (writes Milestone Status History)

Identify the milestone by its **business id** (`milestoneBusinessId`, e.g. `MS-001`).

```bash
curl -X POST http://localhost:4000/api/status-history \
  -H "Content-Type: application/json" \
  -d '{
    "milestoneBusinessId": "MS-001",
    "newStatus": "At Risk",
    "changedBy": "Demo SE",
    "reason": "Customer paused budget review"
  }'
```

---

## 3. Agent governance flow (the important part)

Agents may read and **propose**, but they can never change data or send a message
directly. Every governed action is submitted as an **`ApprovalRequest`** and executes
**only** when a human approves it — then it is written to the audit log. This section
walks the full loop end to end.

### A. Submit an approval request carrying a deferred action

Here an agent proposes creating a new opportunity. The `action.kind` is
`CreateOpportunity`; nothing is created yet.

```bash
curl -X POST http://localhost:4000/api/approval-requests \
  -H "Content-Type: application/json" \
  -d '{
    "requestName": "Create Contoso Fabric Expansion opportunity",
    "requestedBy": "OpportunityAgent",
    "action": {
      "kind": "CreateOpportunity",
      "opportunityName": "Contoso Fabric Expansion",
      "customerName": "Contoso",
      "solutionArea": "Data & AI",
      "salesStage": "Qualify",
      "aeOwner": "Demo AE"
    }
  }'
# -> returns { "success": true, "data": { "id": "<APPROVAL_ID>", "approvalStatus": "Pending", ... } }
```

Other deferred `action.kind` values: `CreateMilestone`, `SendOutlookMail`,
`NotifyTeams`, `UpdateMilestone`, `UpdateOpportunity`, `UpdateDealTeamMember`,
`DeleteMilestone`.

### B. See it pending — nothing has changed yet

```bash
curl "http://localhost:4000/api/approval-requests?approvalStatus=Pending"
```

The row exposes a sanitized `pendingAction` (e.g. `opportunityFields`) for human
review; the raw payload is not leaked.

### C. Reject / needs-changes never execute anything

```bash
# Reject — the action is discarded, nothing is created (audited)
curl -X PATCH http://localhost:4000/api/approval-requests/<APPROVAL_ID>/reject \
  -H "Content-Type: application/json" \
  -d '{ "reviewedBy": "Demo Approver", "notes": "Not this quarter" }'

# Needs-changes — preserves the encoded action for a later approval (audited)
curl -X PATCH http://localhost:4000/api/approval-requests/<APPROVAL_ID>/needs-changes \
  -H "Content-Type: application/json" \
  -d '{ "reviewedBy": "Demo Approver", "notes": "Fix the customer name first" }'
```

### D. Approve — the action executes now (audited by its kind)

```bash
curl -X PATCH http://localhost:4000/api/approval-requests/<APPROVAL_ID>/approve \
  -H "Content-Type: application/json" \
  -d '{ "reviewedBy": "Demo Approver" }'
# -> 200; the opportunity is created (or the deferred action executed) and audited.
#    Approving an already-approved request returns 409.
```

For a recommendation-backed request (one with `relatedRecommendationBusinessId` and no
deferred action), approving performs the mock milestone writeback and audits it as
`CreateMilestone`.

### E. Inspect the audit log

Every governed action lands here.

```bash
curl http://localhost:4000/api/agent-action-audit-logs
curl "http://localhost:4000/api/agent-action-audit-logs?actionType=CreateOpportunity"
```

---

## 4. Recommendations

```bash
curl "http://localhost:4000/api/recommendations?opportunityId=<OPP_ID>"
curl http://localhost:4000/api/recommendations/<REC_ID>
```

## 5. Collaboration notes & deal team

```bash
curl "http://localhost:4000/api/collaboration-notes?opportunityId=<OPP_ID>"
curl "http://localhost:4000/api/deal-team-members?opportunityId=<OPP_ID>"
```

## 6. Universal search

Matches `q` case-insensitively across every field of the global business records.

```bash
curl "http://localhost:4000/api/search?q=Contoso"
curl "http://localhost:4000/api/search?q=TPID-1001&entity=opportunity"
```

## 7. Dashboard

```bash
curl http://localhost:4000/api/dashboard/summary
curl http://localhost:4000/api/dashboard-metric-snapshots
curl -X POST http://localhost:4000/api/dashboard-metric-snapshots
```

## 8. Signed-in user & Microsoft Graph (real, read-only)

These require an authenticated user (Entra bearer token) or a resolvable
`x-msx-session` handle; without one they return **401**, and **501** if Graph isn't
configured. Reads are audited and never persisted into the mock tables.

```bash
curl http://localhost:4000/api/me
curl "http://localhost:4000/api/graph/outlook/messages?top=10"
curl "http://localhost:4000/api/graph/teams/chats?top=10"
curl "http://localhost:4000/api/graph/teams/messages?top=10&perChat=10"
```

---

The full contract, including every field and enum, lives in
[`openapi/msx-milestone-assistant.openapi.yaml`](../openapi/msx-milestone-assistant.openapi.yaml).
