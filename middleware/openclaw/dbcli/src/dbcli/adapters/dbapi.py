from __future__ import annotations

import importlib
import re
import time
from typing import Any

from dbcli.adapters.base import DataSourceAdapter
from dbcli.contracts import ResolvedDataSource, SqlRequest
from dbcli.errors import DbCliError, EXIT_RUNTIME
from dbcli.serialization import json_value


_NAMED_PARAMETER = re.compile(r"(?<!:):([A-Za-z_][A-Za-z0-9_]*)")


class DbApiAdapter(DataSourceAdapter):
    def __init__(self, name: str) -> None:
        self.name = name

    def _module(self) -> Any:
        module_name = {
            "postgresql": "psycopg",
            "postgres": "psycopg",
            "opengauss": "psycopg",
            "mysql": "pymysql",
            "oracle": "oracledb",
        }[self.name]
        try:
            return importlib.import_module(module_name)
        except ImportError as exc:
            raise DbCliError(
                "DRIVER_UNAVAILABLE",
                f"required Python driver is not installed: {module_name}",
                exit_code=EXIT_RUNTIME,
            ) from exc

    @staticmethod
    def _host_port(endpoint: str | None, default_port: int) -> tuple[str, int]:
        value = endpoint or ""
        if ":" not in value:
            return value, default_port
        host, port = value.rsplit(":", 1)
        return host, int(port)

    def connect(self, resolved: ResolvedDataSource) -> Any:
        module = self._module()
        credential = resolved.credential
        username = credential.get("username") or credential.get("user")
        password = credential.get("secret") or credential.get("password")
        if self.name in {"postgresql", "postgres", "opengauss"}:
            host, port = self._host_port(resolved.endpoint, 5432)
            return module.connect(
                host=host,
                port=port,
                dbname=resolved.database,
                user=username,
                password=password,
                **resolved.options,
            )
        if self.name == "mysql":
            host, port = self._host_port(resolved.endpoint, 3306)
            return module.connect(
                host=host,
                port=port,
                database=resolved.database,
                user=username,
                password=password,
                autocommit=False,
                **resolved.options,
            )
        dsn = resolved.endpoint or resolved.database
        return module.connect(user=username, password=password, dsn=dsn, **resolved.options)

    def begin(self, connection: Any, *, isolation: str, read_only: bool) -> None:
        level = isolation.replace("-", " ").upper()
        cursor = connection.cursor()
        try:
            if self.name in {"postgresql", "postgres", "opengauss"}:
                cursor.execute(f"BEGIN ISOLATION LEVEL {level}" + (" READ ONLY" if read_only else ""))
            elif self.name == "mysql":
                cursor.execute(f"SET TRANSACTION ISOLATION LEVEL {level}")
                cursor.execute("START TRANSACTION" + (" READ ONLY" if read_only else ""))
            else:
                if read_only:
                    cursor.execute("SET TRANSACTION READ ONLY")
        finally:
            cursor.close()

    def _sql(self, sql: str) -> str:
        if self.name in {"postgresql", "postgres", "opengauss", "mysql"}:
            return _NAMED_PARAMETER.sub(r"%(\1)s", sql)
        return sql

    def execute(self, connection: Any, request: SqlRequest, *, max_rows: int) -> dict:
        started = time.monotonic()
        cursor = connection.cursor()
        try:
            cursor.execute(self._sql(request.sql), request.params)
            columns = [item[0] for item in cursor.description or ()]
            if columns:
                raw_rows = cursor.fetchmany(max_rows + 1)
                truncated = len(raw_rows) > max_rows
                rows = [
                    {column: json_value(value) for column, value in zip(columns, row)}
                    for row in raw_rows[:max_rows]
                ]
                affected = 0
            else:
                rows, truncated = [], False
                affected = max(0, cursor.rowcount or 0)
        except Exception as exc:
            raise DbCliError("DB_SQL_ERROR", str(exc)) from exc
        finally:
            cursor.close()
        return {
            "affectedRows": affected,
            "columns": columns,
            "rows": rows,
            "rowCount": len(rows),
            "truncated": truncated,
            "elapsedMs": round((time.monotonic() - started) * 1000),
        }

    def _query(self, connection: Any, sql: str, params: Any = None) -> list[dict]:
        cursor = connection.cursor()
        try:
            cursor.execute(sql, params or {})
            columns = [item[0] for item in cursor.description or ()]
            return [{column: json_value(value) for column, value in zip(columns, row)} for row in cursor.fetchall()]
        finally:
            cursor.close()

    def list_schemas(self, connection: Any) -> list[dict]:
        if self.name == "mysql":
            sql = "SELECT schema_name AS name FROM information_schema.schemata ORDER BY schema_name"
        elif self.name == "oracle":
            sql = "SELECT username AS name FROM all_users ORDER BY username"
        else:
            sql = "SELECT schema_name AS name FROM information_schema.schemata ORDER BY schema_name"
        return self._query(connection, sql)

    def list_tables(self, connection: Any, schema: str, object_types: tuple[str, ...]) -> list[dict]:
        del object_types
        if self.name == "oracle":
            sql = "SELECT owner AS schema, object_name AS name, object_type AS type FROM all_objects WHERE owner = :schema AND object_type IN ('TABLE','VIEW') ORDER BY object_name"
            return self._query(connection, sql, {"schema": schema.upper()})
        sql = "SELECT table_schema AS schema, table_name AS name, table_type AS type FROM information_schema.tables WHERE table_schema = %(schema)s ORDER BY table_name"
        return self._query(connection, sql, {"schema": schema})

    def describe_table(self, connection: Any, schema: str, table: str) -> dict:
        if self.name == "oracle":
            sql = "SELECT column_name AS name, data_type AS type, nullable FROM all_tab_columns WHERE owner = :schema AND table_name = :table ORDER BY column_id"
            columns = self._query(connection, sql, {"schema": schema.upper(), "table": table.upper()})
        else:
            sql = "SELECT column_name AS name, data_type AS type, is_nullable AS nullable, column_default AS default_value FROM information_schema.columns WHERE table_schema = %(schema)s AND table_name = %(table)s ORDER BY ordinal_position"
            columns = self._query(connection, sql, {"schema": schema, "table": table})
        if not columns:
            raise DbCliError("TABLE_NOT_FOUND", "table not found")
        for column in columns:
            column["nullable"] = str(column.get("nullable", "")).upper() in {"YES", "Y", "TRUE"}
        return {
            "schema": schema,
            "name": table,
            "columns": columns,
            "primaryKey": [],
            "uniqueConstraints": [],
            "foreignKeys": [],
            "indexes": [],
        }

    def capabilities(self) -> dict:
        return {
            "driver": self.name,
            "transactions": True,
            "savepoints": True,
            "ddlTransactional": self.name in {"postgresql", "postgres", "opengauss"},
            "cancel": True,
            "isolationLevels": ["read-committed", "repeatable-read", "serializable"],
        }

