#!/usr/bin/env python3
"""Minimal public Skill entry: search one fixed knowledge base."""

import json
import subprocess
import sys


RESOURCE_ID = "2001"  # Replace with the platform-assigned knowledge resource ID.


def main() -> int:
    if len(sys.argv) != 3:
        print(json.dumps({"ok": False, "error": {"code": "INVALID_ARGUMENT",
              "message": "usage: run.py <session_id> <query>"}}, ensure_ascii=False))
        return 2
    session_id, query = sys.argv[1:]
    command = [
        "kbcli", "search", "chunks", "--session-id", session_id,
        "--resource-id", RESOURCE_ID, "--query", query, "--top-k", "5", "--mode", "mixedRecall",
    ]
    completed = subprocess.run(command, capture_output=True, text=True, check=False)
    try:
        payload = json.loads(completed.stdout)
    except ValueError:
        payload = {"ok": False, "error": {"code": "KBCLI_PROTOCOL_ERROR",
                   "message": "kbcli returned invalid JSON"}}
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    return completed.returncode if completed.returncode != 0 else (0 if payload.get("ok") else 14)


if __name__ == "__main__":
    raise SystemExit(main())
