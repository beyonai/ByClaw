from __future__ import annotations

import json
from collections.abc import AsyncIterator


async def iter_sse(response) -> AsyncIterator[tuple[str, object]]:
    event = "message"
    data: list[str] = []
    async for line in response.aiter_lines():
        if line == "":
            if data:
                text = "\n".join(data)
                if text == "[DONE]":
                    return
                try:
                    payload = json.loads(text)
                except ValueError:
                    payload = text
                yield event, payload
            event, data = "message", []
            continue
        if line.startswith(":"):
            continue
        field, sep, value = line.partition(":")
        value = value[1:] if sep and value.startswith(" ") else value
        if field == "event":
            event = value
        elif field == "data":
            data.append(value)
    if data:
        text = "\n".join(data)
        if text != "[DONE]":
            try:
                yield event, json.loads(text)
            except ValueError:
                yield event, text


def openai_delta(payload: object) -> str:
    if not isinstance(payload, dict):
        return ""
    choices = payload.get("choices")
    if not isinstance(choices, list):
        return ""
    out = []
    for choice in choices:
        delta = choice.get("delta") if isinstance(choice, dict) else None
        if isinstance(delta, dict) and isinstance(delta.get("content"), str):
            out.append(delta["content"])
    return "".join(out)

