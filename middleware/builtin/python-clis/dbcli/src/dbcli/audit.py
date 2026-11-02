from __future__ import annotations

import hashlib
import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def write_audit(
    *,
    session_id: str | None,
    datasource_code: str | None,
    command: str | None,
    outcome: str,
    exit_code: int,
    payload: dict[str, Any],
    sql: str | None = None,
) -> None:
    target = os.environ.get("DBCLI_AUDIT_FILE")
    if not target:
        return
    record: dict[str, Any] = {
        "timestamp": datetime.now(UTC).isoformat(),
        "sessionHash": _hash(session_id) if session_id else None,
        "datasourceCode": datasource_code,
        "command": command,
        "outcome": outcome,
        "exitCode": exit_code,
        "requestId": payload.get("requestId"),
        "transactionId": payload.get("transactionId"),
        "affectedRows": payload.get("affectedRows"),
    }
    if sql is not None:
        record["sqlHash"] = _hash(sql)
    encoded = json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n"
    path = Path(target)
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
        try:
            os.write(descriptor, encoded.encode("utf-8"))
        finally:
            os.close(descriptor)
    except OSError:
        # Auditing must be provided by a protected platform path. A broken optional
        # local sink does not expose credentials or change database semantics.
        return

