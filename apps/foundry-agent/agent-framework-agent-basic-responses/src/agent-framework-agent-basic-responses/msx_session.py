# Copyright (c) Microsoft. All rights reserved.
"""Per-turn user session handle propagation for on-behalf-of Graph reads.

The Foundry hosted agent is stateless and authenticates to the MSX API as the
SERVICE principal, so it carries no user identity of its own. When a signed-in
user drives a chat turn, the API mints a short-lived opaque handle
(``MSX_SESSION_ID``) and hands it to the agent as a system message. Any tool
that must act AS the user -- reading their Outlook mail or Teams chats -- has to
echo that handle back to the API as the ``x-msx-session`` header so the API can
run the read on-behalf-of the user via Microsoft Graph.

Relying on the model to copy that opaque handle verbatim through two delegation
hops (orchestrator instruction -> specialist -> ``session`` tool argument) is
unreliable: models routinely drop or mangle the value, and the read then fails
with a "sign-in required" error even though the user IS signed in. This module
removes that fragility by carrying the handle out-of-band in a
:class:`contextvars.ContextVar`. It is captured once -- as soon as it is seen in
the turn -- and the API client attaches it to every user-context request
automatically, so a read never depends on the model forwarding the value.

``ContextVar`` values are isolated per :mod:`asyncio` task, so one user turn's
handle can never leak into a different turn handled concurrently.
"""
from __future__ import annotations

import re
from contextvars import ContextVar, Token

# The current turn's user session handle, or None when no signed-in user is
# driving the turn (or the handle has not been captured yet).
_current_session_id: ContextVar[str | None] = ContextVar("msx_session_id", default=None)

# Matches the handle the API injects, e.g. "MSX_SESSION_ID=1b9d0f...". The value
# is an opaque token (a UUID today: hex + hyphens) so accept a run of URL-safe
# token characters, and tolerate either "=" or ":" and surrounding whitespace.
# Note: "." is intentionally excluded so a handle at the end of a sentence does
# not absorb the trailing period.
_SESSION_RE = re.compile(r"MSX_SESSION_ID\s*[=:]\s*([A-Za-z0-9_\-]+)")


def extract_session_id(text: str | None) -> str | None:
    """Pull the ``MSX_SESSION_ID`` value out of arbitrary text (an injected system
    message or a delegation instruction), or return ``None`` when absent."""
    if not text:
        return None
    match = _SESSION_RE.search(text)
    return match.group(1) if match else None


def set_session_id(session_id: str | None) -> Token:
    """Set the current turn's session handle. Returns a token that must be passed
    to :func:`reset_session_id` to restore the previous value (scope the handle to
    a single specialist run so it can never leak past it)."""
    normalized = (session_id or "").strip() or None
    return _current_session_id.set(normalized)


def reset_session_id(token: Token) -> None:
    """Restore the handle to what it was before the matching :func:`set_session_id`."""
    _current_session_id.reset(token)


def get_session_id() -> str | None:
    """The current turn's session handle, or ``None`` when no user context is set."""
    return _current_session_id.get()
