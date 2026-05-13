"""Rules Engine — validation rule CRUD + data validation + trigger execution.

Supports per-model rules with operators: required, min, max, min_length,
max_length, regex, unique.  Falls back to mock data when DB is unavailable.
Trigger rules (`rule_type='trigger'`) fire actions when data changes.
"""
from __future__ import annotations

import json
import re
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select

from app.core.logging import get_logger

logger = get_logger(__name__)

router = APIRouter()


# ── Pydantic schemas ──────────────────────────────────────

class RuleCreate(BaseModel):
    model_id: int
    name: str
    rule_type: str = "validation"  # validation | trigger | visibility
    field_name: Optional[str] = None
    condition: Optional[str] = None  # JSON string: {"operator": "...", "value": ...}
    action: Optional[str] = None    # JSON string
    message: Optional[str] = None
    is_active: bool = True
    priority: int = 0


class RuleUpdate(BaseModel):
    name: Optional[str] = None
    rule_type: Optional[str] = None
    field_name: Optional[str] = None
    condition: Optional[str] = None
    action: Optional[str] = None
    message: Optional[str] = None
    is_active: Optional[bool] = None
    priority: Optional[int] = None


class ValidateRequest(BaseModel):
    model_name: str
    data: dict


class EvaluateTriggersRequest(BaseModel):
    model_name: str
    action: str  # "create" | "update" | "delete"
    record: dict
    old_record: Optional[dict] = None


# ── Mock fallback data ────────────────────────────────────

MOCK_RULES: list[dict] = [
    {
        "id": 1, "model_id": 1, "name": "设备名称必填", "rule_type": "validation",
        "field_name": "name", "condition": '{"operator": "required"}',
        "action": None, "message": "设备名称不能为空", "is_active": True, "priority": 10,
    },
    {
        "id": 2, "model_id": 1, "name": "健康分范围", "rule_type": "validation",
        "field_name": "health_score", "condition": '{"operator": "min", "value": 0}',
        "action": None, "message": "健康分不能小于0", "is_active": True, "priority": 5,
    },
    {
        "id": 3, "model_id": 1, "name": "健康分上限", "rule_type": "validation",
        "field_name": "health_score", "condition": '{"operator": "max", "value": 100}',
        "action": None, "message": "健康分不能超过100", "is_active": True, "priority": 5,
    },
    {
        "id": 4, "model_id": 2, "name": "供应商名称必填", "rule_type": "validation",
        "field_name": "name", "condition": '{"operator": "required"}',
        "action": None, "message": "供应商名称不能为空", "is_active": True, "priority": 10,
    },
    # ── Trigger rules ──
    {
        "id": 10, "model_id": 1, "name": "低健康分自动工单", "rule_type": "trigger",
        "field_name": "health_score",
        "condition": '{"operator": "lt", "field": "health_score", "value": 60}',
        "action": '{"type": "create_record", "target_model": "work_orders", '
                  '"field_mapping": [{"target": "description", "template": "{name}健康分降至{health_score}"}]}',
        "message": "设备健康分过低", "is_active": True, "priority": 1,
    },
]

_next_mock_id = len(MOCK_RULES) + 10


# ── DB helper ─────────────────────────────────────────────

async def _try_db(fn):
    """Try DB operation, return None on failure (mock fallback)."""
    from app.core.db import safe_db_call
    return await safe_db_call(fn)


def _rule_to_dict(r) -> dict:
    """Convert a Rule ORM object to a dict."""
    return {
        "id": r.id,
        "model_id": r.model_id,
        "name": r.name,
        "rule_type": r.rule_type,
        "field_name": r.field_name,
        "condition": r.condition,
        "action": r.action,
        "message": r.message,
        "is_active": r.is_active,
        "priority": r.priority,
    }


# ── CRUD endpoints ────────────────────────────────────────

@router.get("")
async def list_rules(model_id: Optional[int] = Query(None)):
    """List rules, optionally filtered by model_id."""
    async def _query(db):
        from app.models.relational import Rule
        stmt = select(Rule).order_by(Rule.priority.desc(), Rule.id)
        if model_id is not None:
            stmt = stmt.where(Rule.model_id == model_id)
        result = await db.execute(stmt)
        rules = result.scalars().all()
        return {"data": [_rule_to_dict(r) for r in rules]}

    result = await _try_db(_query)
    if result is not None:
        return result
    rules = MOCK_RULES
    if model_id is not None:
        rules = [r for r in rules if r["model_id"] == model_id]
    return {"data": rules}


