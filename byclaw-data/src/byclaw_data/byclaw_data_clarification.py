import json
from typing import Any, Optional, Union

from by_framework import AgentContext
from by_framework.core.protocol.agent_state import AgentState
from by_framework.core.protocol.event_type import EventType
from by_framework.core.protocol.events import AskUserEvent

try:
    from by_framework.common.emitter import DefaultSseLayoutBuilder as _SseCls

    _sse_layout_builder = _SseCls()
except ImportError:
    from by_framework.common.emitter import _build_sse_layout as _legacy_build  # type: ignore[attr-defined]

    class _LegacySseBuilder:
        def build(
            self,
            content: Optional[str],
            role: Optional[str],
            content_type: str,
            source_agent_type: str,
            order_id: Optional[str] = None,
            parent_order_id: Optional[str] = None,
            **_kw: Any,
        ) -> dict[str, Any]:
            return _legacy_build(  # type: ignore[no-any-return]
                content=content,
                role=role,
                content_type=content_type,
                source_agent_type=source_agent_type,
                order_id=order_id,
                parent_order_id=parent_order_id,
            )

    _sse_layout_builder = _LegacySseBuilder()  # type: ignore[assignment]


class ByclawDataClarification(AgentContext):

    async def complex_ask_user(
        self,
        event: Union[AskUserEvent, str],
        message_id: Optional[str] = None,
        parent_message_id: Optional[str] = None,
    ) -> dict[str, Any]:

        if isinstance(event, str):
            event = AskUserEvent(prompt=event)

        await self.emitter.emit_event(
            session_id=self.session_id,
            trace_id=self.trace_id,
            event_type=EventType.ANSWER_DELTA.value,
            source_agent_type=self.current_agent_id,
            message_id=message_id,
            parent_message_id=parent_message_id,
            data=_sse_layout_builder.build(
                content=json.dumps(
                    {
                        "paradigmList": event.metadata.get("paradigmList", []),
                        "query": event.metadata.get("query", ""),
                    },
                    ensure_ascii=False,
                ),
                role="assistant",
                content_type="3012",
                source_agent_type=self.current_agent_id,
                order_id=message_id,
                parent_order_id=parent_message_id,
            ),
            metadata=event.metadata,
        )

        self._is_suspended = True
        return {"status": AgentState.WAITING_USER.value}
