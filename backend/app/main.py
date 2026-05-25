from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.core.logging import get_logger, setup_logging

# Initialize logging before anything else
setup_logging(level=settings.LOG_LEVEL)
logger = get_logger(__name__)
settings.validate_runtime()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Auto-init DB (SQLite fallback only)
    try:
        from app.database import init_db
        await init_db()
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
    quality,
    reports,
    rules,
    scheduler,
    search,
    semantic_assets,
    supply_chain,
    templates,
    workflow,
)

# Auth + system mgmt
app.include_router(auth.router, prefix="/api/v1/auth", tags=["认证"])
app.include_router(admin.router, prefix="/api/v1/admin", tags=["系统管理"])
app.include_router(workflow.router, prefix="/api/v1/workflow", tags=["工作流"])

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
app.include_router(dashboard.router, prefix="/api/v1/dashboard", tags=["运营总览"])
app.include_router(reports.router, prefix="/api/v1/reports", tags=["报表中心"])
app.include_router(model_driven.router, prefix="/api/v1/model-driven", tags=["模型驱动"])
app.include_router(rules.router, prefix="/api/v1/rules", tags=["校验规则"])
app.include_router(notifications.router, prefix="/api/v1/notifications", tags=["通知"])
app.include_router(templates.router, prefix="/api/v1/templates", tags=["模板市场"])
app.include_router(config_io.router, prefix="/api/v1/config", tags=["配置管理"])

# Phase 4 — Scheduler, Search, AI Builder
app.include_router(scheduler.router, prefix="/api/v1/scheduler", tags=["定时任务"])
app.include_router(search.router, prefix="/api/v1/search", tags=["全文搜索"])
app.include_router(ai_builder.router, prefix="/api/v1/ai-builder", tags=["AI增强"])
