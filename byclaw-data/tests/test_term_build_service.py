from __future__ import annotations

from importlib import import_module
from pathlib import Path
import sys
import time

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

executor_module = import_module("byclaw_data.term_build_service.executor")
routes_module = import_module("byclaw_data.term_build_service.routes")
settings_module = import_module("byclaw_data.term_build_service.settings")
models_module = import_module("byclaw_data.term_build_service.models")
repository_module = import_module("byclaw_data.term_build_service.repository")
resolve_minio_uri_to_local_path = executor_module.resolve_minio_uri_to_local_path
create_app = routes_module.create_app
TermBuildSettings = settings_module.TermBuildSettings
TermJobAction = models_module.TermJobAction
TermJobRepository = repository_module.TermJobRepository
JobConflictError = repository_module.JobConflictError
StaleJobClaimError = repository_module.StaleJobClaimError
TermJobStage = models_module.TermJobStage


def test_term_job_api_create_conflict_cancel_and_events(tmp_path: Path) -> None:
    client = TestClient(create_app(_settings(tmp_path, worker_enabled=False)))

    created = client.post(
        "/term-jobs",
        json={"action": "build", "minio_uri": "file:///tmp/example-package"},
    )
    assert created.status_code == 200
    assert created.json()["status"] == "pending"

    conflict = client.post(
        "/term-jobs",
        json={"action": "delete", "minio_uri": "file:///tmp/example-package"},
    )
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["job_id"] == created.json()["job_id"]

    job_id = created.json()["job_id"]
    fetched = client.get(f"/term-jobs/{job_id}")
    assert fetched.status_code == 200
    assert fetched.json()["status"] == "pending"

    events = client.get(f"/term-jobs/{job_id}/events")
    assert events.status_code == 200
    assert events.json()[0]["message"] == "job created"

    cancelled = client.post(f"/term-jobs/{job_id}/cancel")
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"


def test_resolve_s3_uri_to_local_mirror(tmp_path: Path) -> None:
    package_dir = tmp_path / "bucket" / "path" / "to" / "package"
    package_dir.mkdir(parents=True)

    resolved = resolve_minio_uri_to_local_path(
        "s3://bucket/path/to/package/",
        _settings(tmp_path, minio_mount_path=tmp_path),
    )

    assert resolved == package_dir


def test_stale_running_job_is_requeued_and_reclaimed(tmp_path: Path) -> None:
    settings = _settings(tmp_path, worker_enabled=False)
    repository = TermJobRepository(settings.database_path)
    job = repository.create_job(TermJobAction.BUILD, "file:///tmp/stale-package")
    claimed = repository.claim_next_job("dead-worker", lock_ttl_seconds=60)
    assert claimed["id"] == job["id"]
    assert claimed["status"] == "running"

    requeued = repository.requeue_stale_running_jobs(lock_ttl_seconds=0)
    assert requeued == 1

    reclaimed = repository.claim_next_job("live-worker", lock_ttl_seconds=60)
    assert reclaimed["id"] == job["id"]
    assert reclaimed["status"] == "running"
    assert reclaimed["locked_by"] == "live-worker"
    messages = [event["message"] for event in repository.list_events(job["id"])]
    assert "stale running job requeued" in messages


def test_create_job_still_conflicts_with_requeued_stale_job(tmp_path: Path) -> None:
    repository = TermJobRepository(tmp_path / "jobs.sqlite3")
    first = repository.create_job(TermJobAction.BUILD, "file:///tmp/released-package")
    repository.claim_next_job("dead-worker", lock_ttl_seconds=60)
    time.sleep(0.01)

    try:
        repository.create_job(
            TermJobAction.DELETE,
            "file:///tmp/released-package",
            lock_ttl_seconds=0,
        )
    except JobConflictError as exc:
        conflict_job_id = exc.job_id
    else:
        raise AssertionError("expected requeued stale job to keep the resource conflict")

    assert conflict_job_id == first["id"]
    requeued = repository.get_job(first["id"])
    assert requeued["status"] == "pending"


def test_old_worker_cannot_update_after_stale_reclaim(tmp_path: Path) -> None:
    repository = TermJobRepository(tmp_path / "jobs.sqlite3")
    job = repository.create_job(TermJobAction.BUILD, "file:///tmp/fenced-package")
    old_claim = repository.claim_next_job("old-worker", lock_ttl_seconds=60)

    repository.requeue_stale_running_jobs(lock_ttl_seconds=0)
    new_claim = repository.claim_next_job("new-worker", lock_ttl_seconds=60)

    try:
        repository.heartbeat(
            job["id"],
            TermJobStage.BUILDING,
            "old-worker",
            old_claim["attempts"],
        )
    except StaleJobClaimError:
        pass
    else:
        raise AssertionError("expected old worker heartbeat to be fenced")

    try:
        repository.complete_job(
            job["id"],
            {"status": "success"},
            worker_id="old-worker",
            attempts=old_claim["attempts"],
        )
    except StaleJobClaimError:
        pass
    else:
        raise AssertionError("expected old worker completion to be fenced")

    current = repository.get_job(job["id"])
    assert current["status"] == "running"
    assert current["locked_by"] == "new-worker"
    assert current["attempts"] == new_claim["attempts"]


def _settings(
    tmp_path: Path,
    *,
    minio_mount_path: Path | None = None,
    worker_enabled: bool = False,
) -> TermBuildSettings:
    return TermBuildSettings(
        host="127.0.0.1",
        port=18082,
        log_level="warning",
        database_path=tmp_path / "jobs.sqlite3",
        minio_mount_path=minio_mount_path,
        minio_bucket_name="byclaw",
        worker_enabled=worker_enabled,
        worker_id="test-worker",
        worker_poll_interval_seconds=0.1,
        job_lock_ttl_seconds=300,
        knowledge_schema=None,
        knowledge_db_url=None,
        delete_command=None,
    )
