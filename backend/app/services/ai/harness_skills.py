"""Project the platform's visible skill definitions into a single DSH run."""

import hashlib
import re
from pathlib import Path

import yaml

from .settings import maybe_mask_sensitive_payload
from .skill_import import split_skill_markdown
from .skill_loader import FORM_SKILL, available_skill_catalog, bundled_skill_package, skill_body
from .skills import skill_registry


def _portable_metadata(skill) -> dict:
    package = bundled_skill_package(skill.name)
    metadata = package[0] if package else {}
    if skill.source_markdown:
        try:
            metadata, _ = split_skill_markdown(skill.source_markdown)
        except ValueError:
            pass  # Older stored records can still run from their saved instructions.
    result = {}
    for field in ('license', 'compatibility'):
        value = metadata.get(field)
        if isinstance(value, str) and value.strip() and (field != 'compatibility' or len(value) <= 500):
            result[field] = value
    values = metadata.get('metadata')
    if isinstance(values, dict) and all(isinstance(k, str) and isinstance(v, str) for k, v in values.items()):
        result['metadata'] = values
    # An imported allowed-tools declaration does not grant access to platform tools.
    return result


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
        description = maybe_mask_sensitive_payload(item["description"].strip() or skill.title.strip() or alias, settings)
        metadata = {
            "name": alias,
            "description": description[:1024],
            **maybe_mask_sensitive_payload(_portable_metadata(skill), settings),
        }
        # Only the private DSH copy carries client extensions for non-default policies.
        if not skill.model_invocable:
            metadata["disable-model-invocation"] = True
        if not skill.user_invocable:
            metadata["user-invocable"] = False
        frontmatter = yaml.safe_dump(metadata, allow_unicode=True, sort_keys=False)
        body = maybe_mask_sensitive_payload(skill_body(skill), settings)
        package = root / alias
        package.mkdir()
        (package / 'SKILL.md').write_text(f"---\n{frontmatter}---\n\n{body.lstrip()}", encoding="utf-8")
