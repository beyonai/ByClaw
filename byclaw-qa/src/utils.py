from __future__ import annotations
import socket

from contextlib import contextmanager
from typing import Any, Iterator

from by_framework.worker import AgentContext


@contextmanager
def langfuse_scope(
    context: AgentContext,
) -> Iterator[list[Any]]:
    """
    Yields a callbacks list，可直接传入 LangGraph config["callbacks"]。

    同步 context manager，可在 async 函数里用 `with`（不需要 `async with`）。
    """
    callbacks: list[Any] = []

    parent_observation_id = context.get_trace_parent_observation_id()
    if not parent_observation_id:
        yield callbacks
        return

    try:
        from by_framework_trace_langfuse import build_langchain_callback
    except (ImportError, AttributeError):
        yield callbacks
        return

    langfuse_cb = build_langchain_callback(
        trace_id=context.trace_id,
        parent_observation_id=parent_observation_id,
    )
    if langfuse_cb is not None:
        callbacks.append(langfuse_cb)
    yield callbacks


def extract_ip():
    st = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:       
        st.connect(('10.255.255.255', 1))
        IP = st.getsockname()[0]
    except Exception:
        IP = '127.0.0.1'
    finally:
        st.close()
    return IP
