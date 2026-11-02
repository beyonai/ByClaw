from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
from typing import NoReturn

from groksearchcli import __version__
from groksearchcli.client import XaiSearchClient
from groksearchcli.contracts import CONTRACTS, get_contract, list_contracts
from groksearchcli.errors import EXIT_RUNTIME, GrokSearchCliError, invalid_argument
from groksearchcli.serialization import normalize_response
from groksearchcli.validation import (
    duration_seconds,
    normalize_domains,
    normalize_handles,
    validate_dates,
)


class JsonArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> NoReturn:
        raise invalid_argument(message)


def _common(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--query", required=True,
        help="自然语言研究问题；Grok 会据此自主生成具体搜索词和工具调用",
    )
    parser.add_argument("--model", default=os.environ.get("GROKSEARCHCLI_MODEL", "grok-4.6"))
    parser.add_argument("--instructions")
    parser.add_argument("--timeout", default=os.environ.get("GROKSEARCHCLI_TIMEOUT", "120s"))
    parser.add_argument("--format", choices=("json", "jsonl"), default="json")
    parser.add_argument(
        "--verbose", action="store_true",
        help="show human-readable reasoning and tool-call progress on stderr",
    )


def _web_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--allow-domain", action="append", default=[])
    parser.add_argument("--exclude-domain", action="append", default=[])
    parser.add_argument("--image-understanding", action="store_true")
    parser.add_argument("--image-search", action="store_true")


def _x_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--allow-handle", action="append", default=[])
    parser.add_argument("--exclude-handle", action="append", default=[])
    parser.add_argument("--from-date")
    parser.add_argument("--to-date")
    parser.add_argument("--image-understanding", action="store_true")
    parser.add_argument("--video-understanding", action="store_true")


def build_parser() -> argparse.ArgumentParser:
    parser = JsonArgumentParser(prog="groksearchcli", description="Grok Web and X search client")
    parser.add_argument("--version", action="version", version=f"groksearchcli {__version__}")
    groups = parser.add_subparsers(dest="group", required=True, parser_class=JsonArgumentParser)

    web = groups.add_parser("web", help="search the public web")
    web_actions = web.add_subparsers(dest="action", required=True, parser_class=JsonArgumentParser)
    web_search = web_actions.add_parser("search")
    _common(web_search)
    _web_options(web_search)

    x = groups.add_parser("x", help="search X posts and users")
    x_actions = x.add_subparsers(dest="action", required=True, parser_class=JsonArgumentParser)
    x_search = x_actions.add_parser("search")
    _common(x_search)
    _x_options(x_search)

    research = groups.add_parser("research", help="combine Web Search and X Search")
    research_actions = research.add_subparsers(dest="action", required=True, parser_class=JsonArgumentParser)
    research_run = research_actions.add_parser("run")
    _common(research_run)
    _web_options(research_run)
    research_run.add_argument("--allow-handle", action="append", default=[])
    research_run.add_argument("--exclude-handle", action="append", default=[])
    research_run.add_argument("--from-date")
    research_run.add_argument("--to-date")
    research_run.add_argument("--video-understanding", action="store_true")

    describe = groups.add_parser("describe", help="inspect machine-readable command contracts")
    describe.add_argument("contract_group", nargs="?", choices=("web", "x", "research"))
    describe.add_argument("contract_action", nargs="?")
    describe.add_argument("--all", action="store_true")
    describe.add_argument("--format", choices=("json",), default="json")
    return parser


def _web_tool(args: argparse.Namespace) -> dict:
    allowed, excluded = normalize_domains(args.allow_domain, args.exclude_domain)
    tool: dict = {"type": "web_search"}
    if allowed:
        tool["filters"] = {"allowed_domains": allowed}
    elif excluded:
        tool["filters"] = {"excluded_domains": excluded}
    if args.image_understanding:
        tool["enable_image_understanding"] = True
    if args.image_search:
        tool["enable_image_search"] = True
    return tool