@router.post("")
async def create_rule(body: RuleCreate):
    """Create a new validation rule."""
    # Validate condition JSON if provided
    if body.condition:
        try:
            cond = json.loads(body.condition)
            if "operator" not in cond:
                raise ValueError("condition must contain 'operator'")
        except (json.JSONDecodeError, ValueError) as exc:
            raise HTTPException(400, f"Invalid condition JSON: {exc}")

    if body.action:
        try:
            json.loads(body.action)
        except json.JSONDecodeError as exc:
            raise HTTPException(400, f"Invalid action JSON: {exc}")

    async def _query(db):
        from app.models.relational import Rule
        r = Rule(
            model_id=body.model_id, name=body.name, rule_type=body.rule_type,
            field_name=body.field_name, condition=body.condition,
            action=body.action, message=body.message,
            is_active=body.is_active, priority=body.priority,
        )
        db.add(r)
        await db.commit()
        await db.refresh(r)
        return _rule_to_dict(r)

    result = await _try_db(_query)
    if result is not None:
        return result
    global _next_mock_id
    new_id = _next_mock_id
    _next_mock_id += 1
    mock_rule = {
        "id": new_id, "model_id": body.model_id, "name": body.name,
        "rule_type": body.rule_type, "field_name": body.field_name,
        "condition": body.condition, "action": body.action,
        "message": body.message, "is_active": body.is_active,
        "priority": body.priority,
    }
    MOCK_RULES.append(mock_rule)
    return mock_rule


@router.put("/{rule_id}")
async def update_rule(rule_id: int, body: RuleUpdate):
    """Update an existing rule."""
    # Validate condition JSON if provided
    if body.condition is not None:
        try:
            cond = json.loads(body.condition)
            if "operator" not in cond:
                raise ValueError("condition must contain 'operator'")
        except (json.JSONDecodeError, ValueError) as exc:
            raise HTTPException(400, f"Invalid condition JSON: {exc}")

    if body.action is not None:
        try:
            json.loads(body.action)
        except json.JSONDecodeError as exc:
            raise HTTPException(400, f"Invalid action JSON: {exc}")

    async def _query(db):
        from app.models.relational import Rule
        r = await db.get(Rule, rule_id)
        if not r:
            return None
        updates = body.model_dump(exclude_unset=True)
        for key, val in updates.items():
            setattr(r, key, val)
        await db.commit()
        await db.refresh(r)
        return _rule_to_dict(r)

    result = await _try_db(_query)
    if result is not None:
        return result
    for r in MOCK_RULES:
        if r["id"] == rule_id:
            updates = body.model_dump(exclude_unset=True)
            r.update(updates)
            return r
    raise HTTPException(404, "Rule not found")


@router.delete("/{rule_id}")
async def delete_rule(rule_id: int):
    """Delete a rule."""
    async def _query(db):
        from app.models.relational import Rule
        r = await db.get(Rule, rule_id)
        if not r:
            return None
        await db.delete(r)
        await db.commit()
        return {"ok": True}

    result = await _try_db(_query)
    if result is not None:
        return result
    global MOCK_RULES
    MOCK_RULES = [r for r in MOCK_RULES if r["id"] != rule_id]
    return {"ok": True}


# ── Validation engine ─────────────────────────────────────

def _parse_condition(condition_str: Optional[str]) -> Optional[dict]:
    """Parse a JSON condition string into a dict."""
    if not condition_str:
        return None
    try:
        return json.loads(condition_str)
    except json.JSONDecodeError:
        return None


