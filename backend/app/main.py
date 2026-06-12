from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.core.logging import get_logger, setup_logging

# Initialize logging before anything else
setup_logging(level=settings.LOG_LEVEL)
logger = get_logger(__name__)
settings.validate_runtime()
METRICS = {"requests_total": 0, "errors_total": 0, "route_counts": {}, "route_errors": {}, "route_latency_ms": {}}


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Auto-init DB (SQLite fallback only)
    try:
        from app.database import init_db
        await init_db()
        from app.services.ai.agent_registry import AgentRegistryError, load_agent_registry
        try:
            await load_agent_registry(seed_if_empty=False)
        except AgentRegistryError as exc:
            logger.warning("Agent registry not loaded: %s", exc)
    except Exception as exc:
        logger.warning("DB init skipped: %s", exc)
    yield
    try:
        from app.database import close_connections
        await close_connections()
    except Exception as exc:
        logger.debug("close_connections error: %s", exc)


app = FastAPI(
    title=settings.APP_NAME,
    description="制造业数据操作系统 — 制造数智平台",
    version=settings.APP_VERSION,
    lifespan=lifespan,
)


# ── CORS ──────────────────────────────────────────────────
# Note: when CORS_ORIGINS contains "*", credentials must be False per
# the CORS spec (browsers reject "*" + credentials).
_cors_origins = settings.CORS_ORIGINS
_allow_credentials = "*" not in _cors_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=_allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)


@app.middleware("http")
async def observability_middleware(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or uuid4().hex
    start = perf_counter()
    status_code = 500
    try:
        response = await call_next(request)
        status_code = response.status_code
        response.headers["x-request-id"] = request_id
        return response
    finally:
        elapsed_ms = round((perf_counter() - start) * 1000, 2)
        route_key = f"{request.method} {request.url.path}"
        METRICS["requests_total"] += 1
        METRICS["route_counts"][route_key] = METRICS["route_counts"].get(route_key, 0) + 1
        METRICS["route_latency_ms"][route_key] = elapsed_ms
        if status_code >= 500:
            METRICS["errors_total"] += 1
            METRICS["route_errors"][route_key] = METRICS["route_errors"].get(route_key, 0) + 1
        logger.info(
            "request_completed request_id=%s method=%s path=%s status=%s duration_ms=%s",
            request_id,
            request.method,
            request.url.path,
            status_code,
            elapsed_ms,
        )


# ── Global exception handler ──────────────────────────────
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "type": exc.__class__.__name__},
    )


# ── System endpoints ──────────────────────────────────────
@app.get("/", tags=["系统"])
async def root():
    return {
        "name": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "description": "制造业数据操作系统 — 制造数智平台",
    }


@app.get("/health", tags=["系统"])
async def health():
    return {"status": "healthy"}


@app.get("/api/v1/system/readiness", tags=["system"])
async def readiness():
    checks: dict[str, dict] = {}

    try:
        from sqlalchemy import text

        from app.database import AsyncSessionLocal, DB_TYPE

        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
            try:
                version = await session.scalar(text("SELECT version_num FROM alembic_version LIMIT 1"))
            except Exception:
                version = None
        checks["database"] = {"status": "ready", "backend": DB_TYPE}
        checks["migrations"] = {"status": "ready" if version else "degraded", "version": version}
    except Exception as exc:
        checks["database"] = {"status": "not_ready", "error": str(exc)}
        checks["migrations"] = {"status": "not_ready", "error": str(exc)}

    smtp_ready = bool(settings.SMTP_HOST)
    if settings.IS_PRODUCTION:
        checks["smtp"] = {"status": "ready" if smtp_ready else "not_ready", "host": settings.SMTP_HOST or None}
    else:
        checks["smtp"] = {"status": "ready" if smtp_ready else "degraded", "host": settings.SMTP_HOST or None}

    storage_dir = Path(__file__).resolve().parent.parent / "storage"
    try:
        storage_dir.mkdir(parents=True, exist_ok=True)
        probe = storage_dir / ".readiness"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
        checks["storage"] = {"status": "ready", "path": str(storage_dir)}
    except Exception as exc:
        checks["storage"] = {"status": "not_ready", "path": str(storage_dir), "error": str(exc)}

    production_checks = {
        "appMode": settings.APP_MODE,
        "demoAuthOptionalDisabled": not settings.DEMO_AUTH_OPTIONAL,
        "explicitCors": "*" not in settings.CORS_ORIGINS,
        "strongSecret": len(settings.SECRET_KEY or "") >= 32 and settings.SECRET_KEY not in {"change-me", "secret", "dev-secret"},
        "postgresRequired": not settings.IS_PRODUCTION or settings.DATABASE_BACKEND.lower() == "postgresql",
    }
    checks["productionConfig"] = {
        "status": "ready" if all(production_checks.values()) else ("not_ready" if settings.IS_PRODUCTION else "degraded"),
        "checks": production_checks,
    }

    statuses = [item["status"] for item in checks.values()]
    status = "not_ready" if "not_ready" in statuses else ("degraded" if "degraded" in statuses else "ready")
    return {
        "status": status,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "appMode": settings.APP_MODE,
        "checks": checks,
    }


