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
from typing import Annotated, Any

from pydantic import Field

from msx_client import MsxClient

# Controlled choice values (mirror packages/shared) so the model emits values the
# API's Zod validation will accept.
MILESTONE_STATUSES = [
    "On Track", "At Risk", "Blocked", "Completed",
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
    return {
        "id": a.get("id"),
        "approvalRequestBusinessId": a.get("approvalRequestBusinessId"),
        "requestName": a.get("requestName"),
        "approvalStatus": a.get("approvalStatus"),
        "requestStatus": a.get("requestStatus"),
        "opportunity": (a.get("opportunity") or {}).get("opportunityName"),
        "relatedRecommendation": (a.get("relatedRecommendation") or {}).get("recommendationBusinessId"),
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
    return _mc.post("/api/approval-requests", json=payload) or {}


# ---- Milestone tools -----------------------------------------------------
def list_milestones(
    milestoneStatus: Annotated[
        str | None,
        Field(description=f"Optional status filter. One of: {MILESTONE_STATUSES}."),
    ] = None,
) -> Any:
    """List milestones, optionally filtered by status."""
    params = {"milestoneStatus": milestoneStatus} if milestoneStatus else None
    data = _mc.get("/api/milestones", params=params) or []
    return [_trim_milestone(m) for m in data]


def get_milestone(id: Annotated[str, Field(description="The milestone id.")]) -> Any:
    """Get one milestone's full detail by its id."""
    return _mc.get(f"/api/milestones/{id}")


def update_milestone(
    id: Annotated[str, Field(description="The milestone id to update.")],
    milestoneName: Annotated[str | None, Field(description="New name.")] = None,
    milestoneStatus: Annotated[str | None, Field(description=f"One of: {MILESTONE_STATUSES}.")] = None,
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
        "azureCapacityType": azureCapacityType,
        "preferredAzureRegion": preferredAzureRegion,
        "lastUpdated": lastUpdated,
    }
    fields = {k: v for k, v in fields.items() if v is not None}
    if not fields:
        return {"error": "Provide at least one field to update."}
    changes = ", ".join(f"{k}={v}" for k, v in fields.items())
    action = {"kind": "UpdateMilestone", "milestoneId": id, **fields}
    try:
        opp = None
        try:
            m = _mc.get(f"/api/milestones/{id}")
            opp = (m.get("opportunity") or {}).get("opportunityName") if isinstance(m, dict) else None
        except Exception:
            opp = None
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


def get_opportunity(id: Annotated[str, Field(description="The opportunity id.")]) -> Any:
    """Get one opportunity's detail (includes its milestones) by id."""
    return _mc.get(f"/api/opportunities/{id}")


def create_opportunity(
    opportunityName: Annotated[str, Field(description="Name of the new opportunity.")],
    customerName: Annotated[str | None, Field(description="Customer name.")] = None,
    salesStage: Annotated[str | None, Field(description=f"One of: {SALES_STAGES}.")] = None,
    status: Annotated[str | None, Field(description=f"One of: {OPPORTUNITY_STATUSES}.")] = None,
) -> Any:
    """Create a new opportunity."""
    payload = {
        "opportunityName": opportunityName,
        "customerName": customerName,
        "salesStage": salesStage,
        "status": status,
    }
    payload = {k: v for k, v in payload.items() if v is not None}
    return _trim_opportunity(_mc.post("/api/opportunities", json=payload))


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
    suggestedDescription: Annotated[str | None, Field(description="Why this milestone is recommended / what it covers.")] = None,
    suggestedOwnerRole: Annotated[str | None, Field(description="Suggested owner or role.")] = None,
    priority: Annotated[str | None, Field(description=f"One of: {PRIORITIES}.")] = None,
    confidence: Annotated[str | None, Field(description=f"One of: {CONFIDENCE_LEVELS}.")] = None,
) -> Any:
    """Create an AI milestone recommendation under an opportunity. This does NOT create a milestone; it records a suggestion for human review."""
    resolved_name, err = _resolve_opportunity(opportunityName)
    if err:
        return err
    payload = {
        "recommendedMilestoneTitle": recommendedMilestoneTitle,
        "opportunityName": resolved_name,
        "suggestedDescription": suggestedDescription,
        "suggestedOwnerRole": suggestedOwnerRole,
        "priority": priority,
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
    requestedBy: Annotated[str | None, Field(description="Who is requesting (defaults to the agent).")] = None,
) -> Any:
    """Submit an approval request for a recommendation. A human must approve it in the web UI before any milestone is created. This tool never creates a milestone."""
    resolved_name, err = _resolve_opportunity(opportunityName)
    if err:
        return err
    payload = {
        "requestName": requestName,
        "opportunityName": resolved_name,
        "relatedRecommendationBusinessId": relatedRecommendationBusinessId,
        "requestStatus": "Submitted",
        "requestedBy": requestedBy or "HostedAgent",
    }
    payload = {k: v for k, v in payload.items() if v is not None}
    try:
        return _trim_approval(_mc.post("/api/approval-requests", json=payload))
    except Exception as e:  # surface a recoverable message instead of a hard failure
        return {"error": f"Failed to submit approval request: {e}", "opportunityUsed": resolved_name}


def list_pending_approvals() -> Any:
    """List approval requests still awaiting a human decision (approvalStatus = Pending)."""
    data = _mc.get("/api/approval-requests", params={"approvalStatus": "Pending"}) or []
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
