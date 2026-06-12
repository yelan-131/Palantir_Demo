"""Centralized runtime configuration reader.

Reads from the ``system_settings`` database table first, then falls back
to ``config.py`` environment-variable defaults.  Mirrors the caching and
persistence patterns established in ``app.services.ai.settings``.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import select

from app.core.logging import get_logger

logger = get_logger(__name__)

# ---------------------------------------------------------------------------
# Settings keys
# ---------------------------------------------------------------------------
PLATFORM_SETTINGS_KEY = "platform.global"
_OIDC_KEY_PREFIX = "oidc:"

# ---------------------------------------------------------------------------
# In-memory caches
# ---------------------------------------------------------------------------
_PLATFORM_CACHE: dict[str, Any] = {}
_OIDC_TENANT_CACHE: dict[int, dict[str, Any]] = {}
_PROVIDER_DEFAULTS_CACHE: dict[str, dict[str, str]] = {}

# ---------------------------------------------------------------------------
# Default values (mirrors config.py defaults so we can fall back gracefully)
# ---------------------------------------------------------------------------
_PLATFORM_DEFAULTS: dict[str, Any] = {
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

_DEEPSEEK_PROVIDER_DEFAULTS: dict[str, str] = {
    "baseUrl": "https://api.deepseek.com",
    "chatModel": "deepseek-chat",
    "reasoningModel": "deepseek-reasoner",
}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _platform_defaults_from_config() -> dict[str, Any]:
    """Build default platform settings from config.py / env vars."""
    try:
        from app.config import settings as _settings
        defaults = {
            "tokenExpireMinutes": getattr(_settings, "ACCESS_TOKEN_EXPIRE_MINUTES", 480),
            "appPublicUrl": getattr(_settings, "APP_PUBLIC_URL", "http://localhost:5173"),
            "knowledgeStorageDir": getattr(_settings, "KNOWLEDGE_STORAGE_DIR", "storage/knowledge_assets"),
            "providerDefaults": {
                "deepseek": {
                    "baseUrl": "https://api.deepseek.com",
                    "chatModel": "deepseek-chat",
                    "reasoningModel": "deepseek-reasoner",
                },
            },
        }
    except Exception:  # noqa: BLE001
        defaults = dict(_PLATFORM_DEFAULTS)
    return defaults


async def _get_db_session(db=None):
    """Return an async context manager yielding a session.

    If *db* is already an active session we yield it directly (caller is
    responsible for commit/close).  Otherwise we open a fresh ``db_session()``.
    """
    if db is not None:
        from contextlib import asynccontextmanager

        @asynccontextmanager
        async def _wrap():
            yield db

        return _wrap()

    from app.core.db import db_session
    return db_session()


async def _load_platform_settings(db=None) -> dict[str, Any]:
    """Read *platform.global* from DB, merge with defaults, update cache."""
    try:
        from app.models.relational import SystemSetting

        async with await _get_db_session(db) as session:
            result = await session.execute(
                select(SystemSetting).where(SystemSetting.key == PLATFORM_SETTINGS_KEY)
            )
            record = result.scalar_one_or_none()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to load platform settings from DB: %s", exc)
        record = None

    defaults = _platform_defaults_from_config()
    if record is not None and isinstance(record.value, dict):
        merged = {**defaults, **record.value}
    else:
        merged = defaults

    _PLATFORM_CACHE.clear()
    _PLATFORM_CACHE.update(merged)
    return merged


async def _load_oidc_settings(tenant_id: int, db) -> dict[str, Any]:
    """Read *oidc:<tenant_id>* from DB, update per-tenant cache."""
    key = f"{_OIDC_KEY_PREFIX}{tenant_id}"
    try:
        from app.models.relational import SystemSetting

        async with await _get_db_session(db) as session:
            result = await session.execute(
                select(SystemSetting).where(SystemSetting.key == key)
            )
            record = result.scalar_one_or_none()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to load OIDC settings for tenant %d from DB: %s", tenant_id, exc)
        record = None

    data: dict[str, Any] = record.value if (record is not None and isinstance(record.value, dict)) else {}
    _OIDC_TENANT_CACHE[tenant_id] = data
    return data


# ---------------------------------------------------------------------------
# Public API -- getters
# ---------------------------------------------------------------------------

async def get_platform_settings(db=None) -> dict:
    """Return the merged *platform.global* settings dict.

    Reads from DB on every call (unless you pass an explicit *db* session
    which implies the caller wants a single consistent transaction).
    Falls back to ``config.py`` defaults on DB errors.
    """
    if _PLATFORM_CACHE:
        return dict(_PLATFORM_CACHE)
    return await _load_platform_settings(db)


async def get_token_expire_minutes(db=None) -> int:
    """Shortcut: read ``tokenExpireMinutes`` from platform settings.

    Falls back to ``settings.ACCESS_TOKEN_EXPIRE_MINUTES``.
    """
    data = await get_platform_settings(db)
    value = data.get("tokenExpireMinutes")
    if value is not None:
        try:
            return int(value)
        except (TypeError, ValueError):
            pass
    try:
        from app.config import settings as _settings
        return int(getattr(_settings, "ACCESS_TOKEN_EXPIRE_MINUTES", 480))
    except Exception:  # noqa: BLE001
        return 480


async def get_app_public_url(db=None) -> str:
    """Shortcut: read ``appPublicUrl`` from platform settings.

    Falls back to ``settings.APP_PUBLIC_URL``.
    """
    data = await get_platform_settings(db)
    value = data.get("appPublicUrl")
    if value:
        return str(value)
    try:
        from app.config import settings as _settings
        return getattr(_settings, "APP_PUBLIC_URL", "http://localhost:5173")
    except Exception:  # noqa: BLE001
        return "http://localhost:5173"


async def get_knowledge_storage_dir(db=None) -> str:
    """Shortcut: read ``knowledgeStorageDir`` from platform settings.

    Falls back to ``settings.KNOWLEDGE_STORAGE_DIR``.
    """
    data = await get_platform_settings(db)
    value = data.get("knowledgeStorageDir")
    if value:
        return str(value)
    try:
        from app.config import settings as _settings
        return getattr(_settings, "KNOWLEDGE_STORAGE_DIR", "storage/knowledge_assets")
    except Exception:  # noqa: BLE001
        return "storage/knowledge_assets"


async def get_oidc_config_for_tenant(tenant_id: int, db) -> dict:
    """Return OIDC config dict for the given tenant.

    Reads ``oidc:<tenant_id>`` from *system_settings*.  Returns an empty
    dict if no row exists.  Does NOT fall back to config.py OIDC settings
    (that is ``iam.py``'s responsibility).
    """
    cached = _OIDC_TENANT_CACHE.get(tenant_id)
    if cached is not None:
        return dict(cached)
    return await _load_oidc_settings(tenant_id, db)


async def get_provider_model_defaults() -> dict[str, dict[str, str]]:
    """Return ``providerDefaults`` from the platform settings cache.

    Falls back to a hard-coded deepseek default if nothing is configured.
    """
    data = await get_platform_settings()
    provider_defaults = data.get("providerDefaults")
    if isinstance(provider_defaults, dict) and provider_defaults:
        return provider_defaults
    return {"deepseek": dict(_DEEPSEEK_PROVIDER_DEFAULTS)}


# ---------------------------------------------------------------------------
# Public API -- setters (upsert + cache update)
# ---------------------------------------------------------------------------

async def save_platform_settings(db, settings_data: dict, *, updated_by=None) -> dict:
    """Upsert the *platform.global* row, merge with existing, update cache.

    Parameters
    ----------
    db : AsyncSession
        An active database session (caller manages commit/close).
    settings_data : dict
        Partial or full settings payload to merge.
    updated_by : str | None
        Identifier of the user performing the update.

    Returns
    -------
    dict
        The fully merged settings after upsert.
    """
    from app.models.relational import SystemSetting

    # Load current state from DB (bypassing cache to ensure freshness)
    result = await db.execute(
        select(SystemSetting).where(SystemSetting.key == PLATFORM_SETTINGS_KEY)
    )
    record = result.scalar_one_or_none()

    existing_value: dict[str, Any] = {}
    if record is not None and isinstance(record.value, dict):
        existing_value = record.value

    defaults = _platform_defaults_from_config()
    merged = {**defaults, **existing_value, **settings_data}

    if record is None:
        record = SystemSetting(
            key=PLATFORM_SETTINGS_KEY,
            value=merged,
            description="Global platform runtime settings",
            updated_by=updated_by,
        )
        db.add(record)
    else:
        record.value = merged
        record.updated_by = updated_by

    await db.flush()

    _PLATFORM_CACHE.clear()
    _PLATFORM_CACHE.update(merged)
    logger.info("Platform settings saved by %s", updated_by or "system")
    return dict(merged)


async def save_oidc_settings_for_tenant(db, tenant_id: int, oidc_data: dict, *, updated_by=None) -> dict:
    """Upsert the ``oidc:<tenant_id>`` row, merge with existing, update cache.

    Parameters
    ----------
    db : AsyncSession
        An active database session (caller manages commit/close).
    tenant_id : int
        The tenant whose OIDC config to save.
    oidc_data : dict
        Partial or full OIDC payload to merge.
    updated_by : str | None
        Identifier of the user performing the update.

    Returns
    -------
    dict
        The fully merged OIDC settings after upsert.
    """
    from app.models.relational import SystemSetting

    key = f"{_OIDC_KEY_PREFIX}{tenant_id}"

    result = await db.execute(
        select(SystemSetting).where(SystemSetting.key == key)
    )
    record = result.scalar_one_or_none()

    existing_value: dict[str, Any] = {}
    if record is not None and isinstance(record.value, dict):
        existing_value = record.value

    merged = {**existing_value, **oidc_data}

    if record is None:
        record = SystemSetting(
            key=key,
            value=merged,
            description=f"OIDC configuration for tenant {tenant_id}",
            updated_by=updated_by,
        )
        db.add(record)
    else:
        record.value = merged
        record.updated_by = updated_by

    await db.flush()

    _OIDC_TENANT_CACHE[tenant_id] = merged
    logger.info("OIDC settings for tenant %d saved by %s", tenant_id, updated_by or "system")
    return dict(merged)
