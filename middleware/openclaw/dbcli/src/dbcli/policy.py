from __future__ import annotations

import re

from dbcli.contracts import Policy
from dbcli.errors import DbCliError, EXIT_POLICY


_LEADING_COMMENTS = re.compile(r"\A(?:\s|--[^\n]*(?:\n|\Z)|/\*.*?\*/)*", re.DOTALL)
_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_$]*$")
_TRANSACTION_WORDS = {"BEGIN", "COMMIT", "ROLLBACK", "SAVEPOINT", "RELEASE"}
_WRITE_WORDS = {"INSERT", "UPDATE", "DELETE", "MERGE", "REPLACE", "CREATE", "ALTER", "DROP", "TRUNCATE"}
_TABLE_REFERENCE = re.compile(
    r"\b(?:DELETE\s+FROM|FROM|JOIN|UPDATE|INSERT\s+INTO|MERGE\s+INTO)\s+"
    r"([A-Za-z_][A-Za-z0-9_$]*(?:\.[A-Za-z_][A-Za-z0-9_$]*)?)",
    re.IGNORECASE,
)
_CTE_NAME = re.compile(
    r"(?:\bWITH\b(?:\s+RECURSIVE)?|,)\s*([A-Za-z_][A-Za-z0-9_$]*)\s*"
    r"(?:\([^)]*\))?\s+AS\s*\(",
    re.IGNORECASE,
)


def statement_type(sql: str) -> str:
    stripped = _LEADING_COMMENTS.sub("", sql)
    match = re.match(r"([A-Za-z]+)", stripped)
    kind = match.group(1).upper() if match else "UNKNOWN"
    if kind == "WITH":
        upper = stripped.upper()
        for write_kind in ("INSERT", "UPDATE", "DELETE", "MERGE"):
            if re.search(rf"\b{write_kind}\b", upper):
                return write_kind
        return "SELECT" if re.search(r"\bSELECT\b", upper) else "UNKNOWN"
    return kind


def validate_identifier(value: str, kind: str) -> None:
    if not _IDENTIFIER.fullmatch(value):
        raise DbCliError("INVALID_IDENTIFIER", f"invalid {kind}", exit_code=EXIT_POLICY)


def validate_schema(policy: Policy, schema: str) -> None:
    validate_identifier(schema, "schema")
    if policy.allowed_schemas and schema not in policy.allowed_schemas:
        raise DbCliError("DB_POLICY_DENIED", "schema access denied", exit_code=EXIT_POLICY)


def validate_table(policy: Policy, schema: str, table: str) -> None:
    validate_schema(policy, schema)
    validate_identifier(table, "table")
    if policy.allowed_tables and f"{schema}.{table}" not in policy.allowed_tables:
        raise DbCliError("DB_POLICY_DENIED", "table access denied", exit_code=EXIT_POLICY)


def validate_sql(policy: Policy, sql: str, *, in_transaction: bool) -> str:
    kind = statement_type(sql)
    if kind in _TRANSACTION_WORDS:
        raise DbCliError("TRANSACTION_CONTROL_FORBIDDEN", "transaction SQL is managed by dbcli", exit_code=EXIT_POLICY)
    if kind == "UNKNOWN":
        raise DbCliError("SQL_INVALID", "cannot determine SQL statement type")
    if kind not in policy.allowed_operations:
        raise DbCliError("DB_POLICY_DENIED", "SQL operation is not allowed", exit_code=EXIT_POLICY)
    if kind in _WRITE_WORDS:
        if policy.read_only:
            raise DbCliError("DB_POLICY_DENIED", "data source is read-only", exit_code=EXIT_POLICY)
        if policy.writes_require_transaction and not in_transaction:
            raise DbCliError("WRITE_TRANSACTION_REQUIRED", "write statements require a transaction", exit_code=EXIT_POLICY)
    if policy.allowed_tables:
        allowed = set(policy.allowed_tables)
        cte_names = {match.group(1).lower() for match in _CTE_NAME.finditer(sql)}
        for match in _TABLE_REFERENCE.finditer(sql):
            reference = match.group(1)
            if reference.lower() in cte_names:
                continue
            permitted = reference in allowed
            if "." not in reference:
                permitted = any(item.endswith(f".{reference}") for item in allowed)
            if not permitted:
                raise DbCliError("DB_POLICY_DENIED", "table access denied", exit_code=EXIT_POLICY)
    return kind
