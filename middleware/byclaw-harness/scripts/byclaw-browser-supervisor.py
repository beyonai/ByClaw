#!/usr/bin/env python3
from __future__ import annotations

import argparse
import ctypes
import fcntl
import json
import os
from pathlib import Path
import pwd
import secrets
import select
import signal
import socket
import subprocess
import sys
import threading
import time
from typing import Sequence


DEFAULT_BROWSERD_ENTRY = (
    "/opt/byclaw/dsh-managed/profiles/web/node_modules/"
    "@byclaw/dsh-browser-use/lib/browserd.js"
)
DEFAULT_BYCLI_DAEMON_COMMAND = "/opt/nvm/current/bin/bycli"
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
    parser.add_argument("--bycli-doctor-command", default="")
    parser.add_argument("--bycli-health-interval", type=float, default=30.0)
    parser.add_argument("--bycli-command-timeout", type=float, default=3.0)
    parser.add_argument("--prepare-command", default="")
    parser.add_argument("--secret-file", default="")
    # On demand, hold byCLI's TCP port until first use: a client that reaches byCLI over
    # the network (BE's account login and recorder) starts the browser like the socket does.
    parser.add_argument("--activation-port", type=int, default=0)
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
    if not 0 <= options.activation_port <= 65535:
        parser.error("activation port must be a TCP port")
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


