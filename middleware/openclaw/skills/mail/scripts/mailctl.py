#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any, Sequence

from mail_runtime.config import AccountProjectionReader, DEFAULT_CONFIG_ROOT
from mail_runtime.io_security import AnchoredPrivateReader, AttachmentSink, relative_from_absolute
from mail_runtime.models import (
    AccountConfig,
    AttachmentDownloadResult,
    AttachmentRequest,
    ConnectionCheckResult,
    DeleteResult,
    Draft,
    ErrorCode,
    ListRequest,
    MailRuntimeError,
    MessageContent,
    Page,
    ReplyResult,
    SearchRequest,
    SendResult,
    require_text,
    to_jsonable,
)
from mail_runtime.registry import AdapterRegistry, build_default_registry


DEFAULT_WORKSPACE_ROOT = Path("/by/workspace")
DEFAULT_COLLECTION_SESSIONS_ROOT = Path("/by/.sessions")
MAX_INPUT_JSON_BYTES = 256 * 1024

EXIT_CODES = {
    ErrorCode.INVALID_REQUEST: 2,
    ErrorCode.ACCOUNT_NOT_FOUND: 3,
    ErrorCode.AUTH_REQUIRED: 4,
    ErrorCode.AUTH_EXPIRED: 4,
    ErrorCode.PERMISSION_DENIED: 5,
    ErrorCode.MESSAGE_NOT_FOUND: 6,
    ErrorCode.ATTACHMENT_NOT_FOUND: 6,
    ErrorCode.RATE_LIMITED: 7,
    ErrorCode.UPSTREAM_UNAVAILABLE: 7,
    ErrorCode.UNSUPPORTED: 8,
    ErrorCode.INTERNAL_ERROR: 10,
}

CAPABILITIES = {
    "list": "list",
    "get": "get",
    "search": "search",
    "attachment": "downloadAttachment",
    "send": "send",
    "reply": "reply",
    "delete": "delete",
}


class JsonArgumentParser(argparse.ArgumentParser):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        kwargs["add_help"] = False
        super().__init__(*args, **kwargs)

    def error(self, message: str) -> None:
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST, message)

    def exit(self, status: int = 0, message: str | None = None) -> None:
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST, message)


