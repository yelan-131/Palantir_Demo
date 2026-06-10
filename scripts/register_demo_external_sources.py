"""Register demo external PostgreSQL systems as data sources.

Run after ``scripts/create_demo_source_databases.py``. The script talks to the
running backend API, so it exercises the same persistence path as the UI:
DataSource -> metadata scan -> DataSourceMetadata.
"""

from __future__ import annotations

import argparse
import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

from create_demo_source_databases import DATABASES, DEMO_PASSWORD


@dataclass(frozen=True)
class SourceRegistration:
    database: str
    name: str
    business_domain: str
    owner: str
    system_type: str


SOURCE_REGISTRATIONS = {
    "mf_mes_execution": SourceRegistration(
        database="mf_mes_execution",
        name="MES PostgreSQL 生产执行库",
        business_domain="生产",
        owner="生产运营部",
        system_type="MES",
    ),
    "mf_erp_core": SourceRegistration(
        database="mf_erp_core",
        name="ERP PostgreSQL 物料采购库",
        business_domain="供应链",
        owner="计划采购部",
        system_type="ERP",
    ),
    "mf_qms_quality": SourceRegistration(
        database="mf_qms_quality",
        name="QMS PostgreSQL 质量管理库",
        business_domain="质量",
        owner="质量管理部",
        system_type="QMS",
    ),
    "mf_wms_inventory": SourceRegistration(
        database="mf_wms_inventory",
        name="WMS PostgreSQL 仓储库存库",
        business_domain="仓储",
        owner="仓储物流部",
        system_type="WMS",
    ),
    "mf_scm_supply": SourceRegistration(
        database="mf_scm_supply",
        name="SCM PostgreSQL 供应协同库",
        business_domain="供应链",
        owner="供应商管理部",
        system_type="SCM",
    ),
    "mf_crm_sales": SourceRegistration(
        database="mf_crm_sales",
        name="CRM PostgreSQL 客户订单库",
        business_domain="客户",
        owner="客户成功部",
        system_type="CRM",
    ),
}

ISOLATED_SOURCE_PORTS = {
    "mf_mes_execution": 15432,
    "mf_erp_core": 15433,
    "mf_qms_quality": 15434,
    "mf_wms_inventory": 15435,
    "mf_scm_supply": 15436,
    "mf_crm_sales": 15437,
}


class ApiClient:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")

    def request(self, method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        data = None
        headers = {"Accept": "application/json"}
        if payload is not None:
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=data,
            method=method,
            headers=headers,
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                body = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise SystemExit(f"{method} {path} failed: HTTP {exc.code} {body}") from exc
        except urllib.error.URLError as exc:
            raise SystemExit(f"{method} {path} failed: {exc}") from exc
        return json.loads(body) if body else {}

    def get(self, path: str) -> dict[str, Any]:
        return self.request("GET", path)

    def post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.request("POST", path, payload)

    def put(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.request("PUT", path, payload)


def build_data_source_payload(registration: SourceRegistration, args: argparse.Namespace) -> dict[str, Any]:
    spec = DATABASES[registration.database]
    port = ISOLATED_SOURCE_PORTS[registration.database] if args.isolated else args.source_port
    config = {
        "type": "postgresql",
        "host": args.source_host,
        "port": port,
        "database": registration.database,
        "schema": "source",
        "username": spec["role"],
        "password": args.source_password or DEMO_PASSWORD,
        "ssl_enabled": False,
        "owner": registration.owner,
        "business_domain": registration.business_domain,
        "system_type": registration.system_type,
        "prefer_live_scan": True,
    }
    return {
        "name": registration.name,
        "source_type": "postgresql",
        "connection_config": json.dumps(config, ensure_ascii=False),
        "schedule": "手动扫描",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-base", default="http://127.0.0.1:8000/api/v1")
    parser.add_argument("--source-host", default="127.0.0.1")
    parser.add_argument("--source-port", type=int, default=5432)
    parser.add_argument("--source-password", default="")
    parser.add_argument("--isolated", action="store_true", help="Use one PostgreSQL instance per source on ports 15432-15437.")
    parser.add_argument("--no-scan", action="store_true")
    args = parser.parse_args()

    client = ApiClient(args.api_base)
    existing_rows = client.get("/data-sources").get("data", [])
    existing_by_name = {row["name"]: row for row in existing_rows}

    registered: list[tuple[int, str]] = []
    for registration in SOURCE_REGISTRATIONS.values():
        payload = build_data_source_payload(registration, args)
        existing = existing_by_name.get(registration.name)
        if existing:
            source_id = int(existing["id"])
            client.put(f"/data-sources/{source_id}", payload)
            action = "updated"
        else:
            created = client.post("/data-sources", payload)
            source_id = int(created["id"])
            action = "created"
        registered.append((source_id, registration.name))
        print(f"{action}: #{source_id} {registration.name}")

    if args.no_scan:
        return

    for source_id, name in registered:
        result = client.post(
            f"/data-sources/{source_id}/metadata-scan",
            {"limit_tables": 32, "sample_limit": 3},
        )
        scan = result.get("data", {})
        tables = scan.get("tables", [])
        field_count = sum(len(table.get("fields") or []) for table in tables)
        print(f"scanned: #{source_id} {name} tables={len(tables)} fields={field_count}")


if __name__ == "__main__":
    main()
