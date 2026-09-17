from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Any, NoReturn

from dbcli.audit import write_audit
from dbcli.contracts import SqlRequest
from dbcli.errors import DbCliError, EXIT_RUNTIME, invalid_argument
from dbcli.runtime import Runtime


class JsonArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> NoReturn:
        raise invalid_argument(message)


def _identity(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--session-id", required=True)
    parser.add_argument("--datasource-code", required=True)


def build_parser() -> argparse.ArgumentParser:
    parser = JsonArgumentParser(prog="dbcli", description="Session-scoped SQL runtime")
    parser.add_argument("--version", action="version", version="dbcli 0.1.0")
    commands = parser.add_subparsers(dest="command", required=True, parser_class=JsonArgumentParser)

    sql = commands.add_parser("sql", help="execute one parameterized SQL statement")
    _identity(sql)
    source = sql.add_mutually_exclusive_group(required=True)
    source.add_argument("--text")
    source.add_argument("--file", type=Path)
    source.add_argument("--stdin", action="store_true")
    params = sql.add_mutually_exclusive_group()
    params.add_argument("--params")
    params.add_argument("--params-file", type=Path)
    sql.add_argument("--max-rows", type=int)
    sql.add_argument("--timeout")
    sql.add_argument("--expect-affected-rows", type=int)
    sql.add_argument("--format", choices=("json", "jsonl", "csv"), default="json")

    datasource = commands.add_parser("datasource", help="inspect data source capabilities")
    datasource_commands = datasource.add_subparsers(
        dest="datasource_command", required=True, parser_class=JsonArgumentParser
    )
    capabilities = datasource_commands.add_parser("capabilities")
    _identity(capabilities)

    schema = commands.add_parser("schema", help="inspect schemas")
    schema_commands = schema.add_subparsers(
        dest="schema_command", required=True, parser_class=JsonArgumentParser
    )
    schema_list = schema_commands.add_parser("list")
    _identity(schema_list)

    table = commands.add_parser("table", help="inspect tables")
    table_commands = table.add_subparsers(
        dest="table_command", required=True, parser_class=JsonArgumentParser
    )
    table_list = table_commands.add_parser("list")
    _identity(table_list)
    table_list.add_argument("--schema", required=True)
    table_list.add_argument("--include", default="table,view")
    table_describe = table_commands.add_parser("describe")
    _identity(table_describe)
    table_describe.add_argument("--schema", required=True)
    table_describe.add_argument("--table", required=True)

    transaction = commands.add_parser("transaction", help="run atomic SQL work")
    transaction_commands = transaction.add_subparsers(
        dest="transaction_command", required=True, parser_class=JsonArgumentParser
    )
    execute = transaction_commands.add_parser("execute")
    _identity(execute)
    execute.add_argument("--file", required=True, type=Path)
    run = transaction_commands.add_parser("run")
    _identity(run)
    run.add_argument(
        "--isolation",
        choices=("read-committed", "repeatable-read", "serializable"),
        default="read-committed",
    )
    run.add_argument("--read-only", action="store_true")
    run.add_argument("--timeout", default="120s")
    run.add_argument("child_command", nargs=argparse.REMAINDER)
    return parser


def _duration_seconds(value: str | None) -> float | None:
    if value is None:
        return None
    units = {"ms": 0.001, "s": 1.0, "m": 60.0}
    for suffix, multiplier in units.items():
        if value.endswith(suffix):
            try:
                amount = float(value[: -len(suffix)])
            except ValueError as exc:
                raise invalid_argument("invalid duration") from exc
            if amount <= 0:
                raise invalid_argument("duration must be positive")
            return amount * multiplier
    try:
        amount = float(value)
    except ValueError as exc:
        raise invalid_argument("invalid duration") from exc
    if amount <= 0:
        raise invalid_argument("duration must be positive")
    return amount


def _read_sql(args: argparse.Namespace) -> str:
    if args.text is not None:
        return args.text
    if args.file is not None:
        try:
            return args.file.read_text(encoding="utf-8")
        except OSError as exc:
            raise invalid_argument("SQL file is unreadable") from exc
    return sys.stdin.read()


def _read_params(args: argparse.Namespace) -> dict[str, Any] | list[Any]:
    try:
        if args.params is not None:
            value = json.loads(args.params)
        elif args.params_file is not None:
            value = json.loads(args.params_file.read_text(encoding="utf-8"))
        else:
            value = {}
    except (OSError, ValueError) as exc:
        raise invalid_argument("SQL parameters must be valid JSON") from exc
    if not isinstance(value, (dict, list)):
        raise invalid_argument("SQL parameters must be a JSON object or array")
    return value


def dispatch(args: argparse.Namespace, runtime: Runtime) -> dict[str, Any]:
    if args.command == "sql":
        timeout = _duration_seconds(args.timeout)
        sql_text = _read_sql(args)
        args._audit_sql = sql_text
        return runtime.sql(
            args.session_id,
            args.datasource_code,
            SqlRequest(
                sql=sql_text,
                params=_read_params(args),
                max_rows=args.max_rows,
                timeout_ms=round(timeout * 1000) if timeout else None,
                expect_affected_rows=args.expect_affected_rows,
            ),
        )
    if args.command == "datasource":
        return runtime.capabilities(args.session_id, args.datasource_code)
    if args.command == "schema":
        return runtime.list_schemas(args.session_id, args.datasource_code)
    if args.command == "table" and args.table_command == "list":
        object_types = tuple(item.strip().lower() for item in args.include.split(",") if item.strip())
        invalid = set(object_types) - {"table", "view"}
        if invalid:
            raise invalid_argument("--include accepts only table,view")
        return runtime.list_tables(args.session_id, args.datasource_code, args.schema, object_types)
    if args.command == "table":
        return runtime.describe_table(args.session_id, args.datasource_code, args.schema, args.table)
    if args.transaction_command == "execute":
        return runtime.execute_plan(args.session_id, args.datasource_code, args.file)
    command = list(args.child_command)
    if command and command[0] == "--":
        command.pop(0)
    return runtime.run_transaction(
        args.session_id,
        args.datasource_code,
        command,
        isolation=args.isolation,
        read_only=args.read_only,
        timeout_seconds=_duration_seconds(args.timeout) or 120.0,
    )


def _write(payload: dict[str, Any], output_format: str = "json") -> None:
    if output_format == "jsonl" and payload.get("ok") and "rows" in payload:
        for row in payload["rows"]:
            print(json.dumps(row, ensure_ascii=False, separators=(",", ":")))
        return
    if output_format == "csv" and payload.get("ok") and "rows" in payload:
        columns = payload.get("columns") or []
        writer = csv.DictWriter(sys.stdout, fieldnames=columns)
        writer.writeheader()
        writer.writerows(payload["rows"])
        return
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))


