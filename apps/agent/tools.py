"""Tool definitions grouped by domain. Each tool wraps one or more MSX API calls.

Adding capabilities is just adding a Tool to the relevant group here (and, for a
whole new domain, a sub-agent in agents.py).
"""
from __future__ import annotations

from typing import Any

from llm import Tool
from msx_client import MsxClient

# Controlled choice values (mirrors packages/shared) — embedded in descriptions so
# the model produces values the API's validation will accept.
MILESTONE_STATUSES = ["---", "On Track", "At Risk", "Blocked", "Completed", "Cancelled", "Lost To Competitor", "Hygiene/Duplicate"]
MILESTONE_CATEGORIES = ["Production", "Pilot", "Workshop", "Assessment", "Deployment", "Adoption"]
SALES_STAGES = ["Listen & Consult", "Inspire & Design", "Empower & Achieve", "Realize Value", "Manage & Optimize"]
OPPORTUNITY_STATUSES = ["Active", "On Hold", "Won", "Lost", "Closed"]
SOLUTION_AREAS = ["Modern Work", "Security", "Azure", "AI Apps"]
WORKLOADS = ["M365 Copilot for Microsoft 365", "Microsoft Sentinel", "Microsoft Purview", "Azure Migration", "Copilot Studio", "Defender XDR", "Teams Premium"]
CUSTOMER_COMMITMENTS = ["Uncommitted", "Verbal", "Committed", "Contracted"]
DELIVERED_BY = ["Microsoft", "Partner", "Customer", "Joint"]
AZURE_CAPACITY_TYPES = ["---", "Azure Commit", "MACC", "Open", "CSP", "EA"]
PREFERRED_AZURE_REGIONS = ["Canada Central", "Canada East", "East US", "West US", "West Europe", "North Europe"]
RISK_IMPACTS = ["High", "Medium", "Low"]
PRIORITIES = ["High", "Medium", "Low"]
CONFIDENCE_LEVELS = ["High", "Medium", "Low"]
SEARCH_ENTITIES = ["opportunity", "milestone", "statusHistory", "recommendation", "note", "dealTeam", "notification", "runLog", "snapshot"]


def _trim_milestone(m: dict) -> dict:
    return {
        "id": m.get("id"),
        "milestoneBusinessId": m.get("milestoneBusinessId"),
        "milestoneName": m.get("milestoneName"),
        "milestoneStatus": m.get("milestoneStatus"),
        "milestoneCategory": m.get("milestoneCategory"),
        "owner": m.get("owner"),
        "riskImpact": m.get("riskImpact"),
        "opportunity": (m.get("opportunity") or {}).get("opportunityName"),
    }


def _trim_opportunity(o: dict) -> dict:
    return {
        "id": o.get("id"),
        "opportunityBusinessId": o.get("opportunityBusinessId"),
        "opportunityName": o.get("opportunityName"),
        "customerName": o.get("customerName"),
        "salesStage": o.get("salesStage"),
        "status": o.get("status"),
        "milestones": (o.get("_count") or {}).get("milestones"),
    }


