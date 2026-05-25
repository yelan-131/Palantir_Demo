"""Report Center API — CRUD + version snapshots, with mock fallback."""

import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

router = APIRouter()

from app.api.deps import current_tenant_id, current_user_id, get_current_user
from app.config import settings
from app.core.audit import write_audit_log


# ── Schemas ───────────────────────────────────────────────

class ReportCreate(BaseModel):
    name: str
    description: Optional[str] = None
    config: Optional[dict] = None
    category: Optional[str] = "general"
    is_published: Optional[bool] = False
    created_by: Optional[str] = None


class ReportUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    config: Optional[dict] = None
    category: Optional[str] = None
    is_published: Optional[bool] = None


# ── Mock data ─────────────────────────────────────────────

_MOCK_REPORTS = [
    {
        "id": 1,
        "name": "生产运营日报",
        "description": "每日生产数据汇总，含 OEE、产量、设备状态",
        "config": {
            "canvas": {"gridSize": 8},
            "widgets": [
                {
                    "id": "w-1", "type": "kpi-card", "title": "设备总数",
                    "position": {"x": 0, "y": 0, "w": 6, "h": 4},
                    "dataSource": {"endpoint": "/api/v1/dashboard/overview", "path": "equipment.total"},
                    "style": {"color": "#1677ff", "icon": "ToolOutlined"},
                },
                {
                    "id": "w-2", "type": "kpi-card", "title": "运行中",
                    "position": {"x": 6, "y": 0, "w": 6, "h": 4},
                    "dataSource": {"endpoint": "/api/v1/dashboard/overview", "path": "equipment.running"},
                    "style": {"color": "#52c41a", "icon": "CheckCircleOutlined"},
                },
                {
                    "id": "w-3", "type": "kpi-card", "title": "故障数",
                    "position": {"x": 12, "y": 0, "w": 6, "h": 4},
                    "dataSource": {"endpoint": "/api/v1/dashboard/overview", "path": "equipment.fault"},
                    "style": {"color": "#ff4d4f", "icon": "WarningOutlined"},
                },
                {
                    "id": "w-4", "type": "kpi-card", "title": "离线数",
                    "position": {"x": 18, "y": 0, "w": 6, "h": 4},
                    "dataSource": {"endpoint": "/api/v1/dashboard/overview", "path": "equipment.offline"},
                    "style": {"color": "#8c8c8c", "icon": "PoweroffOutlined"},
                },
                {
                    "id": "w-5", "type": "line-chart", "title": "7日生产趋势",
                    "position": {"x": 0, "y": 4, "w": 12, "h": 8},
                    "dataSource": {"endpoint": "/api/v1/dashboard/production", "params": {"days": 7}},
                    "chartConfig": {"xField": "date", "series": [{"name": "计划", "dataField": "planned"}, {"name": "实际", "dataField": "actual"}]},
                },
                {
                    "id": "w-6", "type": "bar-chart", "title": "产线产量对比",
                    "position": {"x": 12, "y": 4, "w": 12, "h": 8},
                    "dataSource": {"endpoint": "/api/v1/dashboard/production", "params": {"days": 7}},
                    "chartConfig": {"xField": "date", "series": [{"name": "产量", "dataField": "actual"}]},
                },
            ],
            "filters": [{"id": "f-1", "type": "date-range", "label": "日期范围", "paramName": "days", "defaultValue": 7}],
        },
        "category": "production",
        "is_published": True,
        "created_by": "admin",
        "created_at": "2026-04-20T10:00:00",
        "updated_at": "2026-04-22T08:30:00",
    },
    {
        "id": 2,
        "name": "设备健康管理看板",
        "description": "设备健康评分、故障预测、维修工单统计",
        "config": {
            "canvas": {"gridSize": 8},
            "widgets": [
                {
                    "id": "w-1", "type": "gauge", "title": "整体健康指数",
                    "position": {"x": 0, "y": 0, "w": 8, "h": 8},
                    "dataSource": {"endpoint": "/api/v1/maintenance/equipment-health"},
                    "style": {"color": "#1677ff"},
                    "chartConfig": {"valueField": "avg_health", "max": 100},
                },
                {
                    "id": "w-2", "type": "pie-chart", "title": "设备状态分布",
                    "position": {"x": 8, "y": 0, "w": 8, "h": 8},
                    "dataSource": {"endpoint": "/api/v1/dashboard/overview"},
                    "chartConfig": {"nameField": "status", "valueField": "count"},
                },
                {
                    "id": "w-3", "type": "data-table", "title": "故障预测列表",
                    "position": {"x": 0, "y": 8, "w": 24, "h": 8},
                    "dataSource": {"endpoint": "/api/v1/maintenance/predictions"},
                    "chartConfig": {"columns": ["equipment_name", "failure_probability", "predicted_date", "recommendation"]},
                },
            ],
            "filters": [],
        },
        "category": "maintenance",
        "is_published": True,
        "created_by": "admin",
        "created_at": "2026-04-21T14:00:00",
        "updated_at": "2026-04-21T14:00:00",
    },
    {
        "id": 3,
        "name": "质量分析报表",
        "description": "SPC 控制图、缺陷帕累托分析",
        "config": {
            "canvas": {"gridSize": 8},
            "widgets": [
                {
                    "id": "w-1", "type": "line-chart", "title": "SPC 控制图",
                    "position": {"x": 0, "y": 0, "w": 24, "h": 10},
                    "dataSource": {"endpoint": "/api/v1/quality/spc/temperature"},
                    "chartConfig": {"xField": "timestamp", "series": [{"name": "测量值", "dataField": "value"}], "controlLimits": {"ucl": "ucl", "lcl": "lcl", "cl": "cl"}},
                },
                {
                    "id": "w-2", "type": "bar-chart", "title": "缺陷帕累托图",
                    "position": {"x": 0, "y": 10, "w": 12, "h": 8},
                    "dataSource": {"endpoint": "/api/v1/quality/defects/pareto"},
                    "chartConfig": {"xField": "defect_type", "series": [{"name": "数量", "dataField": "count"}]},
                },
                {
                    "id": "w-3", "type": "data-table", "title": "缺陷明细",
                    "position": {"x": 12, "y": 10, "w": 12, "h": 8},
                    "dataSource": {"endpoint": "/api/v1/quality/defects"},
                    "chartConfig": {"columns": ["defect_type", "severity", "description", "root_cause"]},
                },
            ],
            "filters": [{"id": "f-1", "type": "select", "label": "SPC参数", "paramName": "parameter", "options": ["temperature", "pressure", "vibration"]}],
        },
        "category": "quality",
        "is_published": False,
        "created_by": "admin",
        "created_at": "2026-04-22T09:00:00",
        "updated_at": "2026-04-22T09:00:00",
    },
]

