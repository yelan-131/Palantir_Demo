"""Rewrite selected JSON config columns with readable non-ASCII text."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

import psycopg2

from app.config import settings


TARGETS = [
    ("form_layouts", "config"),
]


def main() -> None:
    with psycopg2.connect(
        host=settings.POSTGRES_HOST,
        port=settings.POSTGRES_PORT,
        user=settings.POSTGRES_USER,
        password=settings.POSTGRES_PASSWORD,
        dbname=settings.POSTGRES_DB,
    ) as conn:
        with conn.cursor() as cur:
            for table, column in TARGETS:
                cur.execute(
                    f"""
                    SELECT id, {column}
                    FROM {table}
                    WHERE {column} IS NOT NULL
                    ORDER BY id
                    """
                )
                rows = cur.fetchall()
                changed = 0
                for row_id, value in rows:
                    next_text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
                    cur.execute(
                        f"UPDATE {table} SET {column} = %s::json WHERE id = %s",
                        (next_text, row_id),
                    )
                    changed += cur.rowcount
                print(f"{table}.{column}: rewritten={changed}")
        conn.commit()


if __name__ == "__main__":
    main()
