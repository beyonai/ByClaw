from __future__ import annotations

import argparse
import asyncio
import json
import signal
import sys
import uuid
from pathlib import Path
from typing import Any, NoReturn

import httpx

from callcli import __version__
from callcli.contracts import CONTRACTS, SUPPORTED_TYPES, get_contract, list_contracts
from callcli.errors import CallCliError, EXIT_CANCELLED, EXIT_SCHEMA, invalid_argument
from callcli.executors import AgentExecutor, McpExecutor, ToolExecutor, ToolkitExecutor
from callcli.resource_catalog import ResourceCatalog
from callcli.runtime import CapabilityRuntime, ExecutorRouter
from callcli.service_client import DiscoveryServiceClient, run_async
from callcli.snapshot import RedisSnapshotProvider


class JsonArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> NoReturn:
        raise invalid_argument(message)


def _identity(parser: argparse.ArgumentParser, *, resource: bool = True) -> None:
    parser.add_argument("--session-id", required=True)
    if resource:
        parser.add_argument("--resource-id", required=True)
        parser.add_argument("--resource-type", required=True, choices=SUPPORTED_TYPES)


def build_parser() -> argparse.ArgumentParser:
    parser = JsonArgumentParser(prog="callcli", description="Service-discovered ByClaw capability runtime")
    parser.add_argument("--version", action="version", version=f"callcli {__version__}")
    commands = parser.add_subparsers(dest="command", required=True, parser_class=JsonArgumentParser)

    resource = commands.add_parser("resource")
    resource_commands = resource.add_subparsers(dest="resource_command", required=True,
                                                 parser_class=JsonArgumentParser)
    list_cmd = resource_commands.add_parser("list")
    _identity(list_cmd, resource=False)
    list_cmd.add_argument("--keyword", default="")
    list_cmd.add_argument("--resource-type", choices=("MCP", "TOOLKIT", "AGENT"))
    list_cmd.add_argument("--page-num", type=int, default=1)
    list_cmd.add_argument("--page-size", type=int, default=30)
    list_cmd.add_argument("--all-pages", action="store_true")
    describe_resource = resource_commands.add_parser("describe")
    _identity(describe_resource)

    invoke = commands.add_parser(
        "invoke",
        description=(
            "Invoke a capability. For TOOLKIT/MCP, first run `callcli resource describe`, "
            "select an exact action from data.actions/data.tools, and build arguments from inputSchema."
        ),
    )
    _identity(invoke)
    invoke.add_argument("--action", default="",
                        help="required for TOOLKIT/MCP; invalid for TOOL/AGENT")
    invoke.add_argument("--query", default="",
                        help="required for AGENT; invalid for TOOL/TOOLKIT/MCP")
    invoke.add_argument("--arguments",
                        help="JSON object matching the selected tool/action inputSchema")
    invoke.add_argument("--input")
    invoke.add_argument("--trace-id", default="")
    invoke.add_argument("--timeout", type=float)
    invoke.add_argument("--stream", action="store_true")
    invoke.add_argument("--format", choices=("json", "ndjson"), default="json")

    describe = commands.add_parser("describe")
    describe.add_argument("contract", nargs="*")
    describe.add_argument("--all", action="store_true")
    describe.add_argument("--format", choices=("json",), default="json")
    return parser


def _read_object(value: str, flag: str) -> dict:
    try:
        if value == "-":
            raw = sys.stdin.read()
        elif value.lstrip().startswith("{"):
            raw = value
        else:
            raw = Path(value).read_text(encoding="utf-8")
        result = json.loads(raw)
    except (OSError, ValueError) as exc:
        raise invalid_argument(f"{flag} must be a JSON object, readable file, or -") from exc
    if not isinstance(result, dict):
        raise invalid_argument(f"{flag} must contain a JSON object")
    return result


