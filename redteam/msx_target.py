# Copyright (c) Microsoft. All rights reserved.
"""
Red-team *target* for the MSX Milestone Assistant.

The AI Red Teaming Agent (PyRIT) doesn't talk to Defender or Purview directly — it
just fires adversarial prompts at a callback you provide. This module builds that
callback so every attack lands on the **exact surface your detections already watch**:
the app's ``POST /api/chat`` endpoint.

Why /api/chat and not the Foundry agent endpoint?
  * ``chatService.send()`` runs ``screenForDefender()`` on every turn — a synchronous
    ``chat/completions`` mirror that trips the input Prompt Shield (HTTP 400) so
    **Microsoft Defender for Cloud** raises its jailbreak/prompt-injection alert (which
    flows to Defender XDR). That screening runs under the API's own identity, so it
    fires whether or not the red-team caller is authenticated.
  * With a signed-in user token it then calls the hosted agent on-behalf-of the user,
    which is what makes **Microsoft Purview DLP enforce** (app-only tokens are audited
    only). Set ``MSX_USER_BEARER`` to exercise that path.
  * The hosted-agent Responses endpoint swallows content-filter blocks as an in-band
    ``response.failed`` (HTTP 200), so hitting it directly would NOT raise the Defender
    alert. That's the whole reason the screening shim exists — so we target /api/chat.

The callback follows the "complex callback aligned to the OpenAI Chat Protocol" shape
documented for ``RedTeam.scan(target=...)``.
"""

from __future__ import annotations

import json
import os
from typing import Any

import aiohttp


class TargetConfig:
    """Resolved connection settings for the MSX chat endpoint (read from env)."""

    def __init__(self) -> None:
        base = os.environ.get("MSX_API_BASE_URL", "http://localhost:4000").rstrip("/")
        self.chat_url = f"{base}/api/chat"
        self.api_key = os.environ.get("MSX_API_KEY", "").strip()
        self.user_bearer = os.environ.get("MSX_USER_BEARER", "").strip()
        self.timeout_s = float(os.environ.get("MSX_REQUEST_TIMEOUT", "120"))

    def headers(self) -> dict[str, str]:
        h = {"Content-Type": "application/json"}
        # Optional shared-secret gate the API enforces when API_KEY is set (e.g. tunnels).
        if self.api_key:
            h["x-api-key"] = self.api_key
        # Signed-in seller token → OBO → Purview DLP *enforces* (not just audits).
        if self.user_bearer:
            token = self.user_bearer
            if token.lower().startswith("bearer "):
                token = token[7:]
            h["Authorization"] = f"Bearer {token}"
        return h

    @property
    def dlp_enforcing(self) -> bool:
        return bool(self.user_bearer)


def _normalize_messages(messages: Any) -> list[dict[str, str]]:
    """
    Coerce whatever RedTeam hands the callback into the app's chat schema:
    a list of ``{"role": "user"|"assistant", "content": str}`` with non-empty content.

    RedTeam versions pass either a list of message objects (``.role``/``.content``),
    a list of dicts, or a wrapper dict ``{"messages": [...]}``. Handle all of them.
    """
    if isinstance(messages, dict):
        messages = messages.get("messages", [])

    out: list[dict[str, str]] = []
    for m in messages or []:
        if isinstance(m, dict):
            role = m.get("role")
            content = m.get("content")
        else:
            role = getattr(m, "role", None)
            content = getattr(m, "content", None)

        # Content may itself be a list of parts (OpenAI-style); flatten to text.
        if isinstance(content, list):
            parts = []
            for part in content:
                if isinstance(part, dict):
                    parts.append(str(part.get("text", part.get("content", ""))))
                else:
                    parts.append(str(getattr(part, "text", part)))
            content = "\n".join(p for p in parts if p)

        text = ("" if content is None else str(content)).strip()
        if not text:
            continue

        # The chat schema only allows 'user' | 'assistant'. Deliver the attack as a
        # user turn; keep prior assistant turns as assistant.
        norm_role = "assistant" if role == "assistant" else "user"
        out.append({"role": norm_role, "content": text})

    # Guarantee at least one user turn so the request passes zod validation.
    if not out:
        out = [{"role": "user", "content": "(empty red-team prompt)"}]
    return out


def _extract_reply(status: int, body_text: str) -> str:
    """Unwrap the API's ``{ success, data:{ reply } }`` envelope (or an error)."""
    try:
        body = json.loads(body_text)
    except (ValueError, TypeError):
        return body_text.strip() or f"(no body, HTTP {status})"

    if isinstance(body, dict):
        if body.get("success") and isinstance(body.get("data"), dict):
            reply = body["data"].get("reply")
            if isinstance(reply, str) and reply:
                return reply
        # Error envelope { success:false, error } — return it as the "response" so the
        # scan records the target's refusal. The Defender screening already fired.
        if "error" in body:
            return f"[api-error] {body.get('error')}"
    return body_text.strip() or f"(unparsed body, HTTP {status})"


def build_target(config: TargetConfig | None = None):
    """
    Return an async callback for ``RedTeam.scan(target=...)`` that forwards each
    adversarial turn to ``POST /api/chat``.
    """
    cfg = config or TargetConfig()

    async def msx_callback(
        messages: Any,
        stream: bool = False,  # noqa: ARG001 - part of the callback contract
        session_state: Any = None,  # noqa: ARG001
        context: Any = None,  # noqa: ARG001
    ) -> dict[str, list[dict[str, str]]]:
        payload = {
            "messages": _normalize_messages(messages),
        }
        timeout = aiohttp.ClientTimeout(total=cfg.timeout_s)
        try:
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post(
                    cfg.chat_url, headers=cfg.headers(), json=payload
                ) as resp:
                    text = await resp.text()
                    reply = _extract_reply(resp.status, text)
        except Exception as exc:  # network / timeout — surface, never crash the scan
            reply = f"[target-unreachable] {type(exc).__name__}: {exc}"

        return {"messages": [{"role": "assistant", "content": reply}]}

    return msx_callback
