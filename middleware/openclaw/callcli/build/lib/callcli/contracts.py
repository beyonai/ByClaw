from __future__ import annotations

from copy import deepcopy


SUPPORTED_TYPES = ("TOOL", "TOOLKIT", "MCP", "AGENT")
CATALOG_TYPES = ("MCP", "TOOLKIT", "AGENT")

CONTRACTS = {
    "resource list": {
        "command": "resource list",
        "description": "List capabilities authorized for the current session",
        "network": True,
        "input": {"required": ["sessionId"], "properties": {
            "sessionId": {"type": "string"}, "keyword": {"type": "string"},
            "resourceType": {"enum": list(CATALOG_TYPES)}, "pageNum": {"type": "integer"},
            "pageSize": {"type": "integer"}, "allPages": {"type": "boolean"},
        }},
        "output": {"envelope": {"ok": "boolean", "operation": "string", "data": "ResourcePage"}},
        "errors": ["INVALID_ARGUMENT", "SESSION_INVALID", "DISCOVERY_UNAVAILABLE", "BACKEND_ERROR"],
    },
    "resource describe": {
        "command": "resource describe",
        "description": "Describe one exact authorized capability",
        "network": True,
        "input": {"required": ["sessionId", "resourceId", "resourceType"]},
        "output": {"envelope": {"ok": "boolean", "operation": "string", "data": "Capability"}},
        "errors": ["RESOURCE_NOT_FOUND", "RESOURCE_FORBIDDEN", "RESOURCE_TYPE_MISMATCH",
                   "RESOURCE_DETAILS_NOT_FOUND"],
    },
    "invoke": {
        "command": "invoke",
        "description": "Invoke one exact TOOL, TOOLKIT, MCP, or remote AGENT capability",
        "network": True,
        "preconditions": [
            "For TOOLKIT and MCP, run resource describe for the same session, resource ID, and type immediately before invoke",
            "Select an exact action from the current actions/tools result and construct arguments from its current input schema",
        ],
        "input": {"required": ["sessionId", "resourceId", "resourceType"],
                  "resourceTypes": list(SUPPORTED_TYPES),
                  "body": {
                      "action": "required for TOOLKIT/MCP; invalid for TOOL/AGENT",
                      "query": "required for AGENT; invalid for TOOL/TOOLKIT/MCP",
                      "arguments": "object matching the selected inputSchema",
                  }},
        "output": {"formats": ["json", "ndjson"],
                   "envelope": {"ok": "boolean", "operation": "string", "data": "any"}},
        "errors": ["INVALID_ARGUMENT", "ACTION_REQUIRED", "ACTION_NOT_FOUND", "INVALID_PARAMETERS",
                   "AUTH_EXPIRED", "TOOL_REQUEST_FAILED", "MCP_DISCOVERY_FAILED", "MCP_CALL_FAILED",
                   "AGENT_REQUEST_FAILED", "UNSUPPORTED_LOCAL_AGENT", "UNSUPPORTED_INTERACTIVE_AGENT"],
    },
}


def get_contract(parts: list[str]) -> dict:
    key = " ".join(parts)
    if key not in CONTRACTS:
        raise KeyError(key)
    return deepcopy(CONTRACTS[key])


def list_contracts() -> list[dict]:
    return [deepcopy(CONTRACTS[key]) for key in sorted(CONTRACTS)]
