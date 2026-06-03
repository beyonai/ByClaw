"""Middleware for controlling agent output language."""

from __future__ import annotations

import json
from typing import Any

from langchain.agents.middleware import AgentMiddleware, Runtime
from langchain.agents.middleware.types import ModelRequest, ModelResponse
from langchain_core.messages import AIMessage, SystemMessage
from langgraph.typing import ContextT, StateT

from by_qa.core import logger
from by_qa.qa.common.config import AgentOverride
from by_qa.qa.engines.instant.types import AgentNames


LANGUAGE_DISPLAY_NAMES: dict[str, str] = {
    "zh_CN": "Chinese",
    "en_US": "English",
}

CORE_PERSONA_AGENT_MAPPING: dict[str, Any] = {
    "questionDecompose": AgentNames.DECOMPOSER,
    "singleHop": AgentNames.SINGLE_HOP,
    "multiHopSearch": AgentNames.MULTI_HOP,
    "multiHopSummary": AgentNames.MULTI_HOP_SUMMARY,
    "subanswerAggregator": AgentNames.AGGREGATOR,
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


def _agent_name_value(agent_name: Any) -> str:
    return getattr(agent_name, "value", str(agent_name))


def _build_agent_override(
    middleware: list[AgentMiddleware],
    system_prompt: str | None = None,
) -> AgentOverride:
    if not system_prompt:
        return AgentOverride(middleware=middleware)
    return AgentOverride(middleware=middleware, prompt=system_prompt)


def _extract_core_persona_prompts(
    employee_config: dict[str, Any] | None,
) -> dict[str, str]:
    if not employee_config:
        return {}

    raw_core_persona = employee_config.get("corePersonaDefinition")
    if not raw_core_persona:
        return {}

    try:
        core_persona_items = (
            json.loads(raw_core_persona)
            if isinstance(raw_core_persona, str)
            else raw_core_persona
        )
    except json.JSONDecodeError as exc:
        logger.warning("Failed to parse corePersonaDefinition: %s", exc)
        return {}

    if not isinstance(core_persona_items, list):
        logger.warning(
            "corePersonaDefinition should be a list, got %s",
            type(core_persona_items).__name__,
        )
        return {}

    prompt_overrides: dict[str, str] = {}
    for item in core_persona_items:
        if not isinstance(item, dict):
            continue

        persona_key = str(item.get("key") or "").strip()
        prompt_text = str(item.get("value") or "").strip()
        if not persona_key or not prompt_text:
            continue

        agent_name = CORE_PERSONA_AGENT_MAPPING.get(persona_key)
        if agent_name is None:
            continue

        prompt_overrides[_agent_name_value(agent_name)] = prompt_text

    return prompt_overrides


def build_agent_overrides(
    lang: str,
    employee_config: dict[str, Any] | None = None,
) -> dict[str, AgentOverride]:
    """Build per-agent overrides for language middleware and optional prompt replacement."""
    display_name = LANGUAGE_DISPLAY_NAMES.get(lang, lang)
    middleware = [LanguageMiddleware(display_name)]
    prompt_overrides = _extract_core_persona_prompts(employee_config)
    return {
        _agent_name_value(agent_type): _build_agent_override(
            middleware=middleware,
            system_prompt=prompt_overrides.get(_agent_name_value(agent_type)),
        )
        for agent_type in AgentNames
    }
