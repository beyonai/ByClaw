from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, NoReturn

from kbcli import __version__
from kbcli.contracts import CONTRACTS, get_contract, help_epilog, list_contracts
from kbcli.errors import EXIT_RUNTIME, KbCliError, invalid_argument
from kbcli.service_client import ServiceClient


BASE = "/byaiService/datasetController"
RESOURCE_AUTH_LIST = "/byaiService/auth/privilegeGrant/listResourceUseAuth"
SEARCH_MODES = ("mixedRecall", "fullTextRecall", "embedding")


class JsonArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> NoReturn:
        raise invalid_argument(message)


def _identity(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--session-id", required=True,
                        help="current runtime session id; never persist it in a skill")


def _input(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--input", required=True,
                        help="JSON object, JSON file path, or - for stdin")


def _leaf(parent, name: str, *, help_text: str, input_json: bool = False):
    parser = parent.add_parser(name, help=help_text)
    _identity(parser)
    if input_json:
        _input(parser)
    return parser


def build_parser() -> argparse.ArgumentParser:
    parser = JsonArgumentParser(prog="kbcli", description="Service-discovered ByAI knowledge-base client")
    parser.add_argument("--version", action="version", version=f"kbcli {__version__}")
    groups = parser.add_subparsers(dest="group", required=True, parser_class=JsonArgumentParser)

    base = groups.add_parser("base", help="manage knowledge bases")
    base_cmd = base.add_subparsers(dest="action", required=True, parser_class=JsonArgumentParser)
    _leaf(base_cmd, "create", help_text="create a knowledge base", input_json=True)
    _leaf(base_cmd, "update", help_text="update a knowledge base", input_json=True)
    delete_base = _leaf(base_cmd, "delete", help_text="delete a knowledge base")
    delete_base.add_argument("--resource-id", required=True)
    get_base = _leaf(base_cmd, "get", help_text="get knowledge-base details")
    get_base.add_argument("--resource-id", required=True)
    list_base = _leaf(base_cmd, "list", help_text="list knowledge bases available to the current user")
    list_base.add_argument("--keyword", default="")
    list_base.add_argument("--page-num", type=int, default=1)
    list_base.add_argument("--page-size", type=int, default=30)

    folder = groups.add_parser("folder", help="manage folders")
    folder_cmd = folder.add_subparsers(dest="action", required=True, parser_class=JsonArgumentParser)
    for action in ("create", "rename"):
        _leaf(folder_cmd, action, help_text=f"{action} a folder", input_json=True)
    delete_folder = _leaf(folder_cmd, "delete", help_text="delete a folder")
    delete_folder.add_argument("--resource-id", required=True)
    delete_folder.add_argument("--path", required=True)

    item = groups.add_parser("item", help="operate on files or folders")
    item_cmd = item.add_subparsers(dest="action", required=True, parser_class=JsonArgumentParser)
    _leaf(item_cmd, "move", help_text="move files or folders", input_json=True)
    list_item = _leaf(item_cmd, "list", help_text="list files and folders in a directory")
    list_item.add_argument("--resource-id", required=True)
    list_item.add_argument("--directory", default="/")
    list_item.add_argument("--keyword")
    glob_item = _leaf(item_cmd, "glob", help_text="match knowledge paths")
    glob_item.add_argument("--resource-id", required=True)
    glob_item.add_argument("--path-rule", required=True)

    file_group = groups.add_parser("file", help="manage knowledge files")
    file_cmd = file_group.add_subparsers(dest="action", required=True, parser_class=JsonArgumentParser)
    _leaf(file_cmd, "conflicts", help_text="check upload conflicts", input_json=True)
    upload = _leaf(file_cmd, "upload", help_text="upload one or more files")
    upload.add_argument("--resource-id", required=True)
    upload.add_argument("--directory", default="/")
    upload.add_argument("--file", action="append", required=True, type=Path)
    upload.add_argument("--description")
    upload.add_argument("--process-front-matter", action="store_true")
    upload.add_argument("--overwrite", action="store_true")
    upload.add_argument("--skip-existing", action="store_true")
    update = _leaf(file_cmd, "update", help_text="replace file content")
    update.add_argument("--resource-id", required=True)
    update.add_argument("--path", required=True)
    update.add_argument("--file", required=True, type=Path)
    update.add_argument("--description")
    update.add_argument("--process-front-matter", action="store_true")
    delete_file = _leaf(file_cmd, "delete", help_text="delete a file")
    delete_file.add_argument("--resource-id", required=True)
    delete_file.add_argument("--path", required=True)
    download = _leaf(file_cmd, "download", help_text="download a file")
    download.add_argument("--resource-id", required=True)
    download.add_argument("--path", required=True)
    download.add_argument("--output", required=True, type=Path)
    download.add_argument("--force", action="store_true", help="overwrite the local output file")
    read_file = _leaf(file_cmd, "read", help_text="read Markdown content")
    read_file.add_argument("--resource-id", required=True)
    read_file.add_argument("--path", required=True)
    read_file.add_argument("--start-line", type=int)
    read_file.add_argument("--end-line", type=int)

    build = groups.add_parser("build", help="build and inspect knowledge files")
    build_cmd = build.add_subparsers(dest="action", required=True, parser_class=JsonArgumentParser)
    start_build = _leaf(build_cmd, "start", help_text="trigger a knowledge-file build")
    start_build.add_argument("--resource-id", required=True)
    start_build.add_argument("--path", required=True)
    convert_build = _leaf(build_cmd, "convert", help_text="convert a local file to Markdown")
    convert_build.add_argument("--file", required=True, type=Path)
    convert_build.add_argument("--output", required=True, type=Path)
    convert_build.add_argument("--force", action="store_true", help="overwrite the local output file")
    from_doc = _leaf(build_cmd, "from-doc", help_text="store Markdown and build it immediately")
    from_doc.add_argument("--resource-id", required=True)
    from_doc.add_argument("--directory", default="/")
    from_doc.add_argument("--doc-name")
    doc_source = from_doc.add_mutually_exclusive_group(required=True)
    doc_source.add_argument("--doc")
    doc_source.add_argument("--doc-file", type=Path)
    from_doc.add_argument("--language", default="zh-CN")
    result_build = _leaf(build_cmd, "result", help_text="get a knowledge-file build result")
    result_build.add_argument("--resource-id", required=True)
    result_build.add_argument("--path", required=True)
    result_build.add_argument("--chunk-page", type=int, default=1)
    result_build.add_argument("--chunk-page-size", type=int, default=20)
    result_build.add_argument("--no-markdown", action="store_true")
    status_build = _leaf(build_cmd, "status", help_text="get a knowledge-file build status")
    status_build.add_argument("--resource-id", required=True)
    status_build.add_argument("--path", required=True)

    search = groups.add_parser("search", help="search knowledge")
    search_cmd = search.add_subparsers(dest="action", required=True, parser_class=JsonArgumentParser)
    for action in ("chunks", "files"):
        command = _leaf(search_cmd, action, help_text=f"search {action}")
        command.add_argument("--resource-id", action="append", required=True)
        command.add_argument("--query", required=True)
        command.add_argument("--top-k", type=int, default=10)
        command.add_argument("--mode", choices=SEARCH_MODES, default="mixedRecall")
        command.add_argument("--where")
        command.add_argument("--metadata-field", action="append", default=[])
        if action == "chunks":
            command.add_argument("--file-type", action="append", default=[])
    _leaf(search_cmd, "metadata", help_text="search metadata", input_json=True)

    describe = groups.add_parser("describe", help="inspect machine-readable command contracts")
    describe.add_argument("contract_group", nargs="?", choices=("base", "folder", "item", "file", "build", "search"))
    describe.add_argument("contract_action", nargs="?")
    describe.add_argument("--all", action="store_true", help="return every command contract")
    describe.add_argument("--format", choices=("json",), default="json")

    group_action = next(action for action in parser._actions if action.dest == "group")
    for key, contract in CONTRACTS.items():
        group_name, action_name = key.split(" ", 1)
        group_parser = group_action.choices[group_name]
        action_parser = next(action for action in group_parser._actions if action.dest == "action")
        action_parser.choices[action_name].epilog = help_epilog(contract)
    return parser


