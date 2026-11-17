"""Read the required metadata and Markdown body from a SKILL.md document."""

import re

import yaml


def split_skill_markdown(markdown: str) -> tuple[dict, str]:
    lines = markdown.removeprefix("\ufeff").splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        raise ValueError("SKILL.md 必须以 YAML 元数据开头")
    end = next((index for index in range(1, len(lines)) if lines[index].strip() == "---"), None)
    if end is None:
        raise ValueError("YAML 元数据缺少结束分隔线")
    try:
        metadata = yaml.safe_load("".join(lines[1:end]))
    except (yaml.YAMLError, RecursionError) as exc:
        raise ValueError("SKILL.md 的 YAML 元数据格式有误") from exc
    if not isinstance(metadata, dict):
        raise ValueError("YAML 元数据必须包含 name 和 description")
    return metadata, "".join(lines[end + 1:])


def parse_skill_markdown(markdown: str) -> dict[str, str | bool]:
    metadata, instructions = split_skill_markdown(markdown)
    name = metadata.get("name")
    if not isinstance(name, str) or len(name) > 64 or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name):
        raise ValueError("name 须使用 1–64 个小写字母、数字或单连字符")
    description = metadata.get("description")
    if not isinstance(description, str) or not description.strip() or len(description.strip()) > 1024:
        raise ValueError("description 须为 1–1024 个字符的非空文本")
    if len(instructions) > 30000:
        raise ValueError("技能正文最多支持 30000 个字符")
    options = {}
    for key, field, invert in (
        ("disable-model-invocation", "model_invocable", True),
        ("user-invocable", "user_invocable", False),
    ):
        if key not in metadata:
            continue
        value = str(metadata[key]).lower()
        if value not in {"true", "false", "yes", "no", "on", "off", "1", "0"}:
            raise ValueError(f"{key} 须为布尔值")
        options[field] = (value in {"true", "yes", "on", "1"}) != invert
    return {
        "name": name, "description": description.strip(), "instructions": instructions,
        "source_markdown": markdown, **options,
    }
