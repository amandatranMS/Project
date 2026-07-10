"""MSX domain tools and the specialist sub-agents that own them.

Each tool wraps one or more MSX API calls. Sub-agents group related tools and
are exposed to the orchestrator as callable tools (the "agent-as-tool" pattern),
so adding a new capability is just adding tools + one sub-agent here.
"""
from __future__ import annotations

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


def create_milestone(
    milestoneName: Annotated[str, Field(description="Name of the new milestone.")],
    opportunityName: Annotated[str, Field(description="Must match an existing opportunity name.")],
    milestoneStatus: Annotated[str | None, Field(description=f"One of: {MILESTONE_STATUSES}.")] = None,
    milestoneCategory: Annotated[str | None, Field(description=f"One of: {MILESTONE_CATEGORIES}.")] = None,
    owner: Annotated[str | None, Field(description="Owner name.")] = None,
    riskDescription: Annotated[str | None, Field(description="Optional risk note.")] = None,
) -> Any:
    """Create a milestone under an existing opportunity (by opportunity name)."""
    payload = {
        "milestoneName": milestoneName,
        "opportunityName": opportunityName,
        "milestoneStatus": milestoneStatus,
        "milestoneCategory": milestoneCategory,
        "owner": owner,
        "riskDescription": riskDescription,
    }
    payload = {k: v for k, v in payload.items() if v is not None}
    return _trim_milestone(_mc.post("/api/milestones", json=payload))


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


# ---- Sub-agent factory ---------------------------------------------------
_CONFIRM_RULE = (
    " Before creating, updating, or deleting anything, restate the exact action and "
    "values and ask the user to confirm; only proceed after they clearly agree. "
    "Never invent data — rely on your tools."
)


def build_subagents(client) -> list[Agent]:
    """Create the specialist sub-agents, each owning a focused set of MSX tools."""
    return [
        Agent(
            client=client,
            name="milestone_specialist",
            description="Handles milestones: list, look up, create, update, or delete milestones.",
            instructions=(
                "You are the Milestone specialist for a SYNTHETIC MOCK MSX workspace. Use your "
                "tools to read and modify milestones. Creating a milestone requires an existing "
                "opportunity name — if unsure, say so. Report ids and names clearly." + _CONFIRM_RULE
            ),
            tools=[list_milestones, get_milestone, create_milestone, update_milestone, delete_milestone],
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
