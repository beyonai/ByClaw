#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import sys


RESOURCE_ID = "REPLACE_WITH_RESOURCE_ID"
RESOURCE_TYPE = "MCP"
ACTION = "REPLACE_WITH_ACTION"


def emit(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), flush=True)


def fail(code: str, message: str, exit_code: int) -> int:
    emit({"ok": False, "error": {"code": code, "message": message}})
    return exit_code


def parse_cli_result(completed: subprocess.CompletedProcess[str]) -> dict | None:
    try:
        payload = json.loads(completed.stdout)
    except ValueError:
        return None
    return payload if isinstance(payload, dict) else None


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        return fail("INVALID_ARGUMENT", "usage: run.py <session_id> <business-query>", 2)
    session_id, query = argv[1:]
    if not session_id or not query.strip():
        return fail("INVALID_ARGUMENT", "session_id and business-query are required", 2)
    if RESOURCE_ID.startswith("REPLACE_") or ACTION.startswith("REPLACE_"):
        return fail("SKILL_NOT_CONFIGURED", "resource contract placeholders must be replaced", 2)

    if RESOURCE_TYPE in {"TOOLKIT", "MCP"}:
        described = subprocess.run(
            [
                "callcli", "resource", "describe",
                "--session-id", session_id,
                "--resource-id", RESOURCE_ID,
                "--resource-type", RESOURCE_TYPE,
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        contract = parse_cli_result(described)
        if contract is None:
            return fail("CALLCLI_PROTOCOL_ERROR", "callcli describe returned invalid JSON", 14)
        if described.returncode != 0 or contract.get("ok") is not True:
            emit(contract)
            return described.returncode or 14
        data = contract.get("data") if isinstance(contract.get("data"), dict) else {}
        collection_key = "tools" if RESOURCE_TYPE == "MCP" else "actions"
        actions = data.get(collection_key) if isinstance(data.get(collection_key), list) else []
        available = {str(item.get("name")) for item in actions
                     if isinstance(item, dict) and item.get("name")}
        if ACTION not in available:
            return fail("ACTION_NOT_FOUND",
                        f"configured action is absent from current resource contract: {ACTION}", 4)

    request = {"action": ACTION, "arguments": {"keyword": query}}
    completed = subprocess.run(
        [
            "callcli", "invoke",
            "--session-id", session_id,
            "--resource-id", RESOURCE_ID,
            "--resource-type", RESOURCE_TYPE,
            "--input", "-",
            "--format", "json",
        ],
        input=json.dumps(request, ensure_ascii=False),
        capture_output=True,
        text=True,
        check=False,
    )
    payload = parse_cli_result(completed)
    if payload is None:
        return fail("CALLCLI_PROTOCOL_ERROR", "callcli returned invalid JSON", 14)
    emit(payload)
    if completed.returncode != 0:
        return completed.returncode
    return 0 if payload.get("ok") is True else 14


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