def main(argv: list[str] | None = None) -> int:
    args: argparse.Namespace | None = None
    try:
        args = build_parser().parse_args(argv)
        payload = dispatch(args, Runtime())
        write_audit(
            session_id=getattr(args, "session_id", None),
            datasource_code=getattr(args, "datasource_code", None),
            command=getattr(args, "command", None),
            outcome="SUCCESS",
            exit_code=0,
            payload=payload,
            sql=getattr(args, "_audit_sql", None),
        )
        _write(payload, getattr(args, "format", "json"))
        return 0
    except DbCliError as exc:
        payload = exc.payload()
        if args is not None:
            write_audit(
                session_id=getattr(args, "session_id", None),
                datasource_code=getattr(args, "datasource_code", None),
                command=getattr(args, "command", None),
                outcome="FAILED",
                exit_code=exc.exit_code,
                payload=payload,
                sql=getattr(args, "_audit_sql", None),
            )
        _write(payload)
        return exc.exit_code
    except KeyboardInterrupt:
        error = DbCliError("INTERRUPTED", "operation interrupted", exit_code=EXIT_RUNTIME)
        _write(error.payload())
        return error.exit_code
    except Exception:
        error = DbCliError("INTERNAL_ERROR", "unexpected dbcli failure", exit_code=EXIT_RUNTIME)
        _write(error.payload())
        return error.exit_code


def entrypoint() -> NoReturn:
    raise SystemExit(main())
