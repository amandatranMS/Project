"""Thin client for the MSX Milestone Assistant REST API.

Handles the response envelope ({success, data} | {success, error}) and
authenticates to the API. Preferred: a real Microsoft Entra access token
(``Authorization: Bearer``) so Conditional Access can govern the agent; the
static ``x-api-key`` header is used as a fallback when no token scope is set.
Because this agent runs hosted in Foundry, it reaches the (local) MSX app
through a public dev-tunnel URL supplied via API_BASE_URL.

Auth is chosen from the environment:
  * ``MSX_API_SCOPE`` set (e.g. ``api://<msx-api-client-id>/.default``) → fetch an
    Entra token and send it as a bearer.
      - If ``AAD_TENANT_ID`` and ``AGENT_APP_CLIENT_ID`` are also set, the hosted
        managed identity is federated INTO the agent's Entra Agent ID app
        (workload identity federation), so the token that reaches the API is the
        agent app identity — Conditional Access then governs the agent app.
      - Otherwise the hosted managed identity calls the API directly.
  * ``MSX_API_SCOPE`` unset → fall back to the static ``x-api-key`` header.
"""
from __future__ import annotations

import os

import requests


class MsxApiError(Exception):
    """Raised when the API returns a { success: false, error } envelope."""


class MsxClient:
    def __init__(self) -> None:
        self.base = os.environ.get("API_BASE_URL", "http://localhost:4000").rstrip("/")
        self.session = requests.Session()
        # Lets requests pass through a dev tunnel without the browser
        # anti-phishing interstitial; harmless when talking to localhost.
        self.session.headers["X-Tunnel-Skip-AntiPhishing-Page"] = "true"

        # Prefer a real Entra token so Conditional Access can govern the agent;
        # fall back to the static x-api-key when no token scope is configured.
        self._scope = os.environ.get("MSX_API_SCOPE", "").strip() or None
        self._credential = None
        if self._scope:
            self._credential = self._build_credential()
        else:
            api_key = os.environ.get("API_KEY", "")
            if api_key:
                self.session.headers["x-api-key"] = api_key

    @staticmethod
    def _build_credential():
        """Credential used to fetch the MSX API access token (see module docstring)."""
        from azure.identity import ClientAssertionCredential, DefaultAzureCredential

        tenant = (
            os.environ.get("AAD_TENANT_ID") or os.environ.get("AZURE_TENANT_ID") or ""
        ).strip()
        agent_app_client_id = os.environ.get("AGENT_APP_CLIENT_ID", "").strip()
        if tenant and agent_app_client_id:
            # Federate the hosted managed identity into a *separate* Agent ID app.
            # NOTE: not usable for Foundry-hosted agents -- their runtime identity is
            # itself federation-derived, so Entra refuses to use it as a client
            # assertion (AADSTS700231). Leave AGENT_APP_CLIENT_ID unset there and use
            # the direct path below.
            managed_identity = DefaultAzureCredential()
            return ClientAssertionCredential(
                tenant_id=tenant,
                client_id=agent_app_client_id,
                func=lambda: managed_identity.get_token(
                    "api://AzureADTokenExchange/.default"
                ).token,
            )
        # The hosted managed identity (the agent's Agent ID) calls the API directly.
        # Authorize it with an app role on the API and govern it with Conditional Access.
        return DefaultAzureCredential()

    def _apply_bearer(self) -> None:
        """Refresh the Authorization header from the credential (tokens are cached
        and auto-refreshed by azure-identity, so this is cheap per request)."""
        if self._credential and self._scope:
            token = self._credential.get_token(self._scope).token
            self.session.headers["Authorization"] = f"Bearer {token}"

    def request(self, method: str, path: str, params: dict | None = None, json: dict | None = None):
        self._apply_bearer()
        url = f"{self.base}{path}"
        resp = self.session.request(method, url, params=params, json=json, timeout=30)
        try:
            body = resp.json()
        except ValueError:
            resp.raise_for_status()
            return None
        if not isinstance(body, dict) or not body.get("success", False):
            message = body.get("error") if isinstance(body, dict) else None
            raise MsxApiError(message or f"Request failed ({resp.status_code}).")
        return body.get("data")

    def get(self, path: str, params: dict | None = None):
        return self.request("GET", path, params=params)

    def post(self, path: str, json: dict | None = None):
        return self.request("POST", path, json=json)

    def patch(self, path: str, json: dict | None = None):
        return self.request("PATCH", path, json=json)

    def delete(self, path: str, params: dict | None = None):
        return self.request("DELETE", path, params=params)
