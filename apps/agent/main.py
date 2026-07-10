"""CLI chat entry point for the MSX multi-agent assistant.

Run:  python main.py
Type your questions; 'exit' to quit. Destructive actions ask for confirmation.
"""
from __future__ import annotations

import os
import sys

from dotenv import load_dotenv

from agents import build_subagents
from llm import Tool, make_client, model_name
from msx_client import MsxClient
from orchestrator import Orchestrator


def confirm(tool: Tool, args: dict) -> bool:
    """Human-in-the-loop gate for create/update/delete actions."""
    print(f"\n  ⚠  The assistant wants to run: {tool.name}")
    if args:
        for k, v in args.items():
            print(f"       {k} = {v}")
    answer = input("  Proceed? [y/N] ").strip().lower()
    return answer in {"y", "yes"}


def main() -> int:
    load_dotenv(override=True)

    if not (os.environ.get("GITHUB_TOKEN") or os.environ.get("MODEL_API_KEY")):
        print("No model credential set. Copy .env.example to .env and add your GITHUB_TOKEN.", file=sys.stderr)
        return 1

    mc = MsxClient()
    # Fail fast if the API isn't reachable / key is wrong.
    try:
        mc.get("/api/health")
    except Exception as exc:
        print(f"Could not reach the MSX API at {mc.base}: {exc}", file=sys.stderr)
        print("Make sure `npm run dev` is running and API_KEY in .env matches the server.", file=sys.stderr)
        return 1

    client = make_client()
    model = model_name()
    subagents = build_subagents(mc, client, model, confirm)
    orch = Orchestrator(subagents, client, model, confirm)

    print("MSX Milestone Assistant (mock) — multi-agent chat")
    print(f"Model: {model}   API: {mc.base}")
    print("Specialists: " + ", ".join(sa.name for sa in subagents))
    print("Type your question, or 'exit' to quit.\n")

    while True:
        try:
            user = input("You: ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not user:
            continue
        if user.lower() in {"exit", "quit"}:
            break
        try:
            reply = orch.chat(user)
        except Exception as exc:
            print(f"[error] {exc}\n")
            continue
        print(f"\nAssistant: {reply}\n")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