def _request(args: argparse.Namespace) -> tuple[str, str, dict]:
    if args.input and args.arguments:
        raise invalid_argument("--input and --arguments are mutually exclusive")
    body = _read_object(args.input, "--input") if args.input else {}
    if args.arguments:
        body["arguments"] = _read_object(args.arguments, "--arguments")
    for key in ("action", "query"):
        value = getattr(args, key)
        if value and key in body:
            raise invalid_argument(f"--{key} cannot override --input {key}")
        if value:
            body[key] = value
    arguments = body.get("arguments", {})
    if not isinstance(arguments, dict):
        raise invalid_argument("arguments must be a JSON object")
    action, query = str(body.get("action") or ""), str(body.get("query") or "")
    if args.resource_type == "AGENT" and not query.strip():
        raise invalid_argument("query is required for AGENT")
    if args.resource_type != "AGENT" and query:
        raise invalid_argument(f"query is not valid for {args.resource_type}; use --arguments matching inputSchema")
    if args.resource_type in {"TOOL", "AGENT"} and action:
        raise invalid_argument(f"action is not valid for {args.resource_type}")
    if args.resource_type in {"TOOLKIT", "MCP"} and not action.strip():
        collection = "data.actions" if args.resource_type == "TOOLKIT" else "data.tools"
        raise CallCliError(
            "ACTION_REQUIRED",
            f"action is required for {args.resource_type}; run `callcli resource describe` first, "
            f"select an exact action from {collection}, and build arguments from its inputSchema",
            exit_code=EXIT_SCHEMA,
        )
    return action, query, arguments


def _write(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), flush=True)


async def _dispatch(args: argparse.Namespace) -> dict:
    if args.command == "describe":
        if args.all:
            if args.contract:
                raise invalid_argument("--all cannot be combined with a contract name")
            return {"ok": True, "operation": "capability.describe", "data": list_contracts()}
        if not args.contract:
            raise invalid_argument("describe requires a contract name or --all")
        try:
            contract = get_contract(args.contract)
        except KeyError as exc:
            raise invalid_argument(f"unknown contract: {' '.join(args.contract)}") from exc
        return {"ok": True, "operation": "capability.describe", "data": contract}

    catalog = ResourceCatalog(DiscoveryServiceClient(timeout_seconds=args.timeout if hasattr(args, "timeout") and args.timeout else 30))
    if args.command == "resource" and args.resource_command == "list":
        data = await catalog.list_resources(session_id=args.session_id, keyword=args.keyword,
                                            resource_type=args.resource_type, page_num=args.page_num,
                                            page_size=args.page_size, all_pages=args.all_pages)
        meta = {"backendCode": data.pop("backendCode"), "backendMessage": data.pop("backendMessage")}
        return {"ok": True, "operation": "capability.resource.list", "data": data, "meta": meta}

    timeout = args.timeout if hasattr(args, "timeout") and args.timeout else 600
    events = []

    async def sink(event: dict) -> None:
        events.append(event)
        if getattr(args, "stream", False):
            _write(event)

    async with httpx.AsyncClient(timeout=httpx.Timeout(timeout)) as client:
        router = ExecutorRouter(ToolExecutor(client), ToolkitExecutor(client), McpExecutor(client),
                                AgentExecutor(client, event_sink=sink))
        runtime = CapabilityRuntime(catalog, RedisSnapshotProvider(), router)
        if args.command == "resource":
            data = await runtime.describe(args.session_id, args.resource_id, args.resource_type)
            return {"ok": True, "operation": "capability.resource.describe", "data": data}
        action, query, arguments = _request(args)
        result = await runtime.invoke(args.session_id, args.resource_id, args.resource_type,
                                      action=action, query=query, arguments=arguments,
                                      trace_id=args.trace_id or str(uuid.uuid4()))
        if args.stream:
            # AgentExecutor already emitted the terminal event. Non-agent commands get one terminal event here.
            if args.resource_type != "AGENT":
                _write({"event": "complete", "data": result["data"], "target": result["target"]})
            return {"_already_written": True}
        return result


def main(argv: list[str] | None = None) -> int:
    operation = None
    try:
        args = build_parser().parse_args(argv)
        operation = "capability.invoke" if args.command == "invoke" else f"capability.{args.command}"
        result = run_async(_dispatch(args))
        if not result.pop("_already_written", False):
            _write(result)
        return 0
    except CallCliError as exc:
        payload = exc.payload(operation)
        _write({"event": "error", **payload} if argv and "--stream" in argv else payload)
        return exc.exit_code
    except KeyboardInterrupt:
        exc = CallCliError("INTERRUPTED", "operation interrupted", exit_code=EXIT_CANCELLED)
        _write(exc.payload(operation))
        return exc.exit_code
    except Exception:
        exc = CallCliError("INTERNAL_ERROR", "unexpected callcli failure")
        _write(exc.payload(operation))
        return exc.exit_code


def entrypoint() -> NoReturn:
    raise SystemExit(main())
