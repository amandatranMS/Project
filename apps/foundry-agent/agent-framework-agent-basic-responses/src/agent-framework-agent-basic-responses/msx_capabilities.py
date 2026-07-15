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


# ---- Communications tools (Outlook / Teams, via the API's Graph endpoints) ----
# These act on the signed-in user's behalf. In simulate mode the API records the
# action (with audit) but does NOT actually deliver — so the hosted agent can
# demonstrate the full draft -> preview -> send flow with no admin consent.
def send_email(
    to: Annotated[str, Field(description="Recipient email address.")],
    subject: Annotated[str, Field(description="Email subject line.")],
    body: Annotated[str, Field(description="Email body text.")],
    confirm: Annotated[
        bool,
        Field(description="False (default) returns a DRAFT PREVIEW without sending; True sends. Always preview first, then send."),
    ] = False,
) -> Any:
    """Draft/preview or send an Outlook email on the user's behalf.

    Call with confirm=false to get a preview (nothing sent), show it to the user,
    then call again with confirm=true to send. In simulate mode nothing is
    actually delivered; the response says simulated=true.
    """
    try:
        return _mc.post(
            "/api/graph/outlook/send",
            json={"to": to, "subject": subject, "body": body, "confirm": confirm},
        )
    except Exception as e:
        return {"error": f"Failed to send email: {e}"}


def notify_teams(
    message: Annotated[str, Field(description="The Teams message text.")],
    to: Annotated[str | None, Field(description="Recipient email address (optional).")] = None,
    confirm: Annotated[
        bool,
        Field(description="False (default) previews without posting; True posts. Preview first, then post."),
    ] = False,
) -> Any:
    """Draft/preview or post a Teams notification on the user's behalf.

    Call with confirm=false to preview, then confirm=true to post. In simulate
    mode nothing is delivered; the response says simulated=true.
    """
    try:
        payload: dict = {"message": message, "confirm": confirm}
        if to:
            payload["to"] = to
        return _mc.post("/api/graph/teams/notify", json=payload)
    except Exception as e:
        return {"error": f"Failed to post Teams notification: {e}"}
