"""Preview or populate existing form content without replacing custom pages.

Run from backend: .venv/bin/python -m scripts.populate_component_pages [--apply]
"""
import argparse
import asyncio
import json

from app.database import AsyncSessionLocal
from app.services.page_content_migration import populate_pages, upgrade_content_pages


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--upgrade', action='store_true', help='仅升级旧转换程序生成且未被修改的看板草稿')
    args = parser.parse_args()
    async with AsyncSessionLocal() as db:
        action = upgrade_content_pages if args.upgrade else populate_pages
        print(json.dumps(await action(db, apply=args.apply), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    asyncio.run(main())
