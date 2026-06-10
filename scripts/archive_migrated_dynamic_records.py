"""Archive dynamic_records after their form data has been materialized.

The physical business/analysis tables are now the active source of truth.
Rows in dynamic_records are soft-deleted for forms that already point at a
physical table, so normal queries and counts no longer treat them as live data.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from sqlalchemy import text

from app.database import AsyncSessionLocal


async def main() -> None:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text(
                """
                UPDATE dynamic_records dr
                SET deleted_at = now(), updated_at = now()
                FROM forms f
                WHERE dr.form_id = f.id
                  AND dr.tenant_id = f.tenant_id
                  AND dr.deleted_at IS NULL
                  AND lower(coalesce(f.storage_mode, '')) IN ('physical_table', 'business_table')
                  AND coalesce(f.table_name, '') <> ''
                """
            )
        )
        await db.commit()
        print(f"archived={result.rowcount or 0}")


if __name__ == "__main__":
    asyncio.run(main())
