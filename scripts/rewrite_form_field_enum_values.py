"""Rewrite form_fields.enum_values JSON with readable non-ASCII text."""

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


def main() -> None:
    changed = 0
    with psycopg2.connect(
        host=settings.POSTGRES_HOST,
        port=settings.POSTGRES_PORT,
        user=settings.POSTGRES_USER,
        password=settings.POSTGRES_PASSWORD,
        dbname=settings.POSTGRES_DB,
    ) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, enum_values
                FROM form_fields
                WHERE enum_values IS NOT NULL
                ORDER BY id
                """
            )
            rows = cur.fetchall()
            for field_id, enum_values in rows:
                if enum_values is None:
                    continue
                next_text = json.dumps(enum_values, ensure_ascii=False, separators=(",", ":"))
                cur.execute(
                    "UPDATE form_fields SET enum_values = %s::json WHERE id = %s",
                    (next_text, field_id),
                )
                changed += cur.rowcount
        conn.commit()
    print(f"rewritten_enum_values={changed}")


if __name__ == "__main__":
    main()
