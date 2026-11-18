"""Build workflow definitions in the caller's transaction."""

import json
from datetime import datetime

from pydantic import BaseModel

from app.core.principal import current_tenant_id, current_user_id
from app.models.relational import WorkflowDef, WorkflowDefVersion
from app.services.workflow_views import STARTABLE_DEFINITION_STATUSES


class WorkflowDefCreate(BaseModel):
    name: str
    description: str | None = None
    config: dict | None = None
    form_config: dict | None = None
    status: str | None = None
    steps: list | None = None


def snapshot_definition(db, definition, *, published_by: int | None = None):
    """Keep the version that in-flight instances were started against."""
    config = definition.config
    form_config = definition.form_config
    db.add(WorkflowDefVersion(
        tenant_id=definition.tenant_id,
        workflow_id=definition.id,
        version=int(definition.version or 1),
        config=config if isinstance(config, str) else json.dumps(config or {}, ensure_ascii=False),
        form_config=form_config if isinstance(form_config, str) or form_config is None else json.dumps(form_config, ensure_ascii=False),
        status=definition.status or "draft",
        published_by=published_by,
        published_at=datetime.now(),
    ))


async def stage_workflow_definition(db, body: WorkflowDefCreate, user: dict):
    status = (body.status or "draft").lower()
    config = dict(body.config or {"nodes": [], "edges": []})
    if body.steps:
        config["steps"] = body.steps
    if status in STARTABLE_DEFINITION_STATUSES:
        from app.services.workflow_routing import validate_graph
        validate_graph(config, require_cc_recipients=True)
    definition = WorkflowDef(
        tenant_id=current_tenant_id(user), name=body.name, description=body.description,
        config=json.dumps(config, ensure_ascii=False),
        form_config=json.dumps(body.form_config or {"fields": []}, ensure_ascii=False),
        status=status, version=1,
    )
    db.add(definition)
    await db.flush()
    snapshot_definition(db, definition, published_by=current_user_id(user))
    return definition


def update_workflow_definition(db, definition, body: WorkflowDefCreate, user: dict):
    definition.name = body.name
    if body.description is not None:
        definition.description = body.description
    if body.config is not None:
        config = dict(body.config)
        if body.steps:
            config["steps"] = body.steps
        definition.config = json.dumps(config, ensure_ascii=False)
    if body.form_config is not None:
        definition.form_config = json.dumps(body.form_config, ensure_ascii=False)
    if body.status is not None:
        definition.status = body.status.lower()
    definition.version = int(definition.version or 1) + 1
    if str(definition.status or "").lower() in STARTABLE_DEFINITION_STATUSES:
        from app.services.workflow_routing import validate_graph
        from app.services.workflow_views import _definition_config

        validate_graph(_definition_config(definition), require_cc_recipients=True)
    snapshot_definition(db, definition, published_by=current_user_id(user))
