import sys
import pytest
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch


# Set up NodeNames mock values before importing worker
_node_names_mock = MagicMock()
_node_names_mock.DECOMPOSER.value = "decomposer"
_node_names_mock.FINAL_ANSWER.value = "final_answer"
_node_names_mock.SUBANSWER_AGGREGATOR.value = "subanswer_aggregator"
_node_names_mock.SINGLE_HOP_WORKER.value = "single_hop_worker"
_node_names_mock.MULTI_HOP_WORKER.value = "multi_hop_worker"
_node_names_mock.MULTI_HOP_AGENT.value = "multi_hop_agent"
_node_names_mock.MULTI_HOP_SUMMARY.value = "multi_hop_summary"
_node_names_mock.SINGLE_HOP_AGENT.value = "single_hop_agent"

_node_enum_mock = MagicMock()
_node_enum_mock.NodeNames = _node_names_mock

_stream_event_type_mock = MagicMock()
_stream_event_type_mock.NODE_END.value = "node_end"
_stream_event_type_mock.NODE_START.value = "node_start"

_operation_type_mock = MagicMock()
_operation_type_mock.SEARCH = "search-op"

_search_spec_mock = MagicMock()
_search_spec_mock.tool_name = "search_knowledge"

_operation_registry_mock = {_operation_type_mock.SEARCH: _search_spec_mock}

_operation_registry_module = ModuleType("by_qa.qa.instant.runtime.operation_registry")
_operation_registry_module.OperationType = _operation_type_mock
_operation_registry_module.OPERATION_REGISTRY = _operation_registry_mock

_instant_engine_module = ModuleType("by_qa.qa.instant.engine")
_instant_engine_module.InstantSearchEngine = MagicMock()

_event_type_mock = MagicMock()
_event_type_mock.EventType.ANSWER_DELTA.value = "answer_delta"
_event_type_mock.EventType.REASONING_LOG_DELTA.value = "reasoning_log_delta"

_sse_mock = MagicMock()
_sse_mock.SseReasonMessageType.think_title.value = "think_title"

_worker_mod_mock = MagicMock()


class _GatewayWorker:
    pass


_worker_mod_mock.GatewayWorker = _GatewayWorker

_by_framework_mock = ModuleType("by_framework")
_by_framework_common_mock = ModuleType("by_framework.common")
_by_framework_core_mock = ModuleType("by_framework.core")
_by_framework_core_protocol_mock = ModuleType("by_framework.core.protocol")
_by_framework_worker_context_mock = ModuleType("by_framework.worker.context")
_by_framework_worker_context_mock.AskAgentCommand = object
_by_framework_mock.common = _by_framework_common_mock
_by_framework_mock.core = _by_framework_core_mock
_by_framework_mock.worker = _worker_mod_mock
_by_framework_common_mock.emitter = _sse_mock
_by_framework_core_mock.protocol = _by_framework_core_protocol_mock
_by_framework_core_protocol_mock.event_type = _event_type_mock

_mocks = {
    "by_framework": _by_framework_mock,
    "by_framework.common": _by_framework_common_mock,
    "by_framework.common.emitter": _sse_mock,
    "by_framework.core": _by_framework_core_mock,
    "by_framework.core.protocol": _by_framework_core_protocol_mock,
    "by_framework.core.protocol.event_type": _event_type_mock,
    "by_framework.worker": _worker_mod_mock,
    "by_framework.worker.context": _by_framework_worker_context_mock,
    "by_framework.util": MagicMock(),
    "by_framework.util.http_client": MagicMock(),
    "by_framework.util.discovery_http_client": MagicMock(),
    "by_framework.core.discovery": MagicMock(),
    "by_framework.core.extensions": MagicMock(),
    "by_qa": MagicMock(),
    "by_qa.core": MagicMock(),
    "by_qa.qa": MagicMock(),
    "by_qa.qa.common": MagicMock(),
    "by_qa.qa.common.models": MagicMock(StreamEventType=_stream_event_type_mock),
    "by_qa.qa.instant": MagicMock(),
    "by_qa.qa.instant.engine": _instant_engine_module,
    "by_qa.qa.instant.nodes": MagicMock(),
    "by_qa.qa.instant.nodes.node_enum": _node_enum_mock,
    "by_qa.qa.instant.runtime": MagicMock(),
    "by_qa.qa.instant.runtime.operation_registry": _operation_registry_module,
    "redis_agent_config": MagicMock(),
    "minio_agent_config": MagicMock(),
    "minio_client": MagicMock(),
    "by_qa.qa.services": MagicMock(),
    "by_qa.qa.services.llm_service": MagicMock(),
    "redis_model_config": MagicMock(),
}

