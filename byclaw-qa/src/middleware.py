"""Middleware for controlling agent output language."""

from __future__ import annotations

from typing import Any

from langchain.agents.middleware import AgentMiddleware, Runtime
from langchain.agents.middleware.types import ModelRequest, ModelResponse
from langchain_core.messages import AIMessage, SystemMessage
from langgraph.typing import ContextT, StateT

from by_qa.qa.common.config import AgentOverride
from by_qa.qa.engines.instant.types import AgentNames


LANGUAGE_DISPLAY_NAMES: dict[str, str] = {
    "zh_CN": "Chinese",
    "en_US": "English",
}


class LanguageMiddleware(AgentMiddleware):
    """Append a fixed output-language instruction to the agent system prompt."""

    def __init__(self, language: str) -> None:
        self.language = language.strip()

    def _build_system_message(
        self, request: ModelRequest[Any]
    ) -> SystemMessage | None:
        if not self.language:
            return request.system_message

        language_instruction = (
            "\n\n## Output Language\n"
            f"Always respond in {self.language}. "
            "Do not switch to another language unless the user explicitly asks you to."
        )

        existing = request.system_prompt or ""
        return SystemMessage(content=f"{existing}{language_instruction}")

    async def abefore_model(self, state: StateT, runtime: Runtime[ContextT]):
        pass

    def wrap_model_call(
        self,
        request: ModelRequest[Any],
        handler,
    ) -> ModelResponse[Any] | AIMessage:
        return handler(
            request.override(system_message=self._build_system_message(request))
        )

    async def awrap_model_call(
        self,
        request: ModelRequest[Any],
        handler,
    ) -> ModelResponse[Any] | AIMessage:
        return await handler(
            request.override(system_message=self._build_system_message(request))
        )


def build_agent_overrides(lang: str) -> dict[str, AgentOverride]:
    """Build agent overrides that apply LanguageMiddleware to all InstantQAEngine agents."""
    display_name = LANGUAGE_DISPLAY_NAMES.get(lang, lang)
    middleware = [LanguageMiddleware(display_name)]
    return {
        agent_type: AgentOverride(middleware=middleware)
        for agent_type in AgentNames
    }
