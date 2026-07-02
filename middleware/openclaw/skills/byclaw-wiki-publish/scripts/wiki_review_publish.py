#!/usr/bin/env python3
"""Upload generated Wiki markdown, submit review, notify, and publish.

This script is deliberately adapter-shaped. Endpoint paths are provided by
environment variables so deployments can wire it to their own backend APIs
without changing the skill.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import re
import sys
import threading
from pathlib import Path
from typing import Any


APPROVED_STATUS_ENV = "WIKI_REVIEW_APPROVED_STATUSES"


class WikiReviewError(RuntimeError):
    def __init__(self, code: str, message: str, *, data: Any | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.data = data


def json_print(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2, default=str))


def required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise WikiReviewError("env_required", f"{name} is not configured.")
    return value


def backend_service_name() -> str:
    value = os.getenv("WIKI_REVIEW_BACKEND_SERVICE", "").strip() or os.getenv("BE_DOMAINNAME", "").strip()
    if not value:
        raise WikiReviewError("service_not_configured", "Set WIKI_REVIEW_BACKEND_SERVICE or BE_DOMAINNAME.")
    return value


def auth_headers(*, json_content: bool = True) -> dict[str, str]:
    headers: dict[str, str] = {}
    if json_content:
        headers["Content-Type"] = "application/json"
    token = os.getenv("BEYOND_TOKEN", "").strip()
    if token:
        headers["Beyond-Token"] = token
    user_code = os.getenv("USER_CODE", "").strip()
    if user_code:
        headers["X-User-Code"] = user_code
    return headers


def init_discovery_redis() -> None:
    from by_framework.common.redis_client import init_redis  # type: ignore[import-untyped]

    init_redis(
        host=os.getenv("REDIS_HOST", "localhost"),
        port=int(os.getenv("REDIS_PORT", "6379")),
        db=int(os.getenv("REDIS_DATABASE", os.getenv("REDIS_DB", "0"))),
        password=os.getenv("REDIS_PASSWORD") or None,
        username=os.getenv("REDIS_USERNAME") or None,
    )


async def post_via_discovery(service_name: str, path: str, payload: dict[str, Any]) -> Any:
    from by_framework.core.discovery import DiscoveryClient  # type: ignore[import-untyped]
    from by_framework.util.discovery_http_client import DiscoveryHttpClient  # type: ignore[import-untyped]
    from by_framework.util.http_client import RetryConfig  # type: ignore[import-untyped]

    init_discovery_redis()
    discovery_client = DiscoveryClient(cache_interval=5)
    retry_config = RetryConfig(max_attempts=3, retry_on_status_codes={502, 503, 504})
    try:
        async with DiscoveryHttpClient(discovery_client, retry_config=retry_config, health_threshold_ms=-1) as client:
            response = await client.post(service_name, path, headers=auth_headers(), json=payload)
    finally:
        await discovery_client.close()

    return normalize_response(response, service_name, path)


async def upload_via_discovery(
    service_name: str,
    path: str,
    *,
    field_name: str,
    filename: str,
    content: bytes,
    form_fields: dict[str, str],
) -> Any:
    from by_framework.core.discovery import DiscoveryClient  # type: ignore[import-untyped]
    from by_framework.util.discovery_http_client import DiscoveryHttpClient  # type: ignore[import-untyped]
    from by_framework.util.http_client import RetryConfig  # type: ignore[import-untyped]

    init_discovery_redis()
    discovery_client = DiscoveryClient(cache_interval=5)
    retry_config = RetryConfig(max_attempts=3, retry_on_status_codes={502, 503, 504})
    try:
        async with DiscoveryHttpClient(discovery_client, retry_config=retry_config, health_threshold_ms=-1) as client:
            upload = getattr(client, "_upload_with_discovery", None)
            if upload is None:
                raise WikiReviewError("upload_not_supported", "DiscoveryHttpClient does not support multipart upload.")
            parts: list[tuple[str, Any]] = []
            for key, value in form_fields.items():
                if value:
                    parts.append((key, (None, value)))
            parts.append((field_name, (filename, content, "text/markdown; charset=utf-8")))
            response = await upload(
                service_name=service_name,
                path=path,
                parts=parts,
                headers=auth_headers(json_content=False),
            )
    finally:
        await discovery_client.close()

    return normalize_response(response, service_name, path)


def normalize_response(response: Any, service_name: str, path: str) -> Any:
    status_code = int(getattr(response, "status_code", 0) or 0)
    is_success = bool(getattr(response, "is_success", False))
    data = getattr(response, "data", None)
    if not is_success:
        raise WikiReviewError("request_failed", f"HTTP {status_code} calling {service_name}{path}.", data=data)
    if isinstance(data, dict) and data.get("code", 0) not in (0, "0", None):
        message = data.get("msg") or data.get("message") or data.get("error") or data
        raise WikiReviewError("request_failed", f"Backend error calling {service_name}{path}: {message}", data=data)
    if isinstance(data, dict) and "data" in data:
        return data["data"]
    return data


def run_async(coro: Any) -> Any:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)

    result: dict[str, Any] = {}
    error: dict[str, BaseException] = {}

    def runner() -> None:
        try:
            result["value"] = asyncio.run(coro)
        except BaseException as exc:  # noqa: BLE001
            error["exc"] = exc

    thread = threading.Thread(target=runner, daemon=True)
    thread.start()
    thread.join()
    if "exc" in error:
        raise error["exc"]
    return result.get("value")


def slugify(value: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9_.-]+", "-", value.strip()).strip("-._")
    return slug[:80] or "wiki"


def read_markdown(args: argparse.Namespace) -> tuple[str, str]:
    if args.markdown_file:
        path = Path(args.markdown_file).expanduser()
        content = path.read_text(encoding="utf-8")
        return content, path.name
    if args.markdown_text:
        digest = hashlib.sha256(args.markdown_text.encode("utf-8")).hexdigest()[:8]
        return args.markdown_text, f"{slugify(args.document_title)}-{digest}.md"
    raise WikiReviewError("invalid_request", "Provide --markdown-file or --markdown-text.")


def load_json_map_env(name: str) -> dict[str, str]:
    raw = os.getenv(name, "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise WikiReviewError("invalid_env_json", f"{name} must be a JSON object: {exc}") from exc
    if not isinstance(parsed, dict):
        raise WikiReviewError("invalid_env_json", f"{name} must be a JSON object.")
    return {str(key): str(value) for key, value in parsed.items() if value is not None and str(value).strip()}


def repo_key(value: str | None) -> str:
    if not value:
        return ""
    return value.strip().rstrip("/").removesuffix(".git")


def resolve_reviewer(args: argparse.Namespace) -> str:
    if getattr(args, "reviewer", None):
        return args.reviewer.strip()
    if getattr(args, "reviewer_ref", None):
        value = os.getenv(args.reviewer_ref, "").strip()
        if value:
            return value
        raise WikiReviewError("reviewer_not_found", f"Reviewer env var is not configured: {args.reviewer_ref}")

    repository_url = repo_key(getattr(args, "repository_url", None))
    repo_map = load_json_map_env("WIKI_REVIEW_REPOSITORY_REVIEWERS")
    for key, value in repo_map.items():
        if repo_key(key) == repository_url:
            return value

    knowledge_base_id = (getattr(args, "knowledge_base_id", None) or "").strip()
    kb_map = load_json_map_env("WIKI_REVIEW_KB_REVIEWERS")
    if knowledge_base_id and knowledge_base_id in kb_map:
        return kb_map[knowledge_base_id]

    default_reviewer = os.getenv("WIKI_REVIEW_DEFAULT_REVIEWER", "").strip()
    if default_reviewer:
        return default_reviewer

    raise WikiReviewError(
        "reviewer_required",
        "Reviewer is required. Pass --reviewer, --reviewer-ref, or configure WIKI_REVIEW_DEFAULT_REVIEWER.",
    )


def compact_document_ref(upload_result: Any) -> str:
    candidates = [upload_result]
    if isinstance(upload_result, dict):
        for key in ("file", "files", "document", "resource", "result"):
            value = upload_result.get(key)
            if isinstance(value, list):
                candidates.extend(value)
            elif value is not None:
                candidates.append(value)
    for item in candidates:
        if isinstance(item, dict):
            for key in ("url", "fileUrl", "downloadUrl", "objectUrl", "key", "objectKey", "path", "filePath", "id"):
                value = item.get(key)
                if value:
                    return str(value)
        elif isinstance(item, str) and item.strip():
            return item.strip()
    return hashlib.sha256(json.dumps(upload_result, ensure_ascii=False, default=str).encode("utf-8")).hexdigest()[:16]


def extract_review_id(submit_result: Any) -> str | None:
    candidates = [submit_result]
    if isinstance(submit_result, dict):
        for key in ("review", "audit", "approval", "result"):
            value = submit_result.get(key)
            if value is not None:
                candidates.append(value)
    for item in candidates:
        if isinstance(item, dict):
            for key in ("reviewId", "auditId", "approvalId", "id", "taskId", "processId"):
                value = item.get(key)
                if value:
                    return str(value)
        elif isinstance(item, str) and item.strip():
            return item.strip()
    return None


def extract_status(status_result: Any) -> str | None:
    candidates = [status_result]
    if isinstance(status_result, dict):
        for key in ("review", "audit", "approval", "result"):
            value = status_result.get(key)
            if value is not None:
                candidates.append(value)
    for item in candidates:
        if isinstance(item, dict):
            for key in ("status", "reviewStatus", "auditStatus", "state", "result"):
                value = item.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()
                if value is not None and not isinstance(value, (dict, list)):
                    return str(value)
    return None


def build_notify_payload(args: argparse.Namespace, *, review_id: str | None = None, document_ref: str | None = None) -> dict[str, Any]:
    title = getattr(args, "notify_title", None) or getattr(args, "document_title", None) or "Wiki review request"
    message = getattr(args, "notify_message", None) or f"{title} is ready for review."
    return {
        "title": title,
        "message": message,
        "reviewId": review_id or getattr(args, "review_id", None),
        "reviewUrl": getattr(args, "review_url", None),
        "reviewer": getattr(args, "reviewer", None),
        "documentRef": document_ref,
        "repositoryUrl": getattr(args, "repository_url", None),
        "knowledgeBaseId": getattr(args, "knowledge_base_id", None),
    }


def command_submit_review(args: argparse.Namespace) -> dict[str, Any]:
    service_name = backend_service_name()
    upload_path = required_env("WIKI_REVIEW_UPLOAD_PATH")
    submit_path = required_env("WIKI_REVIEW_SUBMIT_PATH")
    reviewer = resolve_reviewer(args)
    markdown, source_filename = read_markdown(args)
    digest = hashlib.sha256(markdown.encode("utf-8")).hexdigest()[:12]
    filename = f"{slugify(args.document_title)}-{digest}.md"
    if source_filename.endswith(".md") and source_filename != filename:
        filename = f"{slugify(Path(source_filename).stem)}-{digest}.md"

    form_fields = {
        "prefix": os.getenv("WIKI_REVIEW_UPLOAD_PREFIX", "").strip(),
        "documentTitle": args.document_title,
        "repositoryUrl": args.repository_url or "",
        "knowledgeBaseId": args.knowledge_base_id or "",
    }
    upload_result = run_async(upload_via_discovery(
        service_name,
        upload_path,
        field_name=os.getenv("WIKI_REVIEW_UPLOAD_FIELD", "files").strip() or "files",
        filename=filename,
        content=markdown.encode("utf-8"),
        form_fields=form_fields,
    ))
    document_ref = compact_document_ref(upload_result)

    submit_payload = {
        "documentTitle": args.document_title,
        "documentRef": document_ref,
        "upload": upload_result,
        "reviewer": reviewer,
        "repositoryUrl": args.repository_url,
        "knowledgeBaseId": args.knowledge_base_id,
        "source": "byclaw-wiki",
        "metadata": {
            "filename": filename,
            "sha256": hashlib.sha256(markdown.encode("utf-8")).hexdigest(),
        },
    }
    submit_result = run_async(post_via_discovery(service_name, submit_path, submit_payload))
    review_id = extract_review_id(submit_result)

    notify_result = None
    if args.notify:
        notify_path = os.getenv("WIKI_REVIEW_NOTIFY_PATH", "").strip()
        if notify_path:
            notify_payload = build_notify_payload(args, review_id=review_id, document_ref=document_ref)
            notify_payload["reviewer"] = reviewer
            notify_result = run_async(post_via_discovery(service_name, notify_path, notify_payload))
        else:
            notify_result = {"skipped": True, "reason": "WIKI_REVIEW_NOTIFY_PATH is not configured"}

    return {
        "ok": True,
        "reviewId": review_id,
        "reviewer": reviewer,
        "documentRef": document_ref,
        "upload": upload_result,
        "submit": submit_result,
        "notify": notify_result,
    }


def command_review_status(args: argparse.Namespace) -> dict[str, Any]:
    service_name = backend_service_name()
    status_path = required_env("WIKI_REVIEW_STATUS_PATH")
    payload = {"reviewId": args.review_id}
    status_result = run_async(post_via_discovery(service_name, status_path, payload))
    return {
        "ok": True,
        "reviewId": args.review_id,
        "status": extract_status(status_result),
        "review": status_result,
    }


def command_publish(args: argparse.Namespace) -> dict[str, Any]:
    service_name = backend_service_name()
    publish_path = required_env("WIKI_REVIEW_PUBLISH_PATH")
    status_result = None
    status = None

    status_path = os.getenv("WIKI_REVIEW_STATUS_PATH", "").strip()
    if status_path and not args.force:
        status_result = run_async(post_via_discovery(service_name, status_path, {"reviewId": args.review_id}))
        status = extract_status(status_result)
        approved = {item.strip().lower() for item in os.getenv(APPROVED_STATUS_ENV, "approved,audit_pass,pass,passed").split(",") if item.strip()}
        if (status or "").lower() not in approved:
            raise WikiReviewError(
                "review_not_approved",
                f"Review {args.review_id} is not approved. Current status: {status or 'unknown'}.",
                data=status_result,
            )
    elif not status_path and not args.force:
        raise WikiReviewError("status_path_required", "Set WIKI_REVIEW_STATUS_PATH or pass --force after explicit user confirmation.")

    payload = {
        "reviewId": args.review_id,
        "knowledgeBaseId": args.knowledge_base_id,
        "force": args.force,
    }
    publish_result = run_async(post_via_discovery(service_name, publish_path, payload))
    return {
        "ok": True,
        "reviewId": args.review_id,
        "knowledgeBaseId": args.knowledge_base_id,
        "status": status,
        "review": status_result,
        "publish": publish_result,
    }


def command_notify(args: argparse.Namespace) -> dict[str, Any]:
    service_name = backend_service_name()
    notify_path = required_env("WIKI_REVIEW_NOTIFY_PATH")
    payload = build_notify_payload(args)
    result = run_async(post_via_discovery(service_name, notify_path, payload))
    return {
        "ok": True,
        "notify": result,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Wiki review and publish adapter")
    subparsers = parser.add_subparsers(dest="command", required=True)

    submit = subparsers.add_parser("submit-review", help="Upload markdown and submit review")
    submit.add_argument("--document-title", required=True)
    submit.add_argument("--markdown-file")
    submit.add_argument("--markdown-text")
    submit.add_argument("--repository-url")
    submit.add_argument("--knowledge-base-id")
    submit.add_argument("--reviewer")
    submit.add_argument("--reviewer-ref")
    submit.add_argument("--notify", action="store_true")
    submit.add_argument("--notify-title")
    submit.add_argument("--notify-message")
    submit.add_argument("--review-url")
    submit.set_defaults(func=command_submit_review)

    status = subparsers.add_parser("review-status", help="Query review status")
    status.add_argument("--review-id", required=True)
    status.set_defaults(func=command_review_status)

    publish = subparsers.add_parser("publish", help="Publish approved Wiki to knowledge base")
    publish.add_argument("--review-id", required=True)
    publish.add_argument("--knowledge-base-id", required=True)
    publish.add_argument("--force", action="store_true")
    publish.set_defaults(func=command_publish)

    notify = subparsers.add_parser("notify", help="Notify reviewer/admin through backend adapter")
    notify.add_argument("--title", dest="notify_title", required=True)
    notify.add_argument("--message", dest="notify_message", required=True)
    notify.add_argument("--review-id")
    notify.add_argument("--review-url")
    notify.add_argument("--reviewer")
    notify.add_argument("--repository-url")
    notify.add_argument("--knowledge-base-id")
    notify.set_defaults(func=command_notify)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        json_print(args.func(args))
        return 0
    except WikiReviewError as exc:
        payload: dict[str, Any] = {
            "ok": False,
            "error": {
                "code": exc.code,
                "message": str(exc),
            },
        }
        if exc.data is not None:
            payload["data"] = exc.data
        json_print(payload)
        return 1
    except Exception as exc:  # noqa: BLE001
        json_print({
            "ok": False,
            "error": {
                "code": "unexpected_error",
                "message": str(exc),
            },
        })
        return 1


if __name__ == "__main__":
    sys.exit(main())
