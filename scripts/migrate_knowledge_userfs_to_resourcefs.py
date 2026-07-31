#!/usr/bin/env python3
"""Migrate legacy knowledge files from per-user UserFS roots to ResourceFS.

The script is intentionally conservative:

* dry-run is the default;
* source files are never deleted;
* existing targets are never overwritten;
* every copied object is verified with SHA-256;
* ambiguous or missing sources are reported and skipped;
* database rows are read-only and are never changed.

It must run on a host where ``FILE_STORAGE_LOCAL_PATH`` is mounted.
The OpenGauss password is read from ``MIGRATION_DB_PASS`` only.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import shutil
import stat
import sys
import time
import uuid
from collections import Counter
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Iterable


TARGET_BUCKET = "byclaw-qa"
RESOURCE_PREFIX = PurePosixPath("/resource/kg_doc")
USER_FS_PREFIX = PurePosixPath("/by")
LOGICAL_PREFIX = "/.bykc/"
SCHEMA_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


@dataclass(frozen=True)
class KnowledgeFile:
    resource_id: int
    kn_code: str
    fs_entry_id: int
    virtual_path: str
    file_object_key: str
    markdown_object_key: str | None
    file_size: int | None
    checksum: str | None
    mime_type: str | None
    updated_at: str | None
    latest_build_status: str | None


@dataclass
class MigrationItem:
    resource_id: int
    kn_code: str
    fs_entry_id: int
    virtual_path: str
    object_type: str
    logical_key: str
    source_paths: list[str]
    selected_source: str | None
    target_path: str
    source_size: int | None
    source_sha256: str | None
    target_size: int | None
    target_sha256: str | None
    status: str
    error: str | None = None

    def report_row(self) -> dict[str, Any]:
        row = asdict(self)
        row["source_paths"] = json.dumps(
            self.source_paths, ensure_ascii=False, separators=(",", ":")
        )
        return row


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Migrate legacy by-qa knowledge objects from UserFS to ResourceFS."
    )
    parser.add_argument(
        "--storage-root",
        default=os.getenv("FILE_STORAGE_LOCAL_PATH"),
        help="Mounted storage root. Defaults to FILE_STORAGE_LOCAL_PATH.",
    )
    parser.add_argument(
        "--db-host",
        default=os.getenv("MIGRATION_DB_HOST", os.getenv("DB_HOST")),
    )
    parser.add_argument(
        "--db-port",
        type=int,
        default=int(os.getenv("MIGRATION_DB_PORT", os.getenv("DB_PORT", "5432"))),
    )
    parser.add_argument(
        "--db-name",
        default=os.getenv("MIGRATION_DB_NAME", os.getenv("DB_DATABASE", "postgres")),
    )
    parser.add_argument(
        "--db-user",
        default=os.getenv("MIGRATION_DB_USER", os.getenv("DB_USER")),
    )
    parser.add_argument(
        "--db-schema",
        default=os.getenv("MIGRATION_DB_SCHEMA", os.getenv("DB_SCHEMA", "byai")),
    )
    parser.add_argument(
        "--resource-id",
        type=int,
        action="append",
        dest="resource_ids",
        help="Limit migration to one resourceId. May be repeated.",
    )
    parser.add_argument(
        "--records-file",
        help=(
            "Read the database inventory from a JSON manifest instead of connecting "
            "to OpenGauss."
        ),
    )
    parser.add_argument(
        "--export-records",
        help="Write the database inventory to a JSON manifest.",
    )
    parser.add_argument(
        "--export-only",
        action="store_true",
        help="Export the database inventory and exit without inspecting storage.",
    )
    parser.add_argument(
        "--report-dir",
        default=os.getenv("MIGRATION_REPORT_DIR", "/tmp/byclaw-knowledge-migration"),
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Copy safe items. Without this flag the script only performs a dry-run.",
    )
    return parser.parse_args(argv)


def validate_args(args: argparse.Namespace) -> None:
    if args.records_file and args.export_only:
        raise ValueError("--records-file cannot be used with --export-only")
    if args.export_only and not args.export_records:
        raise ValueError("--export-only requires --export-records")

    required = []
    if not args.export_only:
        required.append(("--storage-root / FILE_STORAGE_LOCAL_PATH", args.storage_root))
    if not args.records_file:
        required.extend(
            (
                ("--db-host / MIGRATION_DB_HOST", args.db_host),
                ("--db-user / MIGRATION_DB_USER", args.db_user),
                ("MIGRATION_DB_PASS", os.getenv("MIGRATION_DB_PASS")),
            )
        )
    missing = [name for name, value in required if not value]
    if missing:
        raise ValueError("missing required configuration: " + ", ".join(missing))
    if not args.records_file and not SCHEMA_PATTERN.fullmatch(args.db_schema):
        raise ValueError(f"invalid database schema: {args.db_schema!r}")
    if args.records_file:
        records_file = Path(args.records_file)
        if not records_file.is_file():
            raise ValueError(f"records file does not exist: {records_file}")
    if args.export_records and not Path(args.export_records).is_absolute():
        raise ValueError("--export-records must be an absolute path")
    if args.export_only:
        return
    storage_root = Path(args.storage_root)
    if not storage_root.is_absolute():
        raise ValueError("--storage-root must be an absolute path")
    if not storage_root.is_dir():
        raise ValueError(f"storage root does not exist or is not a directory: {storage_root}")


def load_knowledge_files(args: argparse.Namespace) -> list[KnowledgeFile]:
    try:
        import psycopg
    except ImportError as exc:
        raise RuntimeError(
            "psycopg is required; run this script with the byclaw-qa Python environment"
        ) from exc

    schema = args.db_schema
    resource_filter = ""
    params: dict[str, Any] = {
        "resource_biz_type": "KG_DOC",
        "system_code": "BYAI",
        "worker_agent_type": "BYCLAW_QA",
        "entry_type": "FILE",
    }
    if args.resource_ids:
        resource_filter = "AND r.resource_id = ANY(%(resource_ids)s)"
        params["resource_ids"] = sorted(set(args.resource_ids))

    sql = f"""
        WITH latest_build AS (
            SELECT fs_entry_id, status,
                   ROW_NUMBER() OVER (
                       PARTITION BY fs_entry_id
                       ORDER BY created_at DESC, kid DESC
                   ) AS row_num
              FROM {schema}.knowledge_build_task
        )
        SELECT r.resource_id,
               r.resource_code,
               fe.kid,
               fe.virtual_path,
               fe.file_object_key,
               fe.markdown_object_key,
               fe.file_size,
               fe.checksum,
               fe.mime_type,
               fe.updated_at,
               lb.status
          FROM {schema}.ss_resource r
          JOIN {schema}.knowledge_base kb
            ON kb.kid::text = r.resource_code
           AND kb.is_deleted = false
          JOIN {schema}.knowledge_fs_entry fe
            ON fe.knowledge_base_id = kb.kid
           AND fe.entry_type = %(entry_type)s
           AND fe.is_deleted = false
          LEFT JOIN latest_build lb
            ON lb.fs_entry_id = fe.kid
           AND lb.row_num = 1
         WHERE r.resource_biz_type = %(resource_biz_type)s
           AND r.system_code = %(system_code)s
           AND r.worker_agent_type = %(worker_agent_type)s
           AND r.resource_code IS NOT NULL
           {resource_filter}
         ORDER BY r.resource_id, fe.kid
    """
    connection = psycopg.connect(
        host=args.db_host,
        port=args.db_port,
        dbname=args.db_name,
        user=args.db_user,
        password=os.environ["MIGRATION_DB_PASS"],
        options="-c default_transaction_read_only=on -c statement_timeout=60000",
    )
    try:
        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            rows = cursor.fetchall()
    finally:
        connection.close()

    return [
        KnowledgeFile(
            resource_id=int(row[0]),
            kn_code=str(row[1]),
            fs_entry_id=int(row[2]),
            virtual_path=str(row[3]),
            file_object_key=str(row[4]),
            markdown_object_key=str(row[5]) if row[5] else None,
            file_size=int(row[6]) if row[6] is not None else None,
            checksum=str(row[7]) if row[7] else None,
            mime_type=str(row[8]) if row[8] else None,
            updated_at=row[9].isoformat() if row[9] is not None else None,
            latest_build_status=str(row[10]) if row[10] else None,
        )
        for row in rows
    ]


def write_records_file(records: list[KnowledgeFile], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "formatVersion": 1,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "recordCount": len(records),
        "records": [asdict(record) for record in records],
    }
    temporary = path.with_name(f".{path.name}.tmp-{uuid.uuid4().hex}")
    try:
        with temporary.open("x", encoding="utf-8") as stream:
            json.dump(payload, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def load_records_file(
    path: Path,
    resource_ids: list[int] | None = None,
) -> list[KnowledgeFile]:
    with path.open(encoding="utf-8") as stream:
        payload = json.load(stream)
    if not isinstance(payload, dict) or payload.get("formatVersion") != 1:
        raise ValueError(f"unsupported records manifest format: {path}")
    raw_records = payload.get("records")
    if not isinstance(raw_records, list):
        raise ValueError(f"records manifest has no records list: {path}")
    records = [KnowledgeFile(**record) for record in raw_records]
    if payload.get("recordCount") != len(records):
        raise ValueError(f"records manifest count mismatch: {path}")
    selected_ids = set(resource_ids or [])
    if selected_ids:
        records = [record for record in records if record.resource_id in selected_ids]
    return records


def normalize_logical_key(logical_key: str, kn_code: str) -> str:
    normalized = "/" + str(logical_key or "").strip().replace("\\", "/").lstrip("/")
    parts = PurePosixPath(normalized).parts
    if ".." in parts:
        raise ValueError(f"logical key contains traversal: {logical_key}")
    expected_prefix = f"/.bykc/{kn_code}/raw/"
    if not normalized.startswith(expected_prefix):
        raise ValueError(
            f"logical key is outside expected knowledge root {expected_prefix}: {logical_key}"
        )
    return normalized


def safe_path(root: Path, *relative_parts: str) -> Path:
    resolved_root = root.resolve()
    candidate = resolved_root.joinpath(
        *(part.strip().replace("\\", "/").lstrip("/") for part in relative_parts)
    ).resolve()
    if candidate != resolved_root and resolved_root not in candidate.parents:
        raise ValueError(f"path escapes storage root: {candidate}")
    return candidate


def list_user_buckets(storage_root: Path) -> list[Path]:
    return sorted(
        path
        for path in storage_root.iterdir()
        if path.is_dir()
        and path.name.startswith("byclaw-")
        and path.name != TARGET_BUCKET
    )


def source_candidates(
    user_buckets: Iterable[Path], logical_key: str
) -> list[Path]:
    relative_key = logical_key.lstrip("/")
    candidates = []
    for bucket in user_buckets:
        candidate = safe_path(bucket, str(USER_FS_PREFIX).lstrip("/"), relative_key)
        if candidate.is_file():
            candidates.append(candidate)
    return candidates


def target_path(
    storage_root: Path, resource_id: int, logical_key: str
) -> Path:
    target_prefix = RESOURCE_PREFIX / f"KG_DOC_{resource_id}"
    return safe_path(
        storage_root,
        TARGET_BUCKET,
        str(target_prefix).lstrip("/"),
        logical_key.lstrip("/"),
    )


def sha256_file(path: Path, block_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(block_size):
            digest.update(chunk)
    return digest.hexdigest()


def file_fingerprint(path: Path) -> tuple[int, str]:
    return path.stat().st_size, sha256_file(path)


def choose_source(
    candidates: list[Path],
    *,
    expected_checksum: str | None,
) -> tuple[Path | None, dict[Path, tuple[int, str]], str | None]:
    fingerprints = {path: file_fingerprint(path) for path in candidates}
    if not candidates:
        return None, fingerprints, "source file not found in any UserFS bucket"
    if len(candidates) == 1:
        return candidates[0], fingerprints, None

    unique_hashes = {fingerprint[1] for fingerprint in fingerprints.values()}
    if len(unique_hashes) == 1:
        return sorted(candidates)[0], fingerprints, None

    normalized_checksum = (expected_checksum or "").strip().lower()
    if normalized_checksum:
        checksum_matches = [
            path
            for path, (_, digest) in fingerprints.items()
            if digest.lower() == normalized_checksum
        ]
        if len(checksum_matches) == 1:
            return checksum_matches[0], fingerprints, None

    return (
        None,
        fingerprints,
        "multiple UserFS sources have different content",
    )


def inspect_item(
    *,
    record: KnowledgeFile,
    object_type: str,
    logical_key: str,
    user_buckets: list[Path],
    storage_root: Path,
) -> MigrationItem:
    normalized_key = normalize_logical_key(logical_key, record.kn_code)
    candidates = source_candidates(user_buckets, normalized_key)
    expected_checksum = record.checksum if object_type == "ORIGIN" else None
    selected, fingerprints, source_error = choose_source(
        candidates,
        expected_checksum=expected_checksum,
    )
    target = target_path(storage_root, record.resource_id, normalized_key)
    target_size = None
    target_sha256 = None
    if target.is_file():
        target_size, target_sha256 = file_fingerprint(target)

    source_size = None
    source_sha256 = None
    if selected is not None:
        source_size, source_sha256 = fingerprints[selected]

    if source_error and target_sha256 is None:
        status = "SOURCE_AMBIGUOUS" if candidates else "SOURCE_MISSING"
        error = source_error
    elif target_sha256 is not None and selected is None:
        normalized_checksum = (record.checksum or "").strip().lower()
        if object_type == "ORIGIN" and normalized_checksum:
            if target_sha256.lower() == normalized_checksum:
                status = "TARGET_OK_DB_CHECKSUM"
                error = None
            else:
                status = "TARGET_CONFLICT"
                error = (
                    "target checksum differs from database checksum; "
                    f"{source_error}"
                )
        elif object_type == "ORIGIN" and record.file_size is not None:
            if target_size == record.file_size:
                status = "TARGET_PRESENT_SOURCE_MISSING"
                error = source_error
            else:
                status = "TARGET_CONFLICT"
                error = (
                    f"target size {target_size} differs from database size "
                    f"{record.file_size}; {source_error}"
                )
        else:
            status = "TARGET_PRESENT_SOURCE_MISSING"
            error = source_error
    elif target_sha256 is not None:
        if target_sha256 == source_sha256:
            status = "TARGET_OK"
            error = None
        else:
            status = "TARGET_CONFLICT"
            error = "target exists with different content"
    else:
        status = "NEED_COPY"
        error = None

    return MigrationItem(
        resource_id=record.resource_id,
        kn_code=record.kn_code,
        fs_entry_id=record.fs_entry_id,
        virtual_path=record.virtual_path,
        object_type=object_type,
        logical_key=normalized_key,
        source_paths=[str(path) for path in candidates],
        selected_source=str(selected) if selected else None,
        target_path=str(target),
        source_size=source_size,
        source_sha256=source_sha256,
        target_size=target_size,
        target_sha256=target_sha256,
        status=status,
        error=error,
    )


def ensure_shared_parent(target: Path, storage_root: Path) -> None:
    missing = []
    current = target.parent
    resolved_root = storage_root.resolve()
    while not current.exists() and current != resolved_root:
        missing.append(current)
        current = current.parent
    target.parent.mkdir(parents=True, exist_ok=True)
    for directory in reversed(missing):
        try:
            directory.chmod(0o777)
        except OSError:
            pass


def copy_exclusive_verified(item: MigrationItem, storage_root: Path) -> None:
    if item.status != "NEED_COPY" or not item.selected_source:
        return
    source = Path(item.selected_source)
    target = Path(item.target_path)
    ensure_shared_parent(target, storage_root)
    temporary = target.with_name(f".{target.name}.migrating-{uuid.uuid4().hex}")
    try:
        with source.open("rb") as source_stream, temporary.open("xb") as target_stream:
            shutil.copyfileobj(source_stream, target_stream, length=1024 * 1024)
            target_stream.flush()
            os.fsync(target_stream.fileno())
        if sha256_file(temporary) != item.source_sha256:
            raise IOError("temporary target checksum differs from source")
        try:
            os.link(temporary, target)
        except FileExistsError:
            target_size, target_digest = file_fingerprint(target)
            if target_digest != item.source_sha256:
                raise FileExistsError("target appeared with different content")
            item.target_size = target_size
            item.target_sha256 = target_digest
            item.status = "TARGET_OK"
            return
        try:
            target.chmod(
                stat.S_IRUSR
                | stat.S_IWUSR
                | stat.S_IRGRP
                | stat.S_IWGRP
                | stat.S_IROTH
                | stat.S_IWOTH
            )
        except OSError:
            pass
        target_size, target_digest = file_fingerprint(target)
        if target_digest != item.source_sha256:
            raise IOError("final target checksum differs from source")
        item.target_size = target_size
        item.target_sha256 = target_digest
        item.status = "VERIFIED"
        item.error = None
    except Exception as exc:
        item.status = "FAILED"
        item.error = str(exc)
    finally:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass


def build_items(
    records: list[KnowledgeFile],
    *,
    storage_root: Path,
    user_buckets: list[Path],
) -> list[MigrationItem]:
    items: list[MigrationItem] = []
    for record in records:
        items.append(
            inspect_item(
                record=record,
                object_type="ORIGIN",
                logical_key=record.file_object_key,
                user_buckets=user_buckets,
                storage_root=storage_root,
            )
        )
        if record.markdown_object_key:
            items.append(
                inspect_item(
                    record=record,
                    object_type="MARKDOWN",
                    logical_key=record.markdown_object_key,
                    user_buckets=user_buckets,
                    storage_root=storage_root,
                )
            )
    return items


def write_reports(
    *,
    report_dir: Path,
    run_id: str,
    args: argparse.Namespace,
    records: list[KnowledgeFile],
    user_buckets: list[Path],
    items: list[MigrationItem],
) -> tuple[Path, Path]:
    report_dir.mkdir(parents=True, exist_ok=True)
    csv_path = report_dir / f"knowledge-migration-{run_id}.csv"
    summary_path = report_dir / f"knowledge-migration-{run_id}.summary.json"
    rows = [item.report_row() for item in items]
    with csv_path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]) if rows else [])
        if rows:
            writer.writeheader()
            writer.writerows(rows)

    counts = Counter(item.status for item in items)
    summary = {
        "runId": run_id,
        "mode": "execute" if args.execute else "dry-run",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "storageRoot": str(Path(args.storage_root)),
        "resourceIds": sorted(set(args.resource_ids or [])),
        "knowledgeFileCount": len(records),
        "objectCount": len(items),
        "userBucketCount": len(user_buckets),
        "statusCounts": dict(sorted(counts.items())),
        "copiedBytes": sum(
            item.target_size or 0 for item in items if item.status == "VERIFIED"
        ),
        "sourceFilesDeleted": 0,
        "databaseRowsChanged": 0,
        "csvReport": str(csv_path),
    }
    with summary_path.open("w", encoding="utf-8") as stream:
        json.dump(summary, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    return csv_path, summary_path


def blocking_count(items: list[MigrationItem]) -> int:
    safe = {"TARGET_OK", "TARGET_OK_DB_CHECKSUM", "VERIFIED"}
    return sum(item.status not in safe for item in items)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        validate_args(args)
        if args.records_file:
            records = load_records_file(Path(args.records_file), args.resource_ids)
        else:
            records = load_knowledge_files(args)
        if args.export_records:
            export_path = Path(args.export_records)
            write_records_file(records, export_path)
            if args.export_only:
                print(
                    json.dumps(
                        {
                            "mode": "export-only",
                            "knowledgeFileCount": len(records),
                            "recordsFile": str(export_path),
                        },
                        ensure_ascii=False,
                        indent=2,
                    )
                )
                return 0
        storage_root = Path(args.storage_root).resolve()
        user_buckets = list_user_buckets(storage_root)
        items = build_items(
            records,
            storage_root=storage_root,
            user_buckets=user_buckets,
        )
        if args.execute:
            for item in items:
                copy_exclusive_verified(item, storage_root)
        run_id = time.strftime("%Y%m%dT%H%M%S") + f"-{os.getpid()}"
        csv_path, summary_path = write_reports(
            report_dir=Path(args.report_dir),
            run_id=run_id,
            args=args,
            records=records,
            user_buckets=user_buckets,
            items=items,
        )
        counts = Counter(item.status for item in items)
        print(
            json.dumps(
                {
                    "mode": "execute" if args.execute else "dry-run",
                    "knowledgeFileCount": len(records),
                    "objectCount": len(items),
                    "userBucketCount": len(user_buckets),
                    "statusCounts": dict(sorted(counts.items())),
                    "csvReport": str(csv_path),
                    "summaryReport": str(summary_path),
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0 if blocking_count(items) == 0 else 2
    except Exception as exc:
        print(f"migration failed before completion: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