def _read_input(value: str) -> dict[str, Any]:
    try:
        if value == "-":
            raw = sys.stdin.read()
        elif value.lstrip().startswith("{"):
            raw = value
        else:
            raw = Path(value).read_text(encoding="utf-8")
        payload = json.loads(raw)
    except (OSError, ValueError) as exc:
        raise invalid_argument("--input must be a readable JSON object, file, or -") from exc
    if not isinstance(payload, dict):
        raise invalid_argument("--input must contain a JSON object")
    return payload


def _path(value: str) -> str:
    if not value.startswith("/") or ".." in value.split("/"):
        raise invalid_argument("knowledge paths must start with / and cannot contain ..")
    return value


def _glob_rule(value: str) -> str:
    rule = _path(value)
    if "**" in rule:
        raise invalid_argument("--path-rule does not support ** recursive wildcards")
    return rule


def _success(operation: str, backend: dict) -> dict:
    return {
        "ok": True,
        "operation": operation,
        "data": backend.get("data"),
        "meta": {"backendCode": backend.get("code"), "backendMessage": backend.get("msg")},
    }


def _json_call(client: ServiceClient, operation: str, path: str, session_id: str,
               payload: dict, method: str = "POST", query: dict | None = None) -> dict:
    backend = client.json(method, f"{BASE}{path}", session_id=session_id,
                          payload=payload if method == "POST" else None, query=query)
    return _success(operation, backend)