def _x_tool(args: argparse.Namespace) -> dict:
    allowed, excluded = normalize_handles(args.allow_handle, args.exclude_handle)
    validate_dates(args.from_date, args.to_date)
    tool: dict = {"type": "x_search"}
    optional = {
        "allowed_x_handles": allowed,
        "excluded_x_handles": excluded,
        "from_date": args.from_date,
        "to_date": args.to_date,
        "enable_image_understanding": args.image_understanding,
        "enable_video_understanding": args.video_understanding,
    }
    tool.update({key: value for key, value in optional.items() if value})
    return tool


def dispatch(args: argparse.Namespace, client=None) -> dict:
    if args.group == "describe":
        if args.all:
            if args.contract_group or args.contract_action:
                raise invalid_argument("--all cannot be combined with a command name")
            return {"ok": True, "operation": "groksearch.describe.all", "data": list_contracts()}
        if not args.contract_group or not args.contract_action:
            raise invalid_argument("describe requires <group> <command>, or --all")
        key = f"{args.contract_group} {args.contract_action}"
        if key not in CONTRACTS:
            raise invalid_argument(f"unknown command contract: {key}")
        return {"ok": True, "operation": "groksearch.describe", "data": get_contract(
            args.contract_group, args.contract_action
        )}

    if not args.query.strip():
        raise invalid_argument("--query must not be empty")
    timeout = duration_seconds(args.timeout)
    tools = [_web_tool(args)] if args.group == "web" else [_x_tool(args)]
    if args.group == "research":
        tools = [_web_tool(args), _x_tool(args)]
    request = {"model": args.model, "input": args.query, "tools": tools}
    if args.instructions:
        request["instructions"] = args.instructions
    active_client = client or XaiSearchClient(
        event_callback=lambda event: _progress_event(event, verbose=args.verbose)
    )
    started = time.monotonic()
    response = _call_with_heartbeat(
        lambda: active_client.search(request, timeout_seconds=timeout),
        verbose=args.verbose,
    )
    elapsed_ms = round((time.monotonic() - started) * 1000)
    return normalize_response(f"groksearch.{args.group}.{args.action}", response, elapsed_ms=elapsed_ms)


_LAST_PROGRESS_AT = 0.0
_FINAL_RESPONSE_STARTED = False
_THINKING_STARTED = False

_BUSINESS_STATUSES = {
    "response.created": ("started", "检索请求已提交"),
    "response.reasoning_summary_text.delta": ("planning", "正在分析检索任务"),
    "response.reasoning_summary_text.done": ("planning", "检索方案分析完成"),
    "response.output_item.added": ("searching", "正在检索并读取资料"),
    "response.output_item.done": ("searching", "资料检索步骤已完成"),
    "response.output_text.delta": ("writing", "正在整理检索结果"),
    "response.completed": ("completed", "检索完成"),
    "response.failed": ("failed", "检索失败"),
    "response.incomplete": ("incomplete", "检索未完整完成"),
    "error": ("failed", "检索服务返回错误"),
}


def _progress_event(event: dict, *, verbose: bool = False) -> None:
    """Present xAI stream events as stable business statuses on stderr."""
    global _FINAL_RESPONSE_STARTED, _LAST_PROGRESS_AT, _THINKING_STARTED
    event_type = event.get("type", "unknown")
    if event_type == "response.created":
        _FINAL_RESPONSE_STARTED = False
        _THINKING_STARTED = False
    status = _BUSINESS_STATUSES.get(event_type)
    if status is None:
        return
    now = time.monotonic()
    phase, message = status
    terminal = phase in {"completed", "failed", "incomplete"}
    item = event.get("item") if isinstance(event.get("item"), dict) else {}
    is_tool_call = item.get("type") in {"web_search_call", "x_search_call"}
    has_response_text = event_type == "response.output_text.delta" and bool(event.get("text"))
    starts_final_response = event_type == "response.output_text.delta" \
        and not _FINAL_RESPONSE_STARTED
    starts_thinking = event_type.startswith("response.reasoning_summary_text.") \
        and not _THINKING_STARTED
    should_print = event_type == "response.created" or terminal or is_tool_call \
        or starts_final_response or starts_thinking or (verbose and has_response_text) \
        or now - _LAST_PROGRESS_AT >= 5
    if not should_print:
        return
    if verbose:
        _write_verbose_progress(event_type, event)
    else:
        print(json.dumps(
            {"event": "groksearch.status", "phase": phase, "message": message},
            ensure_ascii=False,
            separators=(",", ":"),
        ), file=sys.stderr, flush=True)
    if event_type == "response.output_text.delta":
        _FINAL_RESPONSE_STARTED = True
    if event_type.startswith("response.reasoning_summary_text."):
        _THINKING_STARTED = True
    _LAST_PROGRESS_AT = now


