"""Validation loop for Agent confirmations and tool execution."""

from __future__ import annotations

import fnmatch
from dataclasses import dataclass, field
from typing import Any, Literal

from .agent_items import validation_item
from .settings import safety_policy_snapshot
from .tool_registry import get_tool
from .skills import get_skill


ValidationPhase = Literal["pre_confirmation", "pre_tool", "post_tool"]
ValidationSeverity = Literal["warning", "error"]


@dataclass
class ValidationIssue:
    severity: ValidationSeverity
    code: str
    message: str
    field: str | None = None
    tool: str | None = None
    action_index: int | None = None
    rule_id: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            key: value
            for key, value in {
                "severity": self.severity,
                "code": self.code,
                "message": self.message,
                "field": self.field,
                "tool": self.tool,
                "action_index": self.action_index,
                "rule_id": self.rule_id,
            }.items()
            if value is not None
        }


@dataclass
class ValidationResult:
    phase: ValidationPhase
    issues: list[ValidationIssue] = field(default_factory=list)
    tool: str | None = None
    skill: str | None = None

    @property
    def valid(self) -> bool:
        return not any(issue.severity == "error" for issue in self.issues)

    @property
    def warnings(self) -> list[ValidationIssue]:
        return [issue for issue in self.issues if issue.severity == "warning"]

    @property
    def errors(self) -> list[ValidationIssue]:
        return [issue for issue in self.issues if issue.severity == "error"]

    def as_item(self, *, run_id: str | None = None, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        return validation_item(
            phase=self.phase,
            status="completed" if self.valid else "failed",
            summary=self.summary(),
            issues=[issue.as_dict() for issue in self.issues],
            run_id=run_id,
            tool=self.tool,
            skill=self.skill,
            payload=payload,
        )

    def summary(self) -> str:
        if self.errors:
            return f"{len(self.errors)} validation error(s)"
        if self.warnings:
            return f"{len(self.warnings)} validation warning(s)"
        return "Validation passed"


class AgentValidationService:
    """Validates planned actions, tool payloads, and tool results."""

    def validate_confirmation(
        self,
        *,
        actions: list[dict[str, Any]],
        settings: dict[str, Any] | None = None,
    ) -> ValidationResult:
        issues: list[ValidationIssue] = []
        if not actions:
            issues.append(ValidationIssue("error", "no_actions", "No actions were prepared for confirmation"))
        for index, action in enumerate(actions):
            skill = str(action.get("skill") or "")
            payload = action.get("payload")
            tool = self._tool_for_action(action)
            if not skill:
                issues.append(ValidationIssue("error", "missing_skill", "Action is missing skill", action_index=index))
            if not isinstance(payload, dict):
                issues.append(ValidationIssue("error", "invalid_payload", "Action payload must be an object", tool=tool, action_index=index))
            if tool and not get_tool(tool):
                issues.append(ValidationIssue("warning", "tool_not_registered", f"{tool} is not registered", tool=tool, action_index=index))
            issues.extend(self._apply_rules("pre_confirmation", tool or skill, payload if isinstance(payload, dict) else {}, settings, action_index=index))
        return ValidationResult(phase="pre_confirmation", issues=issues)

    def validate_tool_payload(
        self,
        *,
        tool_name: str,
        payload: dict[str, Any],
        settings: dict[str, Any] | None = None,
        skill_name: str | None = None,
    ) -> ValidationResult:
        issues: list[ValidationIssue] = []
        tool_def = get_tool(tool_name)
        if not tool_def:
            issues.append(ValidationIssue("warning", "tool_not_registered", f"{tool_name} is not registered", tool=tool_name))
        elif tool_def.side_effect != "read" and not payload:
            issues.append(ValidationIssue("error", "empty_write_payload", "Write tools require a non-empty payload", tool=tool_name))
        issues.extend(self._validate_declared_input_schema(tool_name, payload))
        issues.extend(self._apply_rules("pre_tool", tool_name, payload, settings))
        return ValidationResult(phase="pre_tool", issues=issues, tool=tool_name, skill=skill_name)

    def validate_tool_result(
        self,
        *,
        tool_name: str,
        result: dict[str, Any],
        settings: dict[str, Any] | None = None,
        skill_name: str | None = None,
    ) -> ValidationResult:
        issues: list[ValidationIssue] = []
        tool_def = get_tool(tool_name)
        status = str(result.get("status") or "")
        if status in {"failed", "error", "not_implemented", "timeout"}:
            issues.append(ValidationIssue("error", f"tool_{status}", f"{tool_name} returned {status}", tool=tool_name))
        if tool_def and tool_def.side_effect != "read":
            expected = self._expected_result_keys(tool_name)
            if expected and not any(key in result for key in expected):
                issues.append(
                    ValidationIssue(
                        "error",
                        "missing_side_effect_evidence",
                        f"{tool_name} result does not include expected side-effect evidence",
                        tool=tool_name,
                    )
                )
        issues.extend(self._apply_rules("post_tool", tool_name, result, settings))
        return ValidationResult(phase="post_tool", issues=issues, tool=tool_name, skill=skill_name)

    def enabled(self, hook_name: str, settings: dict[str, Any] | None) -> bool:
        enabled_hooks = set(safety_policy_snapshot(settings).get("enabledHooks") or [])
        return hook_name in enabled_hooks

    def _validate_declared_input_schema(self, tool_name: str, payload: dict[str, Any]) -> list[ValidationIssue]:
        tool_def = get_tool(tool_name)
        if not tool_def:
            return []
        schema = tool_def.input_schema or {}
        required = schema.get("required") if isinstance(schema.get("required"), list) else []
        issues: list[ValidationIssue] = []
        for field_name in required:
            if field_name not in payload or payload.get(field_name) in (None, ""):
                issues.append(ValidationIssue("error", "required_field_missing", f"{field_name} is required", field=str(field_name), tool=tool_name))
        return issues

    def _apply_rules(
        self,
        phase: str,
        tool_name: str,
        payload: dict[str, Any],
        settings: dict[str, Any] | None,
        *,
        action_index: int | None = None,
    ) -> list[ValidationIssue]:
        policy = safety_policy_snapshot(settings)
        issues: list[ValidationIssue] = []
        for index, rule in enumerate(policy.get("validationRules") or []):
            if not isinstance(rule, dict):
                continue
            if str(rule.get("phase") or phase) != phase:
                continue
            pattern = str(rule.get("tool") or rule.get("toolPattern") or "*")
            if tool_name and not fnmatch.fnmatch(tool_name, pattern):
                continue
            issue = self._evaluate_rule(rule, payload, tool_name=tool_name, index=index, action_index=action_index)
            if issue:
                issues.append(issue)
        return issues

    def _evaluate_rule(
        self,
        rule: dict[str, Any],
        payload: dict[str, Any],
        *,
        tool_name: str,
        index: int,
        action_index: int | None,
    ) -> ValidationIssue | None:
        rule_type = str(rule.get("ruleType") or rule.get("type") or "field_required")
        field_name = str(rule.get("field") or "")
        severity = "warning" if str(rule.get("severity") or "warning") == "warning" else "error"
        message = str(rule.get("message") or f"Validation rule {index + 1} failed")
        value = self._nested_value(payload, field_name) if field_name else None

        failed = False
        if rule_type == "field_required":
            failed = not field_name or value in (None, "", [], {})
        elif rule_type == "field_equals":
            failed = value != rule.get("value")
        elif rule_type == "min_number":
            failed = not self._compare_number(value, rule.get("value"), lambda actual, expected: actual >= expected)
        elif rule_type == "max_number":
            failed = not self._compare_number(value, rule.get("value"), lambda actual, expected: actual <= expected)
        elif rule_type == "non_empty_result":
            failed = not payload
        else:
            return None

        if not failed:
            return None
        return ValidationIssue(
            severity=severity,  # type: ignore[arg-type]
            code=rule_type,
            message=message,
            field=field_name or None,
            tool=tool_name or None,
            action_index=action_index,
            rule_id=str(rule.get("id") or index),
        )

    @staticmethod
    def _nested_value(payload: dict[str, Any], path: str) -> Any:
        current: Any = payload
        for part in path.split("."):
            if not isinstance(current, dict):
                return None
            current = current.get(part)
        return current

    @staticmethod
    def _compare_number(value: Any, expected: Any, predicate) -> bool:
        try:
            return bool(predicate(float(value), float(expected)))
        except (TypeError, ValueError):
            return False

    @staticmethod
    def _tool_for_action(action: dict[str, Any]) -> str:
        payload = action.get("payload") if isinstance(action.get("payload"), dict) else {}
        contract = payload.get("_contract") if isinstance(payload.get("_contract"), dict) else {}
        if contract.get("tool"):
            return str(contract["tool"])
        skill = str(action.get("skill") or "")
        skill_def = get_skill(skill)
        if skill_def and skill_def.default_tool:
            return skill_def.default_tool
        return ""

    @staticmethod
    def _expected_result_keys(tool_name: str) -> set[str]:
        if tool_name == "forms.create_form_definition":
            return {"form", "route_path"}
        if tool_name == "forms.add_form_field":
            return {"fields", "changed_layouts"}
        if tool_name == "forms.create_dynamic_record_draft":
            return {"record_id", "draft_id", "form_code"}
        if tool_name == "workflow.start":
            return {"workflow_id", "instance_id"}
        if tool_name == "notifications.create":
            return {"notification_id"}
        return set()


agent_validation_service = AgentValidationService()
