"""seed platform.global and oidc:1 into system_settings

Revision ID: 0030_seed_platform_config
Revises: 0029_form_physical_tables
Create Date: 2026-06-10
"""
from __future__ import annotations

import json

import sqlalchemy as sa
from alembic import op

revision = "0030_seed_platform_config"
down_revision = "0029_form_physical_tables"
branch_labels = None
depends_on = None

# ---------------------------------------------------------------------------
# Seed data
# ---------------------------------------------------------------------------
PLATFORM_GLOBAL_KEY = "platform.global"
OIDC_TENANT_1_KEY = "oidc:1"

PLATFORM_GLOBAL_VALUE = {
    "tokenExpireMinutes": 480,
    "appPublicUrl": "http://localhost:5173",
    "knowledgeStorageDir": "storage/knowledge_assets",
    "providerDefaults": {
        "deepseek": {
            "baseUrl": "https://api.deepseek.com",
            "chatModel": "deepseek-chat",
            "reasoningModel": "deepseek-reasoner",
        },
    },
}

OIDC_TENANT_1_VALUE: dict = {}

# Keys that this migration owns (used by downgrade)
_SEED_KEYS = (PLATFORM_GLOBAL_KEY, OIDC_TENANT_1_KEY)


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _has_table("system_settings"):
        return

    bind = op.get_bind()

    # --- platform.global ---
    existing_platform = bind.execute(
        sa.text("SELECT id FROM system_settings WHERE key = :key LIMIT 1"),
        {"key": PLATFORM_GLOBAL_KEY},
    ).scalar()
    if existing_platform is None:
        bind.execute(
            sa.text(
                "INSERT INTO system_settings (key, value, description, updated_by) "
                "VALUES (:key, :value, :description, :updated_by)"
            ),
            {
                "key": PLATFORM_GLOBAL_KEY,
                "value": json.dumps(PLATFORM_GLOBAL_VALUE),
                "description": "Global platform runtime settings",
                "updated_by": None,
            },
        )

    # --- oidc:1 ---
    existing_oidc = bind.execute(
        sa.text("SELECT id FROM system_settings WHERE key = :key LIMIT 1"),
        {"key": OIDC_TENANT_1_KEY},
    ).scalar()
    if existing_oidc is None:
        bind.execute(
            sa.text(
                "INSERT INTO system_settings (key, value, description, updated_by) "
                "VALUES (:key, :value, :description, :updated_by)"
            ),
            {
                "key": OIDC_TENANT_1_KEY,
                "value": json.dumps(OIDC_TENANT_1_VALUE),
                "description": "OIDC configuration for tenant 1",
                "updated_by": None,
            },
        )


def downgrade() -> None:
    if not _has_table("system_settings"):
        return

    bind = op.get_bind()
    for key in _SEED_KEYS:
        bind.execute(
            sa.text("DELETE FROM system_settings WHERE key = :key"),
            {"key": key},
        )
