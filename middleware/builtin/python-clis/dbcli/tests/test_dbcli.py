from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


PROJECT_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = PROJECT_DIR / "src"


class DiscoveryServer:
    def __init__(
        self,
        database_path: Path,
        *,
        writes_require_transaction: bool = True,
        expires_at: str | None = None,
    ):
        self.database_path = database_path
        self.writes_require_transaction = writes_require_transaction
        self.expires_at = expires_at
        self.requests: list[dict[str, Any]] = []
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:  # noqa: N802
                length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(length))
                owner.requests.append(payload)
                if payload.get("sessionId") == "denied":
                    body = {"error": {"code": "SESSION_INVALID", "message": "invalid session"}}
                    encoded = json.dumps(body).encode()
                    self.send_response(403)
                else:
                    body = {
                        "resolutionId": "resolution-1",
                        "driver": "sqlite",
                        "database": str(owner.database_path),
                        "credential": {
                            "type": "none",
                            "expiresAt": owner.expires_at
                            or (datetime.now(UTC) + timedelta(minutes=10)).isoformat(),
                        },
                        "policy": {
                            "readOnly": False,
                            "writesRequireTransaction": owner.writes_require_transaction,
                            "allowedSchemas": ["main"],
                            "allowedTables": ["main.account", "main.transfer_request"],
                            "allowedOperations": ["SELECT", "INSERT", "UPDATE", "DELETE"],
                            "maxRows": 100,
                            "statementTimeoutMs": 5000,
                            "transactionTimeoutMs": 10000,
                        },
                        "schemaVersion": "test/1",
                    }
                    encoded = json.dumps(body).encode()
                    self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)

            def log_message(self, *_args: Any) -> None:
                return

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    @property
    def url(self) -> str:
        host, port = self.server.server_address
        return f"http://{host}:{port}/internal/v1/datasources/resolve"

    def __enter__(self) -> "DiscoveryServer":
        self.thread.start()
        return self

    def __exit__(self, *_args: Any) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)


class DbCliTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        self.database = self.root / "business.sqlite3"
        with sqlite3.connect(self.database) as connection:
            connection.executescript(
                """
                CREATE TABLE account (
                    account_id TEXT PRIMARY KEY,
                    external_ref TEXT UNIQUE,
                    balance NUMERIC NOT NULL,
                    status TEXT NOT NULL DEFAULT 'ACTIVE'
                );
                CREATE TABLE transfer_request (
                    request_id TEXT PRIMARY KEY,
                    from_account_id TEXT NOT NULL REFERENCES account(account_id)
                );
                CREATE TABLE secret_table (secret TEXT);
                INSERT INTO account(account_id, external_ref, balance)
                VALUES ('A', 'EXT-A', 100), ('B', 'EXT-B', 0);
                """
            )

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def run_cli(
        self,
        server: DiscoveryServer,
        *arguments: str,
        extra_env: dict[str, str] | None = None,
    ) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        env["PYTHONPATH"] = str(SRC_DIR)
        env["DBCLI_DISCOVERY_URL"] = server.url
        env["DBCLI_ALLOW_INSECURE_DISCOVERY"] = "1"
        if extra_env:
            env.update(extra_env)
        return subprocess.run(
            [sys.executable, "-m", "dbcli", *arguments],
            cwd=PROJECT_DIR,
            env=env,
            check=False,
            capture_output=True,
            text=True,
        )

    def json_output(self, result: subprocess.CompletedProcess[str]) -> dict[str, Any]:
        self.assertTrue(result.stdout.strip(), result.stderr)
        return json.loads(result.stdout)