_MOCK_SNAPSHOTS: dict[int, list] = {
    1: [
        {"id": 1, "report_id": 1, "config": _MOCK_REPORTS[0]["config"], "version": 1, "created_at": "2026-04-20T10:00:00"},
        {"id": 2, "report_id": 1, "config": _MOCK_REPORTS[0]["config"], "version": 2, "created_at": "2026-04-22T08:30:00"},
    ],
    2: [
        {"id": 3, "report_id": 2, "config": _MOCK_REPORTS[1]["config"], "version": 1, "created_at": "2026-04-21T14:00:00"},
    ],
}

_mock_id_counter = 10


# DB session helper — unified via core.db.safe_db_call
from app.core.db import safe_db_call as _try_db  # noqa: E402


# ── Endpoints ─────────────────────────────────────────────

@router.get("/")
async def list_reports(
    category: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    """报表列表（分页+分类过滤）."""
    async def _query(db):
        from app.models.relational import Report
        from sqlalchemy import select, func
        tenant_id = current_tenant_id(user)
        query = select(Report).where(Report.tenant_id == tenant_id).order_by(Report.updated_at.desc())
        count_query = select(func.count(Report.id)).where(Report.tenant_id == tenant_id)
        if category:
            query = query.where(Report.category == category)
            count_query = count_query.where(Report.category == category)
        total = await db.scalar(count_query)
        query = query.offset((page - 1) * page_size).limit(page_size)
        result = await db.execute(query)
        reports = result.scalars().all()
        return {
            "data": [
                {
                    "id": r.id,
                    "name": r.name,
                    "description": r.description,
                    "config": json.loads(r.config) if isinstance(r.config, str) else r.config,
                    "category": r.category,
                    "is_published": r.is_published,
                    "created_by": r.created_by,
                    "created_at": r.created_at.isoformat() if r.created_at else None,
                    "updated_at": r.updated_at.isoformat() if r.updated_at else None,
                }
                for r in reports
            ],
            "total": total or 0,
            "page": page,
            "page_size": page_size,
        }

    result = await _try_db(_query)
    if result is not None:
        return result
    if settings.IS_PRODUCTION:
        raise HTTPException(503, "Reports database unavailable")

    filtered = _MOCK_REPORTS
    if category:
        filtered = [r for r in filtered if r["category"] == category]
    start = (page - 1) * page_size
    return {
        "data": filtered[start : start + page_size],
        "total": len(filtered),
        "page": page,
        "page_size": page_size,
    }


@router.post("/")
async def create_report(body: ReportCreate, user: dict = Depends(get_current_user)):
    """创建报表."""
    async def _query(db):
        from app.models.relational import Report
        tenant_id = current_tenant_id(user)
        report = Report(
            tenant_id=tenant_id,
            name=body.name,
            description=body.description,
            config=json.dumps(body.config or {"canvas": {"gridSize": 8}, "widgets": [], "filters": []}, ensure_ascii=False),
            category=body.category,
            is_published=body.is_published,
            created_by=body.created_by,
        )
        db.add(report)
        await db.commit()
        await db.refresh(report)
        await write_audit_log(
            tenant_id=tenant_id,
            user_id=current_user_id(user),
            action="create",
            resource_type="report",
            resource_id=report.id,
            new_values=body.dict(),
        )
        return {
            "id": report.id,
            "name": report.name,
            "description": report.description,
            "config": json.loads(report.config),
            "category": report.category,
            "is_published": report.is_published,
            "created_by": report.created_by,
        }

    result = await _try_db(_query)
    if result is not None:
        return result
    if settings.IS_PRODUCTION:
        raise HTTPException(503, "Reports database unavailable")

    global _mock_id_counter
    _mock_id_counter += 1
    new_report = {
        "id": _mock_id_counter,
        "name": body.name,
        "description": body.description,
        "config": body.config or {"canvas": {"gridSize": 8}, "widgets": [], "filters": []},
        "category": body.category,
        "is_published": body.is_published,
        "created_by": body.created_by,
        "created_at": datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat(),
    }
    _MOCK_REPORTS.append(new_report)
    return new_report


@router.get("/{report_id}")
async def get_report(report_id: int, user: dict = Depends(get_current_user)):
    """获取报表详情."""
    async def _query(db):
        from app.models.relational import Report
        tenant_id = current_tenant_id(user)
        report = await db.get(Report, report_id)
        if not report or report.tenant_id != tenant_id:
            return None
        return {
            "id": report.id,
            "name": report.name,
            "description": report.description,
            "config": json.loads(report.config) if isinstance(report.config, str) else report.config,
            "category": report.category,
            "is_published": report.is_published,
            "created_by": report.created_by,
            "created_at": report.created_at.isoformat() if report.created_at else None,
            "updated_at": report.updated_at.isoformat() if report.updated_at else None,
        }

    result = await _try_db(_query)
    if result is not None:
        return result
    if settings.IS_PRODUCTION:
        raise HTTPException(404, "Report not found")

    for r in _MOCK_REPORTS:
        if r["id"] == report_id:
            return r
    raise HTTPException(status_code=404, detail="Report not found")


@router.put("/{report_id}")
async def update_report(report_id: int, body: ReportUpdate, user: dict = Depends(get_current_user)):
    """更新报表."""
    async def _query(db):
        from app.models.relational import Report
        tenant_id = current_tenant_id(user)
        report = await db.get(Report, report_id)
        if not report or report.tenant_id != tenant_id:
            return None
        old_values = {
            "name": report.name,
            "description": report.description,
            "config": report.config,
            "category": report.category,
            "is_published": report.is_published,
        }
        if body.name is not None:
            report.name = body.name
        if body.description is not None:
            report.description = body.description
        if body.config is not None:
            report.config = json.dumps(body.config, ensure_ascii=False)
        if body.category is not None:
            report.category = body.category
        if body.is_published is not None:
            report.is_published = body.is_published
        await db.commit()
        await db.refresh(report)
        await write_audit_log(
            tenant_id=tenant_id,
            user_id=current_user_id(user),
            action="update",
            resource_type="report",
            resource_id=report.id,
            old_values=old_values,
            new_values=body.dict(exclude_unset=True),
        )
        return {
            "id": report.id,
            "name": report.name,
            "description": report.description,
            "config": json.loads(report.config) if isinstance(report.config, str) else report.config,
            "category": report.category,
            "is_published": report.is_published,
            "created_by": report.created_by,
        }

    result = await _try_db(_query)
    if result is not None:
        return result
    if settings.IS_PRODUCTION:
        raise HTTPException(404, "Report not found")

    for r in _MOCK_REPORTS:
        if r["id"] == report_id:
            if body.name is not None:
                r["name"] = body.name
            if body.description is not None:
                r["description"] = body.description
            if body.config is not None:
                r["config"] = body.config
            if body.category is not None:
                r["category"] = body.category
            if body.is_published is not None:
                r["is_published"] = body.is_published
            r["updated_at"] = datetime.now().isoformat()
            return r
    raise HTTPException(status_code=404, detail="Report not found")


@router.delete("/{report_id}")
async def delete_report(report_id: int, user: dict = Depends(get_current_user)):
    """删除报表."""
    async def _query(db):
        from app.models.relational import Report, ReportSnapshot
        tenant_id = current_tenant_id(user)
        report = await db.get(Report, report_id)
        if not report or report.tenant_id != tenant_id:
            return None
        from sqlalchemy import delete
        await db.execute(delete(ReportSnapshot).where(ReportSnapshot.report_id == report_id))
        await db.delete(report)
        await db.commit()
        await write_audit_log(
            tenant_id=tenant_id,
            user_id=current_user_id(user),
            action="delete",
            resource_type="report",
            resource_id=report_id,
        )
        return {"ok": True, "deleted_id": report_id}

    result = await _try_db(_query)
    if result is not None:
        return result
    if settings.IS_PRODUCTION:
        raise HTTPException(404, "Report not found")

    global _MOCK_REPORTS
    _MOCK_REPORTS = [r for r in _MOCK_REPORTS if r["id"] != report_id]
    _MOCK_SNAPSHOTS.pop(report_id, None)
    return {"ok": True, "deleted_id": report_id}


@router.post("/{report_id}/snapshot")
async def create_snapshot(report_id: int, user: dict = Depends(get_current_user)):
    """创建版本快照."""
    async def _query(db):
        from app.models.relational import Report, ReportSnapshot
        from sqlalchemy import select, func
        tenant_id = current_tenant_id(user)
        report = await db.get(Report, report_id)
        if not report or report.tenant_id != tenant_id:
            return None
        max_ver = await db.scalar(
            select(func.max(ReportSnapshot.version)).where(ReportSnapshot.report_id == report_id)
        )
        version = (max_ver or 0) + 1
        snapshot = ReportSnapshot(
            tenant_id=tenant_id,
            report_id=report_id,
            config=report.config,
            version=version,
        )
        db.add(snapshot)
        await db.commit()
        await db.refresh(snapshot)
        return {
            "id": snapshot.id,
            "report_id": snapshot.report_id,
            "config": json.loads(snapshot.config) if isinstance(snapshot.config, str) else snapshot.config,
            "version": snapshot.version,
            "created_at": snapshot.created_at.isoformat() if snapshot.created_at else None,
        }

    result = await _try_db(_query)
    if result is not None:
        return result
    if settings.IS_PRODUCTION:
        raise HTTPException(404, "Report not found")

    for r in _MOCK_REPORTS:
        if r["id"] == report_id:
            snapshots = _MOCK_SNAPSHOTS.setdefault(report_id, [])
            version = len(snapshots) + 1
            snap = {
                "id": 100 + version,
                "report_id": report_id,
                "config": r["config"],
                "version": version,
                "created_at": datetime.now().isoformat(),
            }
            snapshots.append(snap)
            return snap
    raise HTTPException(status_code=404, detail="Report not found")


@router.get("/{report_id}/snapshots")
async def list_snapshots(report_id: int, user: dict = Depends(get_current_user)):
    """历史版本列表."""
    async def _query(db):
        from app.models.relational import ReportSnapshot
        from sqlalchemy import select
        tenant_id = current_tenant_id(user)
        result = await db.execute(
            select(ReportSnapshot)
            .where(ReportSnapshot.report_id == report_id, ReportSnapshot.tenant_id == tenant_id)
            .order_by(ReportSnapshot.version.desc())
        )
        snapshots = result.scalars().all()
        return {
            "data": [
                {
                    "id": s.id,
                    "report_id": s.report_id,
                    "config": json.loads(s.config) if isinstance(s.config, str) else s.config,
                    "version": s.version,
                    "created_at": s.created_at.isoformat() if s.created_at else None,
                }
                for s in snapshots
            ]
        }

    result = await _try_db(_query)
    if result is not None:
        return result
    if settings.IS_PRODUCTION:
        raise HTTPException(503, "Report snapshots database unavailable")

    return {"data": _MOCK_SNAPSHOTS.get(report_id, [])}
