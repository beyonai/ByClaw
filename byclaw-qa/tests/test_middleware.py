import importlib
import importlib.util
import json
import sys
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from types import ModuleType
from unittest.mock import MagicMock, patch


class _AgentNames(Enum):
    DECOMPOSER = "decomposer"
    SINGLE_HOP = "single_hop"
    MULTI_HOP = "multi_hop"
    MULTI_HOP_SUMMARY = "multi_hop_summary"
    AGGREGATOR = "aggregator"


class _AgentMiddleware:
    pass


class _Runtime:
    def __class_getitem__(cls, item):
        return cls


class _ModelRequest:
    def __class_getitem__(cls, item):
        return cls


class _ModelResponse:
    def __class_getitem__(cls, item):
        return cls


class _AIMessage:
    pass


class _SystemMessage:
    def __init__(self, content):
        self.content = content


@dataclass
class _AgentOverride:
    middleware: list
    prompt: str | None = None


def _load_middleware_module(agent_override_cls=_AgentOverride):
    logger_mock = MagicMock()

    middleware_base_module = ModuleType("langchain.agents.middleware")
    middleware_base_module.AgentMiddleware = _AgentMiddleware
    middleware_base_module.Runtime = _Runtime

    middleware_types_module = ModuleType("langchain.agents.middleware.types")
    middleware_types_module.ModelRequest = _ModelRequest
    middleware_types_module.ModelResponse = _ModelResponse

    messages_module = ModuleType("langchain_core.messages")
    messages_module.AIMessage = _AIMessage
    messages_module.SystemMessage = _SystemMessage

    typing_module = ModuleType("langgraph.typing")
    typing_module.ContextT = object
    typing_module.StateT = object

    core_module = ModuleType("by_qa.core")
    core_module.logger = logger_mock

    config_module = ModuleType("by_qa.qa.common.config")
    config_module.AgentOverride = agent_override_cls

    types_module = ModuleType("by_qa.qa.engines.instant.types")
    types_module.AgentNames = _AgentNames

    mocked_modules = {
        "langchain.agents.middleware": middleware_base_module,
        "langchain.agents.middleware.types": middleware_types_module,
        "langchain_core.messages": messages_module,
        "langgraph.typing": typing_module,
        "by_qa.core": core_module,
        "by_qa.qa.common.config": config_module,
        "by_qa.qa.engines.instant.types": types_module,
    }

    with patch.dict(sys.modules, mocked_modules):
        sys.modules.pop("middleware", None)
        module_path = (
            Path(__file__).resolve().parents[1] / "src" / "middleware.py"
        )
        spec = importlib.util.spec_from_file_location("middleware", module_path)
        module = importlib.util.module_from_spec(spec)
        assert spec is not None
        assert spec.loader is not None
        sys.modules["middleware"] = module
        spec.loader.exec_module(module)
    return module, logger_mock


def test_build_agent_overrides_applies_core_persona_prompts():
    middleware_module, _ = _load_middleware_module()
    employee_config = {
        "corePersonaDefinition": json.dumps(
            [
                {"key": "questionDecompose", "value": "decomposer prompt"},
                {"key": "singleHop", "value": "single hop prompt"},
                {"key": "multiHopSearch", "value": "multi hop prompt"},
                {"key": "multiHopSummary", "value": "summary prompt"},
                {"key": "subanswerAggregator", "value": "aggregator prompt"},
            ]
        )
    }

    overrides = middleware_module.build_agent_overrides("zh_CN", employee_config)

    assert overrides["decomposer"].prompt == "decomposer prompt"
    assert overrides["single_hop"].prompt == "single hop prompt"
    assert overrides["multi_hop"].prompt == "multi hop prompt"
    assert overrides["multi_hop_summary"].prompt == "summary prompt"
    assert overrides["aggregator"].prompt == "aggregator prompt"
    assert overrides["decomposer"].middleware[0].language == "Chinese"


def test_build_agent_overrides_skips_null_or_empty_prompts():
    middleware_module, _ = _load_middleware_module()
    employee_config = {
        "corePersonaDefinition": json.dumps(
            [
                {"key": "questionDecompose", "value": None},
                {"key": "singleHop", "value": ""},
                {"key": "multiHopSearch", "value": "   "},
                {"key": "multiHopSummary", "value": "summary prompt"},
                {"key": "subanswerAggregator", "value": "aggregator prompt"},
            ]
        )
    }

    overrides = middleware_module.build_agent_overrides("en_US", employee_config)

    assert overrides["decomposer"].prompt is None
    assert overrides["single_hop"].prompt is None
    assert overrides["multi_hop"].prompt is None
    assert overrides["multi_hop_summary"].prompt == "summary prompt"
    assert overrides["aggregator"].prompt == "aggregator prompt"
    assert overrides["aggregator"].middleware[0].language == "English"
