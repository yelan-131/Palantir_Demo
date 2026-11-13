"""Project the platform's visible skill definitions into a single DSH run."""

import hashlib
import json
import re
from pathlib import Path

from .settings import maybe_mask_sensitive_payload
from .skill_loader import FORM_SKILL, available_skill_catalog, skill_body
from .skills import skill_registry


def stage_native_skills(root: Path, user, settings, context, *, allow_form_designer: bool) -> None:
    registry = skill_registry()
    catalog = available_skill_catalog(user, settings, context, native=True, registry=registry)
    # Reserve valid IDs first, so a legacy alias never replaces an imported name.
    reserved = {name for name in registry if len(name) <= 64 and re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name)}
    for item in catalog:
        name = item["name"]
        if name == FORM_SKILL and not allow_form_designer:
            continue
        skill = registry[name]
        alias = name
        if name not in reserved:
            stem = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:47].rstrip("-") or "skill"
            alias = stem
            if alias in reserved:
                alias = f"{stem}-{hashlib.sha256(name.encode()).hexdigest()[:16]}"
                while alias in reserved:
                    alias = "skill-" + hashlib.sha256(alias.encode()).hexdigest()[:32]
            reserved.add(alias)
        metadata = {
            "name": alias,
            "description": item["description"].strip() or skill.title or alias,
            "disable-model-invocation": not skill.model_invocable,
            "user-invocable": skill.user_invocable,
        }
        metadata["description"] = maybe_mask_sensitive_payload(metadata["description"], settings)
        frontmatter = "\n".join(f"{key}: {json.dumps(value, ensure_ascii=False)}" for key, value in metadata.items())
        body = maybe_mask_sensitive_payload(skill_body(skill), settings)
        (root / f"{alias}.md").write_text(f"---\n{frontmatter}\n---\n\n{body}", encoding="utf-8")
