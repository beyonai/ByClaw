#!/usr/bin/env python3
from __future__ import annotations

import os
from pathlib import Path
import pwd
import tempfile


def run_as(account: pwd.struct_passwd, groups: list[int], action) -> int:
    child = os.fork()
    if child == 0:
        try:
            os.setgroups(groups)
            os.setgid(account.pw_gid)
            os.setuid(account.pw_uid)
            action()
        except BaseException:
            os._exit(1)
        os._exit(0)
    _, status = os.waitpid(child, 0)
    return os.waitstatus_to_exitcode(status)


def main() -> None:
    if os.geteuid() != 0:
        raise AssertionError("runtime-user permission verification requires root")
    byclaw = pwd.getpwnam("byclaw")

    with tempfile.TemporaryDirectory(prefix="byclaw-artifact-mode-", dir="/tmp") as raw:
        parent = Path(raw)
        parent.chmod(0o755)
        delivery = parent / "browser-runtime"
        delivery.mkdir(mode=0o700)
        os.chown(delivery, byclaw.pw_uid, byclaw.pw_gid)
        for artifact_kind in ("downloads", "screenshots"):
            artifact = delivery / artifact_kind / "artifact.bin"

            def write_artifact() -> None:
                artifact.parent.mkdir(mode=0o700)
                artifact.write_bytes(b"browser-artifact")
                artifact.chmod(0o600)

            assert run_as(byclaw, [], write_artifact) == 0
            assert artifact.parent.stat().st_mode & 0o777 == 0o700
            assert artifact.stat().st_mode & 0o777 == 0o600
            assert artifact.stat().st_uid == byclaw.pw_uid
            assert artifact.stat().st_gid == byclaw.pw_gid

            def read_artifact() -> None:
                assert artifact.read_bytes() == b"browser-artifact"

            assert run_as(byclaw, [], read_artifact) == 0

    print("browser artifacts runtime-user permission verification passed")


if __name__ == "__main__":
    main()
