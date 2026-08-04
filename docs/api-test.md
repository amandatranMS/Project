# API Test Guide — Multi-Agent Sales Assistant (Mock)

All examples target the local mock API at `http://localhost:4000`. Nothing here
touches real MSX, Dataverse, or customer data.

> Windows PowerShell users: replace `curl` with `curl.exe` (or use the provided
> `Invoke-RestMethod` snippets) so you get the real curl, not the PowerShell alias.

## 0. Health

```bash
curl http://localhost:4000/api/health
```

## 1. List opportunities

```bash
curl http://localhost:4000/api/opportunities
```

## 2. Get one opportunity (with milestones + team + notes)

```bash
# Replace <OPP_ID> with an id from the list above
curl http://localhost:4000/api/opportunities/<OPP_ID>
```

## 3. Create an opportunity

```bash
curl -X POST http://localhost:4000/api/opportunities \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Northwind AI Adoption",
    "accountName": "Northwind Traders",
    "customerSegment": "Commercial",
    "owner": "Demo SE",
    "dealStage": "Qualify",
    "estimatedValue": 250000,
    "riskLevel": "Low"
  }'
```

## 4. Create a milestone (human path)

```bash
curl -X POST http://localhost:4000/api/milestones \
  -H "Content-Type: application/json" \
  -d '{
    "opportunityId": "<OPP_ID>",
    "title": "Discovery Workshop",
    "milestoneType": "Custom",
    "owner": "Demo SE",
    "priority": "Medium"
  }'
```

## 5. Change a milestone status (writes Milestone Status History)

```bash
curl -X POST http://localhost:4000/api/milestones/<MILESTONE_ID>/status \
  -H "Content-Type: application/json" \
  -d '{ "newStatus": "In Progress", "changedBy": "Demo SE", "changeReason": "Kickoff done" }'
```

---

## Agent governance flow (the important part)

This is the end-to-end path an agent must follow. An agent can read + recommend +
request approval freely, but can only create a milestone AFTER approval.

### A. Start an agent run

```bash
curl -X POST http://localhost:4000/api/agent/runs \
  -H "Content-Type: application/json" \
  -d '{ "agentName": "MilestoneAdvisor", "runType": "Recommend" }'
# -> returns { "id": "<RUN_ID>", ... }
```

### B. Read context (audited as ReadContext)

```bash
curl "http://localhost:4000/api/agent/context/<OPP_ID>?agentName=MilestoneAdvisor"
```

### C. Create a recommendation (audited as CreateRecommendation)

```bash
curl -X POST http://localhost:4000/api/agent/recommendations \
  -H "Content-Type: application/json" \
  -d '{
    "opportunityId": "<OPP_ID>",
    "recommendationType": "Next Milestone",
    "title": "Add a Deployment Readiness milestone",
    "recommendationText": "Create a Deployment Readiness milestone after the architecture review.",
    "generatedByAgent": "MilestoneAdvisor",
    "confidenceScore": 0.82,
    "agentRunId": "<RUN_ID>"
  }'
# -> returns { "id": "<REC_ID>", ... }
```

### D. Submit an approval request (audited as SubmitApproval)

```bash
curl -X POST http://localhost:4000/api/agent/approvals \
  -H "Content-Type: application/json" \
  -d '{
    "recommendationId": "<REC_ID>",
    "requestType": "Create Milestone",
    "requestedBy": "MilestoneAdvisor",
    "summary": "Create Deployment Readiness milestone",
    "payload": {
      "opportunityId": "<OPP_ID>",
      "title": "Deployment Readiness",
      "milestoneType": "Deployment",
      "owner": "Demo SE",
      "priority": "High"
    }
  }'
# -> returns { "id": "<APPROVAL_ID>", "status": "Pending", ... }
```

### E. Try to create the milestone BEFORE approval — should be BLOCKED (403)

```bash
curl -i -X POST http://localhost:4000/api/agent/approvals/<APPROVAL_ID>/fulfill \
  -H "Content-Type: application/json" \
  -d '{ "agentName": "MilestoneAdvisor" }'
# -> HTTP/1.1 403 Forbidden. A "Denied" entry is written to the audit log.
```

### F. Human approves the request

```bash
curl -X POST http://localhost:4000/api/agent/approvals/<APPROVAL_ID>/decision \
  -H "Content-Type: application/json" \
  -d '{ "decision": "Approved", "reviewedBy": "Demo Approver" }'
```

### G. Now fulfill — milestone is created (audited as CreateMilestone)

```bash
curl -X POST http://localhost:4000/api/agent/approvals/<APPROVAL_ID>/fulfill \
  -H "Content-Type: application/json" \
  -d '{ "agentName": "MilestoneAdvisor" }'
# -> HTTP/1.1 201 Created with the new milestone
```

### H. Inspect the audit log

```bash
curl http://localhost:4000/api/agent/audit
```

You should see, in order: `ReadContext`, `CreateRecommendation`, `SubmitApproval`,
`Denied` (the blocked attempt), then `CreateMilestone`.

---

## Dashboard

```bash
curl http://localhost:4000/api/dashboard/metrics
curl -X POST http://localhost:4000/api/dashboard/snapshots
curl http://localhost:4000/api/dashboard/snapshots
```
