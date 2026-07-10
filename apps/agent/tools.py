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
MILESTONE_STATUSES = ["On Track", "At Risk", "Blocked", "Completed", "Cancelled", "Lost To Competitor", "Hygiene/Duplicate"]
MILESTONE_CATEGORIES = ["Production", "Pilot", "Workshop", "Assessment", "Deployment", "Adoption"]
SALES_STAGES = ["Listen & Consult", "Inspire & Design", "Empower & Achieve", "Realize Value", "Manage & Optimize"]
OPPORTUNITY_STATUSES = ["Active", "On Hold", "Won", "Lost", "Closed"]


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
        milestoneStatus: str | None = None,
        milestoneCategory: str | None = None,
        owner: str | None = None,
        riskDescription: str | None = None,
    ) -> Any:
        payload = {
            "milestoneName": milestoneName,
            "opportunityName": opportunityName,
            "milestoneStatus": milestoneStatus,
            "milestoneCategory": milestoneCategory,
            "owner": owner,
            "riskDescription": riskDescription,
        }
        payload = {k: v for k, v in payload.items() if v is not None}
        return _trim_milestone(mc.post("/api/milestones", json=payload))

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
        Tool("create_milestone", "Create a milestone under an existing opportunity (by opportunity name).",
             {"type": "object", "properties": {
                 "milestoneName": {"type": "string"},
                 "opportunityName": {"type": "string", "description": "Must match an existing opportunity name."},
                 "milestoneStatus": {"type": "string", "enum": MILESTONE_STATUSES},
                 "milestoneCategory": {"type": "string", "enum": MILESTONE_CATEGORIES},
                 "owner": {"type": "string"},
                 "riskDescription": {"type": "string"},
             }, "required": ["milestoneName", "opportunityName"]}, create_milestone, destructive=True),
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
        customerName: str | None = None,
        salesStage: str | None = None,
        status: str | None = None,
    ) -> Any:
        payload = {
            "opportunityName": opportunityName,
            "customerName": customerName,
            "salesStage": salesStage,
            "status": status,
        }
        payload = {k: v for k, v in payload.items() if v is not None}
        return _trim_opportunity(mc.post("/api/opportunities", json=payload))

    opportunity_tools = [
        Tool("list_opportunities", "List opportunities, optionally filtered by status or sales stage.",
             {"type": "object", "properties": {
                 "status": {"type": "string", "enum": OPPORTUNITY_STATUSES},
                 "salesStage": {"type": "string", "enum": SALES_STAGES},
             }}, list_opportunities),
        Tool("get_opportunity", "Get one opportunity's detail (includes its milestones) by id.",
             {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}, get_opportunity),
        Tool("create_opportunity", "Create a new opportunity.",
             {"type": "object", "properties": {
                 "opportunityName": {"type": "string"},
                 "customerName": {"type": "string"},
                 "salesStage": {"type": "string", "enum": SALES_STAGES},
                 "status": {"type": "string", "enum": OPPORTUNITY_STATUSES},
             }, "required": ["opportunityName"]}, create_opportunity, destructive=True),
    ]

    return {
        "milestone": milestone_tools,
        "dashboard": dashboard_tools,
        "opportunity": opportunity_tools,
    }
