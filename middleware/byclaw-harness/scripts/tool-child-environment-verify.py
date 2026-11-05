#!/usr/bin/env python3
"""Verify transport credentials with real root/byclaw Linux child processes."""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import pwd
import sys
from typing import TypedDict


class ChildReport(TypedDict):
    uid_matches: bool
    host_key_present: bool
    authorized_key_present: bool
    ordinary_environment_preserved: bool


CHILD_CODE = """
import json, os, sys
if len(sys.argv) > 2:
    os.dup2(int(sys.argv[2]), 1)
print(json.dumps({
    'uid_matches': os.geteuid() == int(sys.argv[1]),
    'host_key_present': 'BYCLAW_TOOL_ENV_HOST_KEY' in os.environ,
    'authorized_key_present': 'BYCLAW_TOOL_ENV_AUTHORIZED_KEY' in os.environ,
    'ordinary_environment_preserved': (
        os.environ.get('BYCLAW_TOOL_ENV_WS_PORT') == '8022'
        and os.environ.get('TOOL_CHILD_TEST_MARKER') == 'preserved'
    ),
}))
"""


def main() -> None:
    if not sys.platform.startswith("linux") or os.geteuid() != 0:
        raise SystemExit("Run as root in the controlled Linux tool image.")
    source = Path(__file__).with_name("byclaw-browser-supervisor.py")
    spec = importlib.util.spec_from_file_location("browser_supervisor", source)
    if spec is None or spec.loader is None:
        raise RuntimeError("Cannot load the sibling browser supervisor")
    supervisor = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(supervisor)
    environment = {
        "PATH": os.environ["PATH"],
        "BYCLAW_TOOL_ENV_HOST_KEY": "fake-host-key-fixture",
        "BYCLAW_TOOL_ENV_AUTHORIZED_KEY": "fake-authorized-key-fixture",
        "BYCLAW_TOOL_ENV_WS_PORT": "8022",
        "TOOL_CHILD_TEST_MARKER": "preserved",
    }
    failures: list[str] = []
    for user in ("root", "byclaw"):
        account = pwd.getpwnam(user)
        command = [sys.executable, "-c", CHILD_CODE, str(account.pw_uid)]
        read_fd, write_fd = os.pipe()
        try:
            child = supervisor.spawn(
                [*command, str(write_fd)], environment, account, pass_fd=write_fd
            )
        finally:
            os.close(write_fd)
        with os.fdopen(read_fd) as output:
            spawned: ChildReport = json.load(output)
        if child.wait(timeout=10) != 0:
            raise RuntimeError(f"Real child failed for {user}")
        reported: ChildReport = supervisor.bycli_report(
            command, environment, account, timeout=10
        )
        expected: ChildReport = {
            "uid_matches": True,
            "host_key_present": account.pw_uid == 0,
            "authorized_key_present": account.pw_uid == 0,
            "ordinary_environment_preserved": True,
        }
        for method, actual in (("spawn", spawned), ("bycli_report", reported)):
            passed = actual == expected
            print(json.dumps({"user": user, "method": method, "passed": passed, **actual}))
            if not passed:
                failures.append(f"{user}:{method}")
    if environment["BYCLAW_TOOL_ENV_HOST_KEY"] != "fake-host-key-fixture":
        failures.append("parent-environment-mutated")
    if failures:
        raise SystemExit("FAIL: " + ", ".join(failures))
    print("PASS: real root/byclaw child transport credential boundaries")


if __name__ == "__main__":
    main()
