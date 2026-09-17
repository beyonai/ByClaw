from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class Policy:
    read_only: bool = False
    writes_require_transaction: bool = True
    allowed_schemas: tuple[str, ...] = ()
    allowed_tables: tuple[str, ...] = ()
    allowed_operations: tuple[str, ...] = ("SELECT",)
    max_rows: int = 200
    statement_timeout_ms: int = 30_000
    transaction_timeout_ms: int = 120_000

    @classmethod
    def from_dict(cls, value: dict[str, Any] | None) -> "Policy":
        data = value or {}
        return cls(
            read_only=bool(data.get("readOnly", False)),
            writes_require_transaction=bool(data.get("writesRequireTransaction", True)),
            allowed_schemas=tuple(data.get("allowedSchemas") or ()),
            allowed_tables=tuple(data.get("allowedTables") or ()),
            allowed_operations=tuple(str(v).upper() for v in data.get("allowedOperations") or ("SELECT",)),
            max_rows=max(1, int(data.get("maxRows", 200))),
            statement_timeout_ms=max(1, int(data.get("statementTimeoutMs", 30_000))),
            transaction_timeout_ms=max(1, int(data.get("transactionTimeoutMs", 120_000))),
        )


@dataclass(frozen=True)
class ResolvedDataSource:
    resolution_id: str
    driver: str
    database: str
    endpoint: str | None
    credential: dict[str, Any]
    policy: Policy
    schema_version: str
    options: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "ResolvedDataSource":
        return cls(
            resolution_id=str(value.get("resolutionId") or ""),
            driver=str(value.get("driver") or "").lower(),
            database=str(value.get("database") or ""),
            endpoint=value.get("endpoint"),
            credential=dict(value.get("credential") or {}),
            policy=Policy.from_dict(value.get("policy")),
            schema_version=str(value.get("schemaVersion") or "unknown"),
            options=dict(value.get("options") or {}),
        )


@dataclass(frozen=True)
class SqlRequest:
    sql: str
    params: dict[str, Any] | list[Any]
    max_rows: int | None = None
    timeout_ms: int | None = None
    expect_affected_rows: int | None = None
