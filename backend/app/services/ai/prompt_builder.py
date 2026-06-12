"""Prompt construction for the enterprise Agent runtime."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from .agent_definition import load_agent_system_prompt
from .schemas import ChatMessage
from .tenant_profile import TenantProfile, default_tenant_profile


PromptMode = Literal["chat", "agent", "knowledge", "extraction"]


class PromptBuildInput(BaseModel):
    mode: PromptMode = "agent"
    tenant_profile: TenantProfile = Field(default_factory=default_tenant_profile)
    user_context: dict[str, Any] = Field(default_factory=dict)
    page_context: dict[str, Any] = Field(default_factory=dict)
    task_context: dict[str, Any] = Field(default_factory=dict)
    evidence: list[dict[str, Any]] = Field(default_factory=list)
    memory: list[dict[str, Any]] = Field(default_factory=list)
    history: list[ChatMessage] = Field(default_factory=list)
    tool_policy: dict[str, Any] = Field(default_factory=dict)
    output_contract: str | None = None
    user_message: str


class PromptBuilder:
    version = "agent-runtime-v1"

    def build(self, data: PromptBuildInput) -> list[ChatMessage]:
        system = "\n".join(
            [
                self._base_system(data),
                self._tenant_block(data.tenant_profile),
                self._mode_block(data.mode),
                self._tool_policy_block(data.tool_policy),
            ]
        )
        context = "\n\n".join(
            part
            for part in [
                self._page_block(data.page_context),
                self._memory_block(data.memory),
                self._evidence_block(data.evidence),
                self._history_block(data.history),
                self._output_contract_block(data.output_contract),
            ]
            if part
        )
        user_content = f"{context}\n\n用户问题：{data.user_message}" if context else data.user_message
        return [ChatMessage(role="system", content=system), ChatMessage(role="user", content=user_content)]

    def _base_system(self, data: PromptBuildInput) -> str:
        return load_agent_system_prompt() or (
            "你是企业平台 AI Agent。普通交流自然回答；涉及企业事实时优先使用证据和记忆。"
            "写入、发布、流程启动等动作必须先确认。不要泄露密钥、连接串或内部审计细节。"
        )

    def _tenant_block(self, profile: TenantProfile) -> str:
        terms = "；".join(f"{key}={value}" for key, value in profile.terminology.items()) or "暂无额外术语"
        return (
            f"租户/企业：{profile.display_name}\n"
            f"产品/平台名：{profile.product_name}\n"
            f"助手名称：{profile.assistant_name}\n"
            f"行业：{profile.industry}\n"
            f"默认语言：{profile.locale}\n"
            f"术语：{terms}"
        )

    def _mode_block(self, mode: PromptMode) -> str:
        if mode == "knowledge":
            return (
                "知识库模式：回答应围绕当前文档、知识证据和企业上下文。"
                "使用证据时在句末标注 [S1]、[S2]。记忆引用标注 [M1]。"
                "用户询问你是谁或模型是什么时，应基于租户身份和当前模型配置自然说明，不要硬编码公司名。"
            )
        if mode == "extraction":
            return "知识抽取模式：优先输出结构化实体、关系、字段和证据段落。"
        return "Agent 模式：可以回答问题、解释判断，也可以提出工具动作 proposal，但写入动作必须等待确认。"

    def _tool_policy_block(self, policy: dict[str, Any]) -> str:
        if not policy:
            return "工具策略：只读检索可自动执行；草稿可生成；写入、发布、流程启动必须确认。"
        return f"工具策略：{policy}"

    def _page_block(self, page_context: dict[str, Any]) -> str:
        if not page_context:
            return ""
        return f"当前页面上下文：{page_context}"

    def _memory_block(self, memory: list[dict[str, Any]]) -> str:
        if not memory:
            return ""
        lines = ["可用长期/会话记忆："]
        for index, item in enumerate(memory[:8], start=1):
            summary = item.get("summary") or item.get("content") or item.get("value") or ""
            lines.append(f"[M{index}] {str(summary)[:500]}")
        return "\n".join(lines)

    def _evidence_block(self, evidence: list[dict[str, Any]]) -> str:
        if not evidence:
            return "知识证据：当前没有检索到强匹配证据。"
        lines = ["知识证据："]
        for index, item in enumerate(evidence[:8], start=1):
            title = item.get("title") or item.get("document_title") or item.get("source_file_name") or item.get("document_id")
            snippet = item.get("snippet") or item.get("chunk_text") or item.get("summary") or ""
            lines.append(f"[S{index}] {title}\n{str(snippet)[:1000]}")
        return "\n\n".join(lines)

    def _history_block(self, history: list[ChatMessage]) -> str:
        if not history:
            return ""
        lines = ["最近对话："]
        for item in history[-8:]:
            lines.append(f"{item.role}: {item.content[:500]}")
        return "\n".join(lines)

    def _output_contract_block(self, output_contract: str | None) -> str:
        return f"输出要求：{output_contract}" if output_contract else ""

    def build_agent_prompt(
        self,
        *,
        user: dict[str, Any],
        tenant_profile: Any,
        page_context: dict[str, Any],
        knowledge_evidence: list[dict[str, Any]] | None = None,
        memory: list[dict[str, Any]] | None = None,
        history: list[ChatMessage] | None = None,
        user_message: str = "",
    ) -> list[ChatMessage]:
        """Build messages for the LLM-driven tool_use agent loop.

        Returns a list starting with a system message and ending with the user message.
        The system prompt includes role definition, tenant context, safety rules,
        and tool usage guidelines.
        """
        system_parts = [
            self._agent_system_block(),
            self._tenant_block(tenant_profile),
            self._agent_user_block(user),
            self._agent_safety_block(),
        ]

        system_content = "\n\n".join(part for part in system_parts if part)

        # Build user context from page, evidence, memory, history
        context_parts = []
        page_block = self._page_block(page_context)
        if page_block:
            context_parts.append(page_block)

        if knowledge_evidence:
            context_parts.append(self._evidence_block(knowledge_evidence))

        if memory:
            context_parts.append(self._memory_block(memory))

        if history:
            context_parts.append(self._history_block(history))

        if context_parts:
            user_content = "\n\n".join(context_parts) + f"\n\n用户问题：{user_message}"
        else:
            user_content = user_message

        return [
            ChatMessage(role="system", content=system_content),
            ChatMessage(role="user", content=user_content),
        ]

    def _agent_system_block(self) -> str:
        return (
            "你是 ManuFoundry 企业平台的 AI Agent。\n\n"
            "你可以使用工具来查询和分析制造数据、管理表单、创建草稿、查询知识库等。\n"
            "你的核心原则：\n"
            "- 普通对话自然回答\n"
            "- 涉及企业数据时，优先使用工具获取实时数据，而不是猜测\n"
            "- 缺少必要参数时，直接向用户询问，不要假设值\n"
            "- 写入、删除、流程启动等操作必须等待用户确认\n"
            "- 不要声称已经执行了未经确认的写入操作\n"
            "- 不要泄露 API 密钥、密码、连接串或内部审计细节\n"
            "- 使用知识证据时标注 [S1]、[S2]，使用记忆时标注 [M1]\n"
            "- 用中文回答"
        )

    def _agent_user_block(self, user: dict[str, Any]) -> str:
        parts = [f"当前用户：{user.get('sub') or user.get('username') or '未知'}"]
        roles = user.get("roles", [])
        if roles:
            role_names = [
                r.get("label") or r.get("name") or str(r)
                for r in roles
                if isinstance(r, dict)
            ]
            if not role_names:
                role_names = [str(r) for r in roles if isinstance(r, str)]
            if role_names:
                parts.append(f"用户角色：{', '.join(role_names)}")
        if user.get("is_admin"):
            parts.append("权限：管理员")
        return "\n".join(parts)

    def _agent_safety_block(self) -> str:
        return (
            "安全规则：\n"
            "- 涉及写入、删除、发布、流程启动的工具，系统会在执行前要求用户确认\n"
            "- 你无法绕过确认机制，也不应该告诉用户可以绕过\n"
            "- 如果工具返回错误，向用户如实说明错误原因\n"
            "- 如果工具返回权限不足，告诉用户需要什么角色才能执行"
        )

    def build_agent_prompt_layered(
        self,
        *,
        user: dict[str, Any],
        tenant_profile: Any,
        page_context: dict[str, Any],
        knowledge_evidence: list[dict[str, Any]] | None = None,
        memory: list[dict[str, Any]] | None = None,
        history: list[ChatMessage] | None = None,
        user_message: str = "",
    ) -> "LayeredContext":
        """Build a LayeredContext for the agent loop.

        Each context block is placed in its own named layer with a trim priority.
        """
        from .context_layers import ContextLayer, LayeredContext

        ctx = LayeredContext()

        # SYSTEM layer (priority 100, never trimmed)
        system_content = "\n\n".join(part for part in [
            self._agent_system_block(),
            self._tenant_block(tenant_profile),
            self._agent_user_block(user),
            self._agent_safety_block(),
        ] if part)
        ctx.add_layer(ContextLayer.SYSTEM, [ChatMessage(role="system", content=system_content)])

        # EVIDENCE layer (priority 40)
        if knowledge_evidence:
            ctx.add_layer(ContextLayer.EVIDENCE, [ChatMessage(
                role="user",
                content=self._evidence_block(knowledge_evidence),
            )])

        # MEMORY layer (priority 50)
        if memory:
            ctx.add_layer(ContextLayer.MEMORY, [ChatMessage(
                role="user",
                content=self._memory_block(memory),
            )])

        # HISTORY layer (priority 30, trimmed first)
        if history:
            history_messages = [ChatMessage(role=h.role, content=h.content[:500]) for h in history[-8:]]
            ctx.add_layer(ContextLayer.HISTORY, history_messages)

        # CURRENT_TURN layer (priority 70)
        context_parts = []
        page_block = self._page_block(page_context)
        if page_block:
            context_parts.append(page_block)
        user_content = "\n\n".join(context_parts) + f"\n\n用户问题：{user_message}" if context_parts else user_message
        ctx.add_layer(ContextLayer.CURRENT_TURN, [ChatMessage(role="user", content=user_content)])

        return ctx
