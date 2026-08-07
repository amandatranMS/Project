"""MSX domain capability functions — the reusable "tool" layer.

Each function wraps one or more MSX REST API calls and returns trimmed JSON.
This module has NO agent-framework dependency on purpose, so the exact same
capabilities can be reused by more than one consumer:
  - the hosted multi-agent app (see ``subagents.py``), and
  - the standalone MCP server (see ``msx_mcp_server.py``), which exposes these
    functions to any MCP-compatible client (other apps, IDEs, or agents).

Adding a new capability = adding one function here; it then becomes available
to both the agents and every MCP consumer at once.
"""
from __future__ import annotations

import difflib
from contextvars import ContextVar, Token
from typing import Annotated, Any

from pydantic import Field

from msx_client import MsxClient
from msx_session import get_session_id

# Controlled choice values (mirror packages/shared) so the model emits values the
# API's Zod validation will accept.
MILESTONE_STATUSES = [
    "---", "On Track", "At Risk", "Blocked", "Completed",
    "Cancelled", "Lost To Competitor", "Hygiene/Duplicate",
]
MILESTONE_CATEGORIES = ["Production", "Pilot", "Workshop", "Assessment", "Deployment", "Adoption"]
SALES_STAGES = ["Listen & Consult", "Inspire & Design", "Empower & Achieve", "Realize Value", "Manage & Optimize"]
OPPORTUNITY_STATUSES = ["Active", "On Hold", "Won", "Lost", "Closed"]
PRIORITIES = ["High", "Medium", "Low"]
CONFIDENCE_LEVELS = ["High", "Medium", "Low"]
# Extra controlled lists needed for full-parity field updates (mirror packages/shared).
SOLUTION_AREAS = ["Modern Work", "Security", "Azure", "AI Apps"]
WORKLOADS = [
    "M365 Copilot for Microsoft 365", "Microsoft Sentinel", "Microsoft Purview",
    "Azure Migration", "Copilot Studio", "Defender XDR", "Teams Premium",
]
CUSTOMER_COMMITMENTS = ["Uncommitted", "Verbal", "Committed", "Contracted"]
DELIVERED_BY = ["Microsoft", "Partner", "Customer", "Joint"]
AZURE_CAPACITY_TYPES = ["---", "Azure Commit", "MACC", "Open", "CSP", "EA"]
PREFERRED_AZURE_REGIONS = [
    "Canada Central", "Canada East", "East US", "West US", "West Europe", "North Europe",
]
RISK_IMPACTS = ["High", "Medium", "Low"]

_mc = MsxClient()
_captured_submissions: ContextVar[list[dict] | None] = ContextVar(
    "captured_submissions",
    default=None,
)


def begin_submission_capture() -> Token:
    return _captured_submissions.set([])


def captured_submissions() -> list[dict]:
    return list(_captured_submissions.get() or [])


def end_submission_capture(token: Token) -> None:
    _captured_submissions.reset(token)


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


def _trim_recommendation(r: dict) -> dict:
    return {
        "id": r.get("id"),
        "recommendationBusinessId": r.get("recommendationBusinessId"),
        "recommendedMilestoneTitle": r.get("recommendedMilestoneTitle"),
        "priority": r.get("priority"),
        "confidence": r.get("confidence"),
        "reviewStatus": r.get("reviewStatus"),
        "opportunity": (r.get("opportunity") or {}).get("opportunityName"),
    }


def _trim_approval(a: dict) -> dict:
    pending_action = a.get("pendingAction") or {}
    return {
        "id": a.get("id"),
        "approvalRequestBusinessId": a.get("approvalRequestBusinessId"),
        "requestName": a.get("requestName"),
        "approvalStatus": a.get("approvalStatus"),
        "requestStatus": a.get("requestStatus"),
        "opportunity": (a.get("opportunity") or {}).get("opportunityName"),
        "relatedRecommendation": (a.get("relatedRecommendation") or {}).get("recommendationBusinessId"),
        "actionKind": pending_action.get("kind"),
        "milestoneFields": pending_action.get("milestoneFields"),
    }


def _resolve_opportunity(identifier: str) -> tuple[str | None, dict | None]:
    """Resolve a user/agent-supplied opportunity identifier to its EXACT name.

    Accepts an exact name, a business id (e.g. OPP-003), a combined label
    ("OPP-003 - Northwind AI Agent Pilot"), or a near-match, so writes don't fail
    on small differences. Returns (exactName, None) on success, or
    (None, errorDict) with candidate suggestions the agent can act on.
    """
    ident = (identifier or "").strip()
    data = _mc.get("/api/opportunities") or []
    if not ident:
        return None, {
            "error": "No opportunity was provided.",
            "hint": "Pass an opportunityName or opportunityBusinessId (e.g. OPP-003).",
            "candidates": [f"{o.get('opportunityBusinessId')} - {o.get('opportunityName')}" for o in data][:10],
        }
    low = ident.lower()
    # 1. exact business id
    for o in data:
        if (o.get("opportunityBusinessId") or "").lower() == low:
            return o.get("opportunityName"), None
    # 2. exact name
    for o in data:
        if (o.get("opportunityName") or "").lower() == low:
            return o.get("opportunityName"), None
    # 3. business id appears inside a label like "OPP-003 - Northwind..."
    for o in data:
        bid = (o.get("opportunityBusinessId") or "").lower()
        if bid and bid in low:
            return o.get("opportunityName"), None
    # 4. name contained either way (handles labels and partial names) - must be unique
    contains = [
        o for o in data
        if (o.get("opportunityName") or "").lower() in low
        or low in (o.get("opportunityName") or "").lower()
    ]
    if len(contains) == 1:
        return contains[0].get("opportunityName"), None
    # 5. fuzzy close match on names - must be unique
    names = [o.get("opportunityName") for o in data if o.get("opportunityName")]
    close = difflib.get_close_matches(ident, names, n=5, cutoff=0.6)
    if len(close) == 1:
        return close[0], None
    return None, {
        "error": f"Could not uniquely match an opportunity for '{identifier}'.",
        "hint": "Ask the user which one, or pass the exact opportunityName or opportunityBusinessId.",
        "candidates": [f"{o.get('opportunityBusinessId')} - {o.get('opportunityName')}" for o in data][:10],
    }