def write_secret_file(path: Path, secret: bytes, account: pwd.struct_passwd) -> None:
    """Leave the broker secret where SSH sessions of the browser user can read it.

    A tool sandbox serves its browser to commands that arrive over SSH, which
    cannot inherit the descriptor the supervisor hands to its own child.
    """
    path.unlink(missing_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
    try:
        os.write(fd, secret)
        os.fchown(fd, account.pw_uid, account.pw_gid)
    finally:
        os.close(fd)


def spawn(
    command: Sequence[str],
    environment: dict[str, str],
    account: pwd.struct_passwd,
    pass_fd: int | None = None,
    listen_fd: int | None = None,
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
    kwargs["pass_fds"] = tuple(fd for fd in (pass_fd, listen_fd) if fd is not None)
    return subprocess.Popen(list(command), **kwargs)  # type: ignore[arg-type]


def acquire_browser_profile_lock(
    path: Path,
    environment: dict[str, str],
    account: pwd.struct_passwd,
) -> int:
    prepared = spawn(["mkdir", "-p", "--", str(path)], environment, account)
    if prepared.wait() != 0:
        raise RuntimeError("browser-supervisor-profile-directory-failed")
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as error:
        os.close(descriptor)
        raise RuntimeError("browser-supervisor-profile-in-use") from error
    return descriptor


def bycli_report(
    command: Sequence[str],
    environment: dict[str, str],
    account: pwd.struct_passwd,
    timeout: float,
) -> dict:
    child_environment = dict(environment)
    child_environment["HOME"] = account.pw_dir
    child_environment["USER"] = account.pw_name
    child_environment["LOGNAME"] = account.pw_name
    try:
        result = subprocess.run(
            list(command),
            env=child_environment,
            close_fds=True,
            preexec_fn=drop_privileges(account),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=timeout,
            check=False,
        )
        if result.returncode != 0:
            return {}
        payload = json.loads(result.stdout)
    except (subprocess.TimeoutExpired, ValueError, OSError, TypeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def bycli_bridge_ready(
    command: Sequence[str],
    environment: dict[str, str],
    account: pwd.struct_passwd,
    timeout: float,
) -> bool:
    payload = bycli_report(command, environment, account, timeout)
    return bool(
        isinstance(payload, dict)
        and payload.get("state") == "ready"
        and isinstance(payload.get("daemon"), dict)
        and payload["daemon"].get("state") == "running"
        and payload["daemon"].get("stale") is not True
        and isinstance(payload.get("extension"), dict)
        and payload["extension"].get("state") == "connected"
    )


def bycli_extension_checks(report: dict) -> dict[str, bool]:
    capabilities = report.get("extensionCapabilities")
    connectivity = report.get("connectivity")
    return {
        "daemonRunning": report.get("daemonRunning") is True,
        "extensionConnected": report.get("extensionConnected") is True,
        "daemonCurrent": report.get("daemonStale") is not True,
        "connectivity": isinstance(connectivity, dict) and connectivity.get("ok") is True,
        "extensionBuildVerified": report.get("extensionBuildVerified") is True,
        "uploadReady": report.get("uploadReady") is True,
        "dialog-policy-v1": isinstance(capabilities, list) and "dialog-policy-v1" in capabilities,
    }


def wait_for_bycli_bridge(
    command: Sequence[str],
    environment: dict[str, str],
    account: pwd.struct_passwd,
    browser_process: subprocess.Popen[bytes],
    timeout: float,
    command_timeout: float,
    doctor_command: Sequence[str] | None = None,
) -> None:
    deadline = time.monotonic() + timeout
    checks = None
    while time.monotonic() < deadline:
        returncode = browser_process.poll()
        if returncode is not None:
            raise RuntimeError(f"browser-supervisor-browserd-exited:{returncode}")
        remaining = deadline - time.monotonic()
        if bycli_bridge_ready(
            command, environment, account, min(command_timeout, max(remaining, 0.01))
        ):
            if doctor_command is None:
                return
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            doctor = bycli_report(
                doctor_command, environment, account, min(max(command_timeout, 10.0), remaining)
            )
            current_checks = bycli_extension_checks(doctor)
            # Keep the last structured result if a final probe exhausts the deadline.
            if doctor or checks is None:
                checks = current_checks
            if all(current_checks.values()) and time.monotonic() <= deadline and browser_process.poll() is None:
                report_bycli_status("local extension verified " + json.dumps(checks, sort_keys=True))
                return
        time.sleep(min(0.05, max(deadline - time.monotonic(), 0)))
    if checks is not None:
        failed = ",".join(name for name, ready in checks.items() if not ready) or "deadline"
        raise RuntimeError(f"browser-supervisor-bycli-extension-verification-timeout:{failed}")
    raise RuntimeError("browser-supervisor-bycli-readiness-timeout")


def report_bycli_status(message: str) -> None:
    sys.stderr.write(f"byclaw-browser-supervisor: byCLI Browser Bridge {message}\n")
    sys.stderr.flush()


def read_browser_generation(path: Path) -> int | None:
    try:
        payload = json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError, OSError, TypeError):
        return None
    generation = payload.get("generation") if isinstance(payload, dict) else None
    if not isinstance(generation, int) or isinstance(generation, bool) or generation <= 0:
        return None
    return generation


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


def wait_for_broker(
    path: Path, process: subprocess.Popen[bytes], timeout: float
) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        returncode = process.poll()
        if returncode is not None:
            raise RuntimeError(f"browser-supervisor-browserd-exited:{returncode}")
        try:
            with socket.socket(socket.AF_UNIX) as probe:
                probe.settimeout(0.1)
                probe.connect(str(path))
            return
        except (FileNotFoundError, ConnectionRefusedError, socket.timeout, OSError):
            time.sleep(0.02)
    raise RuntimeError("browser-supervisor-browserd-readiness-timeout")


def accept_pending(listener: socket.socket) -> list[socket.socket]:
    """Every connection already waiting on a non-blocking listener."""
    accepted = []
    while True:
        try:
            connection, _address = listener.accept()
        except (BlockingIOError, InterruptedError):
            return accepted
        connection.setblocking(True)
        accepted.append(connection)


def relay_to_port(client: socket.socket, port: int, timeout: float) -> None:
    """In the background, hand a held connection to whatever now listens on `port`."""

    def pump(source: socket.socket, target: socket.socket) -> None:
        try:
            while data := source.recv(65536):
                target.sendall(data)
        except OSError:
            pass
        finally:
            try:
                target.shutdown(socket.SHUT_WR)
            except OSError:
                pass

    def run() -> None:
        deadline = time.monotonic() + timeout
        upstream = None
        while upstream is None:
            try:
                upstream = socket.create_connection(("127.0.0.1", port), timeout=1)
            except OSError:
                if time.monotonic() >= deadline:
                    client.close()
                    return
                time.sleep(0.05)
        upstream.settimeout(None)
        back = threading.Thread(target=pump, args=(upstream, client), daemon=True)
        back.start()
        pump(client, upstream)
        back.join()
        client.close()
        upstream.close()

    threading.Thread(target=run, daemon=True).start()


def normalized_returncode(returncode: int | None) -> int:
    if returncode is None:
        return 1
    if returncode < 0:
        return 128 + abs(returncode)
    return returncode


def main(argv: Sequence[str] | None = None) -> int:
    startup_started = time.monotonic()
    enable_child_subreaper()
    options = parse_args(sys.argv[1:] if argv is None else argv)
    browser_account = identity(options.browser_user)
    dsh_account = identity(options.dsh_user)
    socket_path = Path(options.socket_path)
    startup = os.environ.get("BYCLAW_BROWSER_STARTUP", "eager")
    if startup not in {"eager", "on-demand"}:
        raise RuntimeError("browser-supervisor-invalid-startup")
    activation_socket: socket.socket | None = None
    activation_listener: socket.socket | None = None
    ready_path = Path(str(socket_path) + ".ready")
    activated_path = Path(str(socket_path) + ".activated")
    ready_path.unlink(missing_ok=True)
    activated_path.unlink(missing_ok=True)
    viewer = os.environ.get("BYCLAW_BROWSER_VIEWER", "none")
    if viewer not in {"none", "novnc", "shared-novnc"}:
        raise RuntimeError("browser-supervisor-invalid-viewer")

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
    socket_path.unlink(missing_ok=True)
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

        sys.stderr.write(
            "byclaw-browser-supervisor: startup phase=prepared; "
            f"elapsedMs={round((time.monotonic() - startup_started) * 1000)}\n"
        )
        sys.stderr.flush()
        secret.extend(secrets.token_urlsafe(32).encode("ascii"))
        if options.secret_file:
            write_secret_file(Path(options.secret_file), bytes(secret), browser_account)
        bycli_enabled = base_environment.get("BYCLAW_BYCLI_ENABLED", "false") in {
            "true",
            "1",
        }
        bycli_command = (
            [options.bycli_daemon_command]
            if options.bycli_daemon_command
            else [DEFAULT_BYCLI_DAEMON_COMMAND, "daemon", "restart"]
        )
        bycli_status_command = (
            [options.bycli_status_command]
            if options.bycli_status_command
            else [DEFAULT_BYCLI_DAEMON_COMMAND, "daemon", "status", "--json"]
        )
        bycli_doctor_command = (
            [options.bycli_doctor_command]
            if options.bycli_doctor_command
            else [DEFAULT_BYCLI_DAEMON_COMMAND, "doctor", "--json"]
        )

        def restart_bycli() -> int:
            process = spawn(bycli_command, base_environment, browser_account)
            children.append(process)
            code = process.wait()
            children.remove(process)
            return normalized_returncode(code)

        monitor_bycli = False
        browser_generation = None

        def start_browser() -> None:
            nonlocal browserd, activation_socket, monitor_bycli, browser_generation
            nonlocal browser_profile_lock_fd
            # The persistent profile may live on NAS. Lock it only at browser
            # activation, before any daemon can access it; eager mode still gates DSH.
            if viewer != "novnc":
                dsh_home = Path(
                    base_environment.get("DSH_HOME", str(Path(browser_account.pw_dir) / ".dsh"))
                )
                configured_profile = base_environment.get(
                    "BYCLAW_BROWSER_USER_DATA_DIR", ""
                ).strip()
                browser_profile = (
                    Path(configured_profile)
                    if configured_profile
                    else dsh_home / "browser" / "user-data"
                )
                browser_profile_lock_fd = acquire_browser_profile_lock(
                    browser_profile,
                    base_environment,
                    browser_account,
                )
                base_environment["BYCLAW_BROWSER_PROFILE_EXCLUSIVE"] = "true"

            if bycli_enabled:
                bycli_code = restart_bycli()
                if received_signal:
                    raise RuntimeError("browser-supervisor-interrupted")
                if bycli_code != 0:
                    raise RuntimeError(f"browser-supervisor-bycli-exited:{bycli_code}")

            browser_environment = dict(base_environment)
            # Browserd owns DISPLAY lifecycle. Shared noVNC starts one headed
            # process-lifetime browser; the other modes retain their existing
            # headless default or per-lease headed override.
            browser_environment["BYCLAW_BROWSER_HEADLESS"] = (
                "false" if viewer == "shared-novnc" else "true"
            )
            browser_environment["BYCLAW_BROWSER_SOCKET_MODE"] = "0600"
            browser_environment.pop("DISPLAY", None)
            browser_secret_fd = secret_pipe(secret)
            browser_environment["BYCLAW_BROWSER_SECRET_FD"] = str(browser_secret_fd)
            browser_command = (
                [options.browserd_command]
                if options.browserd_command
                else ["node", DEFAULT_BROWSERD_ENTRY]
            )
            if activation_socket is not None:
                browser_environment["BYCLAW_BROWSER_LISTEN_FD"] = str(activation_socket.fileno())
                browser_environment["BYCLAW_BROWSER_READY_FILE"] = str(ready_path)
            try:
                browserd = spawn(
                    browser_command, browser_environment, browser_account, browser_secret_fd,
                    activation_socket.fileno() if activation_socket is not None else None
                )
            finally:
                os.close(browser_secret_fd)
            children.append(browserd)
            if activation_socket is not None:
                deadline = time.monotonic() + options.readiness_timeout
                while not ready_path.exists():
                    if browserd.poll() is not None or received_signal:
                        raise RuntimeError("browser-supervisor-browserd-activation-failed")
                    if time.monotonic() >= deadline:
                        raise RuntimeError("browser-supervisor-browserd-readiness-timeout")
                    time.sleep(0.02)
                activation_socket.close()
                activation_socket = None
            else:
                wait_for_broker(socket_path, browserd, options.readiness_timeout)
            monitor_bycli = bycli_enabled and viewer == "shared-novnc"
            if monitor_bycli:
                wait_for_bycli_bridge(
                    bycli_status_command,
                    base_environment,
                    browser_account,
                    browserd,
                    options.readiness_timeout,
                    options.bycli_command_timeout,
                    doctor_command=bycli_doctor_command,
                )
                report_bycli_status("connected")
            browser_generation = read_browser_generation(browser_generation_path)

            activated_path.touch(mode=0o600)
            os.chown(activated_path, browser_account.pw_uid, browser_account.pw_gid)

        if startup == "on-demand":
            activation_socket = socket.socket(socket.AF_UNIX)
            activation_socket.bind(str(socket_path))
            os.chmod(socket_path, 0o600)
            os.chown(socket_path, browser_account.pw_uid, browser_account.pw_gid)
            activation_socket.listen(32)
            if options.activation_port and bycli_enabled:
                activation_listener = socket.create_server(
                    ("0.0.0.0", options.activation_port), backlog=32
                )
                activation_listener.setblocking(False)
            sys.stderr.write("byclaw-browser-supervisor: browser/byCLI on-demand; DSH starting\n")
        else:
            start_browser()

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
        sys.stderr.write(
            "byclaw-browser-supervisor: startup phase=cli-spawned; "
            f"elapsedMs={round((time.monotonic() - startup_started) * 1000)}\n"
        )
        sys.stderr.flush()
        if startup == "eager":
            secret[:] = b"\0" * len(secret)
        next_bycli_check = time.monotonic() + options.bycli_health_interval
        consecutive_bycli_failures = 0

        while True:
            reap_adopted_children({child.pid for child in children})
            if received_signal:
                for child in reversed(children):
                    terminate(child)
                return 128 + received_signal
            dsh_code = dsh.poll()
            if dsh_code is not None:
                if browserd is not None:
                    terminate(browserd)
                return normalized_returncode(dsh_code)
            if browserd is None:
                waiting = [
                    listener
                    for listener in (activation_socket, activation_listener)
                    if listener is not None
                ]
                if waiting and select.select(waiting, [], [], 0.02)[0]:
                    # byCLI binds its own port while starting: take the clients that
                    # came first, and let it go.
                    held: list[socket.socket] = []
                    if activation_listener is not None:
                        held = accept_pending(activation_listener)
                        activation_listener.close()
                        activation_listener = None
                    try:
                        start_browser()
                    except BaseException:
                        for connection in held:
                            connection.close()
                        raise
                    for connection in held:
                        relay_to_port(connection, options.activation_port, options.readiness_timeout)
                    secret[:] = b"\0" * len(secret)
                    next_bycli_check = time.monotonic() + options.bycli_health_interval
                else:
                    continue
            browser_code = browserd.poll()
            if browser_code is not None:
                terminate(dsh)
                return normalized_returncode(browser_code) or 1
            now = time.monotonic()
            latest_browser_generation = read_browser_generation(
                browser_generation_path
            )
            if browser_generation is None and latest_browser_generation is not None:
                browser_generation = latest_browser_generation
            elif (
                monitor_bycli
                and latest_browser_generation is not None
                and latest_browser_generation != browser_generation
            ):
                report_bycli_status(
                    "browser generation changed "
                    f"from {browser_generation} to {latest_browser_generation}; "
                    "reconnecting"
                )
                browser_generation = latest_browser_generation
                if restart_bycli() != 0:
                    raise RuntimeError(
                        "browser-supervisor-bycli-bridge-unrecoverable"
                    )
                try:
                    wait_for_bycli_bridge(
                        bycli_status_command,
                        base_environment,
                        browser_account,
                        browserd,
                        options.readiness_timeout,
                        options.bycli_command_timeout,
                        doctor_command=bycli_doctor_command,
                    )
                except RuntimeError as error:
                    if str(error).startswith("browser-supervisor-browserd-exited"):
                        raise
                    report_bycli_status(str(error))
                    raise RuntimeError(
                        "browser-supervisor-bycli-bridge-unrecoverable"
                    ) from error
                consecutive_bycli_failures = 0
                next_bycli_check = (
                    time.monotonic() + options.bycli_health_interval
                )
                report_bycli_status("reconnected")
            if monitor_bycli and now >= next_bycli_check:
                if bycli_bridge_ready(
                    bycli_status_command,
                    base_environment,
                    browser_account,
                    options.bycli_command_timeout,
                ):
                    if consecutive_bycli_failures > 0:
                        report_bycli_status("reconnected")
                    consecutive_bycli_failures = 0
                else:
                    consecutive_bycli_failures += 1
                    if consecutive_bycli_failures == 1:
                        report_bycli_status("disconnected; waiting for one retry")
                    if consecutive_bycli_failures >= 2:
                        if restart_bycli() != 0:
                            raise RuntimeError(
                                "browser-supervisor-bycli-bridge-unrecoverable"
                            )
                        try:
                            wait_for_bycli_bridge(
                                bycli_status_command,
                                base_environment,
                                browser_account,
                                browserd,
                                options.readiness_timeout,
                                options.bycli_command_timeout,
                            )
                        except RuntimeError as error:
                            if str(error).startswith("browser-supervisor-browserd-exited"):
                                raise
                            raise RuntimeError(
                                "browser-supervisor-bycli-bridge-unrecoverable"
                            ) from error
                        consecutive_bycli_failures = 0
                        report_bycli_status("reconnected")
                next_bycli_check = time.monotonic() + options.bycli_health_interval
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
        if activation_socket is not None:
            activation_socket.close()
        ready_path.unlink(missing_ok=True)
        activated_path.unlink(missing_ok=True)
        socket_path.unlink(missing_ok=True)
        browser_generation_path.unlink(missing_ok=True)
        for signum, handler in previous.items():
            signal.signal(signum, handler)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        sys.stderr.write(f"{error}\n")
        raise SystemExit(1)