def dispatch(args: argparse.Namespace, client: ServiceClient) -> dict:
    if args.group == "describe":
        if args.all:
            if args.contract_group or args.contract_action:
                raise invalid_argument("--all cannot be combined with a command name")
            return {"ok": True, "operation": "knowledge.describe.all", "data": list_contracts()}
        if not args.contract_group or not args.contract_action:
            raise invalid_argument("describe requires <group> <command>, or --all")
        key = f"{args.contract_group} {args.contract_action}"
        if key not in CONTRACTS:
            raise invalid_argument(f"unknown command contract: {key}")
        return {"ok": True, "operation": "knowledge.describe", "data": get_contract(
            args.contract_group, args.contract_action
        )}
    operation = f"knowledge.{args.group}.{args.action}"
    if args.group == "base":
        if args.action == "list":
            if args.page_num <= 0 or args.page_size <= 0:
                raise invalid_argument("--page-num and --page-size must be positive")
            payload = {
                "keyword": args.keyword,
                "pageNum": args.page_num,
                "pageSize": args.page_size,
                "resourceStatus": "2",
                "resourceBizTypeList": ["KG_DOC", "KG_QA", "KG_TERM"],
                "permission": "",
                "digitalEmployeeType": "",
                "language": "zh-CN",
            }
            backend = client.json("POST", RESOURCE_AUTH_LIST, session_id=args.session_id,
                                  payload=payload)
            return _success(operation, backend)
        if args.action in {"create", "update"}:
            return _json_call(client, operation,
                              "/createDataset" if args.action == "create" else "/updateDataset",
                              args.session_id, _read_input(args.input))
        if args.action == "delete":
            return _json_call(client, operation, "/deleteDataset", args.session_id,
                              {"resourceId": args.resource_id, "path": "/"})
        return _json_call(client, operation, "/detail", args.session_id, {}, method="GET",
                          query={"resourceId": args.resource_id})
    if args.group == "folder":
        if args.action in {"create", "rename"}:
            return _json_call(client, operation,
                              "/createFolder" if args.action == "create" else "/renameFolder",
                              args.session_id, _read_input(args.input))
        return _json_call(client, operation, "/deleteFolder", args.session_id,
                          {"resourceId": args.resource_id, "directoryPath": _path(args.path)})
    if args.group == "item":
        if args.action == "move":
            return _json_call(client, operation, "/moveKnowledgeItems",
                              args.session_id, _read_input(args.input))
        if args.action == "list":
            payload = {
                "resourceId": args.resource_id,
                "directoryPath": _path(args.directory),
            }
            if args.keyword is not None:
                payload["keyword"] = args.keyword
            return _json_call(client, operation, "/queryDirAndFileByLevel",
                              args.session_id, payload)
        return _json_call(client, operation, "/glob", args.session_id, {
            "resourceId": args.resource_id,
            "pathRule": _glob_rule(args.path_rule),
        })
    if args.group == "file":
        if args.action == "conflicts":
            return _json_call(client, operation, "/checkUploadFileConflicts",
                              args.session_id, _read_input(args.input))
        if args.action == "read":
            if args.start_line is not None and args.start_line <= 0:
                raise invalid_argument("--start-line must be positive")
            if args.end_line is not None and args.end_line <= 0:
                raise invalid_argument("--end-line must be positive")
            if (args.start_line is not None and args.end_line is not None
                    and args.end_line < args.start_line):
                raise invalid_argument("--end-line must be greater than or equal to --start-line")
            payload = {"resourceId": args.resource_id, "filePath": _path(args.path)}
            if args.start_line is not None:
                payload["startLine"] = args.start_line
            if args.end_line is not None:
                payload["endLine"] = args.end_line
            return _json_call(client, operation, "/readFile", args.session_id, payload)
        if args.action == "upload":
            if args.overwrite and args.skip_existing:
                raise invalid_argument("--overwrite and --skip-existing are mutually exclusive")
            fields = {
                "resourceId": args.resource_id,
                "directoryPath": _path(args.directory),
                "processFrontMatter": str(args.process_front_matter).lower(),
                "overwrite": str(args.overwrite).lower(),
                "skipIfDuplicate": str(args.skip_existing).lower(),
            }
            if args.description is not None:
                fields["fileDescription"] = args.description
            backend = client.multipart(f"{BASE}/uploadFiles", session_id=args.session_id,
                                       fields=fields, files=args.file)
            return _success(operation, backend)
        if args.action == "update":
            fields = {
                "resourceId": args.resource_id,
                "filePath": _path(args.path),
                "processFrontMatter": str(args.process_front_matter).lower(),
            }
            if args.description is not None:
                fields["fileDescription"] = args.description
            backend = client.multipart(f"{BASE}/knowledgeItems/update", session_id=args.session_id,
                                       fields=fields, files=[args.file], file_field="fileContent")
            return _success(operation, backend)
        if args.action == "delete":
            return _json_call(client, operation, "/removeFile", args.session_id,
                              {"resourceId": args.resource_id, "directoryPath": _path(args.path)})
        if args.output.exists() and not args.force:
            raise KbCliError("OUTPUT_EXISTS", "output file already exists", exit_code=2)
        data = client.download(f"{BASE}/download", session_id=args.session_id,
                               query={"resourceId": args.resource_id,
                                      "directoryPath": _path(args.path)}, output=args.output)
        return {"ok": True, "operation": operation, "data": data}
    if args.group == "build":
        if args.action == "start":
            return _json_call(client, operation, "/build", args.session_id, {
                "resourceId": args.resource_id, "directoryPath": _path(args.path),
            })
        if args.action == "status":
            return _json_call(client, operation, "/fileBuildStatus", args.session_id, {}, method="GET",
                              query={"resourceId": args.resource_id,
                                     "directoryPath": _path(args.path)})
        if args.action == "result":
            if args.chunk_page <= 0 or args.chunk_page_size <= 0:
                raise invalid_argument("--chunk-page and --chunk-page-size must be positive")
            return _json_call(client, operation, "/buildResult", args.session_id, {
                "resourceId": args.resource_id,
                "filePath": _path(args.path),
                "chunkPage": args.chunk_page,
                "chunkPageSize": args.chunk_page_size,
                "includeMarkdown": not args.no_markdown,
            })
        if args.action == "convert":
            if args.output.exists() and not args.force:
                raise KbCliError("OUTPUT_EXISTS", "output file already exists", exit_code=2)
            data = client.multipart_download(
                f"{BASE}/fileToMarkdown", session_id=args.session_id,
                file=args.file, file_field="fileContent", output=args.output,
            )
            return {"ok": True, "operation": operation, "data": data}
        try:
            doc = args.doc if args.doc is not None else args.doc_file.read_text(encoding="utf-8")
        except OSError as exc:
            raise invalid_argument(f"Markdown file is unreadable: {args.doc_file}") from exc
        if not doc.strip():
            raise invalid_argument("Markdown document must not be empty")
        query = {
            "resourceId": args.resource_id,
            "directoryPath": _path(args.directory),
            "doc": doc,
            "language": args.language,
        }
        if args.doc_name is not None:
            query["docName"] = args.doc_name
        data = client.text("GET", f"{BASE}/buildKnowledgeFromDoc",
                           session_id=args.session_id, query=query)
        return {"ok": True, "operation": operation, "data": data}
    if args.action == "metadata":
        return _json_call(client, operation, "/knowledgeItems/metadataSearch",
                          args.session_id, _read_input(args.input))
    try:
        where = json.loads(args.where) if args.where else None
    except ValueError as exc:
        raise invalid_argument("--where must be valid JSON") from exc
    payload = {
        "resourceIdList": args.resource_id,
        "query": args.query,
        "topK": args.top_k,
        "searchMode": args.mode,
        "where": where,
        "metadataFieldList": args.metadata_field,
    }
    if args.action == "chunks":
        payload["fileTypeList"] = args.file_type
    return _json_call(client, operation,
                      "/knowledgeItems/search" if args.action == "chunks" else "/knowledgeItems/searchFile",
                      args.session_id, payload)


def _write(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))


def main(argv: list[str] | None = None) -> int:
    try:
        args = build_parser().parse_args(argv)
        _write(dispatch(args, ServiceClient()))
        return 0
    except KbCliError as exc:
        _write(exc.payload())
        return exc.exit_code
    except KeyboardInterrupt:
        error = KbCliError("INTERRUPTED", "operation interrupted", exit_code=EXIT_RUNTIME)
        _write(error.payload())
        return error.exit_code
    except Exception:
        error = KbCliError("INTERNAL_ERROR", "unexpected kbcli failure", exit_code=EXIT_RUNTIME)
        _write(error.payload())
        return error.exit_code


def entrypoint() -> NoReturn:
    raise SystemExit(main())
