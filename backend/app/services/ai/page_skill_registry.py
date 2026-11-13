"""Refresh the component page workflow on uncustomized tenant skills."""

from sqlalchemy import select, update

from app.models.relational import AIAgentSkillDefinition, AIAgentToolDefinition

from .agent_definition import _load_registry_seed


PREVIOUS_METADATA = {
    'low_code.create_form_definition': (
        '搭建一张业务表单',
        '根据需求规划字段、控件和布局，生成可复核的表单草稿。适用于新建登记表、申请表，或继续调整当前设计器中的表单草稿。',
    ),
    'low_code.publish_form_to_menu': (
        '将业务表单交付到应用菜单',
        '将已保存的标准业务表单挂载到指定应用的菜单，经确认后按需发布。适用于表单配置已准备好，需要让业务人员从应用菜单打开时。',
    ),
    'analysis.manage_dashboard': (
        '搭建和维护业务看板',
        '预览业务数据来源，新建看板草稿，或维护已有看板的指标、布局和筛选。适用于搭建或调整看板，保存和发布需确认。',
    ),
    'analysis.query_dashboard': (
        '查询已发布看板',
        '按已发布看板的指标口径、数据权限和筛选条件查询结果。适用于查看指定时间、班组或范围内的看板指标。',
    ),
}
PREVIOUS_DASHBOARD_TOOLS = {
    'analysis.manage_dashboard': {
        'dashboards.preview_source', 'dashboards.create', 'dashboards.get', 'dashboards.save_draft', 'dashboards.publish',
    },
    'analysis.query_dashboard': {'dashboards.query'},
}


def refresh_component_page_skill_metadata(connection):
    skills = AIAgentSkillDefinition.__table__
    tools = AIAgentToolDefinition.__table__
    defaults = _load_registry_seed('skills.json')
    rows = connection.execute(select(skills).where(skills.c.name.in_(PREVIOUS_METADATA))).mappings().all()
    for row in rows:
        definition = row['definition'] or {}
        previous = PREVIOUS_METADATA[row['name']]
        if definition.get('instructions') is not None or (row['title'], row['description']) != previous:
            continue
        if (definition.get('title'), definition.get('description')) != previous:
            continue
        desired = defaults[row['name']]
        dependencies = desired.get('allowed_tools') or []
        registered = set(connection.scalars(select(tools.c.name).where(
            tools.c.tenant_id == row['tenant_id'], tools.c.name.in_(dependencies),
        )))
        values = {key: desired[key] for key in ('title', 'description')}
        revised = {**definition, **values}
        old_tools = definition.get('allowed_tools') or []
        if set(old_tools) == PREVIOUS_DASHBOARD_TOOLS.get(row['name']):
            revised['allowed_tools'] = list(dict.fromkeys(
                [*old_tools, *(tool for tool in dependencies if tool.startswith('pages.') and tool in registered)]
            ))
            if (desired['default_tool'] in registered and definition.get('default_tool')
                    in {'dashboards.preview_source', 'dashboards.query'}):
                revised['default_tool'] = desired['default_tool']
        connection.execute(update(skills).where(skills.c.id == row['id']).values(
            **values, definition=revised, version=skills.c.version + 1,
        ))
