#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""SearXNG 进程内搜索 CLI（免依赖二进制版）

不启动 Flask Web 服务、不监听端口：每次调用起一个进程，
进程内调用 SearXNG 搜索核心，向 stdout 输出单个 JSON 对象后退出。

用法:
    searxng-cli "查询词" [--engines google,bing] [--category general] \
        [--language zh-CN] [--safesearch 0] [--max-results 20] [--timeout 10]
"""

import argparse
import json
import os
import sys
import traceback
from pathlib import Path
from timeit import default_timer


def _field(res, key, default=""):
    """兼容 msgspec Struct 与 LegacyResult(dict) 的字段读取。"""
    try:
        value = res[key]
    except (KeyError, TypeError):
        value = getattr(res, key, default)
    return default if value is None else value


def resolve_settings_path() -> Path:
    """PyInstaller onedir 打包后数据文件位于 _internal/ 下。"""
    if getattr(sys, "frozen", False):
        base = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    else:
        base = Path(__file__).resolve().parent
    return base / "searxng_pack_settings.yml"


def load_cli_config(settings_path: Path) -> dict:
    """读取 searxng_pack_settings.yml 中的 CLI 专属配置段（cli:）。

    当前支持:
      cli.default_engines: {category: [engine_name, ...]}
        - 未传 --engines 时，按 --category 使用该白名单（优于该类别全量引擎）
        - 该类别未配置白名单时，回退为类别全量引擎
    注意: 此段是 CLI 私有配置，SearXNG 核心不认识它，会被忽略（不影响核心行为）。
    """
    try:
        import yaml

        with open(settings_path, encoding="utf-8") as f:
            cfg = yaml.safe_load(f) or {}
        return cfg.get("cli", {}) or {}
    except Exception as exc:  # noqa: BLE001 配置损坏不应阻断 CLI
        sys.stderr.write(f"WARNING: failed to parse cli config from {settings_path}: {exc}\n")
        return {}


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="searxng-cli",
        description="SearXNG 进程内搜索 CLI：调用一次起一个进程，stdout 输出 JSON 后退出",
    )
    parser.add_argument("query", nargs="?", default=None, help="搜索关键词（--list-engines 模式下可省略）")
    parser.add_argument(
        "--engines", default=None, help="逗号分隔的引擎白名单，如 google,bing,wikipedia；默认按 --category 选择"
    )
    parser.add_argument("--category", default="general", help="搜索类别，默认 general（可用类别见 --list-engines）")
    parser.add_argument("--language", default="all", help="语言，如 zh-CN / en / all，默认 all")
    parser.add_argument("--safesearch", type=int, default=0, choices=[0, 1, 2], help="安全搜索级别，默认 0")
    parser.add_argument(
        "--time-range",
        default=None,
        choices=["day", "week", "month", "year"],
        help="时间范围过滤：day/week/month/year（仅支持 time_range 的引擎生效）",
    )
    parser.add_argument("--pageno", type=int, default=1, help="结果页码，默认 1（配合 --max-results 翻页）")
    parser.add_argument("--max-results", type=int, default=20, help="最多返回的结果条数，默认 20")
    parser.add_argument("--timeout", type=float, default=10.0, help="单次搜索超时（秒），默认 10")
    parser.add_argument("--list-engines", action="store_true", help="列出可用引擎与类别后退出")
    args = parser.parse_args()
    if not args.list_engines and not args.query:
        parser.error("query is required")

    # 必须在 import searx 之前注入：searx/__init__.py 在导入时执行 init_settings()
    settings_path = resolve_settings_path()
    if not settings_path.is_file():
        err = f"settings file not found: {settings_path}"
        sys.stderr.write(f"ERROR: {err}\n")
        print(json.dumps({"error": err, "exit_code": 1}, ensure_ascii=False))
        return 1
    os.environ["SEARXNG_SETTINGS_PATH"] = str(settings_path)

    try:
        import searx  # noqa: F401  # 触发 init_settings()

        from searx.search import Search, initialize
        from searx.search.models import EngineRef, SearchQuery
        from searx.engines import engines, categories
        from flask import Flask

        initialize()  # 加载引擎、初始化网络（含代理）/ metrics / processors

        if args.list_engines:
            listing = {
                cat: sorted(e.name for e in eng_list) for cat, eng_list in sorted(categories.items())
            }
            print(json.dumps(listing, ensure_ascii=False, indent=2))
            return 0

        if args.engines:
            refs = []
            unknown = []
            for name in (n.strip() for n in args.engines.split(",") if n.strip()):
                engine = engines.get(name)
                if engine is None:
                    unknown.append(name)
                    continue
                cat = engine.categories[0] if engine.categories else "general"
                refs.append(EngineRef(name, cat))
            if unknown:
                raise RuntimeError(f"unknown engine(s): {', '.join(unknown)} (see --list-engines)")
            if not refs:
                raise RuntimeError("no valid engine specified (see --list-engines)")
        else:
            # 未传 --engines：优先使用配置中的 cli.default_engines[category] 白名单
            cli_cfg = load_cli_config(settings_path)
            default_map = cli_cfg.get("default_engines", {}) or {}
            whitelist = default_map.get(args.category)

            if whitelist:
                refs = []
                unknown = []
                for name in (n.strip() for n in whitelist if n.strip()):
                    engine = engines.get(name)
                    if engine is None:
                        unknown.append(name)
                        continue
                    cat = engine.categories[0] if engine.categories else args.category
                    refs.append(EngineRef(name, cat))
                if unknown:
                    sys.stderr.write(
                        f"WARNING: cli.default_engines.{args.category} 中存在未知引擎: {', '.join(unknown)}\n"
                    )
                if not refs:
                    raise RuntimeError(
                        f"cli.default_engines.{args.category} 全部无效（见 --list-engines）"
                    )
            else:
                # 该类别未配置白名单 -> 类别全量
                eng_list = categories.get(args.category)
                if not eng_list:
                    raise RuntimeError(
                        f"unknown category: {args.category} (available: {', '.join(sorted(categories))})"
                    )
                refs = [EngineRef(e.name, args.category) for e in eng_list]

        search_query = SearchQuery(
            query=args.query,
            engineref_list=refs,
            lang=args.language,
            safesearch=args.safesearch,
            pageno=args.pageno,
            time_range=args.time_range,
            timeout_limit=args.timeout,
        )

        # Search.search() 内部用 copy_current_request_context 派生线程上下文，
        # 必须处于 Flask request context（test_request_context 不监听端口）。
        app = Flask(__name__)

        start = default_timer()
        with app.test_request_context("/"):
            container = Search(search_query).search()
        elapsed = default_timer() - start

        results = []
        for res in container.get_ordered_results()[: args.max_results]:
            engines_val = _field(res, "engines", "")
            if isinstance(engines_val, (set, list, tuple)):
                engines_val = ", ".join(str(x) for x in engines_val)
            engine_name = _field(res, "engine", "") or engines_val
            results.append(
                {
                    "url": _field(res, "url"),
                    "title": _field(res, "title"),
                    "content": _field(res, "content"),
                    "engine": engine_name,
                    "score": round(float(_field(res, "score", 0.0)), 4),
                }
            )

        stats = {}
        for timing in container.timings:
            stats.setdefault(timing.engine, {"elapsed_sec": round(timing.total, 3), "error": None})
        for unresponsive in container.unresponsive_engines:
            entry = stats.setdefault(unresponsive.engine, {"elapsed_sec": None, "error": None})
            entry["error"] = unresponsive.error_type

        out = {
            "query": args.query,
            "results": results,
            "engine_stats": stats,
            "elapsed_sec": round(elapsed, 3),
            "result_count": len(results),
        }
        if container.redirect_url:
            out["redirect_url"] = container.redirect_url
        if container.suggestions:
            out["suggestions"] = sorted(container.suggestions)
        if container.corrections:
            out["corrections"] = sorted(container.corrections)

        print(json.dumps(out, ensure_ascii=False))
        return 0

    except Exception as exc:  # noqa: BLE001 顶层兜底：任何错误输出 JSON + 非零退出码
        sys.stderr.write(traceback.format_exc())
        sys.stderr.write(f"ERROR: {exc}\n")
        print(json.dumps({"error": str(exc), "exit_code": 1}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    sys.exit(main())
