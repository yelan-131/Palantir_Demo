from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import text


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _admin_token() -> str:
    from app.core.security import create_access_token

    return create_access_token(
        "admin",
        extra={
            "uid": 1,
            "tenant_id": 1,
            "is_admin": True,
            "roles": [{"id": 1, "name": "admin", "label": "Administrator"}],
        },
    )


def _admin_headers() -> dict[str, str]:
    return _headers(_admin_token())


def _ok(response, context: str) -> dict:
    assert response.status_code < 400, f"{context}: {response.status_code} {response.text}"
    return response.json()


def test_business_module_tenant_isolation_for_data_pipeline_and_dashboards():
    from app.core.db import db_session
    from app.main import app
    from app.models.relational import (
        Customer,
        Defect,
        Equipment,
        Factory,
        Inspection,
        Material,
        Product,
        ProductionLine,
        SalesOrder,
        SPCPoint,
        Supplier,
        Warehouse,
        WorkOrder,
        Workshop,
    )

    suffix = uuid.uuid4().hex[:8]

    async def seed_business_data(tenant_a_id: int, tenant_b_id: int) -> dict[str, int]:
        async with db_session() as session:
            factory_a = Factory(tenant_id=tenant_a_id, name=f"FA {suffix}", location="A", capacity=100, status="active")
            factory_b = Factory(tenant_id=tenant_b_id, name=f"FB {suffix}", location="B", capacity=100, status="active")
            session.add_all([factory_a, factory_b])
            await session.flush()

            workshop_a = Workshop(tenant_id=tenant_a_id, name=f"WA {suffix}", factory_id=factory_a.id)
            workshop_b = Workshop(tenant_id=tenant_b_id, name=f"WB {suffix}", factory_id=factory_b.id)
            session.add_all([workshop_a, workshop_b])
            await session.flush()

            line_a = ProductionLine(tenant_id=tenant_a_id, name=f"LA {suffix}", workshop_id=workshop_a.id, capacity=10, status="running")
            line_b = ProductionLine(tenant_id=tenant_b_id, name=f"LB {suffix}", workshop_id=workshop_b.id, capacity=10, status="idle")
            session.add_all([line_a, line_b])
            await session.flush()

            equipment_a = Equipment(tenant_id=tenant_a_id, name=f"EA {suffix}", line_id=line_a.id, model="A", manufacturer="A", status="running", health_score=91)
            equipment_b = Equipment(tenant_id=tenant_b_id, name=f"EB {suffix}", line_id=line_b.id, model="B", manufacturer="B", status="fault", health_score=41)
            product_a = Product(tenant_id=tenant_a_id, name=f"PA {suffix}", sku=f"same-sku-{suffix}", category="A")
            product_b = Product(tenant_id=tenant_b_id, name=f"PB {suffix}", sku=f"same-sku-{suffix}", category="B")
            customer_a = Customer(tenant_id=tenant_a_id, name=f"CA {suffix}", industry="A", region="A")
            customer_b = Customer(tenant_id=tenant_b_id, name=f"CB {suffix}", industry="B", region="B")
            material_a = Material(tenant_id=tenant_a_id, name=f"MA {suffix}", material_type="A", safety_stock=900)
            material_b = Material(tenant_id=tenant_b_id, name=f"MB {suffix}", material_type="B", safety_stock=100)
            supplier_a = Supplier(tenant_id=tenant_a_id, name=f"SA {suffix}", location="A", rating=4.8)
            supplier_b = Supplier(tenant_id=tenant_b_id, name=f"SB {suffix}", location="B", rating=2.8)
            warehouse_a = Warehouse(tenant_id=tenant_a_id, name=f"WHA {suffix}", location="A", capacity=10)
            warehouse_b = Warehouse(tenant_id=tenant_b_id, name=f"WHB {suffix}", location="B", capacity=10)
            session.add_all([equipment_a, equipment_b, product_a, product_b, customer_a, customer_b, material_a, material_b, supplier_a, supplier_b, warehouse_a, warehouse_b])
            await session.flush()

            sales_a = SalesOrder(tenant_id=tenant_a_id, order_no=f"same-order-{suffix}", customer_id=customer_a.id, product_id=product_a.id, quantity=10, due_date=datetime.now())
            sales_b = SalesOrder(tenant_id=tenant_b_id, order_no=f"same-order-{suffix}", customer_id=customer_b.id, product_id=product_b.id, quantity=10, due_date=datetime.now())
            session.add_all([sales_a, sales_b])
            await session.flush()

            work_a = WorkOrder(tenant_id=tenant_a_id, order_no=f"same-work-{suffix}", sales_order_id=sales_a.id, line_id=line_a.id, planned_start=datetime.now(), planned_end=datetime.now() + timedelta(days=1), quantity=10, completed_quantity=8, status="completed")
            work_b = WorkOrder(tenant_id=tenant_b_id, order_no=f"same-work-{suffix}", sales_order_id=sales_b.id, line_id=line_b.id, planned_start=datetime.now(), planned_end=datetime.now() + timedelta(days=1), quantity=10, completed_quantity=1, status="pending")
            inspection_a = Inspection(tenant_id=tenant_a_id, inspection_type="final", target_type="Product", target_id=product_a.id, result="pass", inspected_at=datetime.now())
            inspection_b = Inspection(tenant_id=tenant_b_id, inspection_type="final", target_type="Product", target_id=product_b.id, result="fail", inspected_at=datetime.now())
            session.add_all([work_a, work_b, inspection_a, inspection_b])
            await session.flush()

            defect_b = Defect(tenant_id=tenant_b_id, inspection_id=inspection_b.id, defect_type=f"tenant-b-only-{suffix}", severity="critical")
            spc_a = SPCPoint(tenant_id=tenant_a_id, parameter=f"dim-{suffix}", value=10, ucl=12, lcl=8, cl=10, equipment_id=equipment_a.id, timestamp=datetime.now())
            spc_b = SPCPoint(tenant_id=tenant_b_id, parameter=f"dim-{suffix}", value=20, ucl=12, lcl=8, cl=10, equipment_id=equipment_b.id, timestamp=datetime.now())
            session.add_all([defect_b, spc_a, spc_b])
            await session.execute(text(
                "CREATE TABLE IF NOT EXISTS business_quality_events ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "tenant_id INTEGER NOT NULL, "
                "title TEXT, "
                "deleted_at DATETIME"
                ")"
            ))
            await session.execute(
                text(
                    "INSERT INTO business_quality_events (tenant_id, title, deleted_at) "
                    "VALUES (:tenant_id, :title, NULL)"
                ),
                {"tenant_id": tenant_b_id, "title": f"tenant-b-quality-event-{suffix}"},
            )
            await session.commit()
            return {"tenant_b_equipment": equipment_b.id}

    with TestClient(app) as client:
        platform_headers = _admin_headers()
        tenant_a = _ok(client.post("/api/v1/platform/tenants", headers=platform_headers, json={"name": f"Business A {suffix}", "slug": f"biz-a-{suffix}", "domains": [f"biz-a-{suffix}.example.com"], "admin_email": f"owner@biz-a-{suffix}.example.com"}), "create business tenant a")["data"]
        tenant_b = _ok(client.post("/api/v1/platform/tenants", headers=platform_headers, json={"name": f"Business B {suffix}", "slug": f"biz-b-{suffix}", "domains": [f"biz-b-{suffix}.example.com"], "admin_email": f"owner@biz-b-{suffix}.example.com"}), "create business tenant b")["data"]
        token_a = _ok(client.post("/api/v1/auth/invite/accept", json={"token": tenant_a["adminInvite"]["inviteUrl"].split("token=", 1)[1], "password": "BusinessA123!"}), "accept a")["token"]
        token_b = _ok(client.post("/api/v1/auth/invite/accept", json={"token": tenant_b["adminInvite"]["inviteUrl"].split("token=", 1)[1], "password": "BusinessB123!"}), "accept b")["token"]

        seeded = asyncio.run(seed_business_data(tenant_a["id"], tenant_b["id"]))

        ds_a = _ok(client.post("/api/v1/data-sources", headers=_headers(token_a), json={"name": f"same-ds-{suffix}", "source_type": "api", "connection_config": "{}"}), "tenant a data source")
        ds_b = _ok(client.post("/api/v1/data-sources", headers=_headers(token_b), json={"name": f"same-ds-{suffix}", "source_type": "api", "connection_config": "{}"}), "tenant b data source")
        assert ds_a["tenant_id"] == tenant_a["id"]
        assert ds_b["tenant_id"] == tenant_b["id"]
        assert client.get(f"/api/v1/data-sources/{ds_a['id']}", headers=_headers(token_b)).status_code == 404

        pipe_a = _ok(client.post("/api/v1/pipelines", headers=_headers(token_a), json={"name": f"same-pipe-{suffix}", "config": "{}"}), "tenant a pipeline")
        pipe_b = _ok(client.post("/api/v1/pipelines", headers=_headers(token_b), json={"name": f"same-pipe-{suffix}", "config": "{}"}), "tenant b pipeline")
        assert pipe_a["tenant_id"] == tenant_a["id"]
        assert pipe_b["tenant_id"] == tenant_b["id"]
        assert client.post(f"/api/v1/pipelines/{pipe_a['id']}/run", headers=_headers(token_b)).status_code == 404

        overview_a = _ok(client.get("/api/v1/dashboard/overview", headers=_headers(token_a)), "overview a")
        overview_b = _ok(client.get("/api/v1/dashboard/overview", headers=_headers(token_b)), "overview b")
        assert overview_a["tenant_id"] == tenant_a["id"]
        assert overview_a["quality"]["defect_count"] == 0
        assert overview_b["quality"]["defect_count"] >= 1

        defects_a = _ok(client.get("/api/v1/quality/defects", headers=_headers(token_a)), "defects a")
        assert all(item["defect_type"] != f"tenant-b-only-{suffix}" for item in defects_a["data"])
        spc_a = _ok(client.get(f"/api/v1/quality/spc/dim-{suffix}?equipment_id={seeded['tenant_b_equipment']}", headers=_headers(token_a)), "spc a with b equipment")
        assert spc_a["count"] == 0

        suppliers_a = _ok(client.get("/api/v1/supply-chain/suppliers", headers=_headers(token_a)), "suppliers a")
        assert all(item["tenant_id"] == tenant_a["id"] for item in suppliers_a["data"])

        analytics_a = _ok(client.get("/api/v1/analytics/overview", headers=_headers(token_a)), "analytics a")
        assert analytics_a["production_lines"] == 1
        assert analytics_a["active_lines"] == 1
        assert analytics_a["equipment_utilization"] == 100.0
