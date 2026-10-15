"""Application Agent runtime: the official DeepSeek Harness kernel only."""
from __future__ import annotations
from .harness_runtime import HarnessRuntime
from .intent_router import route_intent

class AgentRuntime(HarnessRuntime):
    def classify_knowledge_intent(self, query: str) -> str:
        # Cheap retrieval classification is a knowledge service helper, not a
        # second Agent planner or execution loop.
        route = route_intent(query, {})
        return "knowledge" if route.intent in {"knowledge", "business_query", "page_help"} else "general"

agent_runtime = AgentRuntime()
