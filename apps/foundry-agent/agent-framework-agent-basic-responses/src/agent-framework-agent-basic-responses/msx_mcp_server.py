"""Standalone MCP server that exposes the MSX capabilities as MCP tools.

This is "Socket #1": a Model Context Protocol server that publishes the same
MSX domain functions used by the hosted multi-agent app (defined in
``msx_capabilities.py``) as standardized MCP tools. Any MCP-compatible client
-- another application, an IDE, or a different agent -- can connect to this
server and reuse the MSX capabilities without importing our code.

The server is intentionally thin: it registers the pure capability functions
from ``msx_capabilities`` and lets FastMCP build the tool schemas from their
type hints and docstrings, so the MCP contract always matches the functions.

Run it directly to serve over stdio (the transport MCP clients spawn):

    python msx_mcp_server.py

It talks to the MSX REST API using the same ``API_BASE_URL`` / ``API_KEY``
environment variables as the rest of the agent.
"""
from __future__ import annotations

from mcp.server.fastmcp import FastMCP

import msx_capabilities as cap

mcp = FastMCP("msx-tools")

# Every MSX capability is published as an MCP tool. FastMCP derives the tool
# name, description, and input schema from each function's name, docstring, and
# annotated parameters, so this list is the single place tools are exposed.
_CAPABILITIES = (
    cap.list_milestones,
    cap.get_milestone,
    cap.get_milestone_handoff_readiness,
    cap.update_milestone,
    cap.delete_milestone,
    cap.get_dashboard_summary,
    cap.list_opportunities,
    cap.get_opportunity,
    cap.get_handoff_readiness,
    cap.get_ecif_estimate,
    cap.create_opportunity,
    cap.update_opportunity,
    cap.search_records,
    cap.list_deal_team,
    cap.update_deal_team_member,
    cap.create_recommendation,
    cap.submit_approval_request,
    cap.list_pending_approvals,
    cap.list_approvals,
)

for _fn in _CAPABILITIES:
    mcp.add_tool(_fn)


if __name__ == "__main__":
    mcp.run()