class CommandContractTests(DbCliTestCase):
    def test_every_data_command_requires_session_and_datasource(self) -> None:
        with DiscoveryServer(self.database) as server:
            result = self.run_cli(server, "schema", "list")
        self.assertEqual(2, result.returncode)
        self.assertEqual("INVALID_ARGUMENT", self.json_output(result)["error"]["code"])

    def test_invalid_session_is_reported_as_structured_error(self) -> None:
        with DiscoveryServer(self.database) as server:
            result = self.run_cli(
                server,
                "schema",
                "list",
                "--session-id",
                "denied",
                "--datasource-code",
                "finance-core",
            )
        self.assertEqual(11, result.returncode)
        self.assertEqual("SESSION_INVALID", self.json_output(result)["error"]["code"])

    def test_insecure_discovery_url_is_rejected_without_explicit_override(self) -> None:
        with DiscoveryServer(self.database) as server:
            result = self.run_cli(
                server,
                "schema",
                "list",
                "--session-id",
                "session-1",
                "--datasource-code",
                "finance-core",
                extra_env={"DBCLI_ALLOW_INSECURE_DISCOVERY": "0"},
            )
        self.assertEqual(14, result.returncode)
        self.assertEqual("DISCOVERY_TLS_REQUIRED", self.json_output(result)["error"]["code"])

    def test_expired_discovery_credential_is_rejected_before_connecting(self) -> None:
        expired = (datetime.now(UTC) - timedelta(seconds=1)).isoformat()
        with DiscoveryServer(self.database, expires_at=expired) as server:
            result = self.run_cli(
                server,
                "schema",
                "list",
                "--session-id",
                "session-1",
                "--datasource-code",
                "finance-core",
            )
        self.assertEqual(11, result.returncode)
        self.assertEqual("CREDENTIAL_EXPIRED", self.json_output(result)["error"]["code"])


class MetadataTests(DbCliTestCase):
    def test_capabilities_and_metadata_are_filtered_and_versioned(self) -> None:
        with DiscoveryServer(self.database) as server:
            common = ("--session-id", "session-1", "--datasource-code", "finance-core")
            capabilities = self.run_cli(server, "datasource", "capabilities", *common)
            schemas = self.run_cli(server, "schema", "list", *common)
            tables = self.run_cli(server, "table", "list", *common, "--schema", "main")
            described = self.run_cli(
                server, "table", "describe", *common, "--schema", "main", "--table", "account"
            )

        self.assertTrue(self.json_output(capabilities)["data"]["transactions"])
        self.assertEqual("test/1", self.json_output(schemas)["schemaVersion"])
        self.assertEqual([{"name": "main"}], self.json_output(schemas)["data"]["schemas"])
        table_names = {item["name"] for item in self.json_output(tables)["data"]["tables"]}
        self.assertIn("account", table_names)
        table = self.json_output(described)["data"]["table"]
        self.assertEqual(["account_id"], table["primaryKey"])
        self.assertEqual("account", table["name"])
        self.assertIn(["external_ref"], table["uniqueConstraints"])
        self.assertTrue(table["indexes"])
        self.assertNotIn("secret_table", table_names)

    def test_describe_denies_table_not_in_object_allowlist(self) -> None:
        with DiscoveryServer(self.database) as server:
            result = self.run_cli(
                server,
                "table",
                "describe",
                "--session-id",
                "session-1",
                "--datasource-code",
                "finance-core",
                "--schema",
                "main",
                "--table",
                "secret_table",
            )
        self.assertEqual(11, result.returncode)
        self.assertEqual("DB_POLICY_DENIED", self.json_output(result)["error"]["code"])

    def test_unallowed_schema_is_not_revealed(self) -> None:
        with DiscoveryServer(self.database) as server:
            result = self.run_cli(
                server,
                "table",
                "list",
                "--session-id",
                "session-1",
                "--datasource-code",
                "finance-core",
                "--schema",
                "private",
            )
        self.assertEqual(11, result.returncode)
        self.assertEqual("DB_POLICY_DENIED", self.json_output(result)["error"]["code"])


