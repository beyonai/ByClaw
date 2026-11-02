from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from dbcli.contracts import ResolvedDataSource, SqlRequest


class DataSourceAdapter(ABC):
    name: str

    @abstractmethod
    def connect(self, resolved: ResolvedDataSource) -> Any: ...

    @abstractmethod
    def begin(self, connection: Any, *, isolation: str, read_only: bool) -> None: ...

    @abstractmethod
    def execute(self, connection: Any, request: SqlRequest, *, max_rows: int) -> dict: ...

    def commit(self, connection: Any) -> None:
        connection.commit()

    def rollback(self, connection: Any) -> None:
        connection.rollback()

    def close(self, connection: Any) -> None:
        connection.close()

    @abstractmethod
    def list_schemas(self, connection: Any) -> list[dict]: ...

    @abstractmethod
    def list_tables(self, connection: Any, schema: str, object_types: tuple[str, ...]) -> list[dict]: ...

    @abstractmethod
    def describe_table(self, connection: Any, schema: str, table: str) -> dict: ...

    @abstractmethod
    def capabilities(self) -> dict: ...