def _submit_action_approval(
    request_name: str,
    action: dict,
    requested_by: str | None = None,
    opportunity_name: str | None = None,
) -> dict:
    """Submit an approval request carrying a deferred action.

    The API executes the action ONLY after a human approves the request in the
    Approvals log. This is how every agent write/send is gated: the agent never
    mutates data or sends messages directly — it submits one of these.
    """
    payload: dict = {
        "requestName": request_name,
        "action": action,
        "requestedBy": requested_by or "HostedAgent",
    }
    if opportunity_name:
        payload["opportunityName"] = opportunity_name
    approval = _mc.post("/api/approval-requests", json=payload) or {}
    captured = _captured_submissions.get()
    if captured is not None and approval.get("approvalRequestBusinessId"):
        captured.append(_trim_approval(approval))
    return approval


# ---- Milestone tools -----------------------------------------------------
def list_milestones(
    opportunity: Annotated[
        str | None,
        Field(
            description=(
                "Optional opportunity filter: an opportunity name or business id "
                "(e.g. OPP-002). When given, ONLY the milestones under that one "
                "opportunity are returned — use this whenever the user asks about a "
                "specific opportunity's milestones."
            ),
        ),
    ] = None,
    milestoneStatus: Annotated[
        str | None,
        Field(description=f"Optional status filter. One of: {MILESTONE_STATUSES}."),
    ] = None,
) -> Any:
    """List EXISTING milestones, optionally scoped to one opportunity and/or status.

    Returns exactly the milestones the API stores — nothing is fabricated or padded.
    When ``opportunity`` is provided, the result contains ONLY milestones under that
    opportunity, so you can answer "which milestones does OPP-XXX have?" precisely
    instead of guessing from the full list. Recommendations and approval requests are
    NOT milestones and are never included here.
    """
    params = {"milestoneStatus": milestoneStatus} if milestoneStatus else None
    data = _mc.get("/api/milestones", params=params) or []

    if opportunity:
        exact_name, err = _resolve_opportunity(opportunity)
        if err:
            return err
        target = (exact_name or "").strip().lower()
        data = [
            m
            for m in data
            if ((m.get("opportunity") or {}).get("opportunityName") or "").strip().lower() == target
        ]
    return [_trim_milestone(m) for m in data]


def get_milestone(
    id: Annotated[str, Field(description="The milestone id or business id (e.g. MS-001).")],
) -> Any:
    """Get one milestone's full detail by its id."""
    return _mc.get(f"/api/milestones/{id}")


def get_milestone_handoff_readiness(
    id: Annotated[str, Field(description="The milestone id or business id (e.g. MS-001).")],
) -> Any:
    """Check whether a milestone carries the CSA-critical handoff info a delivery team needs.

    Covers customer intent (do they actually plan to deploy — buying is not intent), what was
    promised, deployment details, BANT (budget, authority/owner, need, timeline), and who to
    contact. Returns a completeness score, a `missing` list (each with `whatsMissing` +
    `howToFix`), the checks already `present`, and `suggestedDescription` — a ready-to-paste
    "CSA Handoff Notes" block for the milestone description. Informational only; never blocks a save.
    """
    return _mc.get(f"/api/milestones/{id}/handoff-readiness")