class SqlTests(DbCliTestCase):
    def test_parameterized_select_returns_rows(self) -> None:
        with DiscoveryServer(self.database) as server:
            result = self.run_cli(
                server,
                "sql",
                "--session-id",
                "session-1",
                "--datasource-code",
                "finance-core",
                "--text",
                "SELECT account_id, balance FROM account WHERE account_id = :id",
                "--params",
                '{"id":"A"}',
            )
        payload = self.json_output(result)
        self.assertEqual(0, result.returncode)
        self.assertEqual("A", payload["rows"][0]["account_id"])

    def test_standalone_write_is_denied_by_policy(self) -> None:
        with DiscoveryServer(self.database) as server:
            result = self.run_cli(
                server,
                "sql",
                "--session-id",
                "session-1",
                "--datasource-code",
                "finance-core",
                "--text",
                "UPDATE account SET balance = 0",
            )
        self.assertEqual(11, result.returncode)
        self.assertEqual("WRITE_TRANSACTION_REQUIRED", self.json_output(result)["error"]["code"])

    def test_sql_cannot_read_table_outside_object_allowlist(self) -> None:
        with DiscoveryServer(self.database) as server:
            result = self.run_cli(
                server,
                "sql",
                "--session-id",
                "session-1",
                "--datasource-code",
                "finance-core",
                "--text",
                "SELECT secret FROM secret_table",
            )
        self.assertEqual(11, result.returncode)
        self.assertEqual("DB_POLICY_DENIED", self.json_output(result)["error"]["code"])

    def test_transaction_control_sql_is_denied(self) -> None:
        with DiscoveryServer(self.database) as server:
            result = self.run_cli(
                server,
                "sql",
                "--session-id",
                "session-1",
                "--datasource-code",
                "finance-core",
                "--text",
                "BEGIN",
            )
        self.assertEqual(11, result.returncode)
        self.assertEqual("TRANSACTION_CONTROL_FORBIDDEN", self.json_output(result)["error"]["code"])

    def test_jsonl_output_contains_one_row_per_line(self) -> None:
        with DiscoveryServer(self.database) as server:
            result = self.run_cli(
                server,
                "sql",
                "--session-id",
                "session-1",
                "--datasource-code",
                "finance-core",
                "--text",
                "SELECT account_id FROM account ORDER BY account_id",
                "--format",
                "jsonl",
            )
        self.assertEqual(0, result.returncode)
        self.assertEqual([{"account_id": "A"}, {"account_id": "B"}], [json.loads(v) for v in result.stdout.splitlines()])

    def test_statement_timeout_cancels_long_query(self) -> None:
        long_query = (
            "WITH RECURSIVE counter(value) AS "
            "(SELECT 1 UNION ALL SELECT value + 1 FROM counter WHERE value < 10000000) "
            "SELECT sum(value) FROM counter"
        )
        with DiscoveryServer(self.database) as server:
            result = self.run_cli(
                server,
                "sql",
                "--session-id",
                "session-1",
                "--datasource-code",
                "finance-core",
                "--text",
                long_query,
                "--timeout",
                "1ms",
            )
        self.assertEqual(13, result.returncode)
        self.assertEqual("DB_TIMEOUT", self.json_output(result)["error"]["code"])

    def test_audit_log_hashes_session_and_sql(self) -> None:
        audit_file = self.root / "audit.jsonl"
        sql = "SELECT account_id FROM account"
        with DiscoveryServer(self.database) as server:
            result = self.run_cli(
                server,
                "sql",
                "--session-id",
                "session-1",
                "--datasource-code",
                "finance-core",
                "--text",
                sql,
                extra_env={"DBCLI_AUDIT_FILE": str(audit_file)},
            )
        self.assertEqual(0, result.returncode)
        audit_text = audit_file.read_text()
        record = json.loads(audit_text)
        self.assertNotIn("session-1", audit_text)
        self.assertNotIn(sql, audit_text)
        self.assertEqual("finance-core", record["datasourceCode"])
        self.assertEqual("SUCCESS", record["outcome"])
        self.assertIn("sqlHash", record)

    def test_affected_row_assertion_fails(self) -> None:
        with DiscoveryServer(self.database, writes_require_transaction=False) as server:
            result = self.run_cli(
                server,
                "sql",
                "--session-id",
                "session-1",
                "--datasource-code",
                "finance-core",
                "--text",
                "UPDATE account SET balance = 1 WHERE account_id = :id",
                "--params",
                '{"id":"missing"}',
                "--expect-affected-rows",
                "1",
            )
        self.assertEqual(10, result.returncode)
        self.assertEqual("EXPECTED_ROWS_MISMATCH", self.json_output(result)["error"]["code"])