def _write_verbose_progress(event_type: str, event: dict) -> None:
    if event_type == "response.created":
        message = "Search request created."
    elif event_type.startswith("response.reasoning_summary_text."):
        usage = event.get("usage") if isinstance(event.get("usage"), dict) else {}
        tokens = usage.get("reasoning_tokens")
        message = f"Thinking... ({tokens} tokens)" if tokens is not None else "Thinking..."
    elif event_type in {"response.output_item.added", "response.output_item.done"}:
        item = event.get("item") if isinstance(event.get("item"), dict) else {}
        item_type = item.get("type")
        if item_type not in {"web_search_call", "x_search_call"}:
            return
        action = item.get("action") if isinstance(item.get("action"), dict) else {}
        action_type = action.get("type")
        default_name = item_type.removesuffix("_call")
        tool_name = item.get("tool_name") or (action_type if action_type and action_type != "search" else default_name)
        arguments = {key: value for key, value in action.items() if key != "type"}
        message = (
            f"Calling tool: {tool_name} with arguments: "
            f"{json.dumps(arguments, ensure_ascii=False, separators=(',', ':'))}"
        )
    elif event_type == "response.output_text.delta":
        text = event.get("text", "")
        if text:
            if not _FINAL_RESPONSE_STARTED:
                print("\nFinal Response:", file=sys.stderr, flush=True)
            print(text, end="", file=sys.stderr, flush=True)
            return
        message = "Generating final response..."
    elif event_type == "response.completed":
        message = "Search completed."
    elif event_type == "response.incomplete":
        message = "Search ended with an incomplete response."
    else:
        message = "Search failed."
    print(message, file=sys.stderr, flush=True)


def _call_with_heartbeat(call, *, interval_seconds: float = 5.0, verbose: bool = False):
    """Emit stderr heartbeats while a request is silent; preserve stdout for the final JSON."""
    stopped = threading.Event()
    started = time.monotonic()

    def heartbeat() -> None:
        while not stopped.wait(interval_seconds):
            elapsed_seconds = round(time.monotonic() - started, 1)
            if not verbose:
                print(json.dumps({
                    "event": "groksearch.status",
                    "phase": "working",
                    "message": "检索仍在进行",
                    "elapsedSeconds": elapsed_seconds,
                }, ensure_ascii=False, separators=(",", ":")), file=sys.stderr, flush=True)

    thread = threading.Thread(target=heartbeat, daemon=True)
    thread.start()
    try:
        return call()
    finally:
        stopped.set()
        thread.join(timeout=max(interval_seconds, 0.1))


def _write(payload: dict, output_format: str = "json") -> None:
    if output_format == "jsonl" and payload.get("ok"):
        print(json.dumps({"type": "result", **payload}, ensure_ascii=False, separators=(",", ":")))
        return
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))


def main(argv: list[str] | None = None) -> int:
    args: argparse.Namespace | None = None
    try:
        args = build_parser().parse_args(argv)
        payload = dispatch(args)
        _write(payload, getattr(args, "format", "json"))
        return 0
    except GrokSearchCliError as exc:
        _write(exc.payload())
        return exc.exit_code
    except KeyboardInterrupt:
        error = GrokSearchCliError("INTERRUPTED", "operation interrupted", exit_code=EXIT_RUNTIME)
        _write(error.payload())
        return error.exit_code
    except Exception:
        error = GrokSearchCliError("INTERNAL_ERROR", "unexpected groksearchcli failure")
        _write(error.payload())
        return error.exit_code


def entrypoint() -> NoReturn:
    raise SystemExit(main())
