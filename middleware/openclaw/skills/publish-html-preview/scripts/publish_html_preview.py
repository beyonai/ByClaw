#!/usr/bin/env python3
"""Publish an HTML file or site directory through the ByClaw Artifact API."""

from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import mimetypes
import os
from pathlib import Path, PurePosixPath
import secrets
import ssl
import sys
import tempfile
from typing import Any, BinaryIO, Iterator
from urllib.parse import quote, urlsplit, urlunsplit
import zipfile


DEFAULT_EXPIRY_SECONDS = 7 * 24 * 60 * 60
MAX_EXPIRY_SECONDS = 30 * 24 * 60 * 60
UPLOAD_ENDPOINT = "open/api/v1/artifacts"
CHUNK_SIZE = 1024 * 1024


class PublishError(RuntimeError):
    """Represent an expected publishing failure suitable for agent output."""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Publish an HTML file, site directory, or ZIP as a ByClaw Artifact preview."
    )
    parser.add_argument("--path", required=True, help="HTML file, site directory, or ZIP to publish")
    parser.add_argument(
        "--entry-point",
        help="Site entry path relative to the archive root; directories default to index.html",
    )
    parser.add_argument("--display-name", help="Optional user-facing Artifact name")
    parser.add_argument(
        "--expires-in-seconds",
        type=int,
        default=DEFAULT_EXPIRY_SECONDS,
        help=f"Capability URL lifetime, from 1 to {MAX_EXPIRY_SECONDS} seconds",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=float,
        default=120.0,
        help="HTTP connection and response timeout",
    )
    return parser.parse_args()


def validate_entry_point(raw: str) -> str:
    normalized = raw.replace("\\", "/").strip()
    path = PurePosixPath(normalized)
    if not normalized or path.is_absolute() or ".." in path.parts:
        raise PublishError("entry point must be a safe path relative to the site root")
    return str(path)


