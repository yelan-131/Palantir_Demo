"""seed application form assembly menus

Revision ID: 0024_seed_application_assembly
Revises: 0023_saas_hardening
Create Date: 2026-05-28
"""
from __future__ import annotations

import json

import sqlalchemy as sa
from alembic import op

revision = "0024_seed_application_assembly"
down_revision = "0023_saas_hardening"
branch_labels = None
depends_on = None

TENANT_ID = 1

APPLICATION_ASSEMBLY = {
    "production-dashboard": [
        {
            "title": "生产看板",
            "icon": "DashboardOutlined",
            "children": [
                ("production-overview", "生产总览", "/program/production-overview", "DashboardOutlined", "analysis"),
                ("oee-trend-report", "OEE 趋势报表", "/program/oee-trend-report", "DashboardOutlined", "report"),
                ("line-status", "产线状态", "/program/line-status", "DashboardOutlined", "analysis"),
                ("line-load-analysis", "产线负荷分析", "/program/line-load-analysis", "DashboardOutlined", "report"),
            ],
        },
        {
            "title": "业务填报",
            "icon": "AppstoreOutlined",
            "children": [
                ("production-plan-entry", "生产计划填报", "/program/production-plan-entry", "AppstoreOutlined", "business"),
                ("alert-center", "告警中心", "/program/alert-center", "SafetyCertificateOutlined", "business"),
            ],
        },
    ],
    "maintenance-analysis": [
        {
            "title": "设备分析",
            "icon": "ToolOutlined",
            "children": [
                ("device-health", "设备健康", "/program/device-health", "ToolOutlined", "analysis"),
                ("device-health-dashboard", "设备健康看板", "/program/device-health-dashboard", "ToolOutlined", "analysis"),
                ("fault-prediction", "故障预测", "/program/fault-prediction", "WarningOutlined", "analysis"),
                ("failure-trend-analysis", "故障趋势分析", "/program/failure-trend-analysis", "LineChartOutlined", "report"),
            ],
        },
        {
            "title": "维护执行",
            "icon": "AppstoreOutlined",
            "children": [
                ("maintenance-order", "维修工单", "/program/maintenance-order", "AppstoreOutlined", "business"),
                ("alert-center", "告警中心", "/program/alert-center", "SafetyCertificateOutlined", "business"),
                ("equipment-inspection", "点检计划", "/dynamic/equipment-inspection", "FormOutlined", "business"),
            ],
        },
    ],
    "quality-control": [
        {
            "title": "质量看板",
            "icon": "SafetyCertificateOutlined",
            "children": [
                ("quality-overview", "质量总览", "/program/quality-overview", "SafetyCertificateOutlined", "analysis"),
                ("defect-analysis", "缺陷分析", "/program/defect-analysis", "ExperimentOutlined", "analysis"),
                ("defect-analysis-report", "缺陷分析报表", "/program/defect-analysis-report", "ExperimentOutlined", "report"),
                ("process-capability-dashboard", "过程能力看板", "/program/process-capability-dashboard", "CheckCircleOutlined", "report"),
            ],
        },
        {
            "title": "质量业务",
            "icon": "AppstoreOutlined",
            "children": [
                ("inspection-batch", "检验批次", "/program/inspection-batch", "FileSearchOutlined", "business"),
                ("quality-event", "质量事件", "/program/quality-event", "SafetyCertificateOutlined", "business"),
                ("capa-tracking", "CAPA 跟踪", "/dynamic/capa-tracking", "FormOutlined", "business"),
            ],
        },
    ],
    "supply-risk": [
        {
            "title": "供应看板",
            "icon": "ShopOutlined",
            "children": [
                ("supply-overview", "供应总览", "/program/supply-overview", "ShopOutlined", "analysis"),
                ("supplier-risk", "供应商风险", "/program/supplier-risk", "ShopOutlined", "analysis"),
                ("material-impact", "物料影响", "/program/material-impact", "DatabaseOutlined", "analysis"),
                ("material-impact-report", "物料影响报表", "/program/material-impact-report", "DatabaseOutlined", "report"),
                ("supply-risk-dashboard", "供应风险看板", "/program/supply-risk-dashboard", "ShopOutlined", "report"),
            ],
        },
        {
            "title": "风险处理",
            "icon": "AppstoreOutlined",
            "children": [
                ("risk-review", "风险复核", "/program/risk-review", "FileSearchOutlined", "business"),
                ("supplier-scorecard", "供应商评分", "/dynamic/supplier-scorecard", "FormOutlined", "business"),
                ("inventory-impact", "库存影响", "/dynamic/inventory-impact", "FormOutlined", "business"),
            ],
        },
    ],
}


def _scalar(conn, sql: str, **params):
    return conn.execute(sa.text(sql), params).scalar()


