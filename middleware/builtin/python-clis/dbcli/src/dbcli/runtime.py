from __future__ import annotations

import json
import os
import signal
import subprocess
import threading
import uuid
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from dbcli.adapters import get_adapter
from dbcli.contracts import ResolvedDataSource, SqlRequest
from dbcli.discovery_client import DiscoveryClient
from dbcli.errors import DbCliError, EXIT_DATABASE, EXIT_TIMEOUT, EXIT_TRANSACTION, EXIT_UNKNOWN, invalid_argument
from dbcli.ipc import TransactionServer, request as ipc_request
from dbcli.policy import validate_schema, validate_sql, validate_table


class _TransactionInterrupted(Exception):
    pass


def _terminate_process_group(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
        process.communicate(timeout=1)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.communicate()


def _success(datasource_code: str, resolved: ResolvedDataSource, data: dict[str, Any]) -> dict[str, Any]:
    return {
        "ok": True,
        "requestId": f"req_{uuid.uuid4().hex}",
        "datasourceCode": datasource_code,
        "schemaVersion": resolved.schema_version,
        **data,
    }


class Runtime:
    def __init__(self, discovery: DiscoveryClient | None = None) -> None:
        self.discovery = discovery or DiscoveryClient()

    def resolve(self, session_id: str, datasource_code: str, purpose: str) -> tuple[ResolvedDataSource, Any]:
        resolved = self.discovery.resolve(session_id, datasource_code, purpose)
        return resolved, get_adapter(resolved.driver)

    @staticmethod
    def _require_credential_lifetime(resolved: ResolvedDataSource, seconds: float) -> None:
        expires_at = resolved.credential.get("expiresAt")
        if not expires_at:
            return
        expiry = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
        if expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=UTC)
        if expiry <= datetime.now(UTC) + timedelta(seconds=seconds):
            raise DbCliError(
                "CREDENTIAL_LIFETIME_TOO_SHORT",
                "credential does not cover the requested transaction timeout",
                exit_code=11,
            )

    def capabilities(self, session_id: str, datasource_code: str) -> dict[str, Any]:
        resolved, adapter = self.resolve(session_id, datasource_code, "metadata")
        data = adapter.capabilities()
        data["policy"] = {
            "readOnly": resolved.policy.read_only,
            "writesRequireTransaction": resolved.policy.writes_require_transaction,
            "allowedSchemas": list(resolved.policy.allowed_schemas),
            "allowedTables": list(resolved.policy.allowed_tables),
            "allowedOperations": list(resolved.policy.allowed_operations),
            "maxRows": resolved.policy.max_rows,
        }
        return _success(datasource_code, resolved, {"data": data})

    def list_schemas(self, session_id: str, datasource_code: str) -> dict[str, Any]:
        resolved, adapter = self.resolve(session_id, datasource_code, "metadata")
        connection = adapter.connect(resolved)
        try:
            schemas = adapter.list_schemas(connection)
            if resolved.policy.allowed_schemas:
                allowed = set(resolved.policy.allowed_schemas)
                schemas = [item for item in schemas if item["name"] in allowed]
            return _success(datasource_code, resolved, {"data": {"schemas": schemas}})
        finally:
            adapter.close(connection)

    def list_tables(
        self, session_id: str, datasource_code: str, schema: str, object_types: tuple[str, ...]
    ) -> dict[str, Any]:
        resolved, adapter = self.resolve(session_id, datasource_code, "metadata")
        validate_schema(resolved.policy, schema)
        connection = adapter.connect(resolved)
        try:
            tables = adapter.list_tables(connection, schema, object_types)
            if resolved.policy.allowed_tables:
                allowed = set(resolved.policy.allowed_tables)
                tables = [
                    item for item in tables if f"{item['schema']}.{item['name']}" in allowed
                ]
            return _success(datasource_code, resolved, {"data": {"tables": tables}})
        finally:
            adapter.close(connection)

    def describe_table(
        self, session_id: str, datasource_code: str, schema: str, table: str
    ) -> dict[str, Any]:
        resolved, adapter = self.resolve(session_id, datasource_code, "metadata")
        validate_table(resolved.policy, schema, table)
        connection = adapter.connect(resolved)
        try:
            data = adapter.describe_table(connection, schema, table)
            data["allowedOperations"] = list(resolved.policy.allowed_operations)
            return _success(datasource_code, resolved, {"data": {"table": data}})
        finally:
            adapter.close(connection)

    @staticmethod
    def _execute(
        adapter: Any,
        connection: Any,
        resolved: ResolvedDataSource,
        datasource_code: str,
        request: SqlRequest,
        *,
        in_transaction: bool,
    ) -> dict[str, Any]:
        kind = validate_sql(resolved.policy, request.sql, in_transaction=in_transaction)
        max_rows = min(request.max_rows or resolved.policy.max_rows, resolved.policy.max_rows)
        effective_timeout = min(
            request.timeout_ms or resolved.policy.statement_timeout_ms,
            resolved.policy.statement_timeout_ms,
        )
        result = adapter.execute(
            connection, replace(request, timeout_ms=effective_timeout), max_rows=max_rows
        )
        expected = request.expect_affected_rows
        if expected is not None and result["affectedRows"] != expected:
            raise DbCliError(
                "EXPECTED_ROWS_MISMATCH",
                f"expected {expected} affected rows but got {result['affectedRows']}",
                exit_code=EXIT_DATABASE,
            )
        return _success(
            datasource_code,
            resolved,
            {"statementType": kind, **result},
        )

    def sql(self, session_id: str, datasource_code: str, sql_request: SqlRequest) -> dict[str, Any]:
        socket_path = os.environ.get("DBCLI_TRANSACTION_SOCKET")
        token = os.environ.get("DBCLI_TRANSACTION_TOKEN")
        if socket_path and token:
            payload = {
                "token": token,
                "sessionId": session_id,
                "datasourceCode": datasource_code,
                "sql": sql_request.sql,
                "params": sql_request.params,
                "maxRows": sql_request.max_rows,
                "timeoutMs": sql_request.timeout_ms,
                "expectAffectedRows": sql_request.expect_affected_rows,
            }
            response = ipc_request(socket_path, payload)
            if response.get("ok") is not True:
                error = response.get("error") or {}
                raise DbCliError(
                    str(error.get("code") or "TX_FAILED"),
                    str(error.get("message") or "transaction SQL failed"),
                    exit_code=int(response.get("exitCode") or EXIT_TRANSACTION),
                    retryable=bool(error.get("retryable", False)),
                )
            return response

        resolved, adapter = self.resolve(session_id, datasource_code, "sql")
        connection = adapter.connect(resolved)
        try:
            result = self._execute(
                adapter, connection, resolved, datasource_code, sql_request, in_transaction=False
            )
            adapter.commit(connection)
            return result
        except Exception:
            adapter.rollback(connection)
            raise
        finally:
            adapter.close(connection)

    def execute_plan(
        self, session_id: str, datasource_code: str, plan_path: Path
    ) -> dict[str, Any]:
        try:
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise invalid_argument("transaction plan is unreadable or invalid") from exc
        statements = plan.get("statements")
        if not isinstance(statements, list) or not statements:
            raise invalid_argument("transaction plan requires non-empty statements")

        resolved, adapter = self.resolve(session_id, datasource_code, "transaction")
        plan_timeout_seconds = min(
            float(plan.get("timeoutMs") or resolved.policy.transaction_timeout_ms),
            float(resolved.policy.transaction_timeout_ms),
        ) / 1000
        self._require_credential_lifetime(resolved, plan_timeout_seconds)
        connection = adapter.connect(resolved)
        results = []
        try:
            adapter.begin(
                connection,
                isolation=str(plan.get("isolation") or "read-committed"),
                read_only=bool(plan.get("readOnly", False)),
            )
            for index, item in enumerate(statements):
                if not isinstance(item, dict):
                    raise invalid_argument(f"statement {index} is invalid")
                sql = item.get("sql")
                if not sql and item.get("sqlFile"):
                    sql = (plan_path.parent / str(item["sqlFile"])).read_text(encoding="utf-8")
                if not isinstance(sql, str) or not sql.strip():
                    raise invalid_argument(f"statement {index} has no SQL")
                params = item.get("params", {})
                if item.get("paramsFile"):
                    params = json.loads(
                        (plan_path.parent / str(item["paramsFile"])).read_text(encoding="utf-8")
                    )
                result = self._execute(
                    adapter,
                    connection,
                    resolved,
                    datasource_code,
                    SqlRequest(
                        sql=sql,
                        params=params,
                        expect_affected_rows=item.get("expectAffectedRows"),
                    ),
                    in_transaction=True,
                )
                results.append({"id": item.get("id", str(index)), **result})
            adapter.commit(connection)
        except Exception:
            adapter.rollback(connection)
            raise
        finally:
            adapter.close(connection)
        return _success(
            datasource_code,
            resolved,
            {"transactionId": f"tx_{uuid.uuid4().hex}", "state": "COMMITTED", "results": results},
        )

    def run_transaction(
        self,
        session_id: str,
        datasource_code: str,
        command: list[str],
        *,
        isolation: str,
        read_only: bool,
        timeout_seconds: float,
    ) -> dict[str, Any]:
        if not command:
            raise invalid_argument("transaction command is required")
        resolved, adapter = self.resolve(session_id, datasource_code, "transaction")
        timeout_seconds = min(
            timeout_seconds,
            resolved.policy.transaction_timeout_ms / 1000,
        )
        self._require_credential_lifetime(resolved, timeout_seconds)
        connection = adapter.connect(resolved)
        transaction_id = f"tx_{uuid.uuid4().hex}"
        lock = threading.Lock()

        def handle(payload: dict[str, Any]) -> dict[str, Any]:
            if payload.get("sessionId") != session_id or payload.get("datasourceCode") != datasource_code:
                raise DbCliError("TX_CONTEXT_MISMATCH", "transaction context mismatch", exit_code=EXIT_TRANSACTION)
            request = SqlRequest(
                sql=str(payload.get("sql") or ""),
                params=payload.get("params") or {},
                max_rows=payload.get("maxRows"),
                timeout_ms=payload.get("timeoutMs"),
                expect_affected_rows=payload.get("expectAffectedRows"),
            )
            with lock:
                response = self._execute(
                    adapter, connection, resolved, datasource_code, request, in_transaction=True
                )
            response["transactionId"] = transaction_id
            return response

        server = TransactionServer(handle)
        try:
            adapter.begin(connection, isolation=isolation, read_only=read_only)
            server.start()
            environment = os.environ.copy()
            environment.update(
                {
                    "DBCLI_TRANSACTION_SOCKET": str(server.socket_path),
                    "DBCLI_TRANSACTION_TOKEN": server.token,
                    "DBCLI_TRANSACTION_ID": transaction_id,
                    "DBCLI_SESSION_ID": session_id,
                    "DBCLI_DATASOURCE_CODE": datasource_code,
                }
            )
            process = subprocess.Popen(
                command,
                env=environment,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                start_new_session=True,
            )
            previous_handlers: dict[signal.Signals, Any] = {}
            if threading.current_thread() is threading.main_thread():
                def interrupted(_signum: int, _frame: Any) -> None:
                    raise _TransactionInterrupted

                for signum in (signal.SIGINT, signal.SIGTERM):
                    previous_handlers[signum] = signal.getsignal(signum)
                    signal.signal(signum, interrupted)
            try:
                child_stdout, _child_stderr = process.communicate(timeout=timeout_seconds)
            except subprocess.TimeoutExpired as exc:
                _terminate_process_group(process)
                raise DbCliError("TX_TIMEOUT", "transaction command timed out", exit_code=EXIT_TIMEOUT) from exc
            except _TransactionInterrupted as exc:
                _terminate_process_group(process)
                raise DbCliError(
                    "TX_INTERRUPTED", "transaction command was interrupted", exit_code=EXIT_TIMEOUT
                ) from exc
            finally:
                for signum, previous in previous_handlers.items():
                    signal.signal(signum, previous)

            if process.returncode != 0 or server.failed:
                raise DbCliError("TX_FAILED", "transaction command failed", exit_code=EXIT_TRANSACTION)
            try:
                adapter.commit(connection)
            except Exception as exc:
                raise DbCliError(
                    "TX_OUTCOME_UNKNOWN",
                    "connection failed while committing transaction",
                    exit_code=EXIT_UNKNOWN,
                ) from exc
            child_result: Any = child_stdout.strip()
            if child_result:
                try:
                    child_result = json.loads(child_result.splitlines()[-1])
                except ValueError:
                    pass
            return _success(
                datasource_code,
                resolved,
                {
                    "transactionId": transaction_id,
                    "state": "COMMITTED",
                    "childResult": child_result,
                },
            )
        except Exception:
            try:
                adapter.rollback(connection)
            except Exception:
                pass
            raise
        finally:
            server.close()
            adapter.close(connection)
