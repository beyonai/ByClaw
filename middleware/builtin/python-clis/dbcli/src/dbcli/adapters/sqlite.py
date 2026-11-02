from __future__ import annotations

import sqlite3
import time
from typing import Any

from dbcli.adapters.base import DataSourceAdapter
from dbcli.contracts import ResolvedDataSource, SqlRequest
from dbcli.errors import DbCliError
from dbcli.serialization import json_value


class SqliteAdapter(DataSourceAdapter):
    name = "sqlite"

    def connect(self, resolved: ResolvedDataSource) -> sqlite3.Connection:
        connection = sqlite3.connect(resolved.database, timeout=5, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def begin(self, connection: sqlite3.Connection, *, isolation: str, read_only: bool) -> None:
        del isolation, read_only
        connection.execute("BEGIN")

    def execute(self, connection: sqlite3.Connection, request: SqlRequest, *, max_rows: int) -> dict:
        started = time.monotonic()
        deadline = started + request.timeout_ms / 1000 if request.timeout_ms else None
        if deadline is not None:
            connection.set_progress_handler(lambda: int(time.monotonic() >= deadline), 1000)
        try:
            cursor = connection.execute(request.sql, request.params)
            columns = [item[0] for item in cursor.description or ()]
            if columns:
                rows = cursor.fetchmany(max_rows + 1)
                truncated = len(rows) > max_rows
                rows = rows[:max_rows]
                serialized = [
                    {column: json_value(row[column]) for column in columns}
                    for row in rows
                ]
                affected = 0
            else:
                serialized = []
                truncated = False
                affected = max(0, cursor.rowcount)
        except sqlite3.Error as exc:
            if deadline is not None and time.monotonic() >= deadline:
                raise DbCliError("DB_TIMEOUT", "SQL statement timed out", exit_code=13) from exc
            raise DbCliError("DB_SQL_ERROR", str(exc)) from exc
        finally:
            if deadline is not None:
                connection.set_progress_handler(None, 0)
        return {
            "affectedRows": affected,
            "columns": columns,
            "rows": serialized,
            "rowCount": len(serialized),
            "truncated": truncated,
            "elapsedMs": round((time.monotonic() - started) * 1000),
        }

    def list_schemas(self, connection: sqlite3.Connection) -> list[dict]:
        return [{"name": row[1]} for row in connection.execute("PRAGMA database_list")]

    def list_tables(
        self, connection: sqlite3.Connection, schema: str, object_types: tuple[str, ...]
    ) -> list[dict]:
        sqlite_types = []
        if "table" in object_types:
            sqlite_types.append("table")
        if "view" in object_types:
            sqlite_types.append("view")
        if not sqlite_types:
            return []
        placeholders = ",".join("?" for _ in sqlite_types)
        rows = connection.execute(
            f'SELECT name, type FROM "{schema}".sqlite_master '
            f"WHERE type IN ({placeholders}) AND name NOT LIKE 'sqlite_%' ORDER BY name",
            sqlite_types,
        )
        return [{"schema": schema, "name": row[0], "type": row[1].upper()} for row in rows]

    def describe_table(self, connection: sqlite3.Connection, schema: str, table: str) -> dict:
        quoted_table = table.replace('"', '""')
        rows = list(connection.execute(f'PRAGMA "{schema}".table_info("{quoted_table}")'))
        if not rows:
            raise DbCliError("TABLE_NOT_FOUND", "table not found")
        columns = [
            {
                "name": row[1],
                "type": row[2] or "unknown",
                "nullable": not bool(row[3]),
                "default": json_value(row[4]),
            }
            for row in rows
        ]
        primary_key = [row[1] for row in sorted(rows, key=lambda item: item[5]) if row[5] > 0]
        foreign_keys = [
            {"column": row[3], "referencedTable": row[2], "referencedColumn": row[4]}
            for row in connection.execute(f'PRAGMA "{schema}".foreign_key_list("{quoted_table}")')
        ]
        indexes = []
        unique_constraints = []
        for index_row in connection.execute(f'PRAGMA "{schema}".index_list("{quoted_table}")'):
            index_name = index_row[1]
            quoted_index = index_name.replace('"', '""')
            index_columns = [
                item[2]
                for item in connection.execute(f'PRAGMA "{schema}".index_info("{quoted_index}")')
            ]
            unique = bool(index_row[2])
            indexes.append({"name": index_name, "columns": index_columns, "unique": unique})
            origin = index_row[3] if len(index_row) > 3 else None
            if unique and origin != "pk":
                unique_constraints.append(index_columns)
        return {
            "schema": schema,
            "name": table,
            "columns": columns,
            "primaryKey": primary_key,
            "uniqueConstraints": unique_constraints,
            "foreignKeys": foreign_keys,
            "indexes": indexes,
        }

    def capabilities(self) -> dict:
        return {
            "driver": self.name,
            "transactions": True,
            "savepoints": True,
            "ddlTransactional": True,
            "cancel": True,
            "isolationLevels": ["read-committed", "serializable"],
        }
