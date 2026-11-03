"""AI dashboard adapters sharing the editor, data permissions and publication rules."""
from copy import deepcopy

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.api.deps import current_tenant_id, require_admin
from app.models.relational import Form
from app.services import analytics_editor
from app.services.analytics_data import load_data
from app.services.analytics_runtime import design_errors
from app.services.records import runtime_fields
from .low_code_tools import _standard_analytics_design, execute_create_form_definition


class SourceRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    source_form_code: str = Field(min_length=1, max_length=100)
    design: dict | None = None


class CreateRequest(SourceRequest):
    name: str = Field(min_length=1, max_length=100)
    code: str = Field(pattern=r'^[a-z][a-z0-9_]{0,55}$')
    application_id: int | None = Field(default=None, gt=0)


class BoardRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    program_id: str = Field(min_length=1, max_length=100)


class QueryRequest(BoardRequest):
    filters: dict = Field(default_factory=dict)
    widget_filters: dict = Field(default_factory=dict)
    limit: int = Field(default=100, ge=1, le=1000)


class WriteRequest(BoardRequest, analytics_editor.AnalyticsWriteRequest):
    pass


REQUESTS = {'dashboards.preview_source': SourceRequest, 'dashboards.create': CreateRequest,
            'dashboards.get': BoardRequest, 'dashboards.query': QueryRequest,
            'dashboards.save_draft': WriteRequest, 'dashboards.publish': WriteRequest}


async def source_preview(db, user, request):
    source = await db.scalar(select(Form).where(Form.tenant_id == current_tenant_id(user),
                                               Form.code == request.source_form_code))
    if source is None:
        raise HTTPException(404, '来源业务表单不存在')
    fields = await runtime_fields(db, source)
    design = deepcopy(request.design) if request.design is not None else _standard_analytics_design(
        source.code, source.name, [{'field_name': field.field_name, 'field_type': field.field_type,
                                   'searchable': field.searchable} for field in fields if not field.archived])
    design = analytics_editor.AnalyticsDesignRequest(design=design).design
    errors = design_errors(design)
    if errors:
        raise HTTPException(422, {'message': '看板配置无效', 'errors': errors})
    data = await load_data(db, source.tenant_id, source, design, user=user, limit=100)
    if data.get('errors'):
        raise HTTPException(422, {'message': '看板来源或指标校验失败', 'errors': data['errors']})
    return {'source_form_code': source.code, 'design': design, 'analyticsData': data, 'saved': False}


async def execute_dashboard_tool(operation, db, *, user, payload):
    request = REQUESTS[operation].model_validate(payload)
    if operation == 'dashboards.query':
        from app.api.dashboard import _query_form_program
        result = await _query_form_program(db, current_tenant_id(user), request.program_id,
            request.limit, user=user, filters=request.filters, widget_filters=request.widget_filters)
        if result is None or not isinstance(result.get('analyticsDesign'), dict):
            raise HTTPException(404, '已发布看板不存在或不可用')
        return result
    await require_admin(user)
    if operation in {'dashboards.preview_source', 'dashboards.create'}:
        prepared = await source_preview(db, user, request)
        if operation == 'dashboards.preview_source':
            return prepared
        # Bind to the existing source; never invent fields or use the empty new board as its source.
        result = await execute_create_form_definition(db, user=user, payload={
            'form': {'name': request.name, 'code': request.code, 'assembly_kind': 'analysis',
                     'status': 'draft', 'application_id': request.application_id,
                     'config': {'assemblyKind': 'analysis', 'analyticsDesign': prepared['design']}},
            'fields': [], 'menu': {'create': False}})
        return {**result, 'message': '看板草稿已创建并绑定业务来源；请预览并完成首次发布。', 'published': False}
    if operation == 'dashboards.get':
        return await analytics_editor.get_editor(db, user, request.program_id)
    return await analytics_editor.write_design(db, user, request.program_id, request,
                                               publish=operation == 'dashboards.publish')
