#!/usr/bin/env python3
"""Transactional Python business logic. Never invoke this file directly."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any


SKILL_DIR = Path(__file__).resolve().parent.parent
EXPECTED_DATASOURCE_CODE = "3001"


class BusinessError(RuntimeError):
    def __init__(self, code: str, message: str, exit_code: int = 30) -> None:
        super().__init__(message)
        self.code = code
        self.exit_code = exit_code


def required_environment(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise BusinessError("TX_CONTEXT_REQUIRED", f"{name} is missing", 12)
    return value


def execute_sql(
    session_id: str,
    datasource_code: str,
    sql_file: str,
    params: dict[str, Any],
    *,
    expect_affected_rows: int | None = None,
) -> dict[str, Any]:
    command = [
        "dbcli",
        "sql",
        "--session-id",
        session_id,
        "--datasource-code",
        datasource_code,
        "--file",
        str(SKILL_DIR / "sql" / sql_file),
        "--params",
        json.dumps(params, separators=(",", ":")),
        "--format",
        "json",
    ]
    if expect_affected_rows is not None:
        command.extend(["--expect-affected-rows", str(expect_affected_rows)])

    result = subprocess.run(command, check=False, capture_output=True, text=True)
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise BusinessError("DBCLI_PROTOCOL_ERROR", "dbcli returned invalid JSON", 14) from exc

    if result.returncode != 0 or payload.get("ok") is not True:
        # Preserve the structured dbcli failure without exposing session context.
        print(result.stdout.strip(), file=sys.stderr)
        raise BusinessError("SQL_EXECUTION_FAILED", "dbcli sql failed", result.returncode or 10)
    return payload


def main(argv: list[str]) -> int:
    if len(argv) != 5:
        raise BusinessError("INVALID_ARGUMENT", "invalid internal arguments", 2)

    session_id = required_environment("DBCLI_SESSION_ID")
    datasource_code = required_environment("DBCLI_DATASOURCE_CODE")
    required_environment("DBCLI_TRANSACTION_ID")
    if datasource_code != EXPECTED_DATASOURCE_CODE:
        raise BusinessError("TX_DATASOURCE_MISMATCH", "unexpected data source", 12)

    _, request_id, from_account_id, to_account_id, amount = argv
    params = {
        "request_id": request_id,
        "from_account_id": from_account_id,
        "to_account_id": to_account_id,
        "amount": amount,
    }

    claim = execute_sql(session_id, datasource_code, "claim-transfer.sql", params)
    if claim.get("rowCount") == 0:
        existing = execute_sql(session_id, datasource_code, "get-transfer.sql", params)
        rows = existing.get("rows", [])
        if (
            len(rows) == 1
            and rows[0].get("same_request") is True
            and rows[0].get("status") == "SUCCESS"
        ):
            print(
                json.dumps(
                    {
                        "ok": True,
                        "requestId": request_id,
                        "status": "SUCCESS",
                        "alreadyProcessed": True,
                    },
                    separators=(",", ":"),
                )
            )
            return 0
        raise BusinessError(
            "IDEMPOTENCY_CONFLICT",
            "request_id already exists with different parameters or incomplete state",
        )

    locked = execute_sql(session_id, datasource_code, "lock-accounts.sql", params)
    if locked.get("rowCount") != 2:
        raise BusinessError(
            "ACCOUNT_NOT_AVAILABLE", "both accounts must exist and be active", 31
        )

    execute_sql(
        session_id,
        datasource_code,
        "debit.sql",
        params,
        expect_affected_rows=1,
    )
    execute_sql(
        session_id,
        datasource_code,
        "credit.sql",
        params,
        expect_affected_rows=1,
    )
    execute_sql(
        session_id,
        datasource_code,
        "complete-transfer.sql",
        params,
        expect_affected_rows=1,
    )

    print(
        json.dumps(
            {
                "ok": True,
                "requestId": request_id,
                "status": "SUCCESS",
                "alreadyProcessed": False,
            },
            separators=(",", ":"),
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv))
    except BusinessError as exc:
        print(
            json.dumps(
                {"ok": False, "error": {"code": exc.code, "message": str(exc)}},
                separators=(",", ":"),
            ),
            file=sys.stderr,
        )
        raise SystemExit(exc.exit_code)