class PlanTransactionTests(DbCliTestCase):
    def write_plan(self, statements: list[dict[str, Any]]) -> Path:
        path = self.root / "plan.json"
        path.write_text(json.dumps({"statements": statements}))
        return path

    def balances(self) -> tuple[int, int]:
        with sqlite3.connect(self.database) as connection:
            rows = connection.execute(
                "SELECT balance FROM account ORDER BY account_id"
            ).fetchall()
        return rows[0][0], rows[1][0]

    def test_plan_commits_all_statements(self) -> None:
        plan = self.write_plan(
            [
                {
                    "sql": "UPDATE account SET balance = balance - :amount WHERE account_id = 'A'",
                    "params": {"amount": 10},
                    "expectAffectedRows": 1,
                },
                {
                    "sql": "UPDATE account SET balance = balance + :amount WHERE account_id = 'B'",
                    "params": {"amount": 10},
                    "expectAffectedRows": 1,
                },
            ]
        )
        with DiscoveryServer(self.database) as server:
            result = self.run_cli(
                server,
                "transaction",
                "execute",
                "--session-id",
                "session-1",
                "--datasource-code",
                "finance-core",
                "--file",
                str(plan),
            )
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertEqual((90, 10), self.balances())

    def test_plan_rolls_back_when_later_statement_fails(self) -> None:
        plan = self.write_plan(
            [
                {"sql": "UPDATE account SET balance = 90 WHERE account_id = 'A'"},
                {"sql": "UPDATE missing_table SET value = 1"},
            ]
        )
        with DiscoveryServer(self.database) as server:
            result = self.run_cli(
                server,
                "transaction",
                "execute",
                "--session-id",
                "session-1",
                "--datasource-code",
                "finance-core",
                "--file",
                str(plan),
            )
        self.assertEqual(11, result.returncode)
        self.assertEqual("DB_POLICY_DENIED", self.json_output(result)["error"]["code"])
        self.assertEqual((100, 0), self.balances())


