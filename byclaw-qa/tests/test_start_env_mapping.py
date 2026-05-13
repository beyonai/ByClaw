from __future__ import annotations

import os
import shutil
import stat
import subprocess
import textwrap
from pathlib import Path


def _write_fake_uv(fake_bin: Path, exec_log: Path, env_log: Path) -> None:
    uv_path = fake_bin / "uv"
    uv_path.write_text(
        textwrap.dedent(
            f"""\
            #!/usr/bin/env bash
            printf '%s\\n' "$*" > {exec_log}
            printf 'MINIO_ENDPOINT=%s\\n' "${{MINIO_ENDPOINT-}}" > {env_log}
            printf 'MINIO_ACCESS_KEY=%s\\n' "${{MINIO_ACCESS_KEY-}}" >> {env_log}
            printf 'MINIO_SECRET_KEY=%s\\n' "${{MINIO_SECRET_KEY-}}" >> {env_log}
            printf 'MINIO_SECURE=%s\\n' "${{MINIO_SECURE-}}" >> {env_log}
            exit 0
            """
        )
    )
    uv_path.chmod(uv_path.stat().st_mode | stat.S_IXUSR)


def _complete_source_env() -> dict[str, str]:
    return {
        "QA_DOMAINNAME": "byclaw-qa-manager",
        "HOST": "localhost",
        "DB_USER": "postgres",
        "DB_PASS": "postgres",
        "REDIS_HOST": "localhost",
        "REDIS_PORT": "6379",
        "REDIS_DATABASE": "0",
        "FILE_STORAGE_MINIO_HOST": "10.10.168.204",
        "FILE_STORAGE_MINIO_API_PORT": "9009",
        "FILE_STORAGE_MINIO_UI_PORT": "9019",
        "FILE_STORAGE_MINIO_ACCESS_KEY": "minioadmin",
        "FILE_STORAGE_MINIO_SECRET_KEY": "minioadmin",
        "FILE_STORAGE_MINIO_SECURE": "false",
        "BYCLAW_QA_PORT": "8000",
        "BYCLAW_QA_AGENT_DATA_PATH": "agent_data",
        "BYCLAW_QA_KB_FETCH_CACHE_TTL_SECONDS": "86400",
        "BYCLAW_QA_KB_FETCH_CACHE_CLEANUP_INTERVAL_SECONDS": "600",
        "BYCLAW_QA_KB_MINIO_BUCKET": "knowledge-base",
        "BYCLAW_QA_KB_MINIO_MARKDOWN_BUCKET": "knowledge-base-markdown",
        "BYCLAW_QA_BYAI_WORKER_ID": "instant-search-worker-1",
    }


def _write_env(path: Path, values: dict[str, str]) -> None:
    path.write_text("\n".join(f"{key}={value}" for key, value in values.items()) + "\n")


def test_start_maps_file_storage_minio_source_env(tmp_path: Path) -> None:
    qa_dir = tmp_path / "byclaw-qa"
    qa_dir.mkdir()
    shutil.copy2(Path(__file__).resolve().parents[1] / "start.sh", qa_dir / "start.sh")
    _write_env(qa_dir / ".env", _complete_source_env())

    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    exec_log = tmp_path / "exec.log"
    env_log = tmp_path / "env.log"
    _write_fake_uv(fake_bin, exec_log, env_log)

    result = subprocess.run(
        ["bash", str(qa_dir / "start.sh"), "api"],
        cwd=qa_dir,
        env={"PATH": f"{fake_bin}{os.pathsep}{os.environ.get('PATH', '')}"},
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert exec_log.read_text().strip() == "run uvicorn api:app --host 0.0.0.0 --port 8000"
    assert env_log.read_text().splitlines() == [
        "MINIO_ENDPOINT=10.10.168.204:9009",
        "MINIO_ACCESS_KEY=minioadmin",
        "MINIO_SECRET_KEY=minioadmin",
        "MINIO_SECURE=false",
    ]
