"""Production readiness smoke checks for the SaaS multi-tenant path.

This script intentionally uses public HTTP APIs only. It logs in as the
platform administrator, checks readiness, creates a tenant with an invite,
and verifies platform-only endpoints are reachable by the platform admin.
"""
from __future__ import annotations

import argparse
import json as json_lib
import os
import sys
import time
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def _request(method: str, url: str, **kwargs: Any) -> dict[str, Any]:
    headers = dict(kwargs.get("headers") or {})
    body = None
    if "json" in kwargs:
        body = json_lib.dumps(kwargs["json"]).encode("utf-8")
        headers.setdefault("Content-Type", "application/json")
    request = Request(url, data=body, headers=headers, method=method)
    try:
        with urlopen(request, timeout=20) as response:
            text = response.read().decode("utf-8")
    except HTTPError as exc:
        error_text = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {url} failed: {exc.code} {error_text[:500]}") from exc
    if text:
        return json_lib.loads(text)
    return {}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--username", default=os.getenv("SMOKE_USERNAME"))
    parser.add_argument("--password", default=os.getenv("SMOKE_PASSWORD"))
    parser.add_argument("--tenant-slug", default=None, help="default: smoke-<timestamp>")
    parser.add_argument("--tenant-domain", default=None, help="default: <slug>.local")
    args = parser.parse_args()
    if not args.username or not args.password:
        parser.error("provide --username/--password or SMOKE_USERNAME/SMOKE_PASSWORD")
    # Tenant slugs and domains are globally unique, so each run needs new ones.
    args.tenant_slug = args.tenant_slug or f"smoke-{time.strftime('%Y%m%d%H%M%S')}"
    args.tenant_domain = args.tenant_domain or f"{args.tenant_slug}.local"

    base_url = args.base_url.rstrip("/")
    readiness = _request("GET", f"{base_url}/api/v1/system/readiness")
    print(f"readiness={readiness.get('status')}")

    login = _request(
        "POST",
        f"{base_url}/api/v1/auth/login",
        json={"username": args.username, "password": args.password},
    )
    token = (
        login.get("access_token")
        or login.get("token")
        or login.get("data", {}).get("access_token")
        or login.get("data", {}).get("token")
    )
    if not token:
        raise RuntimeError("login did not return an access token")
    headers = {"Authorization": f"Bearer {token}"}

    tenant_payload = {
        "name": "Smoke Tenant",
        "slug": args.tenant_slug,
        "domains": [args.tenant_domain],
        "admin_email": f"admin@{args.tenant_domain}",
    }
    tenant = _request("POST", f"{base_url}/api/v1/platform/tenants", json=tenant_payload, headers=headers)
    tenant_id = tenant.get("data", {}).get("tenant", {}).get("id") or tenant.get("data", {}).get("id")
    if not tenant_id:
        raise RuntimeError("tenant creation did not return tenant id")
    print(f"tenant_id={tenant_id}")

    exports = _request("POST", f"{base_url}/api/v1/platform/tenants/{tenant_id}/exports", headers=headers)
    if not exports.get("ok"):
        raise RuntimeError(f"tenant export failed: {exports}")
    print(f"export_id={exports['data']['id']}")

    metrics = _request("GET", f"{base_url}/api/v1/system/metrics", headers=headers)
    print(f"requests_total={metrics.get('data', {}).get('requests_total')}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"smoke failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