class ScriptTransactionTests(PlanTransactionTests):
    def write_child(self, second_sql: str, *, ignore_second_failure: bool = False) -> Path:
        child = self.root / "child.py"
        child.write_text(
            """
import os
import subprocess
import sys

common = [
    sys.executable, "-m", "dbcli", "sql",
    "--session-id", os.environ["DBCLI_SESSION_ID"],
    "--datasource-code", os.environ["DBCLI_DATASOURCE_CODE"],
]
first = subprocess.run(common + ["--text", "UPDATE account SET balance = balance - 10 WHERE account_id = 'A'"])
if first.returncode:
    raise SystemExit(first.returncode)
second = subprocess.run(common + ["--text", SECOND_SQL])
if second.returncode and not IGNORE_FAILURE:
    raise SystemExit(second.returncode)
""".replace("SECOND_SQL", repr(second_sql)).replace(
                "IGNORE_FAILURE", repr(ignore_second_failure)
            )
        )
        return child

    def run_transaction(self, server: DiscoveryServer, child: Path) -> subprocess.CompletedProcess[str]:
        return self.run_cli(
            server,
            "transaction",
            "run",
            "--session-id",
            "session-1",
            "--datasource-code",
            "finance-core",
            "--timeout",
            "5s",
            "--",
            sys.executable,
            str(child),
        )

    def test_script_transaction_commits_and_discovers_only_once(self) -> None:
        child = self.write_child(
            "UPDATE account SET balance = balance + 10 WHERE account_id = 'B'"
        )
        with DiscoveryServer(self.database) as server:
            result = self.run_transaction(server, child)
            request_count = len(server.requests)
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertEqual((90, 10), self.balances())
        self.assertEqual(1, request_count)

    def test_script_transaction_rolls_back_on_child_failure(self) -> None:
        child = self.write_child("UPDATE missing_table SET value = 1")
        with DiscoveryServer(self.database) as server:
            result = self.run_transaction(server, child)
        self.assertNotEqual(0, result.returncode)
        self.assertEqual((100, 0), self.balances())

    def test_transaction_cannot_commit_if_child_ignores_sql_failure(self) -> None:
        child = self.write_child("UPDATE missing_table SET value = 1", ignore_second_failure=True)
        with DiscoveryServer(self.database) as server:
            result = self.run_transaction(server, child)
        self.assertEqual(12, result.returncode)
        self.assertEqual("TX_FAILED", self.json_output(result)["error"]["code"])
        self.assertEqual((100, 0), self.balances())

    def test_failed_transaction_rejects_later_sql(self) -> None:
        marker = self.root / "second-status.txt"
        child = self.root / "poisoned.py"
        child.write_text(
            """
import os
import pathlib
import subprocess
import sys
common = [sys.executable, '-m', 'dbcli', 'sql', '--session-id', os.environ['DBCLI_SESSION_ID'], '--datasource-code', os.environ['DBCLI_DATASOURCE_CODE']]
subprocess.run(common + ['--text', 'UPDATE missing_table SET value = 1'])
second = subprocess.run(common + ['--text', "UPDATE account SET balance = 1 WHERE account_id = 'A'"])
pathlib.Path(sys.argv[1]).write_text(str(second.returncode))
"""
        )
        with DiscoveryServer(self.database) as server:
            result = self.run_cli(
                server,
                "transaction", "run",
                "--session-id", "session-1",
                "--datasource-code", "finance-core",
                "--timeout", "5s", "--",
                sys.executable, str(child), str(marker),
            )
        self.assertEqual(12, result.returncode)
        self.assertEqual("12", marker.read_text())
        self.assertEqual((100, 0), self.balances())

    def test_transaction_context_cannot_be_switched(self) -> None:
        child = self.root / "mismatch.py"
        child.write_text(
            """
import os
import subprocess
import sys
raise SystemExit(subprocess.run([sys.executable, '-m', 'dbcli', 'sql', '--session-id', 'another-session', '--datasource-code', os.environ['DBCLI_DATASOURCE_CODE'], '--text', 'SELECT 1']).returncode)
"""
        )
        with DiscoveryServer(self.database) as server:
            result = self.run_transaction(server, child)
        self.assertEqual(12, result.returncode)
        self.assertEqual("TX_FAILED", self.json_output(result)["error"]["code"])

    def test_transaction_timeout_rolls_back(self) -> None:
        child = self.root / "timeout.py"
        child.write_text(
            """
import os
import subprocess
import sys
import time
common = [sys.executable, '-m', 'dbcli', 'sql', '--session-id', os.environ['DBCLI_SESSION_ID'], '--datasource-code', os.environ['DBCLI_DATASOURCE_CODE']]
subprocess.run(common + ['--text', "UPDATE account SET balance = 1 WHERE account_id = 'A'"])
time.sleep(5)
"""
        )
        with DiscoveryServer(self.database) as server:
            result = self.run_cli(
                server,
                "transaction", "run",
                "--session-id", "session-1",
                "--datasource-code", "finance-core",
                "--timeout", "200ms", "--",
                sys.executable, str(child),
            )
        self.assertEqual(13, result.returncode)
        self.assertEqual("TX_TIMEOUT", self.json_output(result)["error"]["code"])
        self.assertEqual((100, 0), self.balances())

    def test_credential_must_outlive_requested_transaction_timeout(self) -> None:
        child = self.root / "never-run.py"
        child.write_text("raise SystemExit(0)\n")
        expires = (datetime.now(UTC) + timedelta(seconds=1)).isoformat()
        with DiscoveryServer(self.database, expires_at=expires) as server:
            result = self.run_cli(
                server,
                "transaction", "run",
                "--session-id", "session-1",
                "--datasource-code", "finance-core",
                "--timeout", "5s", "--",
                sys.executable, str(child),
            )
        self.assertEqual(11, result.returncode)
        self.assertEqual("CREDENTIAL_LIFETIME_TOO_SHORT", self.json_output(result)["error"]["code"])

    def test_long_sql_is_cancelled_at_transaction_deadline(self) -> None:
        child = self.root / "long-sql.py"
        child.write_text(
            """
import os
import subprocess
import sys
sql = "WITH RECURSIVE counter(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM counter WHERE value < 10000000) SELECT sum(value) FROM counter"
raise SystemExit(subprocess.run([sys.executable, '-m', 'dbcli', 'sql', '--session-id', os.environ['DBCLI_SESSION_ID'], '--datasource-code', os.environ['DBCLI_DATASOURCE_CODE'], '--text', sql]).returncode)
"""
        )
        with DiscoveryServer(self.database) as server:
            result = self.run_cli(
                server,
                "transaction", "run",
                "--session-id", "session-1",
                "--datasource-code", "finance-core",
                "--timeout", "100ms", "--",
                sys.executable, str(child),
            )
        self.assertEqual(13, result.returncode)
        self.assertEqual("TX_TIMEOUT", self.json_output(result)["error"]["code"])

    def test_sigterm_kills_child_and_rolls_back(self) -> None:
        ready = self.root / "ready"
        finished = self.root / "finished"
        child = self.root / "signal-child.py"
        child.write_text(
            """
import os
import pathlib
import subprocess
import sys
import time
common = [sys.executable, '-m', 'dbcli', 'sql', '--session-id', os.environ['DBCLI_SESSION_ID'], '--datasource-code', os.environ['DBCLI_DATASOURCE_CODE']]
subprocess.run(common + ['--text', "UPDATE account SET balance = 1 WHERE account_id = 'A'"], check=True)
pathlib.Path(sys.argv[1]).write_text('ready')
time.sleep(5)
pathlib.Path(sys.argv[2]).write_text('finished')
"""
        )
        with DiscoveryServer(self.database) as server:
            env = os.environ.copy()
            env.update(
                {
                    "PYTHONPATH": str(SRC_DIR),
                    "DBCLI_DISCOVERY_URL": server.url,
                    "DBCLI_ALLOW_INSECURE_DISCOVERY": "1",
                }
            )
            process = subprocess.Popen(
                [
                    sys.executable, "-m", "dbcli", "transaction", "run",
                    "--session-id", "session-1", "--datasource-code", "finance-core",
                    "--timeout", "10s", "--", sys.executable, str(child), str(ready), str(finished),
                ],
                cwd=PROJECT_DIR,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            deadline = time.monotonic() + 3
            while not ready.exists() and time.monotonic() < deadline:
                time.sleep(0.02)
            self.assertTrue(ready.exists(), "child did not reach transactional update")
            process.terminate()
            stdout, stderr = process.communicate(timeout=3)
        self.assertEqual(13, process.returncode, stdout + stderr)
        self.assertEqual("TX_INTERRUPTED", json.loads(stdout)["error"]["code"])
        time.sleep(0.1)
        self.assertFalse(finished.exists())
        self.assertEqual((100, 0), self.balances())

    def test_success_payload_does_not_embed_child_stderr(self) -> None:
        child = self.root / "stderr-child.py"
        child.write_text("import sys\nprint('sensitive-child-diagnostic', file=sys.stderr)\n")
        with DiscoveryServer(self.database) as server:
            result = self.run_transaction(server, child)
        self.assertEqual(0, result.returncode)
        self.assertNotIn("sensitive-child-diagnostic", result.stdout)
        self.assertNotIn("childStderr", self.json_output(result))


if __name__ == "__main__":
    unittest.main()
