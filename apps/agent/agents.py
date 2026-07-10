"""Sub-agents: focused specialists the orchestrator can delegate to.

Each sub-agent owns a set of domain tools and runs its own tool-calling loop.
Add a new specialist by adding one entry to `build_subagents`.
"""
from __future__ import annotations

from openai import OpenAI

from llm import ConfirmFn, Tool, run_tool_loop
from msx_client import MsxClient
from tools import build_tool_groups


class SubAgent:
    def __init__(
        self,
        name: str,
        description: str,
        instructions: str,
        tools: list[Tool],
        client: OpenAI,
        model: str,
        confirm: ConfirmFn | None = None,
    ) -> None:
        self.name = name
        self.description = description
        self.instructions = instructions
        self.tools = tools
        self.client = client
        self.model = model
        self.confirm = confirm

    def handle(self, request: str) -> str:
        """Answer a self-contained request using this agent's tools."""
        return run_tool_loop(
            self.client,
            self.model,
            self.instructions,
            [{"role": "user", "content": request}],
            self.tools,
            confirm=self.confirm,
        )

    def as_tool(self) -> Tool:
        """Expose this sub-agent to the orchestrator as a single callable tool."""
        return Tool(
            name=f"{self.name}_agent",
            description=self.description,
            parameters={
                "type": "object",
                "properties": {
                    "request": {
                        "type": "string",
                        "description": "A clear, self-contained instruction or question for this specialist.",
                    }
                },
                "required": ["request"],
            },
            func=lambda request: self.handle(request),
        )


def build_subagents(mc: MsxClient, client: OpenAI, model: str, confirm: ConfirmFn | None) -> list[SubAgent]:
    groups = build_tool_groups(mc)

    return [
        SubAgent(
            name="milestone",
            description="Handles milestones: list, look up, create, update, or delete milestones.",
            instructions=(
                "You are the Milestone specialist for a mock MSX workspace. Use your tools to "
                "read and modify milestones. When creating a milestone you need an existing "
                "opportunity name — if unsure, say so. Report ids and names clearly. Never invent data."
            ),
            tools=groups["milestone"],
            client=client,
            model=model,
            confirm=confirm,
        ),
        SubAgent(
            name="dashboard",
            description="Answers questions about aggregate metrics and pipeline health.",
            instructions=(
                "You are the Dashboard specialist. Use get_dashboard_summary to answer questions "
                "about counts (active opportunities, at-risk/blocked milestones, pending approvals) "
                "and pipeline value. Summarize the numbers plainly."
            ),
            tools=groups["dashboard"],
            client=client,
            model=model,
            confirm=confirm,
        ),
        SubAgent(
            name="opportunity",
            description="Handles opportunities: list, look up, or create opportunities.",
            instructions=(
                "You are the Opportunity specialist for a mock MSX workspace. Use your tools to "
                "read and create opportunities. Report ids and names clearly. Never invent data."
            ),
            tools=groups["opportunity"],
            client=client,
            model=model,
            confirm=confirm,
        ),
    ]
