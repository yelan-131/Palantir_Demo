"""Refresh packaged Agent assets before building a backend-only image."""
from pathlib import Path
from shutil import copyfile
root = Path(__file__).resolve().parents[1]
target = root / "backend/app/services/ai/assets"
target.mkdir(exist_ok=True)
for source in (root / ".agent/agent.md", root / ".agent/action-contracts.md", root / "data/agent_registry/skills.json", root / "data/agent_registry/tools.json"):
    copyfile(source, target / source.name)
