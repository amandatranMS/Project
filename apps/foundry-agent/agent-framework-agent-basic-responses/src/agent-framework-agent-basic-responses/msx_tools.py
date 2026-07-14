"""MSX domain tools and the specialist sub-agents that own them.

Each tool wraps one or more MSX API calls. Sub-agents group related tools and
are exposed to the orchestrator as callable tools (the "agent-as-tool" pattern),
so adding a new capability is just adding tools + one sub-agent here.
"""
from __future__ import annotations

import difflib
from typing import Annotated, Any

from agent_framework import Agent
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
) -> Any:
    """Update fields on an existing milestone by id."""
    payload = {
        "milestoneName": milestoneName,
        "milestoneStatus": milestoneStatus,
        "milestoneCategory": milestoneCategory,
        "owner": owner,
    }
    payload = {k: v for k, v in payload.items() if v is not None}
    return _trim_milestone(_mc.patch(f"/api/milestones/{id}", json=payload))


def delete_milestone(id: Annotated[str, Field(description="The milestone id to delete.")]) -> Any:
    """Delete a milestone by id (its status history is also removed)."""
    return _mc.delete(f"/api/milestones/{id}")


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


# ---- Sub-agent factory ---------------------------------------------------
_CONFIRM_RULE = (
    " Before creating, updating, or deleting anything, restate the exact action and "
    "values and ask the user to confirm; only proceed after they clearly agree. "
    "Never invent data — rely on your tools."
)

# Governance rule: a milestone is created ONLY when a human approves an approval
# request. The agent may recommend and request approval, but must then stop.
_GOVERNANCE_RULE = (
    " You cannot create milestones directly. To propose a new milestone, first call "
    "create_recommendation, then submit_approval_request referencing that "
    "recommendation's recommendationBusinessId. After submitting, STOP and tell the "
    "user the request is Pending and a human must approve it in the web UI. Never "
    "claim a milestone was created — you cannot approve or reject requests yourself."
)


def build_subagents(client) -> list[Agent]:
    """Create the specialist sub-agents, each owning a focused set of MSX tools."""
    return [
        Agent(
            client=client,
            name="milestone_specialist",
            description="Handles existing milestones: list, look up, update, or delete milestones. Cannot create milestones.",
            instructions=(
                "You are the Milestone specialist for a SYNTHETIC MOCK MSX workspace. Use your "
                "tools to read, update, and delete EXISTING milestones. You cannot create "
                "milestones — if the user wants a new milestone, tell them it must go through "
                "the governance flow (the governance specialist recommends it and requests "
                "approval; a human approves). Report ids and names clearly." + _CONFIRM_RULE
            ),
            tools=[list_milestones, get_milestone, update_milestone, delete_milestone],
        ),
        Agent(
            client=client,
            name="governance_specialist",
            description="Proposes new milestones the governed way: create a recommendation, submit an approval request, and list pending approvals. Never creates or approves milestones.",
            instructions=(
                "You are the Governance specialist for a SYNTHETIC MOCK MSX workspace. New "
                "milestones are created ONLY after a human approves an approval request, so you "
                "drive the recommend -> request-approval handoff. Use create_recommendation to "
                "record a suggestion, then submit_approval_request with the returned "
                "recommendationBusinessId. Use list_pending_approvals to report what is awaiting "
                "a human. Report the recommendationBusinessId and approvalRequestBusinessId "
                "clearly." + _GOVERNANCE_RULE + _CONFIRM_RULE
            ),
            tools=[create_recommendation, submit_approval_request, list_pending_approvals],
        ),
        Agent(
            client=client,
            name="dashboard_specialist",
            description="Answers questions about aggregate metrics and pipeline health.",
            instructions=(
                "You are the Dashboard specialist for a SYNTHETIC MOCK MSX workspace. Use "
                "get_dashboard_summary to answer questions about counts (active opportunities, "
                "at-risk/blocked milestones, pending approvals) and pipeline value. Summarize plainly."
            ),
            tools=[get_dashboard_summary],
        ),
        Agent(
            client=client,
            name="opportunity_specialist",
            description="Handles opportunities: list, look up, or create opportunities.",
            instructions=(
                "You are the Opportunity specialist for a SYNTHETIC MOCK MSX workspace. Use your "
                "tools to read and create opportunities. Report ids and names clearly." + _CONFIRM_RULE
            ),
            tools=[list_opportunities, get_opportunity, create_opportunity],
        ),
    ]