def _evaluate_rule(rule: dict, data: dict) -> Optional[str]:
    """Evaluate a single rule against data.

    Returns an error message string if the rule fails, or None if it passes.
    """
    cond = _parse_condition(rule.get("condition"))
    if not cond:
        return None

    operator = cond.get("operator")
    field = rule.get("field_name")
    if not field:
        return None

    value = data.get(field)
    error_msg = rule.get("message", f"Validation failed for {field}")

    if operator == "required":
        if value is None or (isinstance(value, str) and value.strip() == ""):
            return error_msg

    elif operator == "min":
        threshold = cond.get("value")
        if value is not None and threshold is not None:
            try:
                if float(value) < float(threshold):
                    return error_msg
            except (ValueError, TypeError):
                pass

    elif operator == "max":
        threshold = cond.get("value")
        if value is not None and threshold is not None:
            try:
                if float(value) > float(threshold):
                    return error_msg
            except (ValueError, TypeError):
                pass

    elif operator == "min_length":
        threshold = cond.get("value")
        if value is not None and threshold is not None:
            if len(str(value)) < int(threshold):
                return error_msg

    elif operator == "max_length":
        threshold = cond.get("value")
        if value is not None and threshold is not None:
            if len(str(value)) > int(threshold):
                return error_msg

    elif operator == "regex":
        pattern = cond.get("value")
        if value is not None and pattern:
            if not re.search(pattern, str(value)):
                return error_msg

    elif operator == "unique":
        # Mock: always passes
        pass

    return None


async def _get_rules_for_model(model_name: str) -> list[dict]:
    """Fetch active validation rules for a model by name.

    Looks up model_id from model_name, then fetches active rules.
    Falls back to mock data.
    """
    async def _query(db):
        from app.models.relational import MetaModel, Rule
        # Resolve model_name -> model_id
        m = await db.scalar(
            select(MetaModel).where(MetaModel.name == model_name)
        )
        if not m:
            return []
        result = await db.execute(
            select(Rule)
            .where(Rule.model_id == m.id, Rule.is_active == True, Rule.rule_type == "validation")
            .order_by(Rule.priority.desc(), Rule.id)
        )
        rules = result.scalars().all()
        return [_rule_to_dict(r) for r in rules]

    result = await _try_db(_query)
    if result is not None:
        return result
    # Mock fallback: resolve model_name -> model_id from mock data
    from app.api._model_driven_shared import MOCK_MODELS
    model_id = None
    for m in MOCK_MODELS:
        if m["name"] == model_name:
            model_id = m["id"]
            break
    if model_id is None:
        return []
    return [
        r for r in MOCK_RULES
        if r["model_id"] == model_id and r.get("is_active", True) and r.get("rule_type") == "validation"
    ]


@router.post("/validate")
async def validate_data(body: ValidateRequest):
    """Validate data against all active rules for a model.

    Body: {"model_name": "equipment", "data": {"name": "CNC-01", "health_score": 95}}
    Returns: {"valid": true/false, "errors": [{"field": "...", "message": "..."}]}
    """
    rules = await _get_rules_for_model(body.model_name)
    errors: list[dict] = []

    for rule in rules:
        err = _evaluate_rule(rule, body.data)
        if err:
            errors.append({"field": rule.get("field_name", ""), "message": err})

    return {"valid": len(errors) == 0, "errors": errors}


# ── Trigger Engine ────────────────────────────────────────

def _interpolate_template(template: str, record: dict) -> str:
    """Replace {field_name} placeholders in a template string with record values.

    Example: "{name}健康分降至{health_score}" with {"name": "CNC-01", "health_score": 42}
    → "CNC-01健康分降至42"
    """
    def _replace(match: re.Match) -> str:
        key = match.group(1)
        val = record.get(key, match.group(0))
        return str(val)

    return re.sub(r"\{(\w+)\}", _replace, template)


def _evaluate_condition(condition: dict, record: dict) -> bool:
    """Evaluate a trigger condition against a data record.

    Supported operators:
      lt, gt, lte, gte, eq, neq, contains
    The condition dict has: {"operator": "...", "field": "...", "value": ...}
    """
    operator = condition.get("operator")
    field = condition.get("field")
    threshold = condition.get("value")

    if not operator or not field:
        return False

    actual = record.get(field)
    if actual is None:
        return False

    try:
        if operator == "lt":
            return float(actual) < float(threshold)
        elif operator == "gt":
            return float(actual) > float(threshold)
        elif operator == "lte":
            return float(actual) <= float(threshold)
        elif operator == "gte":
            return float(actual) >= float(threshold)
        elif operator == "eq":
            return actual == threshold
        elif operator == "neq":
            return actual != threshold
        elif operator == "contains":
            return str(threshold) in str(actual)
    except (ValueError, TypeError):
        return False

    return False


