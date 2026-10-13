"""Administrator settings for per-form fixed, sequential approvals."""
from typing import Literal
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import require_admin, get_db, current_tenant_id, current_user_id
from app.services.form_approval_config import approval_settings, save_approval_settings

router = APIRouter()

class ApprovalStage(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    approver_ids: list[int] = Field(min_length=1, max_length=100)
    approval_mode: Literal['single', 'countersign'] = 'single'

class ApprovalSettingsBody(BaseModel):
    enabled: bool
    stages: list[ApprovalStage] = Field(default_factory=list, max_length=20)
    replace_existing: bool = False
    expected_version: int | None = None

@router.get('/{form_id}/approval-settings')
async def get_settings(form_id: int, db: AsyncSession = Depends(get_db), user: dict = Depends(require_admin)):
    return {'data': await approval_settings(db, current_tenant_id(user), form_id)}

@router.put('/{form_id}/approval-settings')
async def put_settings(form_id: int, body: ApprovalSettingsBody, db: AsyncSession = Depends(get_db), user: dict = Depends(require_admin)):
    payload = body.model_dump()
    if 'expected_version' not in body.model_fields_set:
        payload.pop('expected_version', None)
    result = await save_approval_settings(db, current_tenant_id(user), form_id, current_user_id(user), payload)
    await db.commit()
    return {'data': result}
