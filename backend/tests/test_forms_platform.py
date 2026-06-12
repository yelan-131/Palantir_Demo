"""Tests for the platform form database layer."""
from __future__ import annotations

import pytest


def test_form_code_uses_safe_identifier_rules():
    pytest.importorskip("fastapi")
    from fastapi import HTTPException
    from app.api.forms import _validate_form_code

    _validate_form_code("service_ticket")
    _validate_form_code("service-ticket")
    with pytest.raises(HTTPException):
        _validate_form_code("service ticket")
    with pytest.raises(HTTPException):
        _validate_form_code("../service-ticket")
    with pytest.raises(HTTPException):
        _validate_form_code("service_ticket;drop table forms")


def test_form_field_name_uses_safe_identifier_rules():
    pytest.importorskip("fastapi")
    from fastapi import HTTPException
    from app.api.forms import _validate_field_name

    _validate_field_name("customer_name")
    with pytest.raises(HTTPException):
        _validate_field_name("CustomerName")
    with pytest.raises(HTTPException):
        _validate_field_name("customer.name")


def test_create_field_schema_is_metadata_only():
    pytest.importorskip("fastapi")
    from app.api.forms import FormFieldCreate

    body = FormFieldCreate(
        field_name="customer_name",
        label="Customer Name",
        field_type="string",
        required=True,
    )
    payload = body.dict()
    assert payload["field_name"] == "customer_name"
    assert payload["required"] is True
    assert "ddl" not in payload
    assert "alter_table" not in payload


def test_code_field_options_are_stored_as_field_metadata():
    pytest.importorskip("fastapi")
    from app.api.forms import FormFieldCreate, _normalize_form_field_data

    body = FormFieldCreate(
        field_name="alert_no",
        label="Alert No",
        field_type="code",
        control_type="readonly-text",
        encoding_rule={
            "enabled": True,
            "template": "AL-{yyyyMMdd}-{seq:3}",
            "fixedLength": 15,
        },
    )

    payload = _normalize_form_field_data(body.dict())

    assert payload["field_type"] == "string"
    assert payload["ui_config"]["businessType"] == "code"
    assert payload["ui_config"]["controlType"] == "readonly-text"
    assert payload["ui_config"]["encodingRule"]["fixedLength"] == 15
    assert "ddl" not in payload
    assert "alter_table" not in payload


def test_dynamic_record_schema_accepts_json_payload():
    pytest.importorskip("fastapi")
    from app.api.forms import DynamicRecordCreate

    body = DynamicRecordCreate(data={"customer_name": "Acme", "priority": "high"})
    assert body.data["customer_name"] == "Acme"
    assert body.status == "active"


def test_record_data_validation_enforces_required_unknown_and_enum():
    pytest.importorskip("fastapi")
    from fastapi import HTTPException
    from app.api.forms import _validate_record_data

    class Field:
        def __init__(self, field_name, label, field_type="string", required=False, enum_values=None):
            self.field_name = field_name
            self.label = label
            self.field_type = field_type
            self.required = required
            self.enum_values = enum_values
            self.archived = False

    fields = [
        Field("title", "Title", required=True),
        Field("priority", "Priority", field_type="enum", enum_values=["low", "high"]),
    ]

    _validate_record_data(fields, {"title": "Fix pump", "priority": "high"})
    with pytest.raises(HTTPException):
        _validate_record_data(fields, {"priority": "high"})
    with pytest.raises(HTTPException):
        _validate_record_data(fields, {"title": "Fix pump", "extra": "nope"})
    with pytest.raises(HTTPException):
        _validate_record_data(fields, {"title": "Fix pump", "priority": "urgent"})


def test_record_search_uses_searchable_fields_first():
    pytest.importorskip("fastapi")
    from app.api.forms import _record_matches_search

    class Field:
        def __init__(self, field_name, searchable):
            self.field_name = field_name
            self.searchable = searchable
            self.archived = False

    class Record:
        data = {"title": "Pump issue", "secret": "needle"}

    fields = [Field("title", True), Field("secret", False)]
    assert _record_matches_search(Record(), fields, "pump") is True
    assert _record_matches_search(Record(), fields, "needle") is False


