"""Pytest configuration.

Adds the project root to sys.path so `import app.*` works without
having to install the package in editable mode. Keeps tests
independent of any deployment-time PYTHONPATH magic.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # backend/
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Sane defaults for unit tests — keep settings deterministic.
os.environ.setdefault("SECRET_KEY", "test-secret-key-do-not-use-in-prod")
os.environ.setdefault("LOG_LEVEL", "WARNING")
os.environ.setdefault("DEMO_AUTH_OPTIONAL", "true")
os.environ.setdefault("DATABASE_BACKEND", "sqlite")
