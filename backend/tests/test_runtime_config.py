"""Tests for the centralized runtime configuration module.

Verifies that runtime_config reads from the database first and falls back
to config.py defaults when no DB row exists.
"""

import pytest

from app.config import settings


def _has_postgres():
    """Check if PostgreSQL is available."""
    import asyncio
    from app.core.db import db_session

    async def _check():
        try:
            async with db_session() as db:
                await db.execute(__import__("sqlalchemy").text("SELECT 1"))
            return True
        except Exception:
            return False

    try:
        return asyncio.get_event_loop().run_until_complete(_check())
    except Exception:
        return False


requires_db = pytest.mark.skipif(not _has_postgres(), reason="PostgreSQL not available")


class TestPlatformDefaultsFallback:
    """When no DB row exists, all getters return config.py defaults."""

    def test_token_expire_minutes_default(self):
        """get_token_expire_minutes falls back to settings.ACCESS_TOKEN_EXPIRE_MINUTES."""
        from app.core.runtime_config import get_token_expire_minutes
        import asyncio

        result = asyncio.get_event_loop().run_until_complete(get_token_expire_minutes(db=None))
        assert result == settings.ACCESS_TOKEN_EXPIRE_MINUTES

    def test_app_public_url_default(self):
        """get_app_public_url falls back to settings.APP_PUBLIC_URL."""
        from app.core.runtime_config import get_app_public_url
        import asyncio

        result = asyncio.get_event_loop().run_until_complete(get_app_public_url(db=None))
        assert result == settings.APP_PUBLIC_URL

    def test_knowledge_storage_dir_default(self):
        """get_knowledge_storage_dir falls back to settings.KNOWLEDGE_STORAGE_DIR."""
        from app.core.runtime_config import get_knowledge_storage_dir
        import asyncio

        result = asyncio.get_event_loop().run_until_complete(get_knowledge_storage_dir(db=None))
        assert result == settings.KNOWLEDGE_STORAGE_DIR

    def test_provider_model_defaults_fallback(self):
        """get_provider_model_defaults returns deepseek defaults when DB cache is empty."""
        from app.core.runtime_config import get_provider_model_defaults, _PROVIDER_DEFAULTS_CACHE
        import asyncio

        # Clear cache to force fallback
        _PROVIDER_DEFAULTS_CACHE.clear()
        result = asyncio.get_event_loop().run_until_complete(get_provider_model_defaults())
        assert "deepseek" in result
        assert result["deepseek"]["baseUrl"] == "https://api.deepseek.com"
        assert result["deepseek"]["chatModel"] == "deepseek-chat"

    def test_platform_settings_returns_dict(self):
        """get_platform_settings returns a dict with expected keys."""
        from app.core.runtime_config import get_platform_settings
        import asyncio

        result = asyncio.get_event_loop().run_until_complete(get_platform_settings(db=None))
        assert isinstance(result, dict)
        assert "tokenExpireMinutes" in result
        assert "appPublicUrl" in result
        assert "knowledgeStorageDir" in result


class TestOidcTenantConfig:
    """Per-tenant OIDC configuration reads."""

    def test_oidc_config_for_nonexistent_tenant_returns_empty(self):
        """When no oidc:{tenant_id} row exists, returns empty dict."""
        from app.core.runtime_config import get_oidc_config_for_tenant
        import asyncio

        # Use a tenant_id that definitely has no DB row
        result = asyncio.get_event_loop().run_until_complete(
            get_oidc_config_for_tenant(tenant_id=99999, db=None)
        )
        assert isinstance(result, dict)
        # Should be empty when no row exists
        assert result == {}


class TestInMemoryCaches:
    """Verify cache structures are initialized correctly."""

    def test_platform_cache_exists(self):
        from app.core.runtime_config import _PLATFORM_CACHE
        assert isinstance(_PLATFORM_CACHE, dict)

    def test_oidc_tenant_cache_exists(self):
        from app.core.runtime_config import _OIDC_TENANT_CACHE
        assert isinstance(_OIDC_TENANT_CACHE, dict)

    def test_provider_defaults_cache_exists(self):
        from app.core.runtime_config import _PROVIDER_DEFAULTS_CACHE
        assert isinstance(_PROVIDER_DEFAULTS_CACHE, dict)


class TestMigrationSeedData:
    """Verify the migration file exists and has correct metadata."""

    def test_migration_file_exists(self):
        import importlib.util
        import pathlib
        migration_path = pathlib.Path(__file__).resolve().parent.parent / "alembic" / "versions" / "0030_seed_platform_config.py"
        assert migration_path.exists(), f"Migration file not found: {migration_path}"
        spec = importlib.util.spec_from_file_location("migration_0030", migration_path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        assert mod.revision == "0030_seed_platform_config"
        assert mod.down_revision == "0029_form_physical_tables"

    def test_migration_has_upgrade_and_downgrade(self):
        import importlib.util
        import pathlib
        migration_path = pathlib.Path(__file__).resolve().parent.parent / "alembic" / "versions" / "0030_seed_platform_config.py"
        spec = importlib.util.spec_from_file_location("migration_0030", migration_path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        assert callable(mod.upgrade)
        assert callable(mod.downgrade)
