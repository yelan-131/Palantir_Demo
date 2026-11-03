"""Add missing dashboard AI tools while preserving all existing registry choices.

Run without --apply to inspect; run with --apply after deploying the matching backend.
"""
import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.ai.agent_registry import load_agent_registry, load_seed_registry, save_agent_registry_payload


async def main(apply=False):
    current = await load_agent_registry(include_disabled=True)
    seed_skills, seed_tools = load_seed_registry()
    additions = {'skills': {}, 'tools': {}}
    for kind, seed, prefix in [('skills', seed_skills, 'analysis.'), ('tools', seed_tools, 'dashboards.')]:
        for name, definition in seed.items():
            if name.startswith(prefix) and name not in current[kind] and (
                kind == 'tools' or name in {'analysis.manage_dashboard', 'analysis.query_dashboard'}):
                additions[kind][name] = definition
    print({kind: sorted(items) for kind, items in additions.items()})
    if apply and any(additions.values()):
        await save_agent_registry_payload({kind: {**current[kind], **additions[kind]}
            for kind in additions}, updated_by='dashboard-ai-upgrade')
        print('Dashboard registry additions saved; existing definitions and disabled states preserved.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    asyncio.run(main(parser.parse_args().apply))
