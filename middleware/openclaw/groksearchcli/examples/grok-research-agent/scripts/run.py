#!/usr/bin/env python3
"""Example Skill entry: one combined Grok Web/X research request."""

from __future__ import annotations

import argparse
import json
import subprocess


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a sourced Web/X research brief")
    parser.add_argument("query")
    parser.add_argument("--from-date")
    parser.add_argument("--to-date")
    parser.add_argument("--domain", action="append", default=[])
    parser.add_argument("--handle", action="append", default=[])
    return parser


def main() -> int:
    args = build_parser().parse_args()
    command = ["groksearchcli", "research", "run", "--query", args.query]
    for name, value in (("--from-date", args.from_date), ("--to-date", args.to_date)):
        if value:
            command.extend([name, value])
    for domain in args.domain:
        command.extend(["--allow-domain", domain])
    for handle in args.handle:
        command.extend(["--allow-handle", handle])

    try:
        completed = subprocess.run(
            command, capture_output=True, text=True, check=False, shell=False, timeout=180
        )
    except FileNotFoundError:
        print(json.dumps({"ok": False, "error": {
            "code": "CLI_NOT_FOUND", "message": "groksearchcli is unavailable", "retryable": False,
        }}, separators=(",", ":")))
        return 14
    except subprocess.TimeoutExpired:
        print(json.dumps({"ok": False, "error": {
            "code": "PROCESS_TIMEOUT", "message": "groksearchcli process timed out", "retryable": True,
        }}, separators=(",", ":")))
        return 13
    try:
        payload = json.loads(completed.stdout)
    except ValueError:
        payload = {
            "ok": False,
            "error": {
                "code": "GROKSEARCHCLI_PROTOCOL_ERROR",
                "message": "groksearchcli returned invalid JSON",
                "retryable": False,
            },
        }
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    if completed.returncode != 0:
        return completed.returncode
    return 0 if payload.get("ok") is True else 14


if __name__ == "__main__":
    raise SystemExit(main())
