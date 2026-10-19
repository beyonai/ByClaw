#!/usr/bin/env python3
"""Search conversations through the server-enforced caller allowlist."""
from __future__ import annotations

import argparse
import asyncio
from datetime import datetime
import json
import sys


QUERY_PATH = "/byaiService/skills/conversation-search/query"


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed < 1:
        raise argparse.ArgumentTypeError("必须是正整数")
    return parsed


def timestamp(value: str) -> str:
    try:
        return datetime.strptime(value, "%Y-%m-%d %H:%M:%S").strftime("%Y-%m-%d %H:%M:%S")
    except ValueError as exc:
        raise argparse.ArgumentTypeError("时间格式必须为 yyyy-MM-dd HH:mm:ss") from exc


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="搜索对话记录（服务端校验当前用户白名单）")
    parser.add_argument("--session-id", required=True)
    parser.add_argument("--user-code")
    parser.add_argument("--digital-employee-id", type=positive_int)
    parser.add_argument("--start-time", type=timestamp)
    parser.add_argument("--end-time", type=timestamp)
    parser.add_argument("--keyword")
    parser.add_argument("--page-num", type=positive_int, default=1)
    parser.add_argument("--page-size", type=positive_int, default=20)
    args = parser.parse_args(argv)
    if not args.session_id.strip():
        parser.error("session-id 不能为空")
    if args.page_size > 100:
        parser.error("page-size 不能超过100")
    for field in ("user_code", "keyword"):
        value = getattr(args, field)
        if value is not None and not value.strip():
            parser.error(f"{field} 不能为空")
    if args.start_time and args.end_time and args.start_time > args.end_time:
        parser.error("开始时间不能晚于结束时间")
    return args


def payload_for(args: argparse.Namespace) -> dict:
    fields = {"userCode": args.user_code, "digitalEmployeeId": args.digital_employee_id,
              "startTime": args.start_time, "endTime": args.end_time, "keyword": args.keyword,
              "pageNum": args.page_num, "pageSize": args.page_size}
    return {key: value for key, value in fields.items() if value is not None}


async def search(args: argparse.Namespace, client) -> dict:
    body = await client.json("POST", QUERY_PATH, session_id=args.session_id, payload=payload_for(args))
    if body.get("code") != 0 or not isinstance(body.get("data"), dict):
        raise ValueError("查询响应无效")
    data = body["data"]
    if not isinstance(data.get("list"), list) or any(
        not isinstance(data.get(key), int) or isinstance(data.get(key), bool)
        for key in ("total", "pageNum", "pageSize", "totalPages")
    ):
        raise ValueError("分页响应无效")
    return {"ok": True, "data": data}


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        from callcli.credentials import platform_beyond_token
        from callcli.errors import CallCliError
        from callcli.service_client import DiscoveryServiceClient
    except ImportError:
        print(json.dumps({"ok": False, "error": "缺少平台callcli运行依赖"}, ensure_ascii=False))
        return 1
    if not platform_beyond_token():
        print(json.dumps({"ok": False, "error": "当前用户未认证，缺少平台注入的身份凭据"}, ensure_ascii=False))
        return 1
    try:
        result = asyncio.run(search(args, DiscoveryServiceClient()))
    except CallCliError as exc:
        # Never echo backend bodies, credentials or transport exception strings.
        denied = exc.code == "SESSION_INVALID"
        message = "当前用户无权查询对话记录或登录已失效" if denied else "对话查询失败，请检查平台服务和配置"
        result = {"ok": False, "error": message}
    except Exception:
        result = {"ok": False, "error": "对话查询失败，请检查平台服务和配置"}
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