def _ensure_form(conn, code: str, name: str, kind: str) -> int:
    form_id = _scalar(
        conn,
        "SELECT id FROM forms WHERE tenant_id = :tenant_id AND code = :code LIMIT 1",
        tenant_id=TENANT_ID,
        code=code,
    )
    config = json.dumps(
        {
            "source": "application-assembly-seed",
            "assemblyKind": kind,
            "viewConfig": {"table": {"pageSize": 20, "density": "middle", "columns": []}, "filters": []},
            "workflowDesigner": {},
        },
        ensure_ascii=False,
    )
    if form_id is None:
        form_id = _scalar(
            conn,
            """
            INSERT INTO forms
                (tenant_id, name, code, description, table_name, storage_mode, status, config, created_at, updated_at)
            VALUES
                (:tenant_id, :name, :code, :description, NULL, 'dynamic', 'published', :config, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            RETURNING id
            """,
            tenant_id=TENANT_ID,
            name=name,
            code=code,
            description=f"{name}应用装配入口",
            config=config,
        )
    else:
        conn.execute(
            sa.text(
                """
                UPDATE forms
                SET name = :name,
                    status = 'published',
                    config = CASE
                        WHEN config IS NULL THEN :config
                        ELSE config
                    END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = :form_id
                """
            ),
            {"name": name, "config": config, "form_id": form_id},
        )
    return int(form_id)


def _ensure_application_form(conn, app_id: int, form_id: int, alias: str, sort_order: int) -> None:
    binding_id = _scalar(
        conn,
        """
        SELECT id FROM application_forms
        WHERE tenant_id = :tenant_id AND application_id = :app_id AND form_id = :form_id
        LIMIT 1
        """,
        tenant_id=TENANT_ID,
        app_id=app_id,
        form_id=form_id,
    )
    if binding_id is None:
        conn.execute(
            sa.text(
                """
                INSERT INTO application_forms
                    (tenant_id, application_id, form_id, alias, enabled, default_view, allow_create, allow_edit,
                     allow_delete, allow_export, sort_order, created_at, updated_at)
                VALUES
                    (:tenant_id, :app_id, :form_id, :alias, TRUE, 'list', TRUE, TRUE, TRUE, TRUE,
                     :sort_order, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """
            ),
            {"tenant_id": TENANT_ID, "app_id": app_id, "form_id": form_id, "alias": alias, "sort_order": sort_order},
        )
    else:
        conn.execute(
            sa.text(
                """
                UPDATE application_forms
                SET alias = :alias,
                    enabled = TRUE,
                    sort_order = :sort_order,
                    allow_export = TRUE,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = :binding_id
                """
            ),
            {"binding_id": binding_id, "alias": alias, "sort_order": sort_order},
        )


def _insert_menu_node(
    conn,
    app_id: int,
    parent_id: int | None,
    node_type: str,
    title: str,
    icon: str,
    form_id: int | None,
    route_path: str | None,
    sort_order: int,
    default_entry: bool = False,
) -> int:
    return int(
        _scalar(
            conn,
            """
            INSERT INTO application_menu_nodes
                (tenant_id, application_id, parent_id, node_type, title, icon, form_id, route_path,
                 visible, default_entry, sort_order, created_at, updated_at)
            VALUES
                (:tenant_id, :app_id, :parent_id, :node_type, :title, :icon, :form_id, :route_path,
                 TRUE, :default_entry, :sort_order, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            RETURNING id
            """,
            tenant_id=TENANT_ID,
            app_id=app_id,
            parent_id=parent_id,
            node_type=node_type,
            title=title,
            icon=icon,
            form_id=form_id,
            route_path=route_path,
            default_entry=default_entry,
            sort_order=sort_order,
        )
    )


def upgrade() -> None:
    conn = op.get_bind()
    for app_code, groups in APPLICATION_ASSEMBLY.items():
        app_id = _scalar(
            conn,
            "SELECT id FROM applications WHERE tenant_id = :tenant_id AND code = :code LIMIT 1",
            tenant_id=TENANT_ID,
            code=app_code,
        )
        if app_id is None:
            continue
        app_id = int(app_id)
        conn.execute(
            sa.text("DELETE FROM application_menu_nodes WHERE tenant_id = :tenant_id AND application_id = :app_id"),
            {"tenant_id": TENANT_ID, "app_id": app_id},
        )
        sort_order = 0
        leaf_index = 0
        for group in groups:
            group_id = _insert_menu_node(
                conn,
                app_id=app_id,
                parent_id=None,
                node_type="group",
                title=group["title"],
                icon=group["icon"],
                form_id=None,
                route_path=None,
                sort_order=sort_order,
            )
            sort_order += 1
            for code, name, route_path, icon, kind in group["children"]:
                form_id = _ensure_form(conn, code, name, kind)
                _ensure_application_form(conn, app_id, form_id, name, sort_order)
                _insert_menu_node(
                    conn,
                    app_id=app_id,
                    parent_id=group_id,
                    node_type="form",
                    title=name,
                    icon=icon,
                    form_id=form_id,
                    route_path=route_path,
                    sort_order=sort_order,
                    default_entry=leaf_index == 0,
                )
                sort_order += 1
                leaf_index += 1


def downgrade() -> None:
    conn = op.get_bind()
    for app_code in APPLICATION_ASSEMBLY:
        app_id = _scalar(
            conn,
            "SELECT id FROM applications WHERE tenant_id = :tenant_id AND code = :code LIMIT 1",
            tenant_id=TENANT_ID,
            code=app_code,
        )
        if app_id is not None:
            conn.execute(
                sa.text("DELETE FROM application_menu_nodes WHERE tenant_id = :tenant_id AND application_id = :app_id"),
                {"tenant_id": TENANT_ID, "app_id": int(app_id)},
            )
