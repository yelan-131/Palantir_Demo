"""Published form payloads read by component pages and form routes."""
from __future__ import annotations

from typing import Optional
from app.services.form_definition import _form_payload, _permission_design_from_config, _field_cfg_is_active


def _published_form_payload(form, version, *, applications: Optional[list] = None) -> dict:
    snapshot = version.snapshot or {}
    form_snapshot = snapshot.get("form") or {}
    config = form_snapshot.get("config") or form.config or {}
    live_config = form.config or {}
    snapshot_view = config.get("viewConfig") if isinstance(config, dict) else None
    live_view = live_config.get("viewConfig") if isinstance(live_config, dict) else None
    if (
        isinstance(live_view, dict)
        and (
            not isinstance(snapshot_view, dict)
            or not (snapshot_view.get("table") or {}).get("columns")
            or (not (snapshot_view.get("filters") or []) and (live_view.get("filters") or []))
        )
    ):
        config = {**config, "viewConfig": live_view}
        if live_config.get("formLayout") and not config.get("formLayout"):
            config["formLayout"] = live_config.get("formLayout")
        if live_config.get("viewConfigMeta"):
            config["viewConfigMeta"] = live_config.get("viewConfigMeta")
    payload = {
        **_form_payload(form),
        **{key: value for key, value in form_snapshot.items() if key in {"name", "code", "description", "model_id", "table_name", "storage_mode", "status", "owner_id", "config"}},
        "schema_mode": "published",
        "published_version": version.version,
        "published_at": version.published_at.isoformat() if version.published_at else None,
        "fields": [field for field in snapshot.get("fields", []) if _field_cfg_is_active(field)],
        "permission_design": _permission_design_from_config(config),
    }
    payload["config"] = config
    if applications is not None:
        payload["applications"] = applications
    return payload
