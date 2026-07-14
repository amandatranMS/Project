# Copyright (c) Microsoft. All rights reserved.

import os
from typing import Annotated

from agent_framework import Agent
from agent_framework.foundry import FoundryChatClient
from agent_framework_foundry_hosting import ResponsesHostServer
from azure.identity import DefaultAzureCredential
from dotenv import load_dotenv
from pydantic import Field

from subagents import build_subagents

# Load environment variables from .env file
load_dotenv()


ORCHESTRATOR_INSTRUCTIONS = (
    "You are the main assistant for a SYNTHETIC MOCK MSX Milestone workspace (this is NOT "
    "real MSX, Dataverse, or customer data). You coordinate a team of specialist agents, "
    "each exposed to you as a tool. Analyze the user's request and delegate to the most "
    "relevant specialist(s) by calling their ask_* tool with a clear, self-contained "
    "instruction. You may call several in turn (e.g. look up an opportunity, then create a "
    "milestone under it). Combine their results into one clear, plain-language answer. "
    "Never invent records; rely on the specialists. For any action that creates, updates, "
    "or deletes data, make sure the user has confirmed before it happens only once. "
    "IMPORTANT GOVERNANCE RULE: no one can create a milestone directly. When the user "
    "wants a NEW milestone, delegate to the governance specialist, which records a "
    "recommendation and submits an approval request; a human must then approve it in the "
    "web UI before the milestone exists. Never tell the user a new milestone was created."
)


def _make_delegate(agent: Agent):
    """Wrap a sub-agent as an orchestrator tool (the agent-as-tool pattern)."""

    async def delegate(
        request: Annotated[str, Field(description="A clear, self-contained instruction or question for this specialist.")],
    ) -> str:
        return str(await agent.run(request))

    delegate.__name__ = f"ask_{agent.name}"
    delegate.__doc__ = f"Delegate to the {agent.name}. {agent.description}"
    return delegate


def main():
    client = FoundryChatClient(
        project_endpoint=os.environ["FOUNDRY_PROJECT_ENDPOINT"],
        model=os.environ["AZURE_AI_MODEL_DEPLOYMENT_NAME"],
        credential=DefaultAzureCredential(),
    )

    subagents = build_subagents(client)
    roster = "\n".join(f"- ask_{a.name}: {a.description}" for a in subagents)

    orchestrator = Agent(
        client=client,
        instructions=f"{ORCHESTRATOR_INSTRUCTIONS}\n\nYour specialist team:\n{roster}",
        tools=[_make_delegate(a) for a in subagents],
        # History is managed by the hosting infrastructure, so the service does
        # not need to store it. Learn more at:
        # https://developers.openai.com/api/reference/resources/responses/methods/create
        default_options={"store": False},
    )

    server = ResponsesHostServer(orchestrator)
    server.run()


if __name__ == "__main__":
    main()
