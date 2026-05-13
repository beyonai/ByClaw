from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

from by_framework import EventType
from by_framework.core.protocol.content_type import SseReasonMessageType
from datacloud_knowledge.intent.types import (
    ClarificationResult,
    StreamEvent,
    StreamEventKind,
)

from byclaw_data.paradigm import analyze_query_clarification

_DELTA = EventType.REASONING_LOG_DELTA.value


@dataclass
class _EmittedEvent:
    content: str
    path: list[str]


class _FakeGatewayContext:
    message_id: str

    def __init__(self) -> None:
        self._index = 0
        self._path: list[str] = []
        self.message_id = "root-message"
        self.emitted: list[_EmittedEvent] = []
        self.message_id_history: list[str] = []

    def generate_message_id(self) -> str:
        self._index += 1
        return f"msg-{self._index}"

    @asynccontextmanager
    async def sub_step(
        self,
        title: str,
        content_type: str = SseReasonMessageType.think_text.value,
        event_type: str = _DELTA,
    ):
        old_mid = self.message_id
        self.emitted.append(_EmittedEvent(content=title, path=list(self._path)))
        self.message_id_history.append(self.message_id)
        self._path.append(title)
        self.message_id = self.generate_message_id()
        try:
            yield self.message_id, old_mid
        finally:
            self._path.pop()
            self.message_id = old_mid

    async def emit_chunk(
        self,
        event: Any,
        event_type: str | None = None,
        content_type: str | None = None,
        message_id: str | None = None,
        parent_message_id: str | None = None,
    ) -> None:
        content = event.content if hasattr(event, "content") else str(event)
        self.emitted.append(_EmittedEvent(content=content, path=list(self._path)))
        self.message_id_history.append(self.message_id)

    async def emit_state(
        self,
        event: Any,
        event_type: str | None = None,
        content_type: str | None = None,
        message_id: str | None = None,
        parent_message_id: str | None = None,
    ) -> None:
        content = event.state if hasattr(event, "state") else str(event)
        self.emitted.append(_EmittedEvent(content=content, path=list(self._path)))
        self.message_id_history.append(self.message_id)


def _fake_analyzer(query: str, on_event: Any = None) -> ClarificationResult:
    events = [
        StreamEvent(kind=StreamEventKind.STEP_BEGIN, content="查询分析"),
        StreamEvent(kind=StreamEventKind.TITLE, content="查询分析"),
        StreamEvent(kind=StreamEventKind.TOOL_NAME, content="expand_query"),
        StreamEvent(kind=StreamEventKind.TOOL_ARGS, content='{"query":"原始问题"}'),
        StreamEvent(kind=StreamEventKind.THINKING, content="先识别指标"),
        StreamEvent(kind=StreamEventKind.THINKING, content="与网格分层"),
        StreamEvent(kind=StreamEventKind.TOOL_RESULT, content='{"query":"规范化问题"}'),
        StreamEvent(kind=StreamEventKind.STEP_END, content="查询分析"),
        StreamEvent(kind=StreamEventKind.STEP_BEGIN, content="知识召回"),
        StreamEvent(kind=StreamEventKind.TITLE, content="知识召回"),
        StreamEvent(kind=StreamEventKind.TOOL_NAME, content="knowledge_recall"),
        StreamEvent(kind=StreamEventKind.TOOL_ARGS, content='{"keys":["企业"]}'),
        StreamEvent(kind=StreamEventKind.TOOL_RESULT, content='{"docs":["..."]}'),
        StreamEvent(kind=StreamEventKind.STEP_END, content="知识召回"),
    ]
    for e in events:
        if on_event:
            on_event(e)
    return ClarificationResult(query="规范化问题", needs_clarification=True, form="{}")


def test_stream_hierarchy_with_step_signals() -> None:
    ctx = _FakeGatewayContext()
    result = asyncio.run(
        analyze_query_clarification(
            "高效益、中效益、低效益网格的营收、利润、亩产",
            ctx,
            {"messagePid": "11"},
            analyzer=_fake_analyzer,
        )
    )
    assert result.query == "规范化问题"

    c = ctx.emitted
    contents = [e.content for e in c]

    assert contents[0] == "查询分析"
    assert c[0].path == []
    assert contents[1] == "expand_query"
    assert c[1].path == ["查询分析"]
    assert contents[2] == "工具入参"
    assert c[2].path == ["查询分析", "expand_query"]
    assert '"query"' in contents[3]
    assert c[3].path == ["查询分析", "expand_query"]
    assert contents[4] == "思考过程"
    assert c[4].path == ["查询分析", "expand_query"]
    assert "先识别指标" in contents[5]
    assert c[5].path == ["查询分析", "expand_query", "思考过程"]
    assert "与网格分层" in contents[6]
    assert c[6].path == ["查询分析", "expand_query", "思考过程"]
    assert contents[7] == "工具返回"
    assert c[7].path == ["查询分析", "expand_query"]
    assert '"query"' in contents[8]
    assert c[8].path == ["查询分析", "expand_query"]

    assert contents[9] == "知识召回"
    assert c[9].path == []
    assert contents[10] == "knowledge_recall"
    assert c[10].path == ["知识召回"]
    assert contents[11] == "工具入参"
    assert c[11].path == ["知识召回", "knowledge_recall"]
    assert '"keys"' in contents[12]
    assert c[12].path == ["知识召回", "knowledge_recall"]
    assert contents[13] == "工具返回"
    assert c[13].path == ["知识召回", "knowledge_recall"]
    assert '"docs"' in contents[14]
    assert c[14].path == ["知识召回", "knowledge_recall"]


def test_no_gateway_context() -> None:
    def _simple(query: str, on_event: Any = None) -> ClarificationResult:
        return ClarificationResult(query=query)

    result = asyncio.run(analyze_query_clarification("test", None, analyzer=_simple))
    assert result.query == "test"


def test_error_emits_under_open_step() -> None:
    def _error_analyzer(query: str, on_event: Any = None) -> ClarificationResult:
        for e in [
            StreamEvent(kind=StreamEventKind.STEP_BEGIN, content="查询分析"),
            StreamEvent(kind=StreamEventKind.ERROR, content="失败"),
            StreamEvent(kind=StreamEventKind.STEP_END, content="查询分析"),
        ]:
            if on_event:
                on_event(e)
        return ClarificationResult(query="x")

    ctx = _FakeGatewayContext()
    asyncio.run(analyze_query_clarification("q", ctx, analyzer=_error_analyzer))
    assert ctx.emitted[0].content == "查询分析"
    assert ctx.emitted[1].content == "执行异常：失败"
    assert ctx.emitted[1].path == ["查询分析"]


def test_message_pid_is_used_as_parent_anchor() -> None:
    def _simple(query: str, on_event: Any = None) -> ClarificationResult:
        for e in [
            StreamEvent(kind=StreamEventKind.STEP_BEGIN, content="查询分析"),
            StreamEvent(kind=StreamEventKind.TOOL_NAME, content="expand_query"),
            StreamEvent(kind=StreamEventKind.STEP_END, content="查询分析"),
        ]:
            if on_event:
                on_event(e)
        return ClarificationResult(query=query)

    ctx = _FakeGatewayContext()
    asyncio.run(
        analyze_query_clarification(
            "q", ctx, {"messagePid": "pid-11"}, analyzer=_simple
        )
    )

    assert ctx.message_id == "root-message"
    assert "pid-11" in ctx.message_id_history
