"""A disabled member of a configured countersign must never be silently skipped."""
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from fastapi import HTTPException
from app.api.workflow import _resolve_step_approver_ids

@pytest.mark.asyncio
async def test_partial_fixed_approver_set_is_rejected_without_fallback():
    db=SimpleNamespace(scalar=AsyncMock(side_effect=[SimpleNamespace(id=1), None]))
    step={'assignee_rules':[{'type':'user','value':['1','2']}], 'approval_mode':'countersign'}
    with pytest.raises(HTTPException) as error:
        await _resolve_step_approver_ids(db,1,step,{}, {}, 1, 1,allow_fallback=False)
    assert error.value.status_code==409

@pytest.mark.asyncio
async def test_legacy_assignment_keeps_existing_fallback_behavior():
    db=SimpleNamespace(scalar=AsyncMock(return_value=None))
    step={'assignee_rules':[{'type':'user','value':['2']}]}
    assert await _resolve_step_approver_ids(db,1,step,{}, {}, 1, 1)==[1]
