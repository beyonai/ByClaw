from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlsplit

from groksearchcli.errors import GrokSearchCliError


def normalize_response(operation: str, response: dict, *, elapsed_ms: int) -> dict:
    status = response.get("status")
    if status == "incomplete":
        raise GrokSearchCliError(
            "INCOMPLETE_RESPONSE", "xAI response was incomplete",
            details=response.get("incomplete_details"),
        )
    if status == "failed" or response.get("error"):
        raise GrokSearchCliError("XAI_ERROR", "xAI response failed", details=response.get("error"))
    text_parts: list[str] = []
    citations: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    images: list[dict[str, str]] = []
    for item in response.get("output", []):
        if not isinstance(item, dict) or item.get("type") != "message":
            continue
        for content in item.get("content", []):
            if not isinstance(content, dict):
                continue
            if content.get("type") in {"output_text", "text"} and isinstance(content.get("text"), str):
                text_parts.append(content["text"])
            for annotation in content.get("annotations", []):
                if not isinstance(annotation, dict):
                    continue
                url = annotation.get("url")
                if not isinstance(url, str) or url in seen_urls:
                    continue
                seen_urls.add(url)
                source_type = _source_type(url)
                citations.append({
                    "url": url,
                    "title": annotation.get("title"),
                    "sourceType": source_type,
                })
                if annotation.get("type") == "image_url":
                    images.append({"url": url, "alt": annotation.get("title") or ""})
    for citation in response.get("citations", []):
        if isinstance(citation, str):
            url, title = citation, None
        elif isinstance(citation, dict):
            url, title = citation.get("url"), citation.get("title")
        else:
            continue
        if isinstance(url, str) and url not in seen_urls:
            seen_urls.add(url)
            citations.append({"url": url, "title": title, "sourceType": _source_type(url)})
    answer = "\n".join(text_parts).strip()
    if not answer:
        raise GrokSearchCliError("EMPTY_RESPONSE", "xAI response contained no answer", retryable=False)
    for match in re.finditer(r"!\[([^\]]*)\]\((https?://[^)]+)\)", answer):
        images.append({"url": match.group(2), "alt": match.group(1)})
    usage = response.get("usage") if isinstance(response.get("usage"), dict) else {}
    web_calls = sum(1 for item in response.get("output", [])
                    if isinstance(item, dict) and item.get("type") == "web_search_call")
    x_calls = sum(1 for item in response.get("output", [])
                  if isinstance(item, dict) and item.get("type") == "x_search_call")
    tool_usage = {
        "totalServerSideToolsUsed": usage.get("num_server_side_tools_used", web_calls + x_calls),
        "webSearchCalls": web_calls,
        "xSearchCalls": x_calls,
    }
    return {
        "ok": True,
        "operation": operation,
        "data": {"answer": answer, "citations": citations, "images": images},
        "meta": {
            "model": response.get("model"),
            "responseId": response.get("id"),
            "toolUsage": tool_usage,
            "usage": usage,
            "elapsedMs": elapsed_ms,
        },
    }


def _source_type(url: str) -> str:
    hostname = (urlsplit(url).hostname or "").lower()
    return "x" if hostname in {"x.com", "www.x.com", "twitter.com", "www.twitter.com"} else "web"