def positive_limit(value: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("invalid limit") from exc
    if parsed < 1 or parsed > 100:
        raise argparse.ArgumentTypeError("invalid limit")
    return parsed


def build_parser() -> argparse.ArgumentParser:
    parser = JsonArgumentParser(prog="mailctl", description="Unified mail connector runtime")
    commands = parser.add_subparsers(dest="operation", required=True, parser_class=JsonArgumentParser)
    commands.add_parser("accounts")
    check = commands.add_parser("check")
    add_account(check)
    listing = commands.add_parser("list")
    add_account(listing)
    listing.add_argument("--folder", default="inbox")
    add_paging(listing)
    get = commands.add_parser("get")
    add_account(get)
    add_message(get)
    search = commands.add_parser("search")
    add_account(search)
    search.add_argument("--query", required=True)
    add_paging(search)
    attachment = commands.add_parser("attachment")
    add_account(attachment)
    add_message(attachment)
    attachment.add_argument("--attachment", required=True)
    attachment.add_argument("--output-dir", required=True)
    attachment.add_argument("--collection-session-dir")
    send = commands.add_parser("send")
    add_account(send)
    send.add_argument("--input-json", required=True)
    reply = commands.add_parser("reply")
    add_account(reply)
    add_message(reply)
    reply.add_argument("--input-json", required=True)
    delete = commands.add_parser("delete")
    add_account(delete)
    add_message(delete)
    return parser


def add_account(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--account", required=True)


def add_message(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--message", required=True)


def add_paging(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--limit", type=positive_limit, default=20)
    parser.add_argument("--cursor")


def read_input_json(path_value: str, workspace_root: Path) -> Any:
    relative = relative_from_absolute(workspace_root, Path(path_value))
    return AnchoredPrivateReader(
        workspace_root,
        max_bytes=MAX_INPUT_JSON_BYTES,
    ).read_json(relative)


def require_account(accounts: Sequence[AccountConfig], account_id: str) -> AccountConfig:
    for account in accounts:
        if account.account_id == account_id:
            return account
    raise MailRuntimeError(ErrorCode.ACCOUNT_NOT_FOUND)


def require_exact_result(value: Any, expected: type) -> Any:
    if type(value) is not expected:
        raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)
    return value


def attachment_root(args: argparse.Namespace, workspace_root: Path) -> Path:
    """Permit only the fixed private mail directory of a collection session.

    This attachment-only option does not change draft/input JSON access. The
    existing sink opens every ancestor with O_NOFOLLOW and checks private storage.
    """
    if getattr(args, "collection_session_dir", None) is None:
        return workspace_root
    session = Path(args.collection_session_dir)
    if session == DEFAULT_COLLECTION_SESSIONS_ROOT:
        raise MailRuntimeError(ErrorCode.PERMISSION_DENIED)
    parts = relative_from_absolute(DEFAULT_COLLECTION_SESSIONS_ROOT, session).parts
    if len(parts) != 3 or parts[1] not in {"collections", ".collection-runs"}:
        raise MailRuntimeError(ErrorCode.PERMISSION_DENIED)
    private_root = session / ".routing" / "mail-downloads"
    if Path(args.output_dir) != private_root / "mail-attachments":
        raise MailRuntimeError(ErrorCode.PERMISSION_DENIED)
    return private_root


def supports_operation(account: AccountConfig, capability: str) -> bool:
    status = account.capability_status.get(capability)
    if status is not None:
        return status == "YES" or status.startswith("CONDITIONAL_")
    return capability in account.capabilities


def execute(
    args: argparse.Namespace,
    accounts: Sequence[AccountConfig],
    registry: AdapterRegistry,
    workspace_root: Path,
) -> Any:
    if args.operation == "accounts":
        return [account.public_summary() for account in accounts]
    account = require_account(accounts, args.account)
    if args.operation == "check":
        started = time.monotonic()
        capability_status = registry.probe(account)
        elapsed_ms = max(0, int((time.monotonic() - started) * 1000))
        status = "NORMAL" if all(value == "YES" for value in capability_status.values()) else "PARTIAL"
        return ConnectionCheckResult(status, elapsed_ms, capability_status)
    if not supports_operation(account, CAPABILITIES[args.operation]):
        raise MailRuntimeError(ErrorCode.UNSUPPORTED)
    adapter = registry.adapter_for(account)
    if args.operation == "list":
        folder = require_text(args.folder, maximum=256)
        cursor = require_text(args.cursor, maximum=4096) if args.cursor is not None else None
        return require_exact_result(adapter.list_messages(ListRequest(folder, args.limit, cursor)), Page)
    if args.operation == "get":
        result = adapter.get_message(require_text(args.message, maximum=1024))
        return require_exact_result(result, MessageContent)
    if args.operation == "search":
        query = require_text(args.query, maximum=4096)
        cursor = require_text(args.cursor, maximum=4096) if args.cursor is not None else None
        result = adapter.search_messages(SearchRequest(query, args.limit, cursor))
        return require_exact_result(result, Page)
    if args.operation == "attachment":
        request = AttachmentRequest(
            require_text(args.message, maximum=1024),
            require_text(args.attachment, maximum=1024),
        )
        with AttachmentSink(attachment_root(args, workspace_root), Path(args.output_dir)) as sink:
            result = adapter.download_attachment(request, sink)
            require_exact_result(result, AttachmentDownloadResult)
            return sink.finalize(result)
    if args.operation == "send":
        draft = Draft.from_mapping(
            read_input_json(args.input_json, workspace_root),
            require_recipients=True,
        )
        return require_exact_result(adapter.send_message(draft), SendResult)
    if args.operation == "reply":
        message_id = require_text(args.message, maximum=1024)
        draft = Draft.from_mapping(
            read_input_json(args.input_json, workspace_root),
            require_recipients=False,
        )
        return require_exact_result(adapter.reply_message(message_id, draft), ReplyResult)
    if args.operation == "delete":
        result = adapter.delete_message(require_text(args.message, maximum=1024))
        return require_exact_result(result, DeleteResult)
    raise MailRuntimeError(ErrorCode.INVALID_REQUEST)


def emit(value: dict[str, Any]) -> None:
    print(json.dumps(value, ensure_ascii=False, separators=(",", ":")), flush=True)


def main(
    argv: Sequence[str] | None = None,
    *,
    config_root: Path | str = DEFAULT_CONFIG_ROOT,
    workspace_root: Path | str = DEFAULT_WORKSPACE_ROOT,
    registry: AdapterRegistry | None = None,
) -> int:
    raw_args = list(argv) if argv is not None else sys.argv[1:]
    if raw_args in (["--help"], ["-h"]):
        print(build_parser().format_help(), end="")
        return 0
    operation: str | None = None
    account_id: str | None = None
    try:
        args = build_parser().parse_args(raw_args)
        operation = args.operation
        if hasattr(args, "account"):
            validated_account_id = require_text(args.account, maximum=128)
            args.account = validated_account_id
            account_id = validated_account_id
        accounts = AccountProjectionReader(config_root).read()
        data = execute(args, accounts, registry if registry is not None else build_default_registry(), Path(workspace_root))
        emit({"ok": True, "operation": operation, "accountId": account_id, "data": to_jsonable(data)})
        return 0
    except MailRuntimeError as exc:
        emit({"ok": False, "operation": operation, "accountId": account_id, "error": exc.as_dict()})
        return EXIT_CODES[exc.code]
    except SystemExit:
        error = MailRuntimeError(ErrorCode.INVALID_REQUEST)
        emit({"ok": False, "operation": operation, "accountId": account_id, "error": error.as_dict()})
        return EXIT_CODES[error.code]
    except Exception:
        error = MailRuntimeError(ErrorCode.INTERNAL_ERROR)
        emit({"ok": False, "operation": operation, "accountId": account_id, "error": error.as_dict()})
        return EXIT_CODES[error.code]


if __name__ == "__main__":
    raise SystemExit(main())
