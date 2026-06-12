"""Auto-encoding (料号/业务编号) rule helpers. Pure functions, no DB access."""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any


def _is_encoding_field(field) -> bool:
    ui_config = getattr(field, "ui_config", None) or {}
    return (
        str(getattr(field, "field_type", "") or "").lower() == "code"
        or getattr(field, "business_type", None) == "code"
        or getattr(field, "control_type", None) == "code"
        or isinstance(getattr(field, "encoding_rule", None), dict)
        or ui_config.get("businessType") == "code"
        or ui_config.get("controlType") == "code"
        or isinstance(ui_config.get("encodingRule"), dict)
    )


def _encoding_rule_for_field(field) -> dict:
    ui_config = getattr(field, "ui_config", None) or {}
    flat_rule = getattr(field, "encoding_rule", None)
    if isinstance(flat_rule, dict):
        return flat_rule
    rule = ui_config.get("encodingRule")
    if isinstance(rule, dict):
        return rule
    return {"enabled": True}


def _date_token_for_rule(rule: dict) -> str:
    pattern = str(rule.get("datePattern") or rule.get("date_pattern") or "YYYYMMDD")
    now = datetime.now()
    replacements = {
        "YYYY": f"{now.year:04d}",
        "yyyy": f"{now.year:04d}",
        "YY": f"{now.year % 100:02d}",
        "yy": f"{now.year % 100:02d}",
        "MM": f"{now.month:02d}",
        "DD": f"{now.day:02d}",
        "dd": f"{now.day:02d}",
    }
    value = pattern
    for token, replacement in replacements.items():
        value = value.replace(token, replacement)
    return re.sub(r"[^0-9A-Za-z]+", "", value)


def _render_code_template(rule: dict, sequence: int) -> str:
    seq_length = max(1, int(rule.get("sequenceLength") or rule.get("sequence_length") or 3))
    prefix = str(rule.get("prefix") or "").strip()
    date_token = _date_token_for_rule(rule)
    template = str(rule.get("template") or "").strip()
    seq_value = str(sequence).zfill(seq_length)
    if template:
        value = template
        value = re.sub(r"\{yyyyMMdd\}|\{YYYYMMDD\}", date_token, value)
        value = re.sub(r"\{date\}", date_token, value, flags=re.IGNORECASE)
        value = re.sub(r"\{seq(?::\d+)?\}", seq_value, value, flags=re.IGNORECASE)
        return value
    return "-".join(part for part in [prefix, date_token, seq_value] if part)


def _code_sequence_from_value(value: Any, rule: dict) -> int:
    text_value = str(value or "")
    if not text_value:
        return 0
    seq_length = max(1, int(rule.get("sequenceLength") or rule.get("sequence_length") or 3))
    pattern = re.compile(rf"(\d{{{seq_length},}})$")
    match = pattern.search(text_value)
    return int(match.group(1)) if match else 0


def _rule_code_embeds_date(rule: dict) -> bool:
    """Whether rendered codes embed a date token (and therefore reset per period)."""
    template = str(rule.get("template") or "").strip()
    if not template:
        return True  # default format is prefix-date-seq
    return bool(re.search(r"\{(?:yyyymmdd|date)\}", template, flags=re.IGNORECASE))


def _sequence_period_key(rule: dict) -> str:
    """Counter scope key: the rendered date token for date-bearing rules, else ''."""
    return _date_token_for_rule(rule) if _rule_code_embeds_date(rule) else ""
