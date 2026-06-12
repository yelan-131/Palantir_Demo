"""Tenant-facing AI profile helpers.

Brand and assistant identity are runtime inputs. They must not be hard-coded in
agent prompts because the platform can be deployed for different companies.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from app.config import settings
from app.services.ai.tenant_context import require_tenant_id


class TenantProfile(BaseModel):
    tenant_id: int
    slug: str = "default"
    display_name: str = Field(default_factory=lambda: getattr(settings, "APP_NAME", "Manufacturing Platform"))
    product_name: str = Field(default_factory=lambda: getattr(settings, "APP_NAME", "Manufacturing Platform"))
    assistant_name: str = "AI Assistant"
    industry: str = "manufacturing"
    locale: str = "zh-CN"
    timezone: str = "Asia/Shanghai"
    terminology: dict[str, str] = Field(default_factory=dict)
    brand_voice: str = "natural, professional, evidence-aware"
    forbidden_claims: list[str] = Field(default_factory=list)


def default_tenant_profile(tenant_id: int | None = None, tenant_name: str | None = None) -> TenantProfile:
    tenant_id = require_tenant_id({"tenant_id": tenant_id})
    app_name = tenant_name or getattr(settings, "APP_NAME", "Manufacturing Platform")
    return TenantProfile(
        tenant_id=tenant_id,
        display_name=app_name,
        product_name=app_name,
        assistant_name=f"{app_name} AI",
    )


async def load_tenant_profile(tenant_id: int | None = None, *, session: Any | None = None) -> TenantProfile:
    """Load a safe public tenant profile.

    The current schema only has a minimal Tenant table. This helper centralizes
    the fallback now and leaves a single seam for a future tenant_profiles table.
    """

    tenant_id = require_tenant_id({"tenant_id": tenant_id})
    tenant_name: str | None = None
    tenant_slug = "default"
    if session is not None:
        try:
            from app.models.relational import Tenant

            tenant = await session.get(Tenant, tenant_id)
            if tenant:
                tenant_name = tenant.name
                tenant_slug = tenant.slug
        except Exception:
            tenant_name = None
    profile = default_tenant_profile(tenant_id, tenant_name)
    profile.slug = tenant_slug
    return profile
