# Copyright (c) Microsoft. All rights reserved.
"""Regression tripwire for the signed-in-user (Outlook / Teams) read fix.

Background
----------
The hosted agent reads a signed-in user's Outlook mail / Teams chats on their
behalf by carrying an opaque ``MSX_SESSION_ID`` handle on a per-turn
``contextvars.ContextVar``. ``MsxSessionMiddleware`` binds that handle before the
model runs; the synchronous API client attaches it as the ``x-msx-session``
header on every on-behalf-of read.

The bug this guards against: the middleware used to *reset* the ContextVar in a
``finally`` around ``call_next()``. When the host STREAMS the response (the web
app always does), the model step and its tool calls -- including the reads --
run AFTER ``call_next()`` returns, so the reset cleared the handle before the
read looked it up. The read then fell back to the service principal and failed
with "a signed-in Microsoft user is required" even though the user WAS signed
in. The fix binds the handle for the whole turn and does NOT reset it.

These tests fail loudly if that reset is ever reintroduced, or if the handle no
longer survives past ``call_next()``.

Run with pytest::

    pytest apps/foundry-agent/agent-framework-agent-basic-responses/tests

or with no test runner installed::

    python apps/foundry-agent/agent-framework-agent-basic-responses/tests/test_msx_session.py
"""
from __future__ import annotations

import ast
import asyncio
import sys
from pathlib import Path

# Make the agent source importable whether run via pytest or plain python.
_SRC = Path(__file__).resolve().parents[1] / "src" / "agent-framework-agent-basic-responses"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from msx_session import (  # noqa: E402  (import after sys.path tweak)
    extract_session_id,
    get_session_id,
    reset_session_id,
    set_session_id,
)

_MAIN_PY = _SRC / "main.py"


def _middleware_process_ast() -> ast.AST:
    """Parse main.py (text only -- imports nothing) and return the AST of
    ``MsxSessionMiddleware.process``. Using the AST makes the checks below immune
    to the word "finally" appearing in explanatory comments/docstrings."""
    tree = ast.parse(_MAIN_PY.read_text(encoding="utf-8"))
    cls = next(
        n for n in tree.body
        if isinstance(n, ast.ClassDef) and n.name == "MsxSessionMiddleware"
    )
    return next(
        n for n in cls.body
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == "process"
    )


def _calls_named(node: ast.AST, name: str) -> bool:
    for sub in ast.walk(node):
        if isinstance(sub, ast.Call):
            func = sub.func
            if isinstance(func, ast.Name) and func.id == name:
                return True
            if isinstance(func, ast.Attribute) and func.attr == name:
                return True
    return False


def test_middleware_does_not_reset_handle_around_call_next() -> None:
    """The exact regression guard: the streamed turn must keep the handle bound.

    If someone re-adds ``reset_session_id`` (or a try/finally that clears the
    handle) inside the middleware, streamed Outlook/Teams reads break again.
    """
    proc = _middleware_process_ast()
    assert not _calls_named(proc, "reset_session_id"), (
        "MsxSessionMiddleware.process must NOT call reset_session_id: a reset fires "
        "before streamed tool calls run and reintroduces the 'a signed-in Microsoft "
        "user is required' Outlook/Teams bug."
    )
    has_finally = any(
        isinstance(n, ast.Try) and n.finalbody for n in ast.walk(proc)
    )
    assert not has_finally, (
        "MsxSessionMiddleware.process must not wrap call_next() in try/finally that "
        "could clear the handle before streamed reads execute."
    )
    assert _calls_named(proc, "set_session_id"), "The middleware must bind the handle for the turn."
    assert _calls_named(proc, "call_next"), "The middleware must still invoke call_next()."


def test_handle_persists_after_call_next_without_reset() -> None:
    """Mechanism check: binding without reset keeps the handle live for tool calls
    that run AFTER call_next() returns (the streaming case)."""

    async def scenario() -> None:
        seen: dict[str, str | None] = {}

        async def call_next() -> None:
            # In streaming, the model/tool work is scheduled here but the reads
            # actually execute after this returns; capture what a read would see.
            seen["during"] = get_session_id()

        # Mirror the middleware: bind for the whole turn, DO NOT reset.
        set_session_id("HANDLE_STREAM_123")
        await call_next()
        # A streamed read runs now -- after call_next returned. It must still see it.
        seen["after"] = get_session_id()

        assert seen["during"] == "HANDLE_STREAM_123"
        assert seen["after"] == "HANDLE_STREAM_123"

    asyncio.run(scenario())


def test_delegate_scoped_set_reset_still_restores() -> None:
    """The delegate still uses a scoped set/reset; that pattern must restore the
    previous handle so a delegation that restates a handle can't leak."""
    set_session_id("OUTER")
    token = set_session_id("INNER")
    assert get_session_id() == "INNER"
    reset_session_id(token)
    assert get_session_id() == "OUTER"


def test_extract_session_id_parses_base64url_and_stops_at_period() -> None:
    """Handles are base64url (``msx2`` + A-Za-z0-9_-). The extractor must capture
    the whole handle but not swallow a trailing sentence period."""
    handle = "msx2AbC-_09xYz"
    assert extract_session_id(f"MSX_SESSION_ID={handle}") == handle
    assert extract_session_id(f"note MSX_SESSION_ID={handle}. thanks") == handle
    assert extract_session_id("no marker here") is None
    assert extract_session_id(None) is None


def _run_standalone() -> int:
    """Minimal runner so the tripwire works without pytest installed."""
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failures = 0
    for fn in tests:
        try:
            fn()
            print(f"PASS {fn.__name__}")
        except Exception as exc:  # noqa: BLE001 - report every failure
            failures += 1
            print(f"FAIL {fn.__name__}: {exc}")
    print(f"\n{len(tests) - failures}/{len(tests)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(_run_standalone())