@app.get("/api/v1/system/metrics", tags=["system"])
async def metrics():
    return {"data": METRICS}


# ── Routers ───────────────────────────────────────────────
from app.api import (  # noqa: E402
    admin,
    ai_assistant,
    ai_builder,
    analytics,
    applications,
    auth,
    config_io,
    dashboard,
    data_sources,
    forms,
    graph,
    knowledge,
    maintenance,
    model_driven,
    notifications,
    ontology,
    pipeline,
    platform,
    productization,
    quality,
    release,
    reports,
    rules,
    scheduler,
    search,
    semantic_assets,
    supply_chain,
    templates,
    tenant,
    workflow,
)

# Auth + system mgmt
app.include_router(auth.router, prefix="/api/v1/auth", tags=["认证"])
app.include_router(admin.router, prefix="/api/v1/admin", tags=["系统管理"])
app.include_router(workflow.router, prefix="/api/v1/workflow", tags=["工作流"])

app.include_router(platform.router, prefix="/api/v1/platform", tags=["platform"])
app.include_router(applications.router, prefix="/api/v1/applications", tags=["applications"])
app.include_router(applications.admin_router, prefix="/api/v1/admin", tags=["applications-admin"])
app.include_router(forms.router, prefix="/api/v1/forms", tags=["forms"])

# Data foundation
app.include_router(data_sources.router, prefix="/api/v1/data-sources", tags=["数据源管理"])
app.include_router(ontology.router, prefix="/api/v1/ontology", tags=["本体管理"])
app.include_router(graph.router, prefix="/api/v1/graph", tags=["图谱查询"])
app.include_router(pipeline.router, prefix="/api/v1/pipelines", tags=["数据管线"])

app.include_router(semantic_assets.router, prefix="/api/v1/semantic-assets", tags=["semantic-assets"])
app.include_router(knowledge.router, prefix="/api/v1/knowledge", tags=["knowledge-base"])

# Business modules
app.include_router(analytics.router, prefix="/api/v1/analytics", tags=["数据分析"])
app.include_router(maintenance.router, prefix="/api/v1/maintenance", tags=["预测性维护"])
app.include_router(quality.router, prefix="/api/v1/quality", tags=["质量管理"])
app.include_router(supply_chain.router, prefix="/api/v1/supply-chain", tags=["供应链"])
app.include_router(ai_assistant.router, prefix="/api/v1/ai", tags=["AI助手"])
app.include_router(tenant.router, prefix="/api/v1/tenant", tags=["tenant"])
app.include_router(dashboard.router, prefix="/api/v1/dashboard", tags=["运营总览"])
app.include_router(reports.router, prefix="/api/v1/reports", tags=["报表中心"])
app.include_router(model_driven.router, prefix="/api/v1/model-driven", tags=["模型驱动"])
app.include_router(rules.router, prefix="/api/v1/rules", tags=["校验规则"])
app.include_router(notifications.router, prefix="/api/v1/notifications", tags=["通知"])
app.include_router(templates.router, prefix="/api/v1/templates", tags=["模板市场"])
app.include_router(config_io.router, prefix="/api/v1/config", tags=["配置管理"])
app.include_router(release.router, prefix="/api/v1/release", tags=["release"])

# Phase 4 — Scheduler, Search, AI Builder
app.include_router(scheduler.router, prefix="/api/v1/scheduler", tags=["定时任务"])
app.include_router(search.router, prefix="/api/v1/search", tags=["全文搜索"])
app.include_router(ai_builder.router, prefix="/api/v1/ai-builder", tags=["AI增强"])
app.include_router(productization.router, prefix="/api/v1/productization", tags=["productization"])
