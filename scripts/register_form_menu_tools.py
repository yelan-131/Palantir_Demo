"""Install missing form menu registry entries into an existing database."""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))

from app.core.db import db_session
from app.models.relational import AIAgentSkillDefinition, AIAgentToolDefinition
from app.services.ai.agent_registry import load_seed_registry
from sqlalchemy import select


async def main():
    skills, tools = load_seed_registry()
    async with db_session() as session:
        for model, definitions, name in (
            (AIAgentToolDefinition, tools, 'platform.application_settings.query'),
            (AIAgentToolDefinition, tools, 'forms.publish_to_menu'),
            (AIAgentSkillDefinition, skills, 'low_code.publish_form_to_menu'),
        ):
            existing = await session.scalar(select(model).where(model.tenant_id == 1, model.name == name))
            if existing:
                if name == 'platform.application_settings.query' and existing.description == 'Read tenant application configuration through admin permissions.':
                    existing.description = definitions[name]['description']
                    existing.definition = {**existing.definition, 'description': existing.description}
                continue
            definition = definitions[name]
            handler = {'handler_key': definition['handler_key']} if model is AIAgentToolDefinition else {}
            session.add(model(name=name, title=definition['title'], description=definition['description'],
                              definition=definition, source='form-menu-tools', **handler))
            print(f'Registered {name}')
        await session.commit()


if __name__ == '__main__':
    asyncio.run(main())
