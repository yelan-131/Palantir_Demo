"""Upgrade the bundled draft handler without replacing custom registry definitions."""
import asyncio
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from sqlalchemy import select
from app.core.db import db_session
from app.models.relational import AIAgentToolDefinition
async def main():
    async with db_session() as session:
        row = await session.scalar(select(AIAgentToolDefinition).where(AIAgentToolDefinition.name == "forms.create_dynamic_record_draft"))
        if row and row.handler_key == "not_implemented" and row.definition.get("permission_check") == "save_draft" and row.definition.get("side_effect") == "draft_write":
            row.handler_key = "forms.create_dynamic_record_draft"
            row.definition = {**row.definition, "handler_key": row.handler_key}
            await session.commit()
            print("Bundled draft handler upgraded")
        else:
            print("No bundled draft handler requires upgrade")
asyncio.run(main())