def update_milestone(
    id: Annotated[str, Field(description="The milestone id or business id (e.g. MS-001) to update.")],
    milestoneName: Annotated[str | None, Field(description="New name.")] = None,
    milestoneStatus: Annotated[str | None, Field(description=f"One of: {MILESTONE_STATUSES}. Setting 'Lost To Competitor' REQUIRES a competitorName — ask the user which competitor if the milestone doesn't already have one.")] = None,
    milestoneCategory: Annotated[str | None, Field(description=f"One of: {MILESTONE_CATEGORIES}.")] = None,
    owner: Annotated[str | None, Field(description="New owner name.")] = None,
    workload: Annotated[str | None, Field(description=f"One of: {WORKLOADS}.")] = None,
    customerCommitment: Annotated[str | None, Field(description=f"One of: {CUSTOMER_COMMITMENTS}.")] = None,
    deliveredBy: Annotated[str | None, Field(description=f"One of: {DELIVERED_BY}.")] = None,
    partnerName: Annotated[str | None, Field(description="Partner name.")] = None,
    statusReason: Annotated[str | None, Field(description="Reason for the current status.")] = None,
    estDate: Annotated[str | None, Field(description="Estimated date (ISO, e.g. 2026-07-21).")] = None,
    fitCharge: Annotated[float | None, Field(description="Fit charge amount (number).")] = None,
    nonRecurring: Annotated[bool | None, Field(description="Whether the charge is non-recurring.")] = None,
    comments: Annotated[str | None, Field(description="Free-text comments.")] = None,
    riskDescription: Annotated[str | None, Field(description="Risk description.")] = None,
    riskImpact: Annotated[str | None, Field(description=f"One of: {RISK_IMPACTS}.")] = None,
    mitigationPlan: Annotated[str | None, Field(description="Risk mitigation plan.")] = None,
    blockedReason: Annotated[str | None, Field(description="Why the milestone is blocked.")] = None,
    blockedOwner: Annotated[str | None, Field(description="Who owns unblocking it.")] = None,
    blockedSince: Annotated[str | None, Field(description="Blocked since (ISO date).")] = None,
    expectedResolutionDate: Annotated[str | None, Field(description="Expected resolution date (ISO date).")] = None,
    escalated: Annotated[bool | None, Field(description="Whether the blocker is escalated.")] = None,
    competitorName: Annotated[str | None, Field(description="Milestone competitor name. This updates the milestone, not its opportunity.")] = None,
    azureCapacityType: Annotated[str | None, Field(description=f"One of: {AZURE_CAPACITY_TYPES}.")] = None,
    preferredAzureRegion: Annotated[str | None, Field(description=f"One of: {PREFERRED_AZURE_REGIONS}.")] = None,
    lastUpdated: Annotated[str | None, Field(description="Last-updated date (ISO date).")] = None,
) -> Any:
    """Request an update to any field(s) of an existing milestone. This does NOT
    change anything — it submits an approval request that a human must approve in
    the Approvals log before the update is applied."""
    fields = {
        "milestoneName": milestoneName,
        "milestoneStatus": milestoneStatus,
        "milestoneCategory": milestoneCategory,
        "owner": owner,
        "workload": workload,
        "customerCommitment": customerCommitment,
        "deliveredBy": deliveredBy,
        "partnerName": partnerName,
        "statusReason": statusReason,
        "estDate": estDate,
        "fitCharge": fitCharge,
        "nonRecurring": nonRecurring,
        "comments": comments,
        "riskDescription": riskDescription,
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
    if not fields:
        return {"error": "Provide at least one field to update."}

    # Fetch the milestone once: used to name the opportunity on the approval and,
    # for "Lost To Competitor", to check whether a competitor is already recorded.
    milestone = None
    try:
        milestone = _mc.get(f"/api/milestones/{id}")
    except Exception:
        milestone = None

    # HARD RULE: a milestone can only be marked "Lost To Competitor" with a
    # competitor. If none is supplied and the milestone has none, ask the user
    # which competitor before submitting anything for approval.
    if fields.get("milestoneStatus") == "Lost To Competitor":
        supplied = (competitorName or "").strip()
        existing = (milestone.get("competitorName") or "").strip() if isinstance(milestone, dict) else ""
        if not supplied and not existing:
            return {
                "error": 'A competitor is required to mark a milestone "Lost To Competitor".',
                "requiredQuestion": "Which competitor was this milestone lost to?",
            }

    changes = ", ".join(f"{k}={v}" for k, v in fields.items())
    action = {"kind": "UpdateMilestone", "milestoneId": id, **fields}
    try:
        opp = (milestone.get("opportunity") or {}).get("opportunityName") if isinstance(milestone, dict) else None
        appr = _submit_action_approval(f"Update milestone {id}: {changes}", action, opportunity_name=opp)
        return {
            "submittedForApproval": True,
            "approvalRequestBusinessId": (appr or {}).get("approvalRequestBusinessId"),
            "note": "Pending human approval in the Approvals log. The milestone is NOT changed until a human approves.",
        }
    except Exception as e:
        return {"error": f"Failed to submit milestone update for approval: {e}"}


def delete_milestone(id: Annotated[str, Field(description="The milestone id to delete.")]) -> Any:
    """Request deletion of a milestone. This does NOT delete anything — it submits an
    approval request that a human must approve in the Approvals log before the
    milestone is deleted."""
    action = {"kind": "DeleteMilestone", "milestoneId": id}
    try:
        opp = None
        try:
            m = _mc.get(f"/api/milestones/{id}")
            opp = (m.get("opportunity") or {}).get("opportunityName") if isinstance(m, dict) else None
        except Exception:
            opp = None
        appr = _submit_action_approval(f"Delete milestone {id}", action, opportunity_name=opp)
        return {
            "submittedForApproval": True,
            "approvalRequestBusinessId": (appr or {}).get("approvalRequestBusinessId"),
            "note": "Pending human approval in the Approvals log. The milestone is NOT deleted until a human approves.",
        }
    except Exception as e:
        return {"error": f"Failed to submit milestone deletion for approval: {e}"}


# ---- Dashboard tools -----------------------------------------------------
def get_dashboard_summary() -> Any:
    """Get aggregate metrics: active opportunities, total milestones, at-risk, blocked, pending approvals, pipeline value."""
    return _mc.get("/api/dashboard/summary")


# ---- Opportunity tools ---------------------------------------------------
def list_opportunities(
    status: Annotated[str | None, Field(description=f"Optional status filter. One of: {OPPORTUNITY_STATUSES}.")] = None,
    salesStage: Annotated[str | None, Field(description=f"Optional sales stage filter. One of: {SALES_STAGES}.")] = None,
) -> Any:
    """List opportunities, optionally filtered by status or sales stage."""
    params = {k: v for k, v in {"status": status, "salesStage": salesStage}.items() if v}
    data = _mc.get("/api/opportunities", params=params or None) or []
    return [_trim_opportunity(o) for o in data]


def get_opportunity(id: Annotated[str, Field(description="The opportunity id or business id (e.g. OPP-003).")]) -> Any:
    """Get one opportunity's detail (includes its milestones) by id or business id."""
    return _mc.get(f"/api/opportunities/{id}")


def get_handoff_readiness(id: Annotated[str, Field(description="The opportunity id or business id (e.g. OPP-003).")]) -> Any:
    """Assess whether an opportunity is ready to hand off from pre-sales (AE/SE) to delivery (CSA/CSAM).

    Returns a 0–100 score, a `ready` flag, a `headline`, a `missing` list (each with `item`,
    `whatsMissing`, and `howToFix`), the checks already `present`, and `nextSteps`. Use this
    whenever the user asks if an opportunity/deal is ready to hand off, is handoff-ready, what is
    missing before handoff, or about CSA/CSAM readiness for a deal.
    """
    return _mc.get(f"/api/opportunities/{id}/handoff-readiness")


def get_esif_estimate(id: Annotated[str, Field(description="The opportunity id or business id (e.g. OPP-003).")]) -> Any:
    """Estimate the ESIF deployment/adoption funding that could back an opportunity, plus the funding path.

    Returns a MOCK, transparent estimate: `estimatedFundingUsd`, an `eligible` flag, a `pathLabel`
    and `recommendedPath` (Microsoft- vs partner- vs joint- vs customer-led), a `confidence` level,
    a `headline`, a `basis` list (each with `factor` and `detail`) explaining how the number was
    derived, and `caveats`. Use this whenever the user asks about ESIF, ECIF, deployment/adoption
    funding, how much funding a deal could get, or the funding path/partner for an opportunity.
    Always present it as a mock planning estimate, never an official ESIF/ECIF quote.
    """
    return _mc.get(f"/api/opportunities/{id}/esif-estimate")


def create_opportunity(
    opportunityName: Annotated[str, Field(description="Name of the new opportunity.")],
    userConfirmed: Annotated[bool, Field(description="True only after the user explicitly confirmed the complete displayed draft.")],
    customerName: Annotated[str | None, Field(description="Customer name.")] = None,
    industry: Annotated[str | None, Field(description="Industry.")] = None,
    solutionArea: Annotated[str | None, Field(description=f"One of: {SOLUTION_AREAS}.")] = None,
    salesStage: Annotated[str | None, Field(description=f"One of: {SALES_STAGES}.")] = None,
    status: Annotated[str | None, Field(description=f"One of: {OPPORTUNITY_STATUSES}.")] = None,
    estimatedRevenue: Annotated[float | None, Field(description="Estimated revenue (number).")] = None,
    closeDate: Annotated[str | None, Field(description="Close date (ISO, e.g. 2026-07-21).")] = None,
    aeOwner: Annotated[str | None, Field(description="Account executive owner.")] = None,
    assignedSE: Annotated[str | None, Field(description="Assigned solution engineer.")] = None,
    competitorName: Annotated[str | None, Field(description="Competitor name.")] = None,
    consumptionPhase: Annotated[str | None, Field(description="Consumption phase.")] = None,
    businessProblem: Annotated[str | None, Field(description="Business problem.")] = None,
    nextStep: Annotated[str | None, Field(description="Next step.")] = None,
    lastUpdated: Annotated[str | None, Field(description="Last-updated date (ISO date).")] = None,
) -> Any:
    """Request creation of a new opportunity. This does NOT create anything — it
    submits an approval request that a human must approve in the Approvals log
    before the opportunity is created. The TPID is auto-assigned (next sequential
    number) on creation, so do not ask the user for one unless they volunteer it."""
    if not userConfirmed:
        return {
            "error": "Explicit confirmation required before submission.",
            "requiredAction": "Present the complete editable opportunity draft and ask the user to edit or confirm it.",
        }
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
    action = {"kind": "CreateOpportunity", **fields}
    try:
        appr = _submit_action_approval(f"Create opportunity {opportunityName}", action)
        return {
            "submittedForApproval": True,
            "approvalRequestBusinessId": (appr or {}).get("approvalRequestBusinessId"),
            "note": "Pending human approval in the Approvals log. The opportunity is NOT created until a human approves.",
        }
    except Exception as e:
        return {"error": f"Failed to submit opportunity creation for approval: {e}"}


def update_opportunity(
    id: Annotated[str, Field(description="The opportunity id OR business id (e.g. OPP-003).")],
    opportunityName: Annotated[str | None, Field(description="New opportunity name.")] = None,
    tpid: Annotated[str | None, Field(description="TPID.")] = None,
    customerName: Annotated[str | None, Field(description="Customer name.")] = None,
    industry: Annotated[str | None, Field(description="Industry.")] = None,
    solutionArea: Annotated[str | None, Field(description=f"One of: {SOLUTION_AREAS}.")] = None,
    salesStage: Annotated[str | None, Field(description=f"One of: {SALES_STAGES}.")] = None,
    status: Annotated[str | None, Field(description=f"One of: {OPPORTUNITY_STATUSES}.")] = None,
    estimatedRevenue: Annotated[float | None, Field(description="Estimated revenue (number).")] = None,
    closeDate: Annotated[str | None, Field(description="Close date (ISO, e.g. 2026-07-21).")] = None,
    aeOwner: Annotated[str | None, Field(description="Account executive owner.")] = None,
    assignedSE: Annotated[str | None, Field(description="Assigned solution engineer.")] = None,
    competitorName: Annotated[str | None, Field(description="Competitor name.")] = None,
    consumptionPhase: Annotated[str | None, Field(description="Consumption phase.")] = None,
    businessProblem: Annotated[str | None, Field(description="Business problem.")] = None,
    nextStep: Annotated[str | None, Field(description="Next step.")] = None,
    lastUpdated: Annotated[str | None, Field(description="Last-updated date (ISO date).")] = None,
) -> Any:
    """Request an update to any field(s) of an existing opportunity. This does NOT
    change anything — it submits an approval request that a human must approve in
    the Approvals log before the update is applied."""
    fields = {
        "opportunityName": opportunityName,
        "tpid": tpid,
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
    if not fields:
        return {"error": "Provide at least one field to update."}
    changes = ", ".join(f"{k}={v}" for k, v in fields.items())
    action = {"kind": "UpdateOpportunity", "opportunityId": id, **fields}
    try:
        opp_name = None
        try:
            o = _mc.get(f"/api/opportunities/{id}")
            opp_name = o.get("opportunityName") if isinstance(o, dict) else None
        except Exception:
            opp_name = None
        appr = _submit_action_approval(f"Update opportunity {id}: {changes}", action, opportunity_name=opp_name)
        return {
            "submittedForApproval": True,
            "approvalRequestBusinessId": (appr or {}).get("approvalRequestBusinessId"),
            "note": "Pending human approval in the Approvals log. The opportunity is NOT changed until a human approves.",
        }
    except Exception as e:
        return {"error": f"Failed to submit opportunity update for approval: {e}"}


# ---- Universal search ----------------------------------------------------
SEARCH_ENTITIES = [
    "opportunity", "milestone", "statusHistory", "recommendation", "note",
    "dealTeam", "notification", "runLog", "snapshot",
]


def search_records(
    query: Annotated[
        str,
        Field(
            description=(
                "The value to look up. Matched case-insensitively as a SUBSTRING against "
                "EVERY field of the records — ids, names, tpid, customer, industry, sales "
                "stage, owners (AE/SE), competitor, region, dates, amounts, flags, and free "
                "text. Use this whenever the user refers to a record by any value that is "
                "not an OPP-/MS- id (e.g. a TPID like TPID-1001, a customer, a person, a "
                "competitor)."
            ),
        ),
    ],
    entity: Annotated[
        str | None,
        Field(
            description=(
                "Optional record type to restrict to. One of: "
                f"{SEARCH_ENTITIES}. Omit to search ALL of them."
            ),
        ),
    ] = None,
    field: Annotated[
        str | None,
        Field(
            description=(
                "Optional single field name to match on (e.g. tpid, customerName, aeOwner, "
                "assignedSE, competitorName, preferredAzureRegion). Omit to match any field."
            ),
        ),
    ] = None,
    limit: Annotated[
        int | None,
        Field(description="Optional max records returned per entity (default 25)."),
    ] = None,
) -> Any:
    """Look up records by ANY field value and return the FULL matching records.

    This is the way to find a record when you do not have its OPP-/MS- id. It
    searches across the global business records (opportunities, milestones,
    status history, recommendations, notes, deal team members, notifications, run
    logs, dashboard snapshots) and returns every record whose fields contain the
    query, grouped by entity, each tagged with the `_matchedFields` that matched.
    Always try this before telling the user a record does not exist. It is a
    read: nothing is changed and no approval is needed. (Approval requests and the
    audit log are not searched here — use the governance tools for those.)
    """
    params: dict = {"q": query}
    if entity:
        params["entity"] = entity
    if field:
        params["field"] = field
    if limit:
        params["limit"] = limit
    return _mc.get("/api/search", params=params)


def list_deal_team(
    opportunityId: Annotated[str, Field(description="The opportunity id OR business id (e.g. OPP-003) whose deal team to list.")],
) -> Any:
    """List the deal team members on an opportunity, returning each member's id so
    they can be targeted by update_deal_team_member."""
    try:
        o = _mc.get(f"/api/opportunities/{opportunityId}")
    except Exception as e:
        return {"error": f"Could not load opportunity {opportunityId}: {e}"}
    members = (o or {}).get("dealTeamMembers") or [] if isinstance(o, dict) else []
    return [
        {
            "id": m.get("id"),
            "dealTeamMemberBusinessId": m.get("dealTeamMemberBusinessId"),
            "personName": m.get("personName"),
            "role": m.get("role"),
            "teamArea": m.get("teamArea"),
            "active": m.get("active"),
            "handoffRequired": m.get("handoffRequired"),
        }
        for m in members
    ]


def update_deal_team_member(
    id: Annotated[str, Field(description="The deal team member id OR business id (e.g. DT-003). Use list_deal_team to find it.")],
    personName: Annotated[str | None, Field(description="Person's name.")] = None,
    role: Annotated[str | None, Field(description="Role on the deal.")] = None,
    teamArea: Annotated[str | None, Field(description="Team area.")] = None,
    addedDate: Annotated[str | None, Field(description="Date added (ISO, e.g. 2026-07-21).")] = None,
    active: Annotated[bool | None, Field(description="Whether the member is active.")] = None,
    handoffRequired: Annotated[bool | None, Field(description="Whether a handoff is required.")] = None,
    handoffNotes: Annotated[str | None, Field(description="Handoff notes.")] = None,
    opportunityName: Annotated[str | None, Field(description="Optional parent opportunity name/id, to link the approval request.")] = None,
) -> Any:
    """Request an update to any field(s) of a deal team member. This does NOT
    change anything — it submits an approval request that a human must approve in
    the Approvals log before the update is applied."""
    fields = {
        "personName": personName,
        "role": role,
        "teamArea": teamArea,
        "addedDate": addedDate,
        "active": active,
        "handoffRequired": handoffRequired,
        "handoffNotes": handoffNotes,
    }
    fields = {k: v for k, v in fields.items() if v is not None}
    if not fields:
        return {"error": "Provide at least one field to update."}
    changes = ", ".join(f"{k}={v}" for k, v in fields.items())
    action = {"kind": "UpdateDealTeamMember", "dealTeamMemberId": id, **fields}
    try:
        opp_name = None
        if opportunityName:
            opp_name, _ = _resolve_opportunity(opportunityName)
        appr = _submit_action_approval(
            f"Update deal team member {id}: {changes}", action, opportunity_name=opp_name
        )
        return {
            "submittedForApproval": True,
            "approvalRequestBusinessId": (appr or {}).get("approvalRequestBusinessId"),
            "note": "Pending human approval in the Approvals log. The deal team member is NOT changed until a human approves.",
        }
    except Exception as e:
        return {"error": f"Failed to submit deal team member update for approval: {e}"}


# ---- Governance tools (recommend -> request approval -> human approves) --
# A milestone can ONLY be created by a human approving an approval request.
# These tools let the agent propose and request; they never create a milestone
# and never approve/reject (those are human-only, done in the web UI).
def create_recommendation(
    recommendedMilestoneTitle: Annotated[str, Field(description="Title of the milestone being recommended.")],
    opportunityName: Annotated[str, Field(description="The opportunity's exact name OR its business id (e.g. OPP-003) OR a label; it is resolved automatically.")],
    competitorName: Annotated[str | None, Field(description="Milestone competitor explicitly supplied or explicitly confirmed for this milestone by the user. This is separate from Opportunity.competitorName; never copy or infer the opportunity competitor.")],
    competitorBlankConfirmed: Annotated[bool, Field(description="True only after the user explicitly confirmed that Competitor should be blank.")],
    suggestedDescription: Annotated[str | None, Field(description="Why this milestone is recommended / what it covers.")] = None,
    suggestedOwnerRole: Annotated[str | None, Field(description="Suggested owner or role.")] = None,
    suggestedDueDate: Annotated[str | None, Field(description="Suggested due date (ISO, e.g. 2026-07-21). Use only after user confirmation.")] = None,
    priority: Annotated[str | None, Field(description=f"One of: {PRIORITIES}.")] = None,
    businessValue: Annotated[str | None, Field(description="Expected business value.")] = None,
    riskOrDependency: Annotated[str | None, Field(description="Known risk or dependency supporting the recommendation.")] = None,
    confidence: Annotated[str | None, Field(description=f"One of: {CONFIDENCE_LEVELS}.")] = None,
) -> Any:
    """Create an AI milestone recommendation under an opportunity. This does NOT create a milestone; it records a suggestion for human review."""
    if not (competitorName or "").strip() and not competitorBlankConfirmed:
        return {
            "error": "Competitor confirmation required before creating a recommendation.",
            "requiredQuestion": "Are you sure you want to leave Competitor empty?",
        }
    resolved_name, err = _resolve_opportunity(opportunityName)
    if err:
        return err
    payload = {
        "recommendedMilestoneTitle": recommendedMilestoneTitle,
        "opportunityName": resolved_name,
        "suggestedDescription": suggestedDescription,
        "suggestedOwnerRole": suggestedOwnerRole,
        "suggestedDueDate": suggestedDueDate,
        "priority": priority,
        "businessValue": businessValue,
        "riskOrDependency": riskOrDependency,
        "confidence": confidence,
        "reviewStatus": "Pending",
        "createdByAgent": True,
    }
    payload = {k: v for k, v in payload.items() if v is not None}
    try:
        return _trim_recommendation(_mc.post("/api/recommendations", json=payload))
    except Exception as e:  # surface a recoverable message instead of a hard failure
        return {"error": f"Failed to create recommendation: {e}", "opportunityUsed": resolved_name}


def submit_approval_request(
    requestName: Annotated[str, Field(description="Short name for the approval request.")],
    opportunityName: Annotated[str, Field(description="The opportunity's exact name OR its business id (e.g. OPP-003) OR a label; it is resolved automatically. Use the same opportunity as the recommendation.")],
    relatedRecommendationBusinessId: Annotated[str, Field(description="The recommendationBusinessId returned by create_recommendation.")],
    milestoneName: Annotated[str, Field(description="User-confirmed milestone name.")],
    competitorName: Annotated[str | None, Field(description="User-confirmed milestone competitor. Opportunity competitor is a separate field and must not be copied without explicit confirmation for this milestone. Pass None only after the user explicitly confirms it should be blank.")],
    competitorBlankConfirmed: Annotated[bool, Field(description="True only when the user explicitly confirmed that Competitor should be left empty; otherwise false.")],
    workload: Annotated[str | None, Field(description=f"One of: {WORKLOADS}.")] = None,
    customerCommitment: Annotated[str | None, Field(description=f"One of: {CUSTOMER_COMMITMENTS}.")] = None,
    deliveredBy: Annotated[str | None, Field(description=f"One of: {DELIVERED_BY}.")] = None,
    partnerName: Annotated[str | None, Field(description="Partner name; omit when not applicable.")] = None,
    milestoneCategory: Annotated[str | None, Field(description=f"One of: {MILESTONE_CATEGORIES}.")] = None,
    milestoneStatus: Annotated[str | None, Field(description=f"One of: {MILESTONE_STATUSES}.")] = None,
    statusReason: Annotated[str | None, Field(description="Reason for the selected status.")] = None,
    estDate: Annotated[str | None, Field(description="User-confirmed estimated date (ISO, e.g. 2026-07-21).")]= None,
    fitCharge: Annotated[float | None, Field(description="User-confirmed fit charge amount.")] = None,
    nonRecurring: Annotated[bool | None, Field(description="Whether the charge is non-recurring.")] = None,
    comments: Annotated[str | None, Field(description="Milestone comments.")] = None,
    riskDescription: Annotated[str | None, Field(description="Known risk description; omit when not applicable.")] = None,
    riskImpact: Annotated[str | None, Field(description=f"One of: {RISK_IMPACTS}.")] = None,
    mitigationPlan: Annotated[str | None, Field(description="Risk mitigation plan; omit when not applicable.")] = None,
    blockedReason: Annotated[str | None, Field(description="Why the milestone is blocked; omit unless status is Blocked.")] = None,
    blockedOwner: Annotated[str | None, Field(description="Who owns unblocking; omit unless status is Blocked.")] = None,
    blockedSince: Annotated[str | None, Field(description="Blocked-since date (ISO); omit unless status is Blocked.")] = None,
    expectedResolutionDate: Annotated[str | None, Field(description="Expected resolution date (ISO); omit unless status is Blocked.")] = None,
    escalated: Annotated[bool | None, Field(description="Whether the blocker is escalated; omit unless status is Blocked.")] = None,
    azureCapacityType: Annotated[str | None, Field(description=f"One of: {AZURE_CAPACITY_TYPES}.")] = None,
    preferredAzureRegion: Annotated[str | None, Field(description=f"One of: {PREFERRED_AZURE_REGIONS}.")] = None,
    owner: Annotated[str | None, Field(description="User-confirmed milestone owner.")] = None,
    lastUpdated: Annotated[str | None, Field(description="Last-updated date (ISO).")]= None,
    requestedBy: Annotated[str | None, Field(description="Who is requesting (defaults to the agent).")] = None,
) -> Any:
    """Submit a complete milestone payload for approval. A human must approve it in
    the web UI before the milestone is created. This tool never creates a milestone."""
    resolved_name, err = _resolve_opportunity(opportunityName)
    if err:
        return err
    milestone_fields = {
        "milestoneName": milestoneName,
        "opportunityName": resolved_name,
        "competitorName": competitorName,
        "workload": workload,
        "customerCommitment": customerCommitment,
        "deliveredBy": deliveredBy,
        "partnerName": partnerName,
        "milestoneCategory": milestoneCategory,
        "milestoneStatus": milestoneStatus,
        "statusReason": statusReason,
        "estDate": estDate,
        "fitCharge": fitCharge,
        "nonRecurring": nonRecurring,
        "comments": comments,
        "riskDescription": riskDescription,
        "riskImpact": riskImpact,
        "mitigationPlan": mitigationPlan,
        "blockedReason": blockedReason,
        "blockedOwner": blockedOwner,
        "blockedSince": blockedSince,
        "expectedResolutionDate": expectedResolutionDate,
        "escalated": escalated,
        "azureCapacityType": azureCapacityType,
        "preferredAzureRegion": preferredAzureRegion,
        "owner": owner,
        "lastUpdated": lastUpdated,
    }
    milestone_fields = {k: v for k, v in milestone_fields.items() if v is not None}
    payload = {
        "requestName": requestName,
        "opportunityName": resolved_name,
        "relatedRecommendationBusinessId": relatedRecommendationBusinessId,
        "requestStatus": "Submitted",
        "requestedBy": requestedBy or "HostedAgent",
        "action": {
            "kind": "CreateMilestone",
            "competitorBlankConfirmed": competitorBlankConfirmed,
            **milestone_fields,
        },
    }
    payload = {k: v for k, v in payload.items() if v is not None}
    try:
        return _trim_approval(_mc.post("/api/approval-requests", json=payload))
    except Exception as e:  # surface a recoverable message instead of a hard failure
        return {"error": f"Failed to submit approval request: {e}", "opportunityUsed": resolved_name}


def propose_milestone_for_approval(
    recommendedMilestoneTitle: Annotated[str, Field(description="User-confirmed milestone name.")],
    opportunityName: Annotated[str, Field(description="Opportunity name or business id.")],
    competitorName: Annotated[str | None, Field(description="User-confirmed milestone competitor. Never copy Opportunity.competitorName without explicit milestone-specific confirmation.")],
    competitorBlankConfirmed: Annotated[bool, Field(description="True only after the user explicitly confirmed Competitor should be blank.")],
    suggestedDescription: Annotated[str, Field(description="Complete milestone description/comments confirmed by the user.")],
    userConfirmed: Annotated[bool, Field(description="True only after the user explicitly confirmed the complete displayed draft.")],
    milestoneCategory: Annotated[str | None, Field(description=f"One of: {MILESTONE_CATEGORIES}.")] = None,
    owner: Annotated[str | None, Field(description="User-confirmed milestone owner.")] = None,
    estDate: Annotated[str | None, Field(description="User-confirmed estimated date (ISO).")]= None,
    deliveredBy: Annotated[str | None, Field(description=f"One of: {DELIVERED_BY}.")] = None,
    fitCharge: Annotated[float | None, Field(description="User-confirmed fit charge amount.")] = None,
    nonRecurring: Annotated[bool | None, Field(description="Whether the charge is non-recurring.")] = None,
    customerCommitment: Annotated[str | None, Field(description=f"One of: {CUSTOMER_COMMITMENTS}.")] = None,
    workload: Annotated[str | None, Field(description=f"One of: {WORKLOADS}.")] = None,
    azureCapacityType: Annotated[str | None, Field(description=f"One of: {AZURE_CAPACITY_TYPES}.")] = None,
    preferredAzureRegion: Annotated[str | None, Field(description=f"One of: {PREFERRED_AZURE_REGIONS}.")] = None,
    riskImpact: Annotated[str | None, Field(description=f"One of: {RISK_IMPACTS}.")] = None,
    milestoneStatus: Annotated[str | None, Field(description=f"One of: {MILESTONE_STATUSES}.")] = None,
    statusReason: Annotated[str | None, Field(description="Reason for the selected status.")] = None,
    partnerName: Annotated[str | None, Field(description="Partner name; omit when not applicable.")] = None,
    riskDescription: Annotated[str | None, Field(description="Known risk description.")] = None,
    mitigationPlan: Annotated[str | None, Field(description="Risk mitigation plan.")] = None,
    blockedReason: Annotated[str | None, Field(description="Why the milestone is blocked.")] = None,
    blockedOwner: Annotated[str | None, Field(description="Who owns unblocking.")] = None,
    blockedSince: Annotated[str | None, Field(description="Blocked-since date (ISO).")]= None,
    expectedResolutionDate: Annotated[str | None, Field(description="Expected resolution date (ISO).")]= None,
    escalated: Annotated[bool | None, Field(description="Whether the blocker is escalated.")] = None,
    lastUpdated: Annotated[str | None, Field(description="Last-updated date (ISO).")]= None,
    priority: Annotated[str | None, Field(description=f"Recommendation priority. One of: {PRIORITIES}.")] = None,
    confidence: Annotated[str | None, Field(description=f"Recommendation confidence. One of: {CONFIDENCE_LEVELS}.")] = None,
    requestedBy: Annotated[str | None, Field(description="Who is requesting (defaults to the hosted agent).")] = None,
) -> Any:
    """In one tool call, record a recommendation and submit its complete milestone payload
    for human approval. No milestone is created until a human approves the request."""
    if not userConfirmed:
        return {
            "error": "Explicit confirmation required before submission.",
            "requiredAction": "Present the complete editable milestone draft and ask the user to edit or confirm it.",
        }
    if not (competitorName or "").strip() and not competitorBlankConfirmed:
        return {
            "error": "Competitor confirmation required before submission.",
            "requiredQuestion": "Are you sure you want to leave Competitor empty?",
        }

    recommendation = create_recommendation(
        recommendedMilestoneTitle=recommendedMilestoneTitle,
        opportunityName=opportunityName,
        competitorName=competitorName,
        competitorBlankConfirmed=competitorBlankConfirmed,
        suggestedDescription=suggestedDescription,
        suggestedOwnerRole=owner,
        suggestedDueDate=estDate,
        priority=priority,
        riskOrDependency=riskDescription or blockedReason,
        confidence=confidence,
    )
    if not isinstance(recommendation, dict) or recommendation.get("error"):
        return recommendation

    recommendation_id = recommendation.get("recommendationBusinessId")
    if not recommendation_id:
        return {"error": "Recommendation was created without a business id; approval was not submitted."}

    approval = submit_approval_request(
        requestName=f"Create milestone: {recommendedMilestoneTitle}",
        opportunityName=opportunityName,
        relatedRecommendationBusinessId=recommendation_id,
        milestoneName=recommendedMilestoneTitle,
        competitorName=competitorName,
        competitorBlankConfirmed=competitorBlankConfirmed,
        workload=workload,
        customerCommitment=customerCommitment,
        deliveredBy=deliveredBy,
        partnerName=partnerName,
        milestoneCategory=milestoneCategory,
        milestoneStatus=milestoneStatus,
        statusReason=statusReason,
        estDate=estDate,
        fitCharge=fitCharge,
        nonRecurring=nonRecurring,
        comments=suggestedDescription,
        riskDescription=riskDescription,
        riskImpact=riskImpact,
        mitigationPlan=mitigationPlan,
        blockedReason=blockedReason,
        blockedOwner=blockedOwner,
        blockedSince=blockedSince,
        expectedResolutionDate=expectedResolutionDate,
        escalated=escalated,
        azureCapacityType=azureCapacityType,
        preferredAzureRegion=preferredAzureRegion,
        owner=owner,
        lastUpdated=lastUpdated,
        requestedBy=requestedBy,
    )
    if not isinstance(approval, dict) or approval.get("error"):
        return approval

    captured_fields = approval.get("milestoneFields")
    if approval.get("actionKind") != "CreateMilestone" or not isinstance(captured_fields, dict):
        return {
            "error": "The approval API did not confirm the stored CreateMilestone payload.",
            "recommendationBusinessId": recommendation_id,
            "approvalRequestBusinessId": approval.get("approvalRequestBusinessId"),
            "requiredAction": "Do not claim that milestone fields were captured; investigate or resubmit after the API is updated.",
        }
    return {
        "submittedForApproval": True,
        "recommendationBusinessId": recommendation_id,
        "approvalRequestBusinessId": approval.get("approvalRequestBusinessId"),
        "requestStatus": approval.get("requestStatus"),
        "approvalStatus": approval.get("approvalStatus"),
        "capturedFields": captured_fields,
        "note": "Pending human approval. The milestone does not exist until approved.",
    }


def list_pending_approvals() -> Any:
    """List approval requests still awaiting a human decision (approvalStatus = Pending)."""
    data = _mc.get("/api/approval-requests", params={"approvalStatus": "Pending"}) or []
    return [_trim_approval(a) for a in data]


def list_approvals(
    approvalStatus: Annotated[
        str | None,
        Field(
            description=(
                "Optional status filter. One of: Pending, Approved, Rejected, "
                "Needs Changes. Omit to list every approval request across all "
                "statuses (the full governance history)."
            ),
        ),
    ] = None,
) -> Any:
    """List approval requests in the governance queue, optionally filtered by status
    (Pending, Approved, Rejected, Needs Changes). Read-only visibility into the approval
    pipeline and each request's disposition (what action it will perform and whether a
    human has decided it yet). This NEVER approves, rejects, or changes anything."""
    params = {"approvalStatus": approvalStatus} if approvalStatus else None
    data = _mc.get("/api/approval-requests", params=params) or []
    return [_trim_approval(a) for a in data]


# ---- Communications tools (Outlook / Teams — draft, then approval-gated) ----
# Two-step by design so the user can review/edit before anything is created:
#   1. confirm=False (default) -> returns a DRAFT PREVIEW only. Nothing is created.
#   2. confirm=True -> submits an approval request. A human still approves it in the
#      Approvals log before the API actually sends (simulated in simulate mode).
def send_email(
    to: Annotated[str, Field(description="Recipient email address.")],
    subject: Annotated[str, Field(description="Email subject line.")],
    body: Annotated[str, Field(description="Email body text.")],
    confirm: Annotated[
        bool,
        Field(
            description="False (default) returns a DRAFT PREVIEW only — nothing is created, so the user can review/edit. True submits the email as an approval request. Always draft first, then confirm."
        ),
    ] = False,
) -> Any:
    """Draft (preview) or submit an Outlook email for approval.

    Call with confirm=false FIRST to return a draft the user can review and edit —
    nothing is created. Only after the user approves the wording, call again with
    confirm=true to submit it as an approval request (a human then approves it in
    the Approvals log before it is actually sent)."""
    if not confirm:
        return {
            "draft": {"to": to, "subject": subject, "body": body},
            "submitted": False,
            "note": "DRAFT ONLY — nothing submitted yet. Show this to the user to review/edit. When they approve the wording, call send_email again with confirm=true to submit it for approval.",
        }
    action = {"kind": "SendOutlookMail", "to": to, "subject": subject, "body": body}
    try:
        appr = _submit_action_approval(f'Send email to {to}: "{subject}"', action)
        return {
            "submittedForApproval": True,
            "approvalRequestBusinessId": appr.get("approvalRequestBusinessId"),
            "preview": {"to": to, "subject": subject, "body": body},
            "note": "Pending human approval in the Approvals log. Nothing is sent until a human approves.",
        }
    except Exception as e:
        return {"error": f"Failed to submit email for approval: {e}"}


def notify_teams(
    message: Annotated[str, Field(description="The Teams message text.")],
    to: Annotated[str | None, Field(description="Recipient email address (optional).")] = None,
    confirm: Annotated[
        bool,
        Field(
            description="False (default) returns a DRAFT PREVIEW only — nothing is created, so the user can review/edit. True submits the message as an approval request. Always draft first, then confirm."
        ),
    ] = False,
) -> Any:
    """Draft (preview) or submit a Teams notification for approval.

    Call with confirm=false FIRST to return a draft the user can review and edit —
    nothing is created. Only after the user approves the wording, call again with
    confirm=true to submit it as an approval request (a human then approves it in
    the Approvals log before it is actually posted)."""
    if not confirm:
        return {
            "draft": {"to": to, "message": message},
            "submitted": False,
            "note": "DRAFT ONLY — nothing submitted yet. Show this to the user to review/edit. When they approve the wording, call notify_teams again with confirm=true to submit it for approval.",
        }
    action: dict = {"kind": "NotifyTeams", "message": message}
    if to:
        action["to"] = to
    try:
        appr = _submit_action_approval(
            f"Post Teams message{f' to {to}' if to else ''}", action
        )
        return {
            "submittedForApproval": True,
            "approvalRequestBusinessId": appr.get("approvalRequestBusinessId"),
            "preview": {"to": to, "message": message},
            "note": "Pending human approval in the Approvals log. Nothing is posted until a human approves.",
        }
    except Exception as e:
        return {"error": f"Failed to submit Teams notification for approval: {e}"}


# ---- Communications reads (Outlook / Teams — on behalf of the signed-in user) ----
# READ-ONLY and deliberately NOT approval-gated: reading a user's own mail/chats
# changes nothing and sends nothing, so there is no draft/confirm step. Every read
# is audited on the API side (recordAgentAction, security event) and only
# metadata/short previews are returned — full bodies are never persisted into the
# 11 mock tables. These act AS the signed-in user via the session handle
# (MSX_SESSION_ID), which is propagated out-of-band (see msx_session.py) and
# attached to the API call automatically — the model does NOT need to forward it.
# Without a signed-in user the API returns a clear "sign-in required" error.
def _session_headers(session: str | None) -> dict | None:
    """Per-call header carrying the user session handle for on-behalf-of reads.

    Prefers the handle captured out-of-band for this turn (msx_session) so a
    deterministic value always wins over anything the model might supply; falls
    back to an explicitly passed handle only when none was captured. Returns None
    when neither is available (MsxClient then applies the turn handle if any)."""
    s = get_session_id() or (session or "").strip()
    return {"x-msx-session": s} if s else None


def read_outlook(
    top: Annotated[int, Field(description="How many recent messages to return (1-50).")] = 10,
    session: Annotated[
        str | None,
        Field(
            description="Optional. The signed-in user's session handle is applied automatically; leave unset unless you were explicitly given an MSX_SESSION_ID to override it."
        ),
    ] = None,
) -> Any:
    """Read the signed-in user's recent Outlook email (subject, sender, date, and a
    short body preview) so you can extract context to inform a decision.

    READ-ONLY: nothing is sent and no approval is needed. Runs as the signed-in
    user automatically (the session handle is propagated for you). Returns only
    metadata/previews — never full bodies, and nothing is stored."""
    top = max(1, min(50, int(top or 10)))
    try:
        data = _mc.get(
            "/api/graph/outlook/messages",
            params={"top": top},
            headers=_session_headers(session),
        )
    except Exception as e:
        return {"error": f"Could not read Outlook: {e}"}
    result = []
    for m in data or []:
        addr = (m.get("from") or {}).get("emailAddress") or {}
        result.append(
            {
                "subject": m.get("subject") or "(no subject)",
                "from": addr.get("name") or addr.get("address"),
                "receivedDateTime": m.get("receivedDateTime"),
                "preview": m.get("bodyPreview"),
            }
        )
    return result


def read_teams(
    top: Annotated[int, Field(description="How many recent chats to scan (1-50).")] = 5,
    perChat: Annotated[int, Field(description="How many recent messages to read per chat (1-20).")] = 5,
    session: Annotated[
        str | None,
        Field(
            description="Optional. The signed-in user's session handle is applied automatically; leave unset unless you were explicitly given an MSX_SESSION_ID to override it."
        ),
    ] = None,
) -> Any:
    """Read the signed-in user's recent Teams chats WITH their recent messages
    (sender + short text + timestamp) so you can extract context to inform a
    decision.

    READ-ONLY: nothing is posted and no approval is needed. Runs as the signed-in
    user automatically (the session handle is propagated for you). Returns only
    metadata/short previews, and nothing is stored."""
    top = max(1, min(50, int(top or 5)))
    perChat = max(1, min(20, int(perChat or 5)))
    try:
        data = _mc.get(
            "/api/graph/teams/messages",
            params={"top": top, "perChat": perChat},
            headers=_session_headers(session),
        )
    except Exception as e:
        return {"error": f"Could not read Teams: {e}"}
    return data or []