def build_tool_groups(mc: MsxClient) -> dict[str, list[Tool]]:
    """Returns tools keyed by domain name."""

    # ---- Milestone tools -------------------------------------------------
    def list_milestones(milestoneStatus: str | None = None) -> Any:
        params = {"milestoneStatus": milestoneStatus} if milestoneStatus else None
        data = mc.get("/api/milestones", params=params) or []
        return [_trim_milestone(m) for m in data]

    def get_milestone(id: str) -> Any:
        return mc.get(f"/api/milestones/{id}")

    def create_milestone(
        milestoneName: str,
        opportunityName: str,
        userConfirmed: bool,
        competitorBlankConfirmed: bool,
        workload: str | None = None,
        customerCommitment: str | None = None,
        deliveredBy: str | None = None,
        partnerName: str | None = None,
        milestoneStatus: str | None = None,
        milestoneCategory: str | None = None,
        owner: str | None = None,
        riskDescription: str | None = None,
        statusReason: str | None = None,
        estDate: str | None = None,
        fitCharge: float | None = None,
        nonRecurring: bool | None = None,
        comments: str | None = None,
        riskImpact: str | None = None,
        mitigationPlan: str | None = None,
        blockedReason: str | None = None,
        blockedOwner: str | None = None,
        blockedSince: str | None = None,
        expectedResolutionDate: str | None = None,
        escalated: bool | None = None,
        competitorName: str | None = None,
        azureCapacityType: str | None = None,
        preferredAzureRegion: str | None = None,
        lastUpdated: str | None = None,
        priority: str | None = None,
        confidence: str | None = None,
    ) -> Any:
        if not userConfirmed:
            return {"error": "Explicit confirmation required; present the complete editable draft first."}
        recommendation = mc.post("/api/recommendations", json={
            "recommendedMilestoneTitle": milestoneName,
            "opportunityName": opportunityName,
            "suggestedDescription": comments,
            "suggestedOwnerRole": owner,
            "suggestedDueDate": estDate,
            "priority": priority,
            "riskOrDependency": riskDescription or blockedReason,
            "confidence": confidence,
            "humanReviewRequired": True,
            "reviewStatus": "Pending",
            "readyForMockCreation": False,
            "createdByAgent": True,
        })
        fields = {
            "milestoneName": milestoneName,
            "opportunityName": opportunityName,
            "workload": workload,
            "customerCommitment": customerCommitment,
            "deliveredBy": deliveredBy,
            "partnerName": partnerName,
            "milestoneStatus": milestoneStatus,
            "milestoneCategory": milestoneCategory,
            "owner": owner,
            "riskDescription": riskDescription,
            "statusReason": statusReason,
            "estDate": estDate,
            "fitCharge": fitCharge,
            "nonRecurring": nonRecurring,
            "comments": comments,
            "riskImpact": riskImpact,
            "mitigationPlan": mitigationPlan,
            "blockedReason": blockedReason,
            "blockedOwner": blockedOwner,
            "blockedSince": blockedSince,
            "expectedResolutionDate": expectedResolutionDate,
            "escalated": escalated,
            "competitorName": competitorName,
            "azureCapacityType": azureCapacityType,
            "preferredAzureRegion": preferredAzureRegion,
            "lastUpdated": lastUpdated,
        }
        fields = {k: v for k, v in fields.items() if v is not None}
        approval = mc.post("/api/approval-requests", json={
            "requestName": f"Create milestone: {milestoneName}",
            "opportunityName": opportunityName,
            "relatedRecommendationBusinessId": recommendation.get("recommendationBusinessId"),
            "requestedBy": "LegacyAgent",
            "action": {
                "kind": "CreateMilestone",
                "competitorBlankConfirmed": competitorBlankConfirmed,
                **fields,
            },
        })
        return {
            "submittedForApproval": True,
            "recommendationBusinessId": recommendation.get("recommendationBusinessId"),
            "approvalRequestBusinessId": approval.get("approvalRequestBusinessId"),
            "approvalStatus": approval.get("approvalStatus"),
            "note": "Pending human approval. The milestone does not exist until approved.",
        }

    def update_milestone(
        id: str,
        milestoneName: str | None = None,
        milestoneStatus: str | None = None,
        milestoneCategory: str | None = None,
        owner: str | None = None,
    ) -> Any:
        payload = {
            "milestoneName": milestoneName,
            "milestoneStatus": milestoneStatus,
            "milestoneCategory": milestoneCategory,
            "owner": owner,
        }
        payload = {k: v for k, v in payload.items() if v is not None}
        return _trim_milestone(mc.patch(f"/api/milestones/{id}", json=payload))

    def delete_milestone(id: str) -> Any:
        return mc.delete(f"/api/milestones/{id}")

    milestone_tools = [
        Tool("list_milestones", "List milestones, optionally filtered by status.",
             {"type": "object", "properties": {"milestoneStatus": {"type": "string", "enum": MILESTONE_STATUSES}}}, list_milestones),
        Tool("get_milestone", "Get one milestone's full detail by its id.",
             {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}, get_milestone),
        Tool("create_milestone", "After explicit whole-draft confirmation, record a recommendation and submit a milestone for human approval.",
             {"type": "object", "properties": {
                 "userConfirmed": {"type": "boolean"},
                 "milestoneName": {"type": "string"},
                 "opportunityName": {"type": "string", "description": "Must match an existing opportunity name."},
                 "competitorBlankConfirmed": {"type": "boolean"},
                 "workload": {"type": ["string", "null"], "enum": WORKLOADS + [None]},
                 "customerCommitment": {"type": ["string", "null"], "enum": CUSTOMER_COMMITMENTS + [None]},
                 "deliveredBy": {"type": ["string", "null"], "enum": DELIVERED_BY + [None]},
                 "partnerName": {"type": ["string", "null"]},
                 "milestoneStatus": {"type": ["string", "null"], "enum": MILESTONE_STATUSES + [None]},
                 "milestoneCategory": {"type": ["string", "null"], "enum": MILESTONE_CATEGORIES + [None]},
                 "owner": {"type": ["string", "null"]},
                 "riskDescription": {"type": ["string", "null"]},
                 "statusReason": {"type": ["string", "null"]},
                 "estDate": {"type": ["string", "null"]},
                 "fitCharge": {"type": ["number", "null"]},
                 "nonRecurring": {"type": ["boolean", "null"]},
                 "comments": {"type": ["string", "null"]},
                 "riskImpact": {"type": ["string", "null"], "enum": RISK_IMPACTS + [None]},
                 "mitigationPlan": {"type": ["string", "null"]},
                 "blockedReason": {"type": ["string", "null"]},
                 "blockedOwner": {"type": ["string", "null"]},
                 "blockedSince": {"type": ["string", "null"]},
                 "expectedResolutionDate": {"type": ["string", "null"]},
                 "escalated": {"type": ["boolean", "null"]},
                 "competitorName": {"type": ["string", "null"]},
                 "azureCapacityType": {"type": ["string", "null"], "enum": AZURE_CAPACITY_TYPES + [None]},
                 "preferredAzureRegion": {"type": ["string", "null"], "enum": PREFERRED_AZURE_REGIONS + [None]},
                 "lastUpdated": {"type": ["string", "null"]},
                 "priority": {"type": ["string", "null"], "enum": PRIORITIES + [None]},
                 "confidence": {"type": ["string", "null"], "enum": CONFIDENCE_LEVELS + [None]},
             }, "required": ["userConfirmed", "milestoneName", "opportunityName", "competitorBlankConfirmed"]}, create_milestone, destructive=True),
        Tool("update_milestone", "Update fields on an existing milestone by id.",
             {"type": "object", "properties": {
                 "id": {"type": "string"},
                 "milestoneName": {"type": "string"},
                 "milestoneStatus": {"type": "string", "enum": MILESTONE_STATUSES},
                 "milestoneCategory": {"type": "string", "enum": MILESTONE_CATEGORIES},
                 "owner": {"type": "string"},
             }, "required": ["id"]}, update_milestone, destructive=True),
        Tool("delete_milestone", "Delete a milestone by id (its status history is also removed).",
             {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}, delete_milestone, destructive=True),
    ]

    # ---- Dashboard tools -------------------------------------------------
    def get_dashboard_summary() -> Any:
        return mc.get("/api/dashboard/summary")

    dashboard_tools = [
        Tool("get_dashboard_summary", "Get aggregate metrics: active opportunities, total milestones, at-risk, blocked, pending approvals, pipeline value.",
             {"type": "object", "properties": {}}, get_dashboard_summary),
    ]

    # ---- Opportunity tools ----------------------------------------------
    def list_opportunities(status: str | None = None, salesStage: str | None = None) -> Any:
        params = {k: v for k, v in {"status": status, "salesStage": salesStage}.items() if v}
        data = mc.get("/api/opportunities", params=params or None) or []
        return [_trim_opportunity(o) for o in data]

    def get_opportunity(id: str) -> Any:
        return mc.get(f"/api/opportunities/{id}")

    def create_opportunity(
        opportunityName: str,
        userConfirmed: bool,
        customerName: str | None = None,
        industry: str | None = None,
        solutionArea: str | None = None,
        salesStage: str | None = None,
        status: str | None = None,
        estimatedRevenue: float | None = None,
        closeDate: str | None = None,
        aeOwner: str | None = None,
        assignedSE: str | None = None,
        competitorName: str | None = None,
        consumptionPhase: str | None = None,
        businessProblem: str | None = None,
        nextStep: str | None = None,
        lastUpdated: str | None = None,
    ) -> Any:
        if not userConfirmed:
            return {"error": "Explicit confirmation required; present the complete editable draft first."}
        fields = {
            "opportunityName": opportunityName,
            "customerName": customerName,
            "industry": industry,
            "solutionArea": solutionArea,
            "salesStage": salesStage,
            "status": status,
            "estimatedRevenue": estimatedRevenue,
            "closeDate": closeDate,
            "aeOwner": aeOwner,
            "assignedSE": assignedSE,
            "competitorName": competitorName,
            "consumptionPhase": consumptionPhase,
            "businessProblem": businessProblem,
            "nextStep": nextStep,
            "lastUpdated": lastUpdated,
        }
        fields = {k: v for k, v in fields.items() if v is not None}
        approval = mc.post("/api/approval-requests", json={
            "requestName": f"Create opportunity {opportunityName}",
            "requestedBy": "LegacyAgent",
            "action": {"kind": "CreateOpportunity", **fields},
        })
        return {
            "submittedForApproval": True,
            "approvalRequestBusinessId": approval.get("approvalRequestBusinessId"),
            "approvalStatus": approval.get("approvalStatus"),
            "note": "Pending human approval. The opportunity does not exist until approved.",
        }

    opportunity_tools = [
        Tool("list_opportunities", "List opportunities, optionally filtered by status or sales stage.",
             {"type": "object", "properties": {
                 "status": {"type": "string", "enum": OPPORTUNITY_STATUSES},
                 "salesStage": {"type": "string", "enum": SALES_STAGES},
             }}, list_opportunities),
        Tool("get_opportunity", "Get one opportunity's detail (includes its milestones) by id.",
             {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}, get_opportunity),
        Tool("create_opportunity", "After explicit whole-draft confirmation, submit a new opportunity for human approval.",
             {"type": "object", "properties": {
                 "userConfirmed": {"type": "boolean"},
                 "opportunityName": {"type": "string"},
                 "customerName": {"type": ["string", "null"]},
                 "industry": {"type": ["string", "null"]},
                 "solutionArea": {"type": ["string", "null"], "enum": SOLUTION_AREAS + [None]},
                 "salesStage": {"type": ["string", "null"], "enum": SALES_STAGES + [None]},
                 "status": {"type": ["string", "null"], "enum": OPPORTUNITY_STATUSES + [None]},
                 "estimatedRevenue": {"type": ["number", "null"]},
                 "closeDate": {"type": ["string", "null"]},
                 "aeOwner": {"type": ["string", "null"]},
                 "assignedSE": {"type": ["string", "null"]},
                 "competitorName": {"type": ["string", "null"]},
                 "consumptionPhase": {"type": ["string", "null"]},
                 "businessProblem": {"type": ["string", "null"]},
                 "nextStep": {"type": ["string", "null"]},
                 "lastUpdated": {"type": ["string", "null"]},
             }, "required": ["userConfirmed", "opportunityName"]}, create_opportunity, destructive=True),
    ]

    # ---- Search tool -----------------------------------------------------
    def search_records(query: str, entity: str | None = None, field: str | None = None, limit: int | None = None) -> Any:
        params: dict = {"q": query}
        if entity:
            params["entity"] = entity
        if field:
            params["field"] = field
        if limit:
            params["limit"] = limit
        return mc.get("/api/search", params=params)

    search_tool = Tool(
        "search_records",
        "Look up records by ANY field value and return the FULL matching records grouped by "
        "entity. Matches the query case-insensitively as a substring across every field (ids, "
        "names, tpid, customer, industry, owners/AE/SE, competitor, region, dates, amounts, "
        "flags, free text) of the business records. Use it to find a record when you do not have "
        "its OPP-/MS- id (e.g. a TPID like TPID-1001, a customer, a person, a competitor); always "
        "try it before saying a record does not exist.",
        {"type": "object", "properties": {
            "query": {"type": "string", "description": "The value to search for (matched across every field)."},
            "entity": {"type": "string", "enum": SEARCH_ENTITIES, "description": "Optional record type to restrict to. Omit to search all."},
            "field": {"type": "string", "description": "Optional single field name to match on (e.g. tpid, customerName, aeOwner, competitorName)."},
            "limit": {"type": "integer", "description": "Optional max records per entity (default 25)."},
        }, "required": ["query"]},
        search_records,
    )

    return {
        "milestone": milestone_tools + [search_tool],
        "dashboard": dashboard_tools,
        "opportunity": opportunity_tools + [search_tool],
    }
