from __future__ import annotations

from dbcli.adapters.base import DataSourceAdapter
from dbcli.adapters.sqlite import SqliteAdapter
from dbcli.errors import DbCliError, EXIT_RUNTIME


def get_adapter(name: str) -> DataSourceAdapter:
    if name == "sqlite":
        return SqliteAdapter()
    if name in {"postgresql", "postgres", "opengauss", "mysql", "oracle"}:
        from dbcli.adapters.dbapi import DbApiAdapter

        return DbApiAdapter(name)
    raise DbCliError("DRIVER_UNSUPPORTED", f"unsupported driver: {name}", exit_code=EXIT_RUNTIME)

