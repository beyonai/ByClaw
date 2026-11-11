"""Adapt the Harbor OpenGauss entrypoint for isolated tenant databases.

The image creates a gaussdb role with the same password as the initialized
omm role. OpenGauss rejects password reuse during initialization. The upstream
SQL helper also prints the password.
"""

import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path


ACTIVE_DIRECTORY = "byclaw-cluster"
STAGING_PREFIX = ".byclaw-init-"


def patch_entrypoint(original):
    log_line = 'echo "Execute SQL: ${query_runner[@]} $@"'
    default_user_sql = '''                        create user gaussdb with login password :"passwd" ;
                        grant all privileges to gaussdb;'''
    tenant_grant_sql = '                        grant all privileges to :"user" ;'
    if any(original.count(anchor) != 1 for anchor in (log_line, default_user_sql, tenant_grant_sql)):
        raise SystemExit("Unsupported OpenGauss entrypoint version")

    patched = original.replace(log_line, 'echo "Execute SQL: [redacted]"')
    patched = patched.replace(default_user_sql, '                        -- Tenant role is created by docker_setup_user.')
    return patched.replace(tenant_grant_sql, '''                        grant all privileges on database :"db" to :"user" ;
EOSQL
                GS_DB= docker_process_sql --dbname "$GS_DB" --set user="$GS_USERNAME" <<-'EOSQL'
                        GRANT USAGE, CREATE ON SCHEMA public TO :"user" ;''')


def run_local_initializer(patched, args, env, *, script):
    temp_start = '-w start $@'
    temp_call = '                        docker_temp_server_start "$@"\n'
    init_end = '                        unset PGPASSWORD\n'
    if any(patched.count(anchor) != 1 for anchor in (temp_start, temp_call, init_end)):
        raise SystemExit("Unsupported OpenGauss cold initialization entrypoint")
    # Keep the scratch database off the TCP readiness port. The original
    # configuration is used unchanged when the persistent server starts.
    port = 25433 if env.get("GS_PORT") == "25432" else 25432
    scratch = patched.replace(temp_start, '-w start -o "-p $GS_PORT -c listen_addresses=127.0.0.1" $@')
    scratch = scratch.replace(temp_call, f'                        export GS_PORT={port} PGPORT={port}\n' + temp_call)
    scratch = scratch.replace(init_end, init_end + '                        exit 0\n')
    script.write_text(scratch)
    subprocess.run(["/bin/bash", str(script), *args], env=env, check=True)


def sync_path(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def copy_synced_file(source, destination):
    shutil.copy2(source, destination, follow_symlinks=False)
    sync_path(destination)


def prepare_database(volume, patched, args, env, *, stage=True):
    active = volume / ACTIVE_DIRECTORY
    if active.is_symlink():
        raise RuntimeError("Invalid tenant database directory")
    if active.exists():
        if (volume / "PG_VERSION").exists() or not (active / "PG_VERSION").is_file():
            raise RuntimeError("Ambiguous or incomplete tenant database directory")
        return active
    if not stage or any(
        not (entry.name.startswith(STAGING_PREFIX) and entry.is_dir() and not entry.is_symlink())
        for entry in volume.iterdir()
    ):
        return volume

    with tempfile.TemporaryDirectory(prefix="byclaw-opengauss-", dir="/var/tmp") as local:
        work = Path(local)
        source = work / "data"
        started = time.monotonic()
        run_local_initializer(patched, args, {**env, "PGDATA": str(source)}, script=work / "init.sh")
        if not (source / "PG_VERSION").is_file() or (source / "postmaster.pid").exists():
            raise RuntimeError("Tenant database was not cleanly initialized")
        if any(path.is_symlink() for path in source.rglob("*")):
            raise RuntimeError("Unexpected symlink in newly initialized tenant database")
        print(f"tenant OpenGauss local initialization took {time.monotonic() - started:.2f}s", flush=True)

        started = time.monotonic()
        with tempfile.TemporaryDirectory(prefix=STAGING_PREFIX, dir=volume) as pending:
            copied = Path(pending) / "data"
            shutil.copytree(source, copied, copy_function=copy_synced_file)
            for directory, _, _ in os.walk(copied, topdown=False):
                sync_path(directory)
            # A partial copy is never a startup candidate. A concurrent
            # publish cannot replace an existing nonempty cluster directory.
            copied.rename(active)
            sync_path(volume)
        print(f"tenant OpenGauss persistent publish took {time.monotonic() - started:.2f}s", flush=True)
    return active


def stage_cold_start(volume, args):
    if (not args or args[0] != "gaussdb" or len(args) != 1 or os.geteuid() == 0
            or os.environ.get("SERVER_MODE") or os.environ.get("POSTGRES_INITDB_XLOGDIR")):
        return False
    mode = os.environ.get("BYCLAW_OPENGAUSS_LOCAL_INIT", "auto")
    if mode in ("0", "1"):
        return mode == "1"
    filesystem = subprocess.run(["stat", "-f", "-c", "%T", str(volume)], capture_output=True, text=True)
    return filesystem.returncode == 0 and filesystem.stdout.strip() in ("nfs", "nfs4")


def main():
    patched = patch_entrypoint(Path("/usr/local/bin/entrypoint.sh").read_text())
    args = sys.argv[1:]
    env = os.environ.copy()
    volume = Path(env.get("PGDATA", "/var/lib/opengauss/data")).resolve()
    if volume.is_dir():
        env["PGDATA"] = str(prepare_database(volume, patched, args, env, stage=stage_cold_start(volume, args)))
    target = Path("/tmp/byclaw-tenant-entrypoint.sh")
    target.write_text(patched)
    target.chmod(0o755)
    os.execve("/bin/bash", ["/bin/bash", str(target), *args], env)


if __name__ == "__main__":
    main()
