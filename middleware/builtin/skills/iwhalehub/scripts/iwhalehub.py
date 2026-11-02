#!/usr/bin/env python3
from __future__ import annotations

import argparse
import io
import json
import os
import re
import shutil
import sys
import tempfile
import traceback
import zipfile
from pathlib import Path
from shutil import rmtree as _remove_tree
from typing import Any, Dict, List, Optional

from marketplace import (
    RESOURCE_TYPE_SKILL,
    MarketplaceAuthRequiredError,
    MarketplaceUnavailableError,
    build_headers,
    compact_skill,
    extract_rows,
    normalize_base_url,
    normalize_query,
    request_bytes,
    request_json,
    require_auth,
    sanitize_error,
    trim,
)


def build_search_payload(args: argparse.Namespace, query: str) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "pageIndex": args.page_index,
        "pageSize": args.page_size,
        "resourceType": RESOURCE_TYPE_SKILL,
        "name": query,
    }
    if args.sort_type is not None:
        payload["sortType"] = args.sort_type
    if args.catalog_id is not None:
        payload["catalogId"] = args.catalog_id
    if args.project_type is not None:
        payload["projectType"] = args.project_type
    if args.collect:
        payload["isCollect"] = 1
    if args.latest:
        payload["isLatest"] = 1
    if args.recent_used:
        payload["recentUsed"] = 1
    return payload


def render_markdown(query: str, rows: List[Dict[str, Any]]) -> str:
    lines: List[str] = []
    lines.append("# iWhale skill search")
    lines.append("")
    lines.append(f"Query: `{query or '(empty)'}`")
    lines.append(f"Matches: `{len(rows)}`")
    lines.append("")
    if not rows:
        lines.append("No matching skills found.")
        return "\n".join(lines)

    lines.append("| # | Skill ID | Name | Code | Registry |")
    lines.append("| - | - | - | - | - |")
    for idx, row in enumerate(rows, start=1):
        item = compact_skill(row)
        skill_id = trim(item.get("skillId") or item.get("objId") or "-", 24)
        name = trim(item.get("name") or "-", 40)
        code = trim(item.get("code") or "-", 36)
        registry = trim(item.get("registryName") or "-", 24)
        lines.append(f"| {idx} | {skill_id} | {name} | {code} | {registry} |")
    return "\n".join(lines).rstrip() + "\n"


