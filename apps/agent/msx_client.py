"""Thin client for the MSX Milestone Assistant REST API.

Handles the response envelope ({success, data} | {success, error}) and sends the
`x-api-key` header so it works whether the API is local or behind a dev tunnel.
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
        api_key = os.environ.get("API_KEY", "")
        if api_key:
            self.session.headers["x-api-key"] = api_key
        # Harmless locally; lets requests pass through a dev tunnel without the
        # browser anti-phishing interstitial.
        self.session.headers["X-Tunnel-Skip-AntiPhishing-Page"] = "true"

    def request(self, method: str, path: str, params: dict | None = None, json: dict | None = None):
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

    # Convenience wrappers -------------------------------------------------
    def get(self, path: str, params: dict | None = None):
        return self.request("GET", path, params=params)

    def post(self, path: str, json: dict | None = None):
        return self.request("POST", path, json=json)

    def patch(self, path: str, json: dict | None = None):
        return self.request("PATCH", path, json=json)

    def delete(self, path: str, params: dict | None = None):
        return self.request("DELETE", path, params=params)
