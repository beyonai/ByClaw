from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


SCRIPT_PATH = (
    Path(__file__).parents[2]
    / "scripts"
    / "migrate_knowledge_userfs_to_resourcefs.py"
)
SPEC = importlib.util.spec_from_file_location("knowledge_migration", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
migration = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = migration
SPEC.loader.exec_module(migration)


def knowledge_file(*, checksum: str | None = None):
    return migration.KnowledgeFile(
        resource_id=11029731,
        kn_code="155",
        fs_entry_id=1,
        virtual_path="/门户设计/api.md",
        file_object_key="/.bykc/155/raw/origin/门户设计/api.md",
        markdown_object_key="/.bykc/155/raw/markdown/门户设计/api.md.md",
        file_size=5,
        checksum=checksum,
        mime_type="text/markdown",
        updated_at=None,
        latest_build_status="complete",
    )


def write_source(root: Path, user_code: str, logical_key: str, content: bytes) -> Path:
    path = root / f"byclaw-{user_code}" / "by" / logical_key.lstrip("/")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return path


def test_build_items_and_copy_origin_and_markdown(tmp_path):
    record = knowledge_file()
    write_source(tmp_path, "user-a", record.file_object_key, b"hello")
    write_source(tmp_path, "user-a", record.markdown_object_key, b"# hello")

    items = migration.build_items(
        [record],
        storage_root=tmp_path,
        user_buckets=migration.list_user_buckets(tmp_path),
    )

    assert [item.status for item in items] == ["NEED_COPY", "NEED_COPY"]
    for item in items:
        migration.copy_exclusive_verified(item, tmp_path)
    assert [item.status for item in items] == ["VERIFIED", "VERIFIED"]
    assert (
        tmp_path
        / "byclaw-qa"
        / "resource/kg_doc/KG_DOC_11029731/.bykc/155/raw/origin/门户设计/api.md"
    ).read_bytes() == b"hello"
    assert (
        tmp_path
        / "byclaw-qa"
        / "resource/kg_doc/KG_DOC_11029731/.bykc/155/raw/markdown/门户设计/api.md.md"
    ).read_bytes() == b"# hello"


def test_existing_different_target_is_never_overwritten(tmp_path):
    record = knowledge_file()
    write_source(tmp_path, "user-a", record.file_object_key, b"hello")
    target = migration.target_path(
        tmp_path,
        record.resource_id,
        record.file_object_key,
    )
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"other")

    item = migration.inspect_item(
        record=record,
        object_type="ORIGIN",
        logical_key=record.file_object_key,
        user_buckets=migration.list_user_buckets(tmp_path),
        storage_root=tmp_path,
    )
    migration.copy_exclusive_verified(item, tmp_path)

    assert item.status == "TARGET_CONFLICT"
    assert target.read_bytes() == b"other"


def test_multiple_different_sources_are_ambiguous(tmp_path):
    record = knowledge_file()
    write_source(tmp_path, "user-a", record.file_object_key, b"first")
    write_source(tmp_path, "user-b", record.file_object_key, b"second")

    item = migration.inspect_item(
        record=record,
        object_type="ORIGIN",
        logical_key=record.file_object_key,
        user_buckets=migration.list_user_buckets(tmp_path),
        storage_root=tmp_path,
    )

    assert item.status == "SOURCE_AMBIGUOUS"
    assert item.selected_source is None


def test_database_checksum_resolves_multiple_sources(tmp_path):
    content = b"correct"
    checksum = migration.hashlib.sha256(content).hexdigest()
    record = knowledge_file(checksum=checksum)
    expected_source = write_source(
        tmp_path, "user-a", record.file_object_key, content
    )
    write_source(tmp_path, "user-b", record.file_object_key, b"wrong")

    item = migration.inspect_item(
        record=record,
        object_type="ORIGIN",
        logical_key=record.file_object_key,
        user_buckets=migration.list_user_buckets(tmp_path),
        storage_root=tmp_path,
    )

    assert item.status == "NEED_COPY"
    assert item.selected_source == str(expected_source)


def test_records_manifest_round_trip_and_resource_filter(tmp_path):
    first = knowledge_file()
    second = migration.KnowledgeFile(
        **{**migration.asdict(first), "resource_id": 11029732}
    )
    manifest = tmp_path / "records.json"

    migration.write_records_file([first, second], manifest)
    records = migration.load_records_file(manifest, [11029731])

    assert records == [first]


def test_existing_target_without_source_must_match_database_checksum(tmp_path):
    content = b"expected"
    checksum = migration.hashlib.sha256(content).hexdigest()
    record = knowledge_file(checksum=checksum)
    target = migration.target_path(
        tmp_path,
        record.resource_id,
        record.file_object_key,
    )
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)

    matching = migration.inspect_item(
        record=record,
        object_type="ORIGIN",
        logical_key=record.file_object_key,
        user_buckets=migration.list_user_buckets(tmp_path),
        storage_root=tmp_path,
    )
    target.write_bytes(b"different")
    conflicting = migration.inspect_item(
        record=record,
        object_type="ORIGIN",
        logical_key=record.file_object_key,
        user_buckets=migration.list_user_buckets(tmp_path),
        storage_root=tmp_path,
    )

    assert matching.status == "TARGET_OK_DB_CHECKSUM"
    assert conflicting.status == "TARGET_CONFLICT"
