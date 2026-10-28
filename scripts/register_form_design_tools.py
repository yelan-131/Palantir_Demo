"""Add missing form design tools to an existing database registry.

Run from backend: .venv/bin/python ../scripts/register_form_design_tools.py
Existing definitions and disabled states are preserved.
"""
import asyncio
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from sqlalchemy import select
from app.core.db import db_session
from app.models.relational import AIAgentToolDefinition
from app.services.ai.agent_definition import _load_registry_seed
from app.services.ai.form_configuration_tools import FORM_DESIGN_TOOLS


async def main():
    seed = _load_registry_seed('tools.json')
    added = []
    async with db_session() as session:
        existing = set((await session.scalars(select(AIAgentToolDefinition.name))).all())
        for name in FORM_DESIGN_TOOLS:
            if name in existing:
                continue
            definition = seed[name]
            session.add(AIAgentToolDefinition(name=name, title=definition['title'],
                description=definition['description'], definition=definition,
                enabled=True, source='form-design-tools', version=1))
            added.append(name)
        await session.commit()
    print(f'Added {len(added)} form design tools; existing entries preserved. Restart backend to refresh runtime registry.')


if __name__ == '__main__':
    asyncio.run(main())
