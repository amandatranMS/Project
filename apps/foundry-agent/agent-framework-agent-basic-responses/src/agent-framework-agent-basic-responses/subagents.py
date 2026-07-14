# Copyright (c) Microsoft. All rights reserved.
"""Specialist sub-agents for the MSX hosted multi-agent app.

This module composes the pure capability functions from ``msx_capabilities``
into four specialist agents that the orchestrator delegates to (the
"agent-as-tool" pattern). Keeping the agent composition here -- separate from
the capability functions -- lets the same capabilities be reused by the
standalone MCP server (``msx_mcp_server.py``) without dragging in the
agent-framework dependency.

Proof of MCP reuse: when the ``MSX_TOOLS_VIA_MCP`` environment variable is
truthy, the dashboard specialist consumes the ``get_dashboard_summary``
capability *through* the MCP server instead of calling the function directly.
The default (flag unset) keeps every specialist on the direct functions, so the
deployed hosted agent behaves exactly as before.
"""
from __future__ import annotations

import os
import sys

from agent_framework import Agent, MCPStdioTool

from msx_capabilities import (
    create_opportunity,
    create_recommendation,
    delete_milestone,
    get_dashboard_summary,
    get_milestone,
    get_opportunity,
    list_milestones,
    list_opportunities,
    list_pending_approvals,
    submit_approval_request,
    update_milestone,
)

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

_MCP_SERVER_PATH = os.path.join(os.path.dirname(__file__), "msx_mcp_server.py")


def _dashboard_tools() -> list:
    """Return the dashboard specialist's tools.

    Default: the direct ``get_dashboard_summary`` function (deployed behavior).
    When ``MSX_TOOLS_VIA_MCP`` is set, the same capability is consumed through
    the MSX MCP server instead, proving other consumers can reuse it too.
    """
    if os.environ.get("MSX_TOOLS_VIA_MCP", "").strip().lower() in ("1", "true", "yes", "on"):
        mcp_tools = MCPStdioTool(
            name="msx_tools",
            command=sys.executable,
            args=[_MCP_SERVER_PATH],
            allowed_tools=["get_dashboard_summary"],
        )
        return [mcp_tools]
    return [get_dashboard_summary]


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
            tools=_dashboard_tools(),
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