with patch.dict(sys.modules, _mocks):
    import worker as worker_module
    from worker import InstantSearchWorker, convert_node_name_to_title, parse_dataset_ids

# Keep worker accessible for patch("worker.ByHttpClient", ...) style patches
sys.modules.setdefault("worker", worker_module)


# --- parse_dataset_ids ---

def test_parse_dataset_ids_none():
    assert parse_dataset_ids(None) == []


def test_parse_dataset_ids_empty_string():
    assert parse_dataset_ids("") == []


def test_parse_dataset_ids_whitespace_only():
    assert parse_dataset_ids("   ") == []


def test_parse_dataset_ids_single():
    assert parse_dataset_ids("1") == [1]


def test_parse_dataset_ids_multiple():
    assert parse_dataset_ids("1,2,3") == [1, 2, 3]


def test_parse_dataset_ids_with_spaces():
    assert parse_dataset_ids(" 1 , 2 , 3 ") == [1, 2, 3]


def test_parse_dataset_ids_trailing_comma():
    assert parse_dataset_ids("1,2,") == [1, 2]


# --- convert_node_name_to_title ---

def test_convert_node_name_decomposer():
    assert convert_node_name_to_title("decomposer") == "问题分解"


def test_convert_node_name_search_tool():
    assert convert_node_name_to_title("search_knowledge") == "信息检索"


def test_convert_node_name_single_hop_worker():
    assert convert_node_name_to_title("single_hop_worker") == "单跳问题处理"


def test_convert_node_name_multi_hop_worker():
    assert convert_node_name_to_title("multi_hop_worker") == "多跳问题处理"


def test_convert_node_name_final_answer():
    assert convert_node_name_to_title("final_answer") == "答案聚合"


def test_convert_node_name_subanswer_aggregator():
    assert convert_node_name_to_title("subanswer_aggregator") == "答案聚合"


def test_convert_node_name_multi_hop_agent():
    assert convert_node_name_to_title("multi_hop_agent") == "多跳问题信息检索"


def test_convert_node_name_multi_hop_summary():
    assert convert_node_name_to_title("multi_hop_summary") == "多跳问题答案总结"


def test_convert_node_name_single_hop_agent():
    assert convert_node_name_to_title("single_hop_agent") == "单跳问题信息检索"


def test_convert_node_name_unknown_returns_none():
    assert convert_node_name_to_title("unknown_node") is None


# --- InstantSearchWorker ---