async def _get_triggers_for_model(model_name: str) -> list[dict]:
    """Fetch active trigger rules for a model by name.

    Looks up model_id from model_name, then fetches active trigger-type rules.
    Falls back to mock data.
    """
    async def _query(db):
        from app.models.relational import MetaModel, Rule
        m = await db.scalar(
            select(MetaModel).where(MetaModel.name == model_name)
        )
        if not m:
            return []
        result = await db.execute(
            select(Rule)
            .where(Rule.model_id == m.id, Rule.is_active == True, Rule.rule_type == "trigger")
            .order_by(Rule.priority.desc(), Rule.id)
        )
        rules = result.scalars().all()
        return [_rule_to_dict(r) for r in rules]

    result = await _try_db(_query)
    if result is not None:
        return result
    # Mock fallback
    from app.api._model_driven_shared import MOCK_MODELS
    model_id = None
    for m in MOCK_MODELS:
        if m["name"] == model_name:
            model_id = m["id"]
            break
    if model_id is None:
        return []
    return [
        r for r in MOCK_RULES
        if r["model_id"] == model_id and r.get("is_active", True) and r.get("rule_type") == "trigger"
    ]


async def _execute_trigger_action(action: dict, record: dict) -> dict:
    """Execute a single trigger action.

    Supported action types:
      - create_record: Insert a new row in the target model using field_mapping.
      - update_record: Update an existing record in the target model.
      - log_event: Log the event (no DB write).

    Returns a result dict: {"status": "ok"|"skipped"|"error", "detail": ...}
    """
    action_type = action.get("type", "")

    if action_type == "log_event":
        logger.info(
            "Trigger log_event: record=%s, action_config=%s",
            {k: v for k, v in record.items() if k in ("id", "name")},
            action,
        )
        return {"status": "ok", "detail": "logged"}

    if action_type == "create_record":
        target_model = action.get("target_model", "")
        field_mapping = action.get("field_mapping", [])

        # Build new record from field_mapping
        new_record: dict[str, Any] = {}
        for mapping in field_mapping:
            target_field = mapping.get("target", "")
            if "source" in mapping:
                new_record[target_field] = record.get(mapping["source"])
            elif "template" in mapping:
                new_record[target_field] = _interpolate_template(mapping["template"], record)
            elif "value" in mapping:
                new_record[target_field] = mapping["value"]

        if not new_record:
            return {"status": "skipped", "detail": "empty field_mapping"}

        # Try DB insert
        async def _insert(db):
            from app.api._model_driven_shared import SAFE_COLUMNS, assert_safe_identifier
            allowed = SAFE_COLUMNS.get(target_model, set())
            safe_keys = [k for k in new_record.keys() if k in allowed and k != "id"]
            if not safe_keys:
                return None
            for k in safe_keys:
                assert_safe_identifier(k)
            cols = ",".join(safe_keys)
            vals = ",".join([f":{k}" for k in safe_keys])
            from sqlalchemy import text
            sql = f"INSERT INTO {target_model} ({cols}) VALUES ({vals}) RETURNING id"
            row = (await db.execute(text(sql), {k: new_record[k] for k in safe_keys})).mappings().first()
            await db.commit()
            return int(row["id"]) if row else None

        try:
            from app.core.db import safe_db_call
            inserted_id = await safe_db_call(_insert)
            if inserted_id is not None:
                logger.info("Trigger create_record in %s: new id=%s", target_model, inserted_id)
                return {"status": "ok", "detail": f"created id={inserted_id} in {target_model}"}
            else:
                logger.info("Trigger create_record: DB unavailable, logged only (%s)", target_model)
                return {"status": "ok", "detail": f"mock-create in {target_model}: {new_record}"}
        except Exception as exc:
            logger.warning("Trigger create_record failed: %s", exc)
            return {"status": "error", "detail": str(exc)}

    if action_type == "update_record":
        target_model = action.get("target_model", "")
        target_id = action.get("target_id")
        field_mapping = action.get("field_mapping", [])

        if not target_id:
            # Try to resolve from record
            target_id = record.get("id")

        if not target_id:
            return {"status": "skipped", "detail": "no target_id for update_record"}

        updates: dict[str, Any] = {}
        for mapping in field_mapping:
            target_field = mapping.get("target", "")
            if "source" in mapping:
                updates[target_field] = record.get(mapping["source"])
            elif "template" in mapping:
                updates[target_field] = _interpolate_template(mapping["template"], record)
            elif "value" in mapping:
                updates[target_field] = mapping["value"]

        if not updates:
            return {"status": "skipped", "detail": "empty field_mapping"}

        async def _update(db):
            from app.api._model_driven_shared import SAFE_COLUMNS, assert_safe_identifier
            from sqlalchemy import text
            allowed = SAFE_COLUMNS.get(target_model, set())
            safe_keys = [k for k in updates.keys() if k in allowed and k != "id"]
            if not safe_keys:
                return None
            for k in safe_keys:
                assert_safe_identifier(k)
            set_clause = ",".join([f"{k} = :{k}" for k in safe_keys])
            sql = f"UPDATE {target_model} SET {set_clause} WHERE id = :id"
            params = {k: updates[k] for k in safe_keys}
            params["id"] = target_id
            await db.execute(text(sql), params)
            await db.commit()
            return target_id

        try:
            from app.core.db import safe_db_call
            updated_id = await safe_db_call(_update)
            if updated_id is not None:
                logger.info("Trigger update_record in %s: id=%s", target_model, updated_id)
                return {"status": "ok", "detail": f"updated id={updated_id} in {target_model}"}
            else:
                logger.info("Trigger update_record: DB unavailable, logged only (%s)", target_model)
                return {"status": "ok", "detail": f"mock-update in {target_model} id={target_id}: {updates}"}
        except Exception as exc:
            logger.warning("Trigger update_record failed: %s", exc)
            return {"status": "error", "detail": str(exc)}

    # Unknown action type
    logger.warning("Unknown trigger action type: %s", action_type)
    return {"status": "error", "detail": f"unknown action type: {action_type}"}


