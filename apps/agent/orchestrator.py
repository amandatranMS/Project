"""The orchestrator: the main chat agent that routes to sub-agents."""
from __future__ import annotations

from openai import OpenAI

from agents import SubAgent
from llm import ConfirmFn, run_tool_loop


ORCHESTRATOR_INSTRUCTIONS = (
    "You are the main assistant for a SYNTHETIC MOCK MSX Milestone workspace (not real "
    "MSX/customer data). You coordinate a team of specialist agents, each exposed to you "
    "as a tool. Analyze the user's request and delegate to the most relevant specialist(s) "
    "by calling their *_agent tool with a clear instruction. You may call several in turn "
    "(e.g. look up an opportunity, then create a milestone under it). Combine their results "
    "into one clear, plain-language answer. Never invent records; rely on the tools. When the "
    "user asks for an assessment, recommendation, plan, or next steps for one opportunity, "
    "structure the answer as Known Facts, Assumptions, Recommended Actions, and Expected "
    "Outcome. Known Facts may contain only tool-returned values for that opportunity. Label "
    "all inferences as assumptions; say 'None' when no assumptions are needed. Present general "
    "Solution Engineering advice as proposed actions, not record facts. Never introduce a "
    "specific person or role, partner, date, risk rating, count, or pipeline metric unless a "
    "tool returned it for that scope. Do not mix dashboard metrics into a single-opportunity "
    "answer unless the user explicitly requests pipeline context. Keep recommendations concise "
    "and tied to the stated blocker or objective. For a NEW milestone recommendation or "
    "opportunity, delegate first to retrieve available context and prepare a complete editable "
    "draft. Infer reasonably inferable values from that context and controlled choices instead "
    "of requiring the user to manually supply every field. Label every field [Known], "
    "[Assumption—High/Medium/Low], or [Not applicable—assumed], and call out low-confidence "
    "fields. Ask the user to edit or explicitly confirm the whole draft. The initial request is "
    "never confirmation. Submit through the specialist's approval-gated tool only after a later "
    "explicit confirmation, with userConfirmed=true and every exact draft value."
)


class Orchestrator:
    def __init__(self, subagents: list[SubAgent], client: OpenAI, model: str, confirm: ConfirmFn | None = None) -> None:
        self.subagents = subagents
        self.client = client
        self.model = model
        self.confirm = confirm
        self.tools = [sa.as_tool() for sa in subagents]
        self.history: list[dict] = []

    @property
    def instructions(self) -> str:
        roster = "\n".join(f"- {sa.name}_agent: {sa.description}" for sa in self.subagents)
        return f"{ORCHESTRATOR_INSTRUCTIONS}\n\nYour specialist team:\n{roster}"

    def chat(self, user_message: str) -> str:
        self.history.append({"role": "user", "content": user_message})
        reply = run_tool_loop(
            self.client,
            self.model,
            self.instructions,
            self.history,
            self.tools,
            confirm=self.confirm,
        )
        self.history.append({"role": "assistant", "content": reply})
        return reply