def zip_site(source_dir: Path, entry_point: str) -> Path:
    entry_file = source_dir.joinpath(*PurePosixPath(entry_point).parts)
    if not entry_file.is_file():
        raise PublishError(f"site entry point does not exist: {entry_point}")

    temp_file = tempfile.NamedTemporaryFile(prefix="byclaw-html-preview-", suffix=".zip", delete=False)
    temp_path = Path(temp_file.name)
    temp_file.close()
    try:
        with zipfile.ZipFile(temp_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for candidate in sorted(source_dir.rglob("*")):
                if candidate.is_symlink():
                    raise PublishError(f"site directory contains a symbolic link: {candidate}")
                if candidate.is_file():
                    archive.write(candidate, candidate.relative_to(source_dir).as_posix())
        return temp_path
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(CHUNK_SIZE):
            digest.update(chunk)
    return digest.hexdigest()


def backend_base_url() -> str:
    for name in (
        "BYAI_SERVICE_BASE_URL",
        "BAIYING_HUB_BASE_URL",
        "BAIYING_WORKSPACE_ARCHIVE_BASE_URL",
    ):
        value = os.environ.get(name, "").strip()
        if value:
            parsed = urlsplit(value)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                raise PublishError(f"{name} is not a valid HTTP(S) base URL")
            return value.rstrip("/")
    raise PublishError(
        "backend service URL is unavailable; the sandbox host must inject "
        "BYAI_SERVICE_BASE_URL from discover_backend_base_url"
    )


def endpoint_url(base_url: str) -> str:
    return f"{base_url}/{UPLOAD_ENDPOINT}"


def absolute_capability_url(base_url: str, value: Any) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    value = value.strip()
    parsed_value = urlsplit(value)
    if parsed_value.scheme and parsed_value.netloc:
        return value

    parsed_base = urlsplit(base_url)
    base_path = parsed_base.path.rstrip("/")
    relative_path = parsed_value.path
    if relative_path.startswith("/"):
        path = (
            relative_path
            if base_path and relative_path.startswith(f"{base_path}/")
            else f"{base_path}{relative_path}"
        )
    else:
        path = f"{base_path}/{relative_path}"
    return urlunsplit((parsed_base.scheme, parsed_base.netloc, path, parsed_value.query, parsed_value.fragment))


def text_part(boundary: str, name: str, value: str) -> bytes:
    return (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="{name}"\r\n\r\n'
        f"{value}\r\n"
    ).encode("utf-8")


def file_header(boundary: str, file_path: Path, upload_name: str) -> bytes:
    content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    ascii_name = "upload.zip" if file_path.suffix.lower() == ".zip" else "upload.html"
    encoded_name = quote(upload_name, safe="")
    return (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{ascii_name}"; '
        f"filename*=UTF-8''{encoded_name}\r\n"
        f"Content-Type: {content_type}\r\n\r\n"
    ).encode("ascii")


def multipart_segments(
    boundary: str, fields: dict[str, str], file_path: Path, upload_name: str
) -> tuple[list[bytes], bytes, bytes]:
    field_segments = [text_part(boundary, name, value) for name, value in fields.items()]
    header = file_header(boundary, file_path, upload_name)
    closing = f"\r\n--{boundary}--\r\n".encode("ascii")
    return field_segments, header, closing


def iter_file(stream: BinaryIO) -> Iterator[bytes]:
    while chunk := stream.read(CHUNK_SIZE):
        yield chunk


def upload(
    url: str,
    token: str,
    file_path: Path,
    upload_name: str,
    fields: dict[str, str],
    timeout_seconds: float,
) -> dict[str, Any]:
    parsed = urlsplit(url)
    boundary = f"----ByClawArtifact{secrets.token_hex(16)}"
    field_segments, header, closing = multipart_segments(boundary, fields, file_path, upload_name)
    content_length = sum(map(len, field_segments)) + len(header) + file_path.stat().st_size + len(closing)
    request_path = parsed.path or "/"
    if parsed.query:
        request_path = f"{request_path}?{parsed.query}"

    connection_type = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
    connection_kwargs: dict[str, Any] = {"timeout": timeout_seconds}
    if parsed.scheme == "https":
        connection_kwargs["context"] = ssl.create_default_context()
    connection = connection_type(parsed.hostname, parsed.port, **connection_kwargs)
    try:
        connection.putrequest("POST", request_path)
        connection.putheader("Beyond-Token", token)
        connection.putheader("Content-Type", f"multipart/form-data; boundary={boundary}")
        connection.putheader("Content-Length", str(content_length))
        connection.putheader("Accept", "application/json")
        connection.endheaders()
        for segment in field_segments:
            connection.send(segment)
        connection.send(header)
        with file_path.open("rb") as stream:
            for chunk in iter_file(stream):
                connection.send(chunk)
        connection.send(closing)

        response = connection.getresponse()
        body = response.read()
    except (OSError, http.client.HTTPException) as exc:
        raise PublishError(f"Artifact upload request failed: {exc}") from exc
    finally:
        connection.close()

    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise PublishError(f"Artifact API returned HTTP {response.status} with invalid JSON") from exc
    if response.status < 200 or response.status >= 300:
        message = payload.get("msg") if isinstance(payload, dict) else None
        raise PublishError(f"Artifact API returned HTTP {response.status}: {message or 'upload rejected'}")
    if not isinstance(payload, dict) or payload.get("success") is not True or not isinstance(payload.get("data"), dict):
        message = payload.get("msg") if isinstance(payload, dict) else None
        raise PublishError(f"Artifact API rejected the upload: {message or 'unexpected response'}")
    return payload["data"]


def prepare_upload(args: argparse.Namespace) -> tuple[Path, str, str | None, bool, str]:
    source = Path(args.path).expanduser().resolve()
    if not source.exists():
        raise PublishError(f"publish path does not exist: {source}")

    if source.is_dir():
        entry_point = validate_entry_point(args.entry_point or "index.html")
        return zip_site(source, entry_point), "SITE", entry_point, True, f"{source.name}.zip"
    if not source.is_file():
        raise PublishError(f"publish path is not a regular file: {source}")

    suffix = source.suffix.lower()
    if suffix == ".zip":
        entry_point = validate_entry_point(args.entry_point) if args.entry_point else None
        return source, "SITE" if entry_point else "AUTO", entry_point, False, source.name
    if suffix in {".html", ".htm"}:
        if args.entry_point:
            raise PublishError("--entry-point applies only to a directory or ZIP site")
        return source, "AUTO", None, False, source.name
    raise PublishError("publish path must be an HTML file, a site directory, or a ZIP archive")


def publish(args: argparse.Namespace) -> dict[str, Any]:
    if not 1 <= args.expires_in_seconds <= MAX_EXPIRY_SECONDS:
        raise PublishError(f"--expires-in-seconds must be between 1 and {MAX_EXPIRY_SECONDS}")
    if args.timeout_seconds <= 0:
        raise PublishError("--timeout-seconds must be greater than zero")

    token = os.environ.get("BEYOND_TOKEN", "").strip()
    if not token:
        raise PublishError("BEYOND_TOKEN is not available in the sandbox environment")
    base_url = backend_base_url()
    upload_path, publish_mode, entry_point, temporary, upload_name = prepare_upload(args)
    try:
        fields = {
            "publishMode": publish_mode,
            "stripTopLevelDirectory": "true",
            "expiresInSeconds": str(args.expires_in_seconds),
            "sha256": sha256_file(upload_path),
        }
        if entry_point:
            fields["entryPoint"] = entry_point
        if args.display_name:
            fields["displayName"] = args.display_name

        data = upload(
            endpoint_url(base_url),
            token,
            upload_path,
            upload_name,
            fields,
            args.timeout_seconds,
        )
    finally:
        if temporary:
            upload_path.unlink(missing_ok=True)

    return {
        "ok": True,
        "artifactId": data.get("artifactId"),
        "kind": data.get("kind"),
        "status": data.get("status"),
        "entryPoint": data.get("entryPoint"),
        "previewUrl": absolute_capability_url(base_url, data.get("previewUrl")),
        "downloadUrl": absolute_capability_url(base_url, data.get("downloadUrl")),
        "expiresAt": data.get("expiresAt"),
        "warnings": data.get("warnings") or [],
    }


def main() -> int:
    try:
        result = publish(parse_args())
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except PublishError as exc:
        print(
            json.dumps(
                {"ok": False, "error": {"code": "publish_failed", "message": str(exc)}},
                ensure_ascii=False,
                indent=2,
            ),
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