# ── Trigger API endpoints ─────────────────────────────────

@router.get("/triggers")
async def list_triggers(model_name: str = Query(..., description="Model name to list triggers for")):
    """List active triggers for a given model."""
    triggers = await _get_triggers_for_model(model_name)
    return {"data": triggers}


@router.post("/evaluate-triggers")
async def evaluate_triggers(body: EvaluateTriggersRequest):
    """Evaluate triggers against a data change event.

    For each active trigger whose condition matches the record, execute the
    associated action and return results.

    Body: {
        "model_name": "equipment",
        "action": "update",
        "record": {"id": 1, "name": "CNC-01", "health_score": 42},
        "old_record": {"health_score": 88}   // optional
    }
    Returns: {"triggered": [{"rule_name": "...", "action_type": "...", "result": {...}}]}
    """
    triggers = await _get_triggers_for_model(body.model_name)
    triggered: list[dict] = []

    for rule in triggers:
        cond = _parse_condition(rule.get("condition"))
        if not cond:
            continue

        # Evaluate condition against the *new* record (the current state)
        if not _evaluate_condition(cond, body.record):
            continue

        # Condition matched — parse and execute the action
        action_raw = _parse_condition(rule.get("action"))  # reuse JSON parser
        if not action_raw:
            continue

        try:
            result = await _execute_trigger_action(action_raw, body.record)
            triggered.append({
                "rule_name": rule.get("name", ""),
                "action_type": action_raw.get("type", ""),
                "result": result,
            })
        except Exception as exc:
            # Best-effort: never let a single trigger failure break the loop
            logger.warning("Trigger action execution failed for rule %s: %s", rule.get("name"), exc)
            triggered.append({
                "rule_name": rule.get("name", ""),
                "action_type": action_raw.get("type", ""),
                "result": {"status": "error", "detail": str(exc)},
            })

    return {"triggered": triggered}


async def _evaluate_triggers_sync(
    model_name: str,
    action: str,
    record: dict,
    old_record: dict | None = None,
) -> None:
    """Best-effort trigger evaluation — for integration into data CRUD.

    Wraps the full evaluation in try/except so that trigger failures never
    block the main data operation.
    """
    try:
        await evaluate_triggers(EvaluateTriggersRequest(
            model_name=model_name,
            action=action,
            record=record,
            old_record=old_record,
        ))
    except Exception as exc:
        logger.warning("Trigger evaluation failed (non-blocking): %s", exc)
