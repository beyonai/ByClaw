#!/usr/bin/env python3
from __future__ import annotations

import argparse
import ctypes
import fcntl
import os
from pathlib import Path
import pwd
import secrets
import signal
import subprocess
import sys
import time
from typing import Sequence


DEFAULT_BROWSERD_ENTRY = (
    "/opt/byclaw/dsh-managed/profiles/web/node_modules/"
    "@byclaw/dsh-browser-use/lib/browserd.js"
)
PR_SET_CHILD_SUBREAPER = 36


def enable_child_subreaper() -> None:
    if not sys.platform.startswith("linux"):
        return
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) != 0:
        error_number = ctypes.get_errno()
        raise RuntimeError(
            f"browser-supervisor-subreaper-failed:{os.strerror(error_number)}"
        )


def adopted_child_pids() -> list[int]:
    if not sys.platform.startswith("linux"):
        return []
    children_path = Path(f"/proc/{os.getpid()}/task/{os.getpid()}/children")
    try:
        return [int(value) for value in children_path.read_text().split()]
    except FileNotFoundError:
        return []


def reap_adopted_children(excluded_pids: set[int] | None = None) -> None:
    excluded = excluded_pids or set()
    for pid in adopted_child_pids():
        if pid in excluded:
            continue
        try:
            os.waitpid(pid, os.WNOHANG)
        except ChildProcessError:
            pass


def terminate_adopted_descendants(grace_seconds: float = 3.0) -> None:
    if not sys.platform.startswith("linux"):
        return

    deadline = time.monotonic() + grace_seconds
    sent_term: set[int] = set()
    while time.monotonic() < deadline:
        reap_adopted_children()
        children = adopted_child_pids()
        if not children:
            return
        for pid in children:
            if pid in sent_term:
                continue
            try:
                os.kill(pid, signal.SIGTERM)
                sent_term.add(pid)
            except ProcessLookupError:
                pass
        time.sleep(0.02)

    kill_deadline = time.monotonic() + 1.0
    while time.monotonic() < kill_deadline:
        reap_adopted_children()
        children = adopted_child_pids()
        if not children:
            return
        # Killing an adopted parent can reparent another generation to us.
        # Rediscover on every pass instead of relying on one PID snapshot.
        for pid in children:
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        time.sleep(0.02)
    reap_adopted_children()


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Supervise the private ByClaw browser runtime"
    )
    parser.add_argument("--browser-user", default="byclaw")
    parser.add_argument("--dsh-user", default="byclaw")
    parser.add_argument("--socket-path", default="/run/byclaw-browser/browserd.sock")
    parser.add_argument("--readiness-timeout", type=float, default=15.0)
    parser.add_argument("--browserd-command", default="")
    parser.add_argument("--bycli-daemon-command", default="")
    parser.add_argument("--bycli-status-command", default="")
    parser.add_argument("--bycli-health-interval", type=float, default=30.0)
    parser.add_argument("--bycli-command-timeout", type=float, default=3.0)
    parser.add_argument("--prepare-command", default="")
    parser.add_argument("command", nargs=argparse.REMAINDER)
    options = parser.parse_args(argv)
    if options.command[:1] == ["--"]:
        options.command = options.command[1:]
    if not options.command:
        parser.error("a DSH command is required after --")
    if options.readiness_timeout <= 0:
        parser.error("readiness timeout must be positive")
    if options.bycli_health_interval <= 0:
        parser.error("byCLI health interval must be positive")
    if options.bycli_command_timeout <= 0:
        parser.error("byCLI command timeout must be positive")
    return options


def identity(name: str) -> pwd.struct_passwd:
    try:
        return pwd.getpwnam(name)
    except KeyError as error:
        raise RuntimeError(f"browser-supervisor-user-not-found:{name}") from error


def drop_privileges(account: pwd.struct_passwd):
    if os.geteuid() != 0:
        if os.geteuid() != account.pw_uid or os.getegid() != account.pw_gid:
            raise RuntimeError("browser-supervisor-requires-root")
        return None

    def drop() -> None:
        os.initgroups(account.pw_name, account.pw_gid)
        os.setgid(account.pw_gid)
        os.setuid(account.pw_uid)

    return drop


def secret_pipe(secret: bytes) -> int:
    read_fd, write_fd = os.pipe()
    try:
        view = memoryview(secret)
        while view:
            written = os.write(write_fd, view)
            view = view[written:]
    finally:
        os.close(write_fd)
    return read_fd


def spawn(
    command: Sequence[str],
    environment: dict[str, str],
    account: pwd.struct_passwd,
    pass_fd: int | None = None,
) -> subprocess.Popen[bytes]:
    child_environment = dict(environment)
    child_environment["HOME"] = account.pw_dir
    child_environment["USER"] = account.pw_name
    child_environment["LOGNAME"] = account.pw_name
    kwargs: dict[str, object] = {
        "env": child_environment,
        "close_fds": True,
        "start_new_session": True,
        "preexec_fn": drop_privileges(account),
    }
    if pass_fd is not None:
        kwargs["pass_fds"] = (pass_fd,)
    return subprocess.Popen(list(command), **kwargs)  # type: ignore[arg-type]


