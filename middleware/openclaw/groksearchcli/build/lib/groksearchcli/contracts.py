from __future__ import annotations

from copy import deepcopy


COMMON_ERRORS = [
    "INVALID_ARGUMENT",
    "MISSING_CREDENTIAL",
    "AUTHENTICATION_FAILED",
    "PERMISSION_DENIED",
    "RATE_LIMITED",
    "REQUEST_TIMEOUT",
    "SERVICE_UNAVAILABLE",
    "PROTOCOL_ERROR",
    "INCOMPLETE_RESPONSE",
    "EMPTY_RESPONSE",
    "XAI_ERROR",
    "INTERNAL_ERROR",
    "INTERRUPTED",
]


def _property(value_type: str, *, required: bool = False, **extra) -> dict:
    return {"type": value_type, "required": required, **extra}


WEB_PROPERTIES = {
    "query": _property(
        "string", required=True,
        description="面向公开互联网的自然语言研究问题或任务；Grok 会据此自主生成多个网页搜索/浏览操作。不要传入逗号分隔的关键词列表。",
        examples=["查询 OWL 2 本体标准及权威教程", "比较 2026 年小团队创业方向并提供来源"],
    ),
    "allowDomain": _property("string[]", maxItems=5),
    "excludeDomain": _property("string[]", maxItems=5),
    "imageUnderstanding": _property("boolean", default=False),
    "imageSearch": _property("boolean", default=False),
    "model": _property("string", default="grok-4.6"),
    "instructions": _property("string"),
    "timeout": _property("duration", default="120s"),
    "verbose": _property("boolean", default=False),
}

X_PROPERTIES = {
    "query": _property(
        "string", required=True,
        description="面向 X 内容的自然语言研究问题或任务；Grok 会据此自主生成关键词、语义和用户检索。不要把 query 当作单个账号或固定搜索词参数。",
        examples=["查询 xAI 在 X 上的最新产品讨论", "分析某主题近期用户反馈"],
    ),
    "allowHandle": _property("string[]", maxItems=20),
    "excludeHandle": _property("string[]", maxItems=20),
    "fromDate": _property("date"),
    "toDate": _property("date"),
    "imageUnderstanding": _property("boolean", default=False),
    "videoUnderstanding": _property("boolean", default=False),
    "model": _property("string", default="grok-4.6"),
    "instructions": _property("string"),
    "timeout": _property("duration", default="120s"),
    "verbose": _property("boolean", default=False),
}


def _contract(command: str, description: str, properties: dict, notes: list[str]) -> dict:
    return {
        "command": command,
        "description": description,
        "input": {
            "type": "object",
            "properties": deepcopy(properties),
            "required": [name for name, spec in properties.items() if spec.get("required")],
        },
        "output": {
            "dataType": "SearchResult",
            "dataSchema": {
                "type": "object",
                "properties": {
                    "answer": {"type": "string"},
                    "citations": {"type": "array", "items": {"type": "object"}},
                    "images": {"type": "array", "items": {"type": "object"}},
                },
                "required": ["answer", "citations", "images"],
            },
            "metaSchema": {
                "type": "object",
                "properties": {
                    "model": {"type": "string"},
                    "responseId": {"type": "string"},
                    "toolUsage": {"type": "object"},
                    "usage": {"type": "object"},
                    "elapsedMs": {"type": "integer"},
                },
            },
            "envelope": {"ok": "boolean", "operation": "string", "data": "SearchResult", "meta": "object"},
            "errorEnvelope": {
                "ok": "false",
                "error.code": "string",
                "error.message": "string",
                "error.retryable": "boolean",
                "error.details": "object?",
            },
        },
        "errors": list(COMMON_ERRORS),
        "notes": notes,
    }


CONTRACTS = {
    "web search": _contract(
        "web search",
        "使用 Grok Web Search 检索公开互联网",
        WEB_PROPERTIES,
        ["allowDomain 与 excludeDomain 互斥", "域名列表最多 5 项"],
    ),
    "x search": _contract(
        "x search",
        "使用 Grok X Search 检索 X 内容",
        X_PROPERTIES,
        ["allowHandle 与 excludeHandle 互斥", "账号列表最多 20 项", "日期范围包含首尾日期"],
    ),
    "research run": _contract(
        "research run",
        "在单个 Grok 请求中联合使用 Web Search 和 X Search",
        {**WEB_PROPERTIES, **{key: value for key, value in X_PROPERTIES.items() if key not in WEB_PROPERTIES}},
        ["query 是同一个跨来源的自然语言研究问题", "两个工具由 Grok 在同一个请求中自主编排"],
    ),
}


def get_contract(group: str, action: str) -> dict:
    return deepcopy(CONTRACTS[f"{group} {action}"])


def list_contracts() -> list[dict]:
    return [deepcopy(CONTRACTS[key]) for key in sorted(CONTRACTS)]
