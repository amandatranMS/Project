"""Model access + the shared tool-calling loop.

Uses the OpenAI SDK pointed at GitHub Models (OpenAI-compatible). To move to
Azure AI Foundry / Azure OpenAI later, only the client construction here changes.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any, Callable

from openai import OpenAI


@dataclass
class Tool:
    """A callable the model can invoke, plus its JSON-schema description."""

    name: str
    description: str
    parameters: dict
    func: Callable[..., Any]
    destructive: bool = False  # create/update/delete → ask for confirmation first


# Signature: (tool, args) -> bool. Return False to cancel a destructive action.
ConfirmFn = Callable[[Tool, dict], bool]


def make_client() -> OpenAI:
    api_key = os.environ.get("MODEL_API_KEY") or os.environ.get("GITHUB_TOKEN")
    if not api_key:
        raise RuntimeError(
            "No model credential found. Set GITHUB_TOKEN (GitHub Models) or "
            "MODEL_API_KEY in apps/agent/.env."
        )
    base_url = os.environ.get("MODEL_ENDPOINT", "https://models.github.ai/inference")
    return OpenAI(base_url=base_url, api_key=api_key)


def model_name() -> str:
    return os.environ.get("MODEL_NAME", "openai/gpt-4o-mini")


def _to_openai_tools(tools: list[Tool]) -> list[dict]:
    return [
        {
            "type": "function",
            "function": {"name": t.name, "description": t.description, "parameters": t.parameters},
        }
        for t in tools
    ]


def run_tool_loop(
    client: OpenAI,
    model: str,
    system_prompt: str,
    messages: list[dict],
    tools: list[Tool],
    *,
    max_steps: int = 8,
    confirm: ConfirmFn | None = None,
) -> str:
    """Runs a chat completion loop, executing tool calls until the model answers."""
    tool_map = {t.name: t for t in tools}
    openai_tools = _to_openai_tools(tools)
    convo = [{"role": "system", "content": system_prompt}] + messages

    for _ in range(max_steps):
        resp = client.chat.completions.create(
            model=model,
            messages=convo,
            tools=openai_tools or None,
            tool_choice="auto" if openai_tools else None,
            temperature=0.2,
        )
        msg = resp.choices[0].message

        if not msg.tool_calls:
            return msg.content or ""

        convo.append(
            {
                "role": "assistant",
                "content": msg.content,
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                    }
                    for tc in msg.tool_calls
                ],
            }
        )

        for tc in msg.tool_calls:
            tool = tool_map.get(tc.function.name)
            try:
                args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}

            if tool is None:
                result: Any = f"Unknown tool: {tc.function.name}"
            elif tool.destructive and confirm is not None and not confirm(tool, args):
                result = "Cancelled by the user — no change was made."
            else:
                try:
                    result = tool.func(**args)
                except Exception as exc:  # surface API/validation errors to the model
                    result = f"Error: {exc}"

            convo.append(
                {
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": result if isinstance(result, str) else json.dumps(result, default=str),
                }
            )

    return "I wasn't able to finish within the step limit — please refine your request."