class _FakeEngine:
    def __init__(self):
        self.input_data = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def stream_search(self, input_data):
        self.input_data = input_data
        yield SimpleNamespace(
            type=SimpleNamespace(value="answer"),
            role=_node_names_mock.FINAL_ANSWER.value,
            data={"content": "final answer"},
            instance_id="final-node",
            parent_ids=[],
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("call_kb_ids", [None, []])
async def test_process_command_uses_all_agent_kbs_when_call_kb_ids_empty(call_kb_ids):
    worker = InstantSearchWorker()
    agent_config = SimpleNamespace()
    engine_config = {
        "retrieval": {
            "knowledge_bases": [
                {"kb_code": "kb-1", "kb_name": "知识库1", "path": "/s1", "service_name": "svc"},
                {"kb_code": "kb-2", "kb_name": "知识库2", "path": "/s2", "service_name": "svc"},
            ]
        }
    }
    command = SimpleNamespace(
        extra_payload={"agent_id": "agent-1", "call_kb_ids": call_kb_ids},
        header=SimpleNamespace(session_id="s1", parent_message_id="p1", message_id="m1"),
        content="query",
    )
    context = SimpleNamespace(
        redis=AsyncMock(),
        emit_chunk=AsyncMock(),
        session_id="s1",
        agent_runtime_state=SimpleNamespace(session_manager=SimpleNamespace(user_code="u1")),
    )

    with (
        patch.object(worker_module, "load_agent_config_from_minio", AsyncMock(return_value=agent_config)),
        patch.object(worker_module, "convert_agent_config_to_engine_config", return_value=engine_config),
        patch.object(worker_module, "InstantSearchEngine", return_value=_FakeEngine()) as instant_search_engine,
        patch.object(worker_module, "generate_report_filename", AsyncMock(return_value="季度分析")),
        patch.object(worker_module, "upload_report", AsyncMock()),
        patch("redis_model_config.RedisModelConfigProvider", return_value=AsyncMock()),
    ):
        result = await worker.process_command(command, context)

    assert result == "final answer\n\n报告已保存到：/qa/季度分析.md"
    instant_search_engine.assert_called_once()
    assert instant_search_engine.call_args.kwargs["config"]["retrieval"]["knowledge_bases"] == [
        {"kb_code": "kb-1", "kb_name": "知识库1", "path": "/s1", "service_name": "svc"},
        {"kb_code": "kb-2", "kb_name": "知识库2", "path": "/s2", "service_name": "svc"},
    ]


@pytest.mark.asyncio
async def test_process_command_filters_agent_kbs_by_call_kb_ids_subset():
    worker = InstantSearchWorker()
    agent_config = SimpleNamespace()
    engine_config = {
        "retrieval": {
            "knowledge_bases": [
                {"kb_code": "kb-1", "kb_name": "知识库1", "path": "/s1", "service_name": "svc"},
                {"kb_code": "kb-2", "kb_name": "知识库2", "path": "/s2", "service_name": "svc"},
            ]
        }
    }
    command = SimpleNamespace(
        extra_payload={"agent_id": "agent-1", "call_kb_ids": ["kb-2"]},
        header=SimpleNamespace(session_id="s1", parent_message_id="p1", message_id="m1"),
        content="query",
    )
    context = SimpleNamespace(
        redis=AsyncMock(),
        emit_chunk=AsyncMock(),
        session_id="s1",
        agent_runtime_state=SimpleNamespace(session_manager=SimpleNamespace(user_code="u1")),
    )

    with (
        patch.object(worker_module, "load_agent_config_from_minio", AsyncMock(return_value=agent_config)),
        patch.object(worker_module, "convert_agent_config_to_engine_config", return_value=engine_config),
        patch.object(worker_module, "InstantSearchEngine", return_value=_FakeEngine()) as instant_search_engine,
        patch.object(worker_module, "generate_report_filename", AsyncMock(return_value="季度分析")),
        patch.object(worker_module, "upload_report", AsyncMock()),
        patch("redis_model_config.RedisModelConfigProvider", return_value=AsyncMock()),
    ):
        result = await worker.process_command(command, context)

    assert result == "final answer\n\n报告已保存到：/qa/季度分析.md"
    instant_search_engine.assert_called_once()
    assert instant_search_engine.call_args.kwargs["config"]["retrieval"]["knowledge_bases"] == [
        {"kb_code": "kb-2", "kb_name": "知识库2", "path": "/s2", "service_name": "svc"}
    ]


@pytest.mark.asyncio
async def test_process_command_returns_answer_when_call_kb_ids_not_belong_to_agent():
    worker = InstantSearchWorker()
    agent_config = SimpleNamespace()
    engine_config = {
        "retrieval": {
            "knowledge_bases": [
                {"kb_code": "kb-1", "kb_name": "知识库1", "path": "/s1", "service_name": "svc"},
                {"kb_code": "kb-2", "kb_name": "知识库2", "path": "/s2", "service_name": "svc"},
            ]
        }
    }
    command = SimpleNamespace(
        extra_payload={"agent_id": "agent-1", "call_kb_ids": ["kb-2", "kb-3"]},
        header=SimpleNamespace(session_id="s1", parent_message_id="p1", message_id="m1"),
        content="query",
    )
    context = SimpleNamespace(
        redis=AsyncMock(),
        emit_chunk=AsyncMock(),
        session_id="s1",
        agent_runtime_state=SimpleNamespace(session_manager=SimpleNamespace(user_code="u1")),
    )

    with (
        patch.object(worker_module, "load_agent_config_from_minio", AsyncMock(return_value=agent_config)),
        patch.object(worker_module, "convert_agent_config_to_engine_config", return_value=engine_config),
        patch.object(worker_module, "InstantSearchEngine") as instant_search_engine,
    ):
        result = await worker.process_command(command, context)

    assert result == "知识库编码不存在：kb-3"
    instant_search_engine.assert_not_called()
    context.emit_chunk.assert_awaited_once_with(
        "知识库编码不存在：kb-3",
        event_type="answer_delta",
    )


@pytest.mark.asyncio
async def test_process_command_logs_warning_when_agent_id_missing():
    worker = InstantSearchWorker()
    command = SimpleNamespace(
        extra_payload={},
        header=SimpleNamespace(session_id="s1", parent_message_id="p1", message_id="m1"),
        content="query",
    )
    context = SimpleNamespace(
        redis=AsyncMock(),
        emit_chunk=AsyncMock(),
        session_id="s1",
        agent_runtime_state=SimpleNamespace(session_manager=SimpleNamespace(user_code="u1")),
    )

    with patch.object(worker_module, "logger") as mock_logger:
        result = await worker.process_command(command, context)

    assert result == "未指定可用数字员工，无法执行检索。"
    mock_logger.warning.assert_called_once()
    assert "missing agent_id" in str(mock_logger.warning.call_args)


@pytest.mark.asyncio
async def test_process_command_logs_warning_when_agent_has_no_search_config():
    worker = InstantSearchWorker()
    command = SimpleNamespace(
        extra_payload={"agent_id": "agent-1"},
        header=SimpleNamespace(session_id="s1", parent_message_id="p1", message_id="m1"),
        content="query",
    )
    context = SimpleNamespace(
        redis=AsyncMock(),
        emit_chunk=AsyncMock(),
        session_id="s1",
        agent_runtime_state=SimpleNamespace(session_manager=SimpleNamespace(user_code="u1")),
    )

    with (
        patch.object(worker_module, "load_agent_config_from_minio", AsyncMock(return_value=None)),
        patch.object(worker_module, "logger") as mock_logger,
    ):
        result = await worker.process_command(command, context)

    assert result == "当前数字员工未配置检索能力，无法执行检索。"
    mock_logger.warning.assert_called_once()
    assert "has no retrieval config" in str(mock_logger.warning.call_args)


@pytest.mark.asyncio
async def test_process_command_logs_warning_when_no_knowledge_bases_loaded():
    worker = InstantSearchWorker()
    agent_config = SimpleNamespace()
    command = SimpleNamespace(
        extra_payload={"agent_id": "agent-1"},
        header=SimpleNamespace(session_id="s1", parent_message_id="p1", message_id="m1"),
        content="query",
    )
    context = SimpleNamespace(
        redis=AsyncMock(),
        emit_chunk=AsyncMock(),
        session_id="s1",
        agent_runtime_state=SimpleNamespace(session_manager=SimpleNamespace(user_code="u1")),
    )

    with (
        patch.object(worker_module, "load_agent_config_from_minio", AsyncMock(return_value=agent_config)),
        patch.object(
            worker_module,
            "convert_agent_config_to_engine_config",
            return_value={"retrieval": {"knowledge_bases": []}},
        ),
        patch.object(worker_module, "logger") as mock_logger,
    ):
        result = await worker.process_command(command, context)

    assert result == "当前未配置可用知识库，无法执行检索。"
    assert mock_logger.warning.call_count == 1
    assert "has no available knowledge bases" in str(mock_logger.warning.call_args)


@pytest.mark.asyncio
async def test_process_command_logs_warning_when_requested_call_kb_ids_are_missing():
    worker = InstantSearchWorker()
    agent_config = SimpleNamespace()
    command = SimpleNamespace(
        extra_payload={"agent_id": "agent-1", "call_kb_ids": ["kb-2", "kb-3"]},
        header=SimpleNamespace(session_id="s1", parent_message_id="p1", message_id="m1"),
        content="query",
    )
    context = SimpleNamespace(
        redis=AsyncMock(),
        emit_chunk=AsyncMock(),
        session_id="s1",
        agent_runtime_state=SimpleNamespace(session_manager=SimpleNamespace(user_code="u1")),
    )

    with (
        patch.object(worker_module, "load_agent_config_from_minio", AsyncMock(return_value=agent_config)),
        patch.object(
            worker_module,
            "convert_agent_config_to_engine_config",
            return_value={
                "retrieval": {
                    "knowledge_bases": [
                        {"kb_code": "kb-1", "kb_name": "知识库1", "path": "/s1", "service_name": "svc"},
                        {"kb_code": "kb-2", "kb_name": "知识库2", "path": "/s2", "service_name": "svc"},
                    ]
                }
            },
        ),
        patch.object(worker_module, "logger") as mock_logger,
    ):
        result = await worker.process_command(command, context)

    assert result == "知识库编码不存在：kb-3"
    assert mock_logger.warning.call_count == 1
    assert "requested call_kb_ids are not available" in str(mock_logger.warning.call_args)

@pytest.mark.asyncio
async def test_process_command_lets_engine_load_model_provider():
    worker = InstantSearchWorker()
    agent_config = SimpleNamespace()
    engine_config = {
        "retrieval": {
            "knowledge_bases": [
                {
                    "kb_code": "kb-1",
                    "kb_name": "知识库",
                    "path": "/search",
                    "service_name": "kb-service",
                }
            ]
        }
    }
    fake_engine = _FakeEngine()
    command = SimpleNamespace(
        extra_payload={"agent_id": "agent-1"},
        header=SimpleNamespace(
            session_id="session-1",
            parent_message_id="parent-1",
            message_id="message-1",
        ),
        content="hello",
    )
    context = SimpleNamespace(
        redis=AsyncMock(),
        emit_chunk=AsyncMock(),
        session_id="session-1",
        agent_runtime_state=SimpleNamespace(
            session_manager=SimpleNamespace(user_code="test")
        ),
    )

    with (
        patch.object(
            worker_module,
            "load_agent_config_from_minio",
            AsyncMock(return_value=agent_config),
        ),
        patch.object(
            worker_module,
            "convert_agent_config_to_engine_config",
            return_value=engine_config,
        ),
        patch.object(
            worker_module,
            "create_llm_service",
            new_callable=AsyncMock,
            create=True,
        ) as create_llm_service,
        patch.object(
            worker_module,
            "InstantSearchEngine",
            return_value=fake_engine,
        ) as instant_search_engine,
        patch.object(worker_module, "generate_report_filename", AsyncMock(return_value="test_file")),
        patch.object(worker_module, "upload_report", AsyncMock()),
        patch("redis_model_config.RedisModelConfigProvider", return_value=AsyncMock()),
    ):
        result = await worker.process_command(command, context)

    assert result == "final answer\n\n报告已保存到：/qa/test_file.md"
    create_llm_service.assert_not_awaited()
    instant_search_engine.assert_called_once_with(config=engine_config)
    assert "llm_service" not in engine_config


@pytest.mark.asyncio
async def test_process_command_uses_async_context_for_engine_and_stream():
    worker = InstantSearchWorker()
    agent_config = SimpleNamespace()
    engine_config = {
        "retrieval": {
            "knowledge_bases": [
                {"kb_code": "kb-1", "kb_name": "知识库", "path": "/s", "service_name": "svc"}
            ]
        }
    }
    lifecycle = {"entered": False, "exited": False}

    class _ClosableStream:
        def __init__(self):
            self._yielded = False
            self.closed = False

        def __aiter__(self):
            return self

        async def __anext__(self):
            if self._yielded:
                raise StopAsyncIteration
            self._yielded = True
            return SimpleNamespace(
                type=SimpleNamespace(value="answer"),
                role=_node_names_mock.FINAL_ANSWER.value,
                data={"content": "final answer"},
                instance_id="final-node",
                parent_ids=[],
            )

        async def aclose(self):
            self.closed = True

    stream = _ClosableStream()
    class _ManagedEngine:
        def __init__(self):
            self.stream_search = MagicMock(return_value=stream)

        async def __aenter__(self):
            lifecycle["entered"] = True
            return self

        async def __aexit__(self, exc_type, exc, tb):
            lifecycle["exited"] = True
            return False

    fake_engine = _ManagedEngine()

    command = SimpleNamespace(
        extra_payload={"agent_id": "agent-1"},
        header=SimpleNamespace(session_id="s1", parent_message_id="p1", message_id="m1"),
        content="query",
    )
    context = SimpleNamespace(
        redis=AsyncMock(),
        emit_chunk=AsyncMock(),
        session_id="s1",
        agent_runtime_state=SimpleNamespace(
            session_manager=SimpleNamespace(user_code="u1")
        ),
    )

    with (
        patch.object(worker_module, "load_agent_config_from_minio", AsyncMock(return_value=agent_config)),
        patch.object(worker_module, "convert_agent_config_to_engine_config", return_value=engine_config),
        patch.object(worker_module, "InstantSearchEngine", return_value=fake_engine),
        patch.object(worker_module, "generate_report_filename", AsyncMock(return_value="季度分析")),
        patch.object(worker_module, "upload_report", AsyncMock()),
        patch("redis_model_config.RedisModelConfigProvider", return_value=AsyncMock()),
    ):
        result = await worker.process_command(command, context)

    assert result == "final answer\n\n报告已保存到：/qa/季度分析.md"
    assert lifecycle == {"entered": True, "exited": True}
    assert stream.closed is True
    fake_engine.stream_search.assert_called_once()


# --- generate_report_filename ---

@pytest.mark.asyncio
async def test_generate_report_filename_returns_llm_result():
    llm_service = MagicMock()
    llm_service.generate = AsyncMock(return_value="季度销售分析报告")
    result = await worker_module.generate_report_filename("报告内容", llm_service)
    assert result == "季度销售分析报告"
    call_args = llm_service.generate.call_args[0][0]
    assert isinstance(call_args, list)
    assert call_args[0]["role"] == "user"
    assert "报告内容" in call_args[0]["content"]


@pytest.mark.asyncio
async def test_generate_report_filename_sanitizes_special_chars():
    llm_service = MagicMock()
    llm_service.generate = AsyncMock(return_value="报告/结果:2026*01")
    result = await worker_module.generate_report_filename("内容", llm_service)
    assert "/" not in result
    assert ":" not in result
    assert "*" not in result
    assert result  # must be non-empty, not a fallback


@pytest.mark.asyncio
async def test_generate_report_filename_fallback_on_empty():
    llm_service = MagicMock()
    llm_service.generate = AsyncMock(return_value="   ")
    result = await worker_module.generate_report_filename("内容", llm_service)
    assert result.startswith("report_")


@pytest.mark.asyncio
async def test_generate_report_filename_fallback_on_exception():
    llm_service = MagicMock()
    llm_service.generate = AsyncMock(side_effect=Exception("LLM error"))
    result = await worker_module.generate_report_filename("内容", llm_service)
    assert result.startswith("report_")


@pytest.mark.asyncio
async def test_generate_report_filename_truncates_long_name():
    llm_service = MagicMock()
    llm_service.generate = AsyncMock(return_value="a" * 100)
    result = await worker_module.generate_report_filename("内容", llm_service)
    assert len(result) <= 50


# --- upload_report ---

@pytest.mark.asyncio
async def test_upload_report_posts_correct_payload(monkeypatch):
    monkeypatch.setenv("BE_DOMAINNAME", "http://10.45.134.143:8086")

    mock_response = MagicMock()
    mock_response.is_success = True
    mock_response.data = {
        "code": 0,
        "msg": "Operation successful",
        "data": {"filePath": "/datacloud/xxx查询结果.md"},
        "success": True,
    }

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = AsyncMock(return_value=mock_response)

    context = SimpleNamespace(
        session_id="session-1",
        agent_runtime_state=SimpleNamespace(
            session_manager=SimpleNamespace(user_code="0027011322")
        ),
    )

    with patch("worker.DiscoveryHttpClient", return_value=mock_client):
        result = await worker_module.upload_report("报告内容", "季度分析", "session-1", "0027011322")

    mock_client.post.assert_called_once_with(
        service_name="http://10.45.134.143:8086",
        path="/byaiService/open/api/v1/conversation/writeTxt",
        json={
            "userCode": "0027011322",
            "sessionId": "session-1",
            "filePath": "/qa/季度分析.md",
            "content": "报告内容",
        },
    )
    assert result is True


@pytest.mark.asyncio
async def test_upload_report_logs_error_on_failed_response(monkeypatch):
    monkeypatch.setenv("BE_DOMAINNAME", "http://10.45.134.143:8086")

    mock_response = MagicMock()
    mock_response.is_success = False
    mock_response.status_code = 500

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = AsyncMock(return_value=mock_response)

    context = SimpleNamespace(
        session_id="s1",
        agent_runtime_state=SimpleNamespace(
            session_manager=SimpleNamespace(user_code="u1")
        ),
    )

    with patch("worker.DiscoveryHttpClient", return_value=mock_client):
        with patch.object(worker_module, "logger") as mock_logger:
            result = await worker_module.upload_report("内容", "文件名", "s1", "u1")
            mock_logger.error.assert_called_once()
            assert "500" in str(mock_logger.error.call_args)
    assert result is False


@pytest.mark.asyncio
async def test_upload_report_treats_nonzero_top_level_code_as_failure(monkeypatch):
    monkeypatch.setenv("BE_DOMAINNAME", "http://10.45.134.143:8086")

    mock_response = MagicMock()
    mock_response.is_success = True
    mock_response.data = {
        "code": 1001,
        "msg": "save failed",
        "data": {"filePath": ""},
        "success": False,
    }

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = AsyncMock(return_value=mock_response)

    with patch("worker.DiscoveryHttpClient", return_value=mock_client):
        with patch.object(worker_module, "logger") as mock_logger:
            result = await worker_module.upload_report("内容", "文件名", "s1", "u1")
            mock_logger.error.assert_called_once()
            assert "1001" in str(mock_logger.error.call_args)

    assert result is False


@pytest.mark.asyncio
async def test_upload_report_skips_when_no_be_domainname(monkeypatch):
    monkeypatch.delenv("BE_DOMAINNAME", raising=False)

    with patch("worker.DiscoveryHttpClient") as mock_cls:
        result = await worker_module.upload_report("内容", "文件名", "s1", "u1")

    mock_cls.assert_not_called()
    assert result is False


@pytest.mark.asyncio
async def test_upload_report_logs_on_http_failure(monkeypatch):
    monkeypatch.setenv("BE_DOMAINNAME", "http://10.45.134.143:8086")

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = AsyncMock(side_effect=Exception("connection refused"))

    context = SimpleNamespace(
        session_id="s1",
        agent_runtime_state=SimpleNamespace(
            session_manager=SimpleNamespace(user_code="u1")
        ),
    )

    with patch("worker.DiscoveryHttpClient", return_value=mock_client):
        with patch.object(worker_module, "logger") as mock_logger:
            result = await worker_module.upload_report("内容", "文件名", "s1", "u1")
            mock_logger.error.assert_called_once()
            assert "connection refused" in str(mock_logger.error.call_args)
    assert result is False


# --- process_command report upload integration ---

@pytest.mark.asyncio
async def test_process_command_uploads_report_after_final_answer():
    worker = InstantSearchWorker()
    agent_config = SimpleNamespace()
    engine_config = {
        "retrieval": {
            "knowledge_bases": [{"kb_code": "kb-1", "kb_name": "kb", "path": "/s", "service_name": "svc"}]
        }
    }
    fake_engine = _FakeEngine()
    command = SimpleNamespace(
        extra_payload={"agent_id": "agent-1"},
        header=SimpleNamespace(
            session_id="session-1",
            parent_message_id="parent-1",
            message_id="message-1",
        ),
        content="查询问题",
    )
    context = SimpleNamespace(
        redis=AsyncMock(),
        emit_chunk=AsyncMock(),
        session_id="session-1",
        agent_runtime_state=SimpleNamespace(
            session_manager=SimpleNamespace(user_code="0027011322")
        ),
    )

    with (
        patch.object(worker_module, "load_agent_config_from_minio", AsyncMock(return_value=agent_config)),
        patch.object(worker_module, "convert_agent_config_to_engine_config", return_value=engine_config),
        patch.object(worker_module, "InstantSearchEngine", return_value=fake_engine),
        patch.object(worker_module, "generate_report_filename", AsyncMock(return_value="季度分析")) as mock_gen,
        patch.object(worker_module, "upload_report", AsyncMock()) as mock_upload,
        patch("redis_model_config.RedisModelConfigProvider", return_value=AsyncMock()),
    ):
        result = await worker.process_command(command, context)

    assert result == "final answer\n\n报告已保存到：/qa/季度分析.md"
    mock_gen.assert_awaited_once()
    mock_upload.assert_awaited_once_with("final answer", "季度分析", "session-1", "0027011322")


@pytest.mark.asyncio
async def test_process_command_does_not_report_upload_success_when_upload_fails():
    worker = InstantSearchWorker()
    agent_config = SimpleNamespace()
    engine_config = {
        "retrieval": {
            "knowledge_bases": [{"kb_code": "kb-1", "kb_name": "kb", "path": "/s", "service_name": "svc"}]
        }
    }
    fake_engine = _FakeEngine()
    command = SimpleNamespace(
        extra_payload={"agent_id": "agent-1"},
        header=SimpleNamespace(
            session_id="session-1",
            parent_message_id="parent-1",
            message_id="message-1",
        ),
        content="查询问题",
    )
    context = SimpleNamespace(
        redis=AsyncMock(),
        emit_chunk=AsyncMock(),
        session_id="session-1",
        agent_runtime_state=SimpleNamespace(
            session_manager=SimpleNamespace(user_code="0027011322")
        ),
    )

    with (
        patch.object(worker_module, "load_agent_config_from_minio", AsyncMock(return_value=agent_config)),
        patch.object(worker_module, "convert_agent_config_to_engine_config", return_value=engine_config),
        patch.object(worker_module, "InstantSearchEngine", return_value=fake_engine),
        patch.object(worker_module, "generate_report_filename", AsyncMock(return_value="季度分析")) as mock_gen,
        patch.object(worker_module, "upload_report", AsyncMock(return_value=False)) as mock_upload,
        patch("redis_model_config.RedisModelConfigProvider", return_value=AsyncMock()),
    ):
        result = await worker.process_command(command, context)

    assert result == "final answer\n\n报告保存失败，未写入会话文件。"
    mock_gen.assert_awaited_once()
    mock_upload.assert_awaited_once_with("final answer", "季度分析", "session-1", "0027011322")
    emitted_texts = [call.args[0] for call in context.emit_chunk.await_args_list]
    assert "\n\n报告已保存到：/qa/季度分析.md" not in emitted_texts
    assert "\n\n报告保存失败，未写入会话文件。" in emitted_texts


@pytest.mark.asyncio
async def test_process_command_emits_upload_failure_message_when_upload_fails():
    worker = InstantSearchWorker()
    agent_config = SimpleNamespace()
    engine_config = {
        "retrieval": {
            "knowledge_bases": [{"kb_code": "kb-1", "kb_name": "kb", "path": "/s", "service_name": "svc"}]
        }
    }
    fake_engine = _FakeEngine()
    command = SimpleNamespace(
        extra_payload={"agent_id": "agent-1"},
        header=SimpleNamespace(
            session_id="session-1",
            parent_message_id="parent-1",
            message_id="message-1",
        ),
        content="查询问题",
    )
    context = SimpleNamespace(
        redis=AsyncMock(),
        emit_chunk=AsyncMock(),
        session_id="session-1",
        agent_runtime_state=SimpleNamespace(
            session_manager=SimpleNamespace(user_code="0027011322")
        ),
    )

    with (
        patch.object(worker_module, "load_agent_config_from_minio", AsyncMock(return_value=agent_config)),
        patch.object(worker_module, "convert_agent_config_to_engine_config", return_value=engine_config),
        patch.object(worker_module, "InstantSearchEngine", return_value=fake_engine),
        patch.object(worker_module, "generate_report_filename", AsyncMock(return_value="季度分析")),
        patch.object(worker_module, "upload_report", AsyncMock(return_value=False)),
        patch("redis_model_config.RedisModelConfigProvider", return_value=AsyncMock()),
    ):
        result = await worker.process_command(command, context)

    assert result == "final answer\n\n报告保存失败，未写入会话文件。"
    emitted_texts = [call.args[0] for call in context.emit_chunk.await_args_list]
    assert "\n\n报告保存失败，未写入会话文件。" in emitted_texts


@pytest.mark.asyncio
async def test_process_command_skips_upload_when_no_final_answer():
    worker = InstantSearchWorker()
    agent_config = SimpleNamespace()
    engine_config = {
        "retrieval": {
            "knowledge_bases": [{"kb_code": "kb-1", "kb_name": "kb", "path": "/s", "service_name": "svc"}]
        }
    }

    async def empty_stream(input_data):
        return
        yield  # make it an async generator

    class _PlainEngine:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        def stream_search(self, input_data):
            return empty_stream(input_data)

    fake_engine = _PlainEngine()

    command = SimpleNamespace(
        extra_payload={"agent_id": "agent-1"},
        header=SimpleNamespace(session_id="s1", parent_message_id="p1", message_id="m1"),
        content="query",
    )
    context = SimpleNamespace(
        redis=AsyncMock(),
        emit_chunk=AsyncMock(),
        session_id="s1",
        agent_runtime_state=SimpleNamespace(
            session_manager=SimpleNamespace(user_code="u1")
        ),
    )

    with (
        patch.object(worker_module, "load_agent_config_from_minio", AsyncMock(return_value=agent_config)),
        patch.object(worker_module, "convert_agent_config_to_engine_config", return_value=engine_config),
        patch.object(worker_module, "InstantSearchEngine", return_value=fake_engine),
        patch.object(worker_module, "generate_report_filename", AsyncMock()) as mock_gen,
        patch.object(worker_module, "upload_report", AsyncMock()) as mock_upload,
    ):
        result = await worker.process_command(command, context)

    assert result == ""
    mock_gen.assert_not_awaited()
    mock_upload.assert_not_awaited()
