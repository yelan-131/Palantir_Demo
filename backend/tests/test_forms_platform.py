"""Tests for the platform form database layer."""
from __future__ import annotations

import pytest


def test_form_code_uses_safe_identifier_rules():
    pytest.importorskip("fastapi")
    from fastapi import HTTPException
    from app.api.forms import _validate_form_code

    _validate_form_code("service_ticket")
    with pytest.raises(HTTPException):
        _validate_form_code("service-ticket")
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