def test_dynamic_record_partial_update_preserves_existing_fields():
    pytest.importorskip("fastapi")
    from app.api.forms import _merged_record_data

    merged = _merged_record_data(
        {"title": "Original", "priority": "high", "owner": "Alice"},
        {"priority": "low"},
    )

    assert merged == {"title": "Original", "priority": "low", "owner": "Alice"}


def test_hidden_fields_are_not_queryable():
    pytest.importorskip("fastapi")
    from fastapi import HTTPException
    from app.api.forms import _ensure_filter_fields_visible, _record_matches_search, _visible_field_subset

    class Field:
        def __init__(self, field_name, searchable):
            self.field_name = field_name
            self.searchable = searchable
            self.archived = False

    class Record:
        data = {"title": "Pump issue", "internal_note": "secret needle"}

    fields = [Field("title", True), Field("internal_note", True)]
    visible_fields = {"title"}
    query_fields = _visible_field_subset(fields, visible_fields)

    assert _record_matches_search(Record(), query_fields, "pump") is True
    assert _record_matches_search(Record(), query_fields, "needle") is False
    with pytest.raises(HTTPException):
        _ensure_filter_fields_visible(
            [{"field": "internal_note", "op": "contains", "value": "needle"}],
            visible_fields,
        )


def test_record_filters_require_queryable_fields():
    pytest.importorskip("fastapi")
    from fastapi import HTTPException
    from app.api.forms import _record_matches_filters

    class Field:
        def __init__(self, field_name, searchable=False, sortable=False):
            self.field_name = field_name
            self.searchable = searchable
            self.sortable = sortable
            self.archived = False

    class Record:
        data = {"status": "open", "secret": "hidden"}

    fields = [Field("status", searchable=True), Field("secret")]
    assert _record_matches_filters(Record(), fields, [{"field": "status", "op": "equals", "value": "open"}]) is True
    assert _record_matches_filters(Record(), fields, [{"field": "status", "op": "equals", "value": "closed"}]) is False
    with pytest.raises(HTTPException):
        _record_matches_filters(Record(), fields, [{"field": "missing", "op": "equals", "value": "x"}])


def test_sort_fields_must_be_visible_and_sortable():
    pytest.importorskip("fastapi")
    from fastapi import HTTPException
    from app.api.forms import _ensure_sort_field_allowed

    class Field:
        def __init__(self, field_name, sortable):
            self.field_name = field_name
            self.sortable = sortable
            self.archived = False

    fields = [Field("title", True), Field("internal_note", True), Field("description", False)]

    _ensure_sort_field_allowed("title", fields, {"title", "description"})
    with pytest.raises(HTTPException):
        _ensure_sort_field_allowed("internal_note", fields, {"title"})
    with pytest.raises(HTTPException):
        _ensure_sort_field_allowed("description", fields, {"title", "description"})


def test_field_change_compatibility_flags_existing_bad_values():
    pytest.importorskip("fastapi")
    from app.api.forms import _field_value_is_compatible

    class Field:
        enum_values = None

        def __init__(self, field_type):
            self.field_type = field_type

    assert _field_value_is_compatible(Field("integer"), 7) is True
    assert _field_value_is_compatible(Field("integer"), "7") is False
    assert _field_value_is_compatible(Field("boolean"), True) is True
    assert _field_value_is_compatible(Field("boolean"), "true") is False
    assert _field_value_is_compatible(Field("code"), "AL-20260529-001") is True
    assert _field_value_is_compatible(Field("code"), 20260529001) is False


def test_publish_preview_blocks_new_required_field_with_existing_records():
    pytest.importorskip("fastapi")
    from app.api.forms import _publish_impact_report

    snapshot = {
        "fields": [
            {"field_name": "title", "label": "Title", "field_type": "string", "required": True},
            {"field_name": "owner", "label": "Owner", "field_type": "string", "required": True},
        ]
    }

    report = _publish_impact_report(None, 1, snapshot, [{"title": "Fix pump"}])
    blocking = [item for item in report["items"] if item["level"] == "blocking"]

    assert report["blocking_count"] == 1
    assert blocking[0]["type"] == "new_required_field_missing"
    assert blocking[0]["field_name"] == "owner"