def render_json(query: str, rows: List[Dict[str, Any]]) -> str:
    payload = {
        "query": query,
        "count": len(rows),
        "results": [compact_skill(row) for row in rows],
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


def run_search(args: argparse.Namespace) -> int:
    manager_url_raw = os.getenv("KN_MANAGER_URL", "").strip()
    if not manager_url_raw:
        print("Skill marketplace configuration is unavailable.", file=sys.stderr)
        return 2

    manager_url = normalize_base_url(manager_url_raw)
    auth_key, auth_value = require_auth()
    query = normalize_query(args.query)
    headers = build_headers(auth_key, auth_value)
    search_url = f"{manager_url}/resource/qryStoreResourcePageByLogin"

    try:
        search_resp = request_json(search_url, build_search_payload(args, query), headers)
    except MarketplaceUnavailableError:
        print("Skill marketplace is temporarily unavailable.")
        return 0

    rows = extract_rows(search_resp)

    if args.json:
        print(render_json(query, rows))
    else:
        print(render_markdown(query, rows), end="")
    return 0


def _slugify_skill_folder(raw: str, skill_id: int) -> str:
    value = (raw or "").strip()
    if not value:
        return f"skill-{skill_id}"
    if "/" in value:
        value = value.rsplit("/", 1)[-1]
    value = re.sub(r"[^A-Za-z0-9._-]+", "-", value)
    value = re.sub(r"-{2,}", "-", value).strip("._-")
    return value or f"skill-{skill_id}"


def _read_skill_name(skill_md: Path) -> Optional[str]:
    try:
        for line in skill_md.read_text(encoding="utf-8", errors="replace").splitlines()[:40]:
            stripped = line.strip()
            if stripped.startswith("name:"):
                return stripped.split(":", 1)[1].strip().strip("'\"")
    except OSError:
        return None
    return None


def _derive_target_dir(skills_root: Path, extracted_root: Path, temp_dir: Path, skill_md: Path, skill_id: int) -> Path:
    if extracted_root != temp_dir:
        folder_name = _slugify_skill_folder(extracted_root.name, skill_id)
    else:
        folder_name = _slugify_skill_folder(_read_skill_name(skill_md) or "", skill_id)
    return skills_root / folder_name


def _require_direct_child_dir(parent: Path, target: Path, label: str) -> Path:
    parent_resolved = parent.expanduser().resolve()
    target_resolved = target.expanduser().resolve()
    try:
        target_resolved.relative_to(parent_resolved)
    except ValueError as exc:
        raise RuntimeError(f"{label} must stay inside {parent_resolved}") from exc
    if target_resolved == parent_resolved or target_resolved.parent != parent_resolved:
        raise RuntimeError(f"{label} must be a direct child of {parent_resolved}")
    return target_resolved


def _remove_existing_skill_dir(skills_root: Path, target_dir: Path) -> None:
    safe_target = _require_direct_child_dir(skills_root, target_dir, "Target skill directory")
    if safe_target.exists():
        _remove_tree(safe_target)


def _remove_temp_extract_dir(skills_root: Path, temp_dir: Path) -> None:
    safe_temp_dir = _require_direct_child_dir(skills_root, temp_dir, "Temporary extraction directory")
    if not safe_temp_dir.name.startswith(".iwhale-skill-"):
        raise RuntimeError("Temporary extraction directory name is not allowed")
    _remove_tree(safe_temp_dir, ignore_errors=True)


def _safe_extract_zip(zip_bytes: bytes, extract_dir: Path) -> Path:
    extract_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archive:
        for info in archive.infolist():
            raw_name = info.filename.replace("\\", "/")
            if not raw_name or raw_name.endswith("/"):
                continue
            entry_path = (extract_dir / raw_name).resolve()
            if extract_dir.resolve() not in entry_path.parents and entry_path != extract_dir.resolve():
                raise RuntimeError(f"Archive entry escapes target directory: {raw_name}")
            mode = info.external_attr >> 16
            file_type = mode & 0o170000
            if file_type in (0o120000, 0o020000, 0o060000):
                raise RuntimeError(f"Archive entry type is not allowed: {raw_name}")
            entry_path.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(info) as src, open(entry_path, "wb") as dst:
                shutil.copyfileobj(src, dst)
            if mode:
                try:
                    os.chmod(entry_path, mode & 0o777)
                except OSError:
                    pass

    candidates = [
        child
        for child in extract_dir.iterdir()
        if child.name not in (".DS_Store", "__MACOSX")
    ]
    if len(candidates) == 1 and candidates[0].is_dir():
        return candidates[0]
    return extract_dir


def _find_skill_md(root: Path) -> Optional[Path]:
    direct = root / "SKILL.md"
    if direct.exists():
        return direct
    for child in root.iterdir():
        if child.is_dir():
            nested = child / "SKILL.md"
            if nested.exists():
                return nested
    return None


def render_install_result(result: Dict[str, Any], use_json: bool) -> None:
    if use_json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return
    if result.get("dryRun"):
        print(f"Would install skill {result.get('skillId')} into {result.get('targetDir')}")
        return
    print(f"Installed skill {result.get('skillId')} into {result.get('targetDir')}")


def run_install(args: argparse.Namespace) -> int:
    manager_url_raw = os.getenv("KN_MANAGER_URL", "").strip()
    if not manager_url_raw:
        print("Skill marketplace configuration is unavailable.", file=sys.stderr)
        return 2

    manager_url = normalize_base_url(manager_url_raw)
    auth_key, auth_value = require_auth()
    headers = build_headers(auth_key, auth_value)
    target_workspace = Path(args.workspace_dir or os.getenv("OPENCLAW_WORKSPACE_DIR", os.getcwd())).expanduser().resolve()
    skills_root = target_workspace / "skills"
    target_workspace.mkdir(parents=True, exist_ok=True)
    skills_root.mkdir(parents=True, exist_ok=True)
    skill_id = args.skill_id
    target_dir = skills_root / f"skill-{skill_id}"
    result: Dict[str, Any] = {
        "skillId": skill_id,
        "targetDir": str(target_dir),
    }

    if args.dry_run:
        result["dryRun"] = True
        render_install_result(result, args.json)
        return 0

    export_payload = {"skillIds": [skill_id]}
    zip_bytes = request_bytes(f"{manager_url}/api/skill/export", headers, export_payload)
    temp_dir = Path(tempfile.mkdtemp(prefix=".iwhale-skill-", dir=str(skills_root if skills_root.exists() else target_workspace)))
    try:
        extracted_root = _safe_extract_zip(zip_bytes, temp_dir)
        skill_md = _find_skill_md(extracted_root)
        if skill_md is None:
            raise RuntimeError("ZIP archive does not contain SKILL.md")

        target_dir = _derive_target_dir(skills_root, extracted_root, temp_dir, skill_md, skill_id)
        target_dir = _require_direct_child_dir(skills_root, target_dir, "Target skill directory")
        result["targetDir"] = str(target_dir)
        _remove_existing_skill_dir(skills_root, target_dir)
        target_dir.parent.mkdir(parents=True, exist_ok=True)

        if extracted_root == temp_dir:
            target_dir.mkdir(parents=True, exist_ok=False)
            for child in list(temp_dir.iterdir()):
                shutil.move(str(child), str(target_dir / child.name))
        else:
            shutil.move(str(extracted_root), str(target_dir))
        result["installed"] = True
        result["skillMd"] = str(target_dir / "SKILL.md")
        render_install_result(result, args.json)
        return 0
    finally:
        _remove_temp_extract_dir(skills_root, temp_dir)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Search and install iWhale skills.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    search = subparsers.add_parser("search", help="Search the skill marketplace.")
    search.add_argument("--query", nargs="?", const="", default="", help="Search term")
    search.add_argument("--page-size", type=int, default=10)
    search.add_argument("--page-index", type=int, default=1)
    search.add_argument("--sort-type", type=int)
    search.add_argument("--catalog-id", type=int)
    search.add_argument("--project-type", type=int)
    search.add_argument("--collect", action="store_true")
    search.add_argument("--latest", action="store_true")
    search.add_argument("--recent-used", action="store_true")
    search.add_argument("--json", action="store_true", help="Emit JSON instead of markdown")

    install = subparsers.add_parser("install", help="Install a skill from its ZIP package.")
    install.add_argument("--skill-id", "--skillId", dest="skill_id", type=int, required=True, help="Skill ID (skillInfoId) returned by search.")
    install.add_argument("--project-type", type=int)
    install.add_argument("--workspace-dir", "--workspaceDir", dest="workspace_dir")
    install.add_argument("--dry-run", action="store_true")
    install.add_argument("--json", action="store_true", help="Emit JSON instead of text")

    return parser


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "search":
            return run_search(args)
        if args.command == "install":
            return run_install(args)
        parser.error(f"Unsupported command: {args.command}")
        return 2
    except MarketplaceUnavailableError:
        print("Skill marketplace is temporarily unavailable.")
        return 0
    except MarketplaceAuthRequiredError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    except RuntimeError as exc:
        print(sanitize_error(exc), file=sys.stderr)
        return 1
    except Exception as exc:
        if os.getenv("IWHALEHUB_DEBUG", "").strip() in ("1", "true", "TRUE", "yes", "YES"):
            print(sanitize_error(traceback.format_exc()), file=sys.stderr)
        else:
            message = sanitize_error(exc)
            suffix = f": {message}" if message else ""
            print(f"Skill marketplace request failed ({type(exc).__name__}){suffix}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
