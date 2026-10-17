"""Auto-encoding (料号/业务编号) rule helpers. Pure functions, no DB access."""
from __future__ import annotations

import re
import hashlib
import json
from datetime import datetime
from typing import Any

from fastapi import HTTPException


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
    if pattern == "none":
        return ""
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


def _matches_encoding_condition(condition: dict, data: dict) -> bool:
    actual = data.get(condition.get("sourceField"))
    expected = condition.get("value", "")
    operator = condition.get("operator", "eq")
    if operator == "isEmpty":
        return actual is None or actual == "" or actual == []
    if operator == "notEmpty":
        return actual is not None and actual != "" and actual != []
    if operator == "eq":
        return str(actual if actual is not None else "") == str(expected)
    if operator == "ne":
        return str(actual if actual is not None else "") != str(expected)
    if operator == "contains":
        return str(expected) in str(actual if actual is not None else "")
    if operator in ("gte", "lte"):
        try:
            return float(actual) >= float(expected) if operator == "gte" else float(actual) <= float(expected)
        except (TypeError, ValueError):
            return False
    return False


def _select_encoding_rule(rule: dict, data: dict) -> dict:
    if rule.get("enabled") is False or not isinstance(rule.get("rules"), list):
        return rule
    if not any(candidate.get("enabled") is not False for candidate in rule["rules"]):
        return {"enabled": False}
    for candidate in rule["rules"]:
        if candidate.get("enabled") is not False and all(
            _matches_encoding_condition(condition, data) for condition in candidate.get("conditions", [])
        ):
            selected = dict(candidate)
            if any(segment.get("resetCycle") == "dependency" for segment in selected.get("segments", [])):
                sources = selected.get("dependencies") or [segment.get("sourceField") for segment in selected.get("segments", []) if segment.get("sourceField")]
                selected["_dependencyScope"] = hashlib.sha256(json.dumps(
                    [data.get(source) for source in sources], sort_keys=True, default=str).encode()).hexdigest()[:16]
            return selected
    raise HTTPException(422, "没有满足条件的编码规则，请检查编码规则的触发条件")


def _render_code_template(rule: dict, sequence: int, data: dict | None = None) -> str:
    segments = rule.get("segments")
    if isinstance(segments, list) and segments:
        parts = []
        for segment in segments:
            kind = segment.get("type")
            length = max(1, int(segment.get("length") or 1))
            padding = segment.get("padding", "none")
            if kind == "fixed":
                value = str(segment.get("value") or "")
            elif kind == "date":
                value = _date_token_for_rule(segment)
            elif kind == "sequence":
                value = str(int(segment.get("sequenceStart") or 1) + (sequence - 1) * int(segment.get("sequenceStep") or 1))
                padding = segment.get("padding") or "leftZero"
            else:
                source = segment.get("sourceField") or segment.get("sourceAttribute")
                raw = (data or {}).get(source)
                if isinstance(raw, dict):
                    raw = raw.get(segment.get("sourceAttribute") or "code")
                if raw is None or raw == "":
                    raise HTTPException(422, f"编码段 {segment.get('name', source)} 缺少来源值")
                value = str(raw)
            if padding == "truncate":
                value = value[:length]
            elif padding == "leftZero":
                value = value.zfill(length)
            elif padding == "rightZero":
                value = value.ljust(length, "0")
            parts.append(value)
        return "".join(parts)

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
    if rule.get("segments"):
        pattern = []
        sequence_segment = None
        for segment in rule["segments"]:
            if segment.get("type") == "fixed":
                raw = str(segment.get("value") or "")
                length = max(1, int(segment.get("length") or 1))
                padding = segment.get("padding")
                raw = raw[:length] if padding == "truncate" else raw.zfill(length) if padding == "leftZero" else raw.ljust(length, "0") if padding == "rightZero" else raw
                pattern.append(re.escape(raw))
            elif segment.get("type") == "date":
                pattern.append(re.escape(_date_token_for_rule(segment)))
            elif segment.get("type") == "sequence" and sequence_segment is None:
                sequence_segment = segment
                pattern.append(r"(\d+)")
            else:
                pattern.append(r".+?")
        match = re.fullmatch("".join(pattern), str(value or ""))
        if match and sequence_segment:
            start = int(sequence_segment.get("sequenceStart") or 1)
            step = max(1, int(sequence_segment.get("sequenceStep") or 1))
            return max(0, (int(match.group(1)) - start) // step + 1)
        return 0
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
    if isinstance(rule.get("segments"), list) and rule["segments"]:
        sequence = next((s for s in rule["segments"] if s.get("type") == "sequence"), {})
        cycle = sequence.get("resetCycle") or rule.get("resetCycle") or "never"
        period = datetime.now().strftime({"day": "%Y%m%d", "month": "%Y%m", "year": "%Y"}.get(cycle, "")) if cycle != "never" else ""
        if cycle == "dependency":
            period = rule.get("_dependencyScope", "")
        identity = hashlib.sha256(str(rule["id"]).encode()).hexdigest()[:20] if rule.get("id") else ""
        return f"rule:{identity}:{period}" if identity else period
    return _date_token_for_rule(rule) if _rule_code_embeds_date(rule) else ""
