"""Shared form schemas contracts for HTTP and tool callers."""
from __future__ import annotations
from typing import Any, Optional
from pydantic import BaseModel, Field


class FormRulePreviewRequest(BaseModel):
    query: str = Field(default='', max_length=256)
    page: int | None = Field(default=None, ge=1, le=100000)
    page_size: int = Field(default=20, ge=1, le=100)
    selected: str | int | None = None
    data: dict[str, Any] = Field(default_factory=dict)
    record_id: int | None = None


class DesignerRulePreviewRequest(BaseModel):
    validate_only: bool = False
    query: str = Field(default='', max_length=256)
    page: int | None = Field(default=None, ge=1, le=100000)
    page_size: int = Field(default=20, ge=1, le=100)
    selected: str | int | None = None
    mask_record: bool = False
    controls: list[dict] = Field(default_factory=list, max_length=1000)
    data: dict[str, Any] = Field(default_factory=dict)


class FormCreate(BaseModel):
    name: str
    code: str
    description: Optional[str] = None
    application_id: Optional[int] = None
    model_id: Optional[int] = None
    table_name: Optional[str] = None
    storage_mode: str = "dynamic"
    status: str = "draft"
    config: dict = Field(default_factory=dict)


class FormUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    model_id: Optional[int] = None
    table_name: Optional[str] = None
    storage_mode: Optional[str] = None
    status: Optional[str] = None
    config: Optional[dict] = None


class FormCopy(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    code: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$")


class ApplicationFormUpsert(BaseModel):
    form_id: int
    alias: Optional[str] = None
    enabled: bool = True
    default_view: str = "list"
    data_scope: Optional[str] = None
    allow_create: bool = True
    allow_edit: bool = True
    allow_delete: bool = True
    allow_export: bool = False
    sort_order: int = 0


class FormFieldCreate(BaseModel):
    field_name: str
    label: str
    field_type: str = "string"
    business_type: Optional[str] = None
    control_type: Optional[str] = None
    data_source: Optional[str] = None
    encoding_rule: Optional[dict] = None
    required: bool = False
    visible_in_list: bool = True
    visible_in_form: bool = True
    searchable: bool = False
    sortable: bool = False
    default_value: Optional[str] = None
    enum_values: Optional[dict] = None
    validation: Optional[dict] = None
    ui_config: Optional[dict] = None
    sort_order: int = 0


class FormFieldUpdate(BaseModel):
    label: Optional[str] = None
    field_type: Optional[str] = None
    business_type: Optional[str] = None
    control_type: Optional[str] = None
    data_source: Optional[str] = None
    encoding_rule: Optional[dict] = None
    required: Optional[bool] = None
    visible_in_list: Optional[bool] = None
    visible_in_form: Optional[bool] = None
    searchable: Optional[bool] = None
    sortable: Optional[bool] = None
    archived: Optional[bool] = None
    default_value: Optional[str] = None
    enum_values: Optional[dict] = None
    validation: Optional[dict] = None
    ui_config: Optional[dict] = None
    sort_order: Optional[int] = None


class DynamicRecordCreate(BaseModel):
    data: dict
    status: str = "active"


class DynamicRecordUpdate(BaseModel):
    data: Optional[dict] = None
    status: Optional[str] = None
    expected_values: Optional[dict] = None


class MenuNodeCreate(BaseModel):
    parent_id: Optional[int] = None
    node_type: str = "form"
    title: str
    icon: Optional[str] = None
    form_id: Optional[int] = None
    route_path: Optional[str] = None
    visible: bool = True
    default_entry: bool = False
    sort_order: int = 0
    config: dict = Field(default_factory=dict)


class MenuNodeUpdate(BaseModel):
    parent_id: Optional[int] = None
    node_type: Optional[str] = None
    title: Optional[str] = None
    icon: Optional[str] = None
    form_id: Optional[int] = None
    route_path: Optional[str] = None
    visible: Optional[bool] = None
    default_entry: Optional[bool] = None
    sort_order: Optional[int] = None
    config: Optional[dict] = None


class FormLayoutUpsert(BaseModel):
    layout_type: str = "list"
    config: dict = Field(default_factory=dict)


class FormActionCreate(BaseModel):
    action_key: str
    label: str
    action_type: str = "builtin"
    config: dict = Field(default_factory=dict)
    enabled: bool = True
    sort_order: int = 0


class FormActionUpdate(BaseModel):
    label: Optional[str] = None
    action_type: Optional[str] = None
    config: Optional[dict] = None
    enabled: Optional[bool] = None
    sort_order: Optional[int] = None


class FormPermissionCreate(BaseModel):
    role_id: int
    action: str
    effect: str = "allow"
    field_name: Optional[str] = None


class FormPermissionUpdate(BaseModel):
    action: Optional[str] = None
    effect: Optional[str] = None
    field_name: Optional[str] = None


class WorkflowBindingCreate(BaseModel):
    workflow_id: int
    trigger_action: str = "submit"
    enabled: bool = True
    config: dict = Field(default_factory=dict)


class WorkflowBindingUpdate(BaseModel):
    workflow_id: Optional[int] = None
    trigger_action: Optional[str] = None
    enabled: Optional[bool] = None
    config: Optional[dict] = None


class FormApplicationSubmit(BaseModel):
    expected_status: str

