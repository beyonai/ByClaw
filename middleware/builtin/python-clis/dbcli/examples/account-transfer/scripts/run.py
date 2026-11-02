#!/usr/bin/env python3
"""Python public entry point for the account-transfer example."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from decimal import Decimal, InvalidOperation
from pathlib import Path


DATASOURCE_CODE = "3001"
ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
SCRIPT_DIR = Path(__file__).resolve().parent


def fail(message: str) -> int:
    print(
        json.dumps(
            {"ok": False, "error": {"code": "INVALID_ARGUMENT", "message": message}},
            separators=(",", ":"),
        ),
        file=sys.stderr,
    )
    return 2


def valid_id(value: str) -> bool:
    return bool(ID_PATTERN.fullmatch(value))


def main(argv: list[str]) -> int:
    if len(argv) != 6:
        return fail(
            "expected session_id, request_id, from_account_id, "
            "to_account_id and amount"
        )

    _, session_id, request_id, from_account_id, to_account_id, amount_text = argv

    if not session_id:
        return fail("session_id is required")
    if not valid_id(request_id):
        return fail("request_id format is invalid")
    if not valid_id(from_account_id) or not valid_id(to_account_id):
        return fail("account ID format is invalid")
    if from_account_id == to_account_id:
        return fail("source and target accounts must differ")

    try:
        amount = Decimal(amount_text)
    except InvalidOperation:
        return fail("amount must be a decimal")
    if not amount.is_finite() or amount <= 0 or amount.as_tuple().exponent < -2:
        return fail("amount must be positive with at most two decimal places")

    command = [
        "dbcli",
        "transaction",
        "run",
        "--session-id",
        session_id,
        "--datasource-code",
        DATASOURCE_CODE,
        "--isolation",
        "read-committed",
        "--timeout",
        "30s",
        "--",
        sys.executable,
        str(SCRIPT_DIR / "business.py"),
        request_id,
        from_account_id,
        to_account_id,
        format(amount, "f"),
    ]

    # Inherit stdin/stdout/stderr so dbcli retains control of the public result.
    return subprocess.run(command, check=False).returncode


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
