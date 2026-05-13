"""测试函数内部流式事件推送 — 验证 on_event 回调推送完整事件流

从 byclaw-data 项目运行（有 .env 配置 LLM 和 DB）。

Run:
    uv run python tests/test_func_stream.py
"""

from __future__ import annotations

import json
import sys

from dotenv import load_dotenv

load_dotenv()

from datacloud_knowledge.intent import analyze_query_clarification  # noqa: E402
from datacloud_knowledge.intent.types import StreamEvent  # noqa: E402

# kind → 显示前缀 + 颜色 ANSI code
_KIND_STYLE: dict[str, tuple[str, str]] = {
    StreamEvent.TITLE: ("📦", "\033[1;36m"),  # bold cyan
    StreamEvent.TOOL_NAME: ("🔧", "\033[1;33m"),  # bold yellow
    StreamEvent.TOOL_ARGS: ("📥", "\033[0;90m"),  # gray
    StreamEvent.THINKING: ("💭", "\033[0;37m"),  # white (流式，不换行)
    StreamEvent.TOOL_RESULT: ("📤", "\033[0;32m"),  # green
    StreamEvent.ERROR: ("❌", "\033[1;31m"),  # bold red
}
_RESET = "\033[0m"

_last_kind: str = ""


def _on_event(event: StreamEvent) -> None:
    global _last_kind  # noqa: PLW0603
    icon, color = _KIND_STYLE.get(event.kind, ("?", ""))

    if event.kind == StreamEvent.THINKING:
        # thinking 是流式增量，不换行
        if _last_kind != StreamEvent.THINKING:
            sys.stdout.write(f"\n  {icon} ")
        sys.stdout.write(f"{color}{event.content}{_RESET}")
        sys.stdout.flush()
    else:
        # 非 thinking 事件，如果上一个是 thinking 先换行
        if _last_kind == StreamEvent.THINKING:
            sys.stdout.write("\n")

        # 格式化 JSON 内容
        content = event.content
        if event.kind in (StreamEvent.TOOL_ARGS, StreamEvent.TOOL_RESULT):
            try:
                parsed = json.loads(content)
                content = json.dumps(parsed, ensure_ascii=False, indent=2)
                content = content.replace("\n", "\n      ")
            except (json.JSONDecodeError, ValueError):
                pass

        if event.kind == StreamEvent.TITLE:
            print(f"\n{icon} {color}{event.content}{_RESET}")
        else:
            print(f"  {icon} {color}{content}{_RESET}")

    _last_kind = event.kind


def main() -> None:
    query = "202602龙头、骨干企业的数量、营收"
    try:
        analyze_query_clarification(query, on_event=_on_event)

    except Exception:
        import traceback

        traceback.print_exc()


if __name__ == "__main__":
    main()
