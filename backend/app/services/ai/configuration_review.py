"""Edit a pending form proposal without another model call or business write."""
from copy import deepcopy
from datetime import datetime

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictBool
from sqlalchemy import select

from app.core.db import db_session
from app.models.relational import AIAgentRun, AIConversation
from .agent_items import confirmation_item, extract_confirmation_payload
from .agent_runs import AGENT_RUNS
from .agent_validation import agent_validation_service
from .confirmations import create_confirmation_payload
from .policies import decide_tool_permission


class FieldReviewEdit(BaseModel):
    model_config = ConfigDict(extra='forbid')
    index: int = Field(ge=0)
    label: str = Field(min_length=1, max_length=200)
    required: StrictBool


class ConfigurationReviewEdit(BaseModel):
    model_config = ConfigDict(extra='forbid')
    confirmation_token: str
    action_index: int = Field(ge=0)
    form_name: str = Field(min_length=1, max_length=200)
    fields: list[FieldReviewEdit] = Field(max_length=500)


def edit_form_proposal(action, edit):
    # Do not accept arbitrary payloads, tool names, IDs or internal protocol keys.
    result = deepcopy(action)
    payload = result.get('payload') or {}
    if payload.get('_harness_tool') != 'forms.create_form_definition':
        raise HTTPException(422, '当前操作不支持直接编辑')
    if not edit.form_name.strip():
        raise HTTPException(422, '表单名称不能为空')
    payload['form']['name'] = edit.form_name.strip()
    seen = set()
    fields = payload.get('fields') or []
    for field in edit.fields:
        if field.index in seen or field.index >= len(fields) or not field.label.strip():
            raise HTTPException(422, '字段不存在、重复或名称为空')
        seen.add(field.index)
        fields[field.index]['label'] = field.label.strip()
        fields[field.index]['required'] = field.required
    return result


async def revise_configuration(run_id, edit, user, settings):
    async with db_session() as db:
        row = await db.scalar(select(AIAgentRun).where(
            AIAgentRun.run_id == run_id, AIAgentRun.tenant_id == user['tenant_id']
        ).with_for_update())
        if row is None:
            raise HTTPException(404, '待确认操作不存在')
        confirmation = extract_confirmation_payload(row.items or []) or row.confirmation_payload or {}
        owner = str(user.get('sub') or user.get('username') or user.get('uid'))
        if str(confirmation.get('user')) != owner:
            raise HTTPException(404, '待确认操作不存在')
        if row.status != 'waiting_confirmation' or confirmation.get('confirmation_token') != edit.confirmation_token:
            raise HTTPException(409, '配置已更新或操作已结束，请刷新后重试')
        if confirmation.get('expires_at') and datetime.fromisoformat(confirmation['expires_at']) < datetime.now():
            raise HTTPException(409, '确认卡片已过期，请重新生成')
        actions = deepcopy(confirmation.get('actions') or [])
        if edit.action_index >= len(actions):
            raise HTTPException(422, '待确认操作不存在')
        action = edit_form_proposal(actions[edit.action_index], edit)
        tool = action['payload']['_harness_tool']
        decision = decide_tool_permission(user, settings, tool)
        if not decision.allowed:
            raise HTTPException(403, decision.reason)
        validation = agent_validation_service.validate_tool_payload(tool_name=tool, payload=action['payload'], settings=settings)
        if not validation.valid:
            raise HTTPException(422, {'message': validation.summary(), 'issues': [issue.as_dict() for issue in validation.errors]})
        actions[edit.action_index] = action
        updated = create_confirmation_payload(user=user, actions=actions, evidence=row.evidence, risk_level=row.risk_level)
        # The new nonce invalidates confirmation requests from stale tabs.
        items = [item for item in (row.items or []) if item.get('type') != 'confirmation']
        items.append(confirmation_item(confirmation_payload=updated, run_id=run_id))
        row.items, row.actions, row.confirmation_payload = items, actions, updated
        conversation = await db.scalar(select(AIConversation).where(
            AIConversation.conversation_id == row.conversation_id,
            AIConversation.tenant_id == user['tenant_id'], AIConversation.user_id == owner))
        if conversation:
            conversation.metadata_json = {**(conversation.metadata_json or {}),
                'pending_action_state': {'skill': action['skill'], 'status': 'ready_for_confirmation',
                    'collected_slots': action['payload'], 'missing_slots': []}}
        await db.commit()
        if run_id in AGENT_RUNS:
            AGENT_RUNS[run_id].update(items=items, actions=actions)
        return {'run_id': run_id, 'items': items, 'requires_confirmation': True}