def test_publish_preview_blocks_incompatible_type_change():
    pytest.importorskip("fastapi")
    from app.api.forms import _publish_impact_report

    class Version:
        version = 1
        snapshot = {"fields": [{"field_name": "amount", "label": "Amount", "field_type": "string"}]}

    snapshot = {"fields": [{"field_name": "amount", "label": "Amount", "field_type": "integer"}]}

    report = _publish_impact_report(Version(), 2, snapshot, [{"amount": "42"}])

    assert report["blocking_count"] == 1
    assert report["items"][0]["type"] == "field_type_incompatible"


def test_publish_preview_warns_when_archived_field_has_data():
    pytest.importorskip("fastapi")
    from app.api.forms import _publish_impact_report

    class Version:
        version = 1
        snapshot = {"fields": [{"field_name": "legacy_note", "label": "Legacy Note", "field_type": "string"}]}

    snapshot = {"fields": [{"field_name": "legacy_note", "label": "Legacy Note", "field_type": "string", "archived": True}]}

    report = _publish_impact_report(Version(), 2, snapshot, [{"legacy_note": "keep this"}])

    assert report["blocking_count"] == 0
    assert report["warning_count"] == 1
    assert report["items"][0]["type"] == "field_archived_with_data"


def test_production_dynamic_query_requires_pushed_search(monkeypatch):
    pytest.importorskip("fastapi")
    from fastapi import HTTPException
    from app.api import forms

    monkeypatch.setattr(forms.settings, "APP_MODE", "production")
    with pytest.raises(HTTPException):
        forms._ensure_production_record_query_supported("needle", [], False, True)


def test_application_form_binding_schema_is_configuration_only():
    pytest.importorskip("fastapi")
    from app.api.forms import ApplicationFormUpsert

    body = ApplicationFormUpsert(form_id=7, alias="Service Ticket", allow_export=True)
    payload = body.dict()
    assert payload["form_id"] == 7
    assert payload["alias"] == "Service Ticket"
    assert payload["enabled"] is True
    assert payload["default_view"] == "list"
    assert "ddl" not in payload
    assert "alter_table" not in payload


def test_layout_action_permission_and_workflow_schemas_are_config_only():
    pytest.importorskip("fastapi")
    from app.api.forms import (
        FormActionCreate,
        FormLayoutUpsert,
        FormPermissionCreate,
        WorkflowBindingCreate,
    )

    layout = FormLayoutUpsert(layout_type="list", config={"columns": ["customer_name"]})
    action = FormActionCreate(action_key="submit", label="Submit", config={"confirm": True})
    permission = FormPermissionCreate(role_id=1, action="read", field_name="customer_name")
    binding = WorkflowBindingCreate(workflow_id=2, trigger_action="submit", config={"title_field": "customer_name"})

    assert layout.config["columns"] == ["customer_name"]
    assert action.config["confirm"] is True
    assert permission.field_name == "customer_name"
    assert binding.config["title_field"] == "customer_name"
    for payload in [layout.dict(), action.dict(), permission.dict(), binding.dict()]:
        assert "ddl" not in payload
        assert "alter_table" not in payload


def test_action_and_workflow_identifiers_share_safe_rules():
    pytest.importorskip("fastapi")
    from fastapi import HTTPException
    from app.api._model_driven_shared import assert_safe_identifier

    assert_safe_identifier("submit")
    assert_safe_identifier("approve_and_archive")
    with pytest.raises(HTTPException):
        assert_safe_identifier("submit;drop")


def test_professional_flow_graph_resolves_executable_steps():
    pytest.importorskip("fastapi")
    from app.api.workflow import _get_steps_from_workflow

    workflow = {
        "config": {
            "nodes": [
                {"id": "start", "type": "startEvent", "label": "提交"},
                {"id": "review", "type": "userTask", "label": "主管审批", "assigneeValue": "质量经理", "approvalMode": "orSign"},
                {"id": "gate", "type": "exclusiveGateway", "label": "风险判断"},
                {"id": "end", "type": "endEvent", "label": "归档"},
            ],
            "edges": [
                {"id": "e1", "source": "start", "target": "review", "priority": 1},
                {"id": "e2", "source": "review", "target": "gate", "priority": 1},
                {"id": "e3", "source": "gate", "target": "end", "priority": 1, "isDefault": True},
            ],
        }
    }

    steps = _get_steps_from_workflow(workflow)

    assert [step["type"] for step in steps] == ["start", "approval", "condition", "end"]
    assert steps[1]["assignee_role"] == "质量经理"
    assert steps[1]["approval_mode"] == "orSign"