def acquire_browser_profile_lock(
    path: Path,
    environment: dict[str, str],
    account: pwd.struct_passwd,
) -> int:
    prepared = spawn(["mkdir", "-p", "--", str(path)], environment, account)
    try:
        code = prepared.wait(timeout=5)
    except subprocess.TimeoutExpired as error:
        terminate(prepared, grace_seconds=0.2)
        raise RuntimeError("browser-supervisor-profile-directory-timeout") from error
    if code != 0:
        raise RuntimeError("browser-supervisor-profile-directory-failed")
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as error:
        os.close(descriptor)
        raise RuntimeError("browser-supervisor-profile-in-use") from error
    return descriptor


def terminate(process: subprocess.Popen[bytes], grace_seconds: float = 3.0) -> None:
    if process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    except PermissionError:
        try:
            process.send_signal(signal.SIGTERM)
        except ProcessLookupError:
            return
    try:
        process.wait(timeout=grace_seconds)
        return
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    except PermissionError:
        try:
            process.kill()
        except ProcessLookupError:
            pass
    process.wait()


def normalized_returncode(returncode: int | None) -> int:
    if returncode is None:
        return 1
    if returncode < 0:
        return 128 + abs(returncode)
    return returncode


def main(argv: Sequence[str] | None = None) -> int:
    enable_child_subreaper()
    options = parse_args(sys.argv[1:] if argv is None else argv)
    browser_account = identity(options.browser_user)
    dsh_account = identity(options.dsh_user)
    socket_path = Path(options.socket_path)
    viewer = os.environ.get("BYCLAW_BROWSER_VIEWER", "none")

    base_environment = dict(os.environ)
    base_environment.pop("BYCLAW_BROWSER_SECRET", None)
    base_environment.pop("BYCLAW_BROWSER_SECRET_FD", None)
    base_environment["BYCLAW_BROWSER_SOCKET"] = str(socket_path)
    base_environment["BYCLAW_BROWSER_IDLE_MS"] = base_environment.get(
        "BYCLAW_BROWSER_IDLE_MS", "30000"
    )
    base_environment["BYCLAW_BROWSER_DOWNLOAD_ROOT"] = base_environment.get(
        "BYCLAW_BROWSER_DOWNLOAD_ROOT", str(socket_path.parent / "downloads")
    )
    base_environment["BYCLAW_BROWSER_SCREENSHOT_ROOT"] = base_environment.get(
        "BYCLAW_BROWSER_SCREENSHOT_ROOT", str(socket_path.parent / "screenshots")
    )
    browser_generation_path = Path(
        base_environment.get(
            "BYCLAW_BROWSER_GENERATION_FILE",
            str(socket_path.parent / "browser-generation.json"),
        )
    )
    base_environment["BYCLAW_BROWSER_GENERATION_FILE"] = str(
        browser_generation_path
    )
    activation_path = Path(str(socket_path) + ".activate")
    base_environment["BYCLAW_BROWSER_ACTIVATION_SOCKET"] = str(activation_path)
    base_environment["BYCLAW_BROWSER_READY_TIMEOUT_MS"] = str(int(options.readiness_timeout * 1000))
    base_environment["BYCLAW_BYCLI_COMMAND_TIMEOUT_MS"] = str(int(options.bycli_command_timeout * 1000))
    base_environment["BYCLAW_BYCLI_HEALTH_INTERVAL_MS"] = str(int(options.bycli_health_interval * 1000))
    if options.bycli_daemon_command:
        base_environment["BYCLAW_BYCLI_DAEMON_COMMAND"] = options.bycli_daemon_command
    if options.bycli_status_command:
        base_environment["BYCLAW_BYCLI_STATUS_COMMAND"] = options.bycli_status_command
    socket_path.unlink(missing_ok=True)
    activation_path.unlink(missing_ok=True)
    browser_generation_path.unlink(missing_ok=True)

    secret = bytearray()
    children: list[subprocess.Popen[bytes]] = []
    browserd: subprocess.Popen[bytes] | None = None
    dsh: subprocess.Popen[bytes] | None = None
    browser_profile_lock_fd: int | None = None
    received_signal = 0

    def forward(signum: int, _frame: object) -> None:
        nonlocal received_signal
        received_signal = signum
        for child in list(children):
            if child.poll() is not None:
                continue
            try:
                os.killpg(child.pid, signum)
            except ProcessLookupError:
                pass
            except PermissionError:
                try:
                    child.send_signal(signum)
                except ProcessLookupError:
                    pass

    previous = {
        signum: signal.signal(signum, forward)
        for signum in (signal.SIGINT, signal.SIGTERM)
    }
    try:
        if options.prepare_command:
            prepare_environment = dict(base_environment)
            prepare_environment["BYCLAW_DSH_PREPARE_ONLY"] = "1"
            prepared = spawn(
                [options.prepare_command], prepare_environment, dsh_account
            )
            children.append(prepared)
            prepare_code = prepared.wait()
            children.remove(prepared)
            if received_signal:
                return 128 + received_signal
            if prepare_code != 0:
                return normalized_returncode(prepare_code)

        secret.extend(secrets.token_urlsafe(32).encode("ascii"))
        dsh_environment = dict(base_environment)
        dsh_environment["BYCLAW_BROWSER_OWNS_RUNTIME"] = "false"
        dsh_environment["BYCLAW_DSH_PREPARED"] = "1"
        dsh_environment.pop("DISPLAY", None)
        dsh_secret_fd = secret_pipe(secret)
        dsh_environment["BYCLAW_BROWSER_SECRET_FD"] = str(dsh_secret_fd)
        try:
            dsh = spawn(options.command, dsh_environment, dsh_account, dsh_secret_fd)
        finally:
            os.close(dsh_secret_fd)
        children.append(dsh)

        # Only the lightweight broker/viewer starts here. Chrome, desktop and
        # byCLI are activated by first use inside browserd. DSH never waits for
        # browser readiness, profile locking, bridge health or recovery.
        browser_environment = dict(base_environment)
        browser_environment["BYCLAW_BROWSER_HEADLESS"] = (
            "false" if viewer == "shared-novnc" else "true"
        )
        browser_environment["BYCLAW_BROWSER_SOCKET_MODE"] = "0600"
        browser_environment.pop("DISPLAY", None)
        browser_command = ([options.browserd_command] if options.browserd_command
                           else ["node", DEFAULT_BROWSERD_ENTRY])
        next_browser_start = 0.0
        restart_delay = 1.0
        browser_started_at = 0.0
        while True:
            reap_adopted_children({child.pid for child in children})
            if received_signal:
                return 128 + received_signal
            dsh_code = dsh.poll()
            if dsh_code is not None:
                return normalized_returncode(dsh_code)
            if browserd is not None and browserd.poll() is not None:
                # A crashed broker can leave Chrome/desktop children in its
                # process group. Stop them before the next profile owner starts.
                try:
                    os.killpg(browserd.pid, signal.SIGKILL)
                except (ProcessLookupError, PermissionError):
                    pass
                children.remove(browserd)
                browserd = None
                if time.monotonic() - browser_started_at > 30:
                    restart_delay = 1.0
                next_browser_start = time.monotonic() + restart_delay
                restart_delay = min(restart_delay * 2, 30.0)
                sys.stderr.write("browser-supervisor: browserd exited; DSH remains available; retrying\n")
            if browserd is None and time.monotonic() >= next_browser_start:
                try:
                    if viewer != "novnc" and browser_profile_lock_fd is None:
                        dsh_home = Path(base_environment.get("DSH_HOME", str(Path(browser_account.pw_dir) / ".dsh")))
                        configured = base_environment.get("BYCLAW_BROWSER_USER_DATA_DIR", "").strip()
                        profile = Path(configured) if configured else dsh_home / "browser" / "user-data"
                        browser_profile_lock_fd = acquire_browser_profile_lock(profile, base_environment, browser_account)
                        browser_environment["BYCLAW_BROWSER_PROFILE_EXCLUSIVE"] = "true"
                    socket_path.unlink(missing_ok=True)
                    activation_path.unlink(missing_ok=True)
                    browser_generation_path.unlink(missing_ok=True)
                    browser_secret_fd = secret_pipe(secret)
                    browser_environment["BYCLAW_BROWSER_SECRET_FD"] = str(browser_secret_fd)
                    try:
                        browserd = spawn(browser_command, browser_environment, browser_account, browser_secret_fd)
                    finally:
                        os.close(browser_secret_fd)
                    children.append(browserd)
                    browser_started_at = time.monotonic()
                except (OSError, RuntimeError) as error:
                    sys.stderr.write(f"browser-supervisor: browser unavailable ({error}); DSH remains available\n")
                    next_browser_start = time.monotonic() + restart_delay
                    restart_delay = min(restart_delay * 2, 30.0)
            time.sleep(0.02)
    except BaseException:
        for child in reversed(children):
            terminate(child)
        if received_signal:
            return 128 + received_signal
        raise
    finally:
        for child in reversed(children):
            terminate(child)
        terminate_adopted_descendants()
        secret[:] = b"\0" * len(secret)
        if browser_profile_lock_fd is not None:
            os.close(browser_profile_lock_fd)
        socket_path.unlink(missing_ok=True)
        activation_path.unlink(missing_ok=True)
        browser_generation_path.unlink(missing_ok=True)
        for signum, handler in previous.items():
            signal.signal(signum, handler)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        sys.stderr.write(f"{error}\n")
        raise SystemExit(1)
