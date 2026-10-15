#!/usr/bin/env python3
from __future__ import annotations

import getpass
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time


ROOT = Path(__file__).resolve().parent.parent
SUPERVISOR = Path(
    os.environ.get(
        "BYCLAW_TEST_SUPERVISOR",
        str(ROOT / "scripts" / "byclaw-browser-supervisor.py"),
    )
)


FAKE_BROWSERD = r"""#!/usr/bin/env python3
import hashlib, json, os, signal, socket, sys, time
fd_name = "BYCLAW_BROWSER_SECRET_FD"
fd = int(os.environ.pop(fd_name))
secret = os.read(fd, 512)
os.close(fd)
assert secret
assert secret.decode() not in "\0".join(os.environ.values())
assert secret.decode() not in "\0".join(sys.argv)
record = {
    "digest": hashlib.sha256(secret).hexdigest(),
    "uid": os.getuid(),
    "gid": os.getgid(),
    "home": os.environ.get("HOME"),
    "downloadRoot": os.environ.get("BYCLAW_BROWSER_DOWNLOAD_ROOT"),
    "screenshotRoot": os.environ.get("BYCLAW_BROWSER_SCREENSHOT_ROOT"),
    "socketMode": os.environ.get("BYCLAW_BROWSER_SOCKET_MODE"),
    "headless": os.environ.get("BYCLAW_BROWSER_HEADLESS"),
    "viewer": os.environ.get("BYCLAW_BROWSER_VIEWER"),
    "display": os.environ.get("DISPLAY"),
    "fdEnvRemoved": fd_name not in os.environ,
    "generationFile": os.environ.get("BYCLAW_BROWSER_GENERATION_FILE"),
    "profileExclusive": os.environ.get("BYCLAW_BROWSER_PROFILE_EXCLUSIVE"),
}
open(os.environ["FAKE_BROWSER_RECORD"], "w").write(json.dumps(record))
generation_path = os.environ.get("BYCLAW_BROWSER_GENERATION_FILE")
if generation_path:
    open(generation_path, "w").write(json.dumps({"generation": 1, "pid": os.getpid()}))
def stop_without_socket(signum, _frame):
    with open(os.environ["FAKE_BROWSER_SIGNAL"], "w") as output:
        output.write(str(signum))
    raise SystemExit(0)
if os.environ.get("FAKE_BROWSER_MODE") == "no-socket":
    signal.signal(signal.SIGTERM, stop_without_socket)
    signal.signal(signal.SIGINT, stop_without_socket)
    while True: time.sleep(.05)
sock = socket.socket(socket.AF_UNIX)
sock.bind(os.environ["BYCLAW_BROWSER_SOCKET"])
sock.listen(4)
def stop(signum, _frame):
    with open(os.environ["FAKE_BROWSER_SIGNAL"], "w") as output:
        output.write(str(signum))
    sock.close()
    raise SystemExit(0)
signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
if os.environ.get("FAKE_BROWSER_MODE") == "exit23":
    deadline = time.monotonic() + 3
    while not os.path.exists(os.environ["FAKE_DSH_RECORD"]):
        if time.monotonic() >= deadline: raise RuntimeError("dsh-not-ready")
        time.sleep(.01)
    raise SystemExit(23)
if os.environ.get("FAKE_BROWSER_MODE") == "restart-generation":
    deadline = time.monotonic() + 3
    while not os.path.exists(os.environ["FAKE_DSH_RECORD"]):
        if time.monotonic() >= deadline: raise RuntimeError("dsh-not-ready")
        time.sleep(.01)
    time.sleep(.05)
    open(generation_path, "w").write(json.dumps({"generation": 2, "pid": os.getpid() + 1}))
while True:
    try:
        connection, _ = sock.accept()
        connection.close()
    except InterruptedError:
        pass
"""


FAKE_DSH = r"""#!/usr/bin/env python3
import hashlib, json, os, signal, sys, time
def silence_stdio():
    null = os.open(os.devnull, os.O_RDWR)
    for descriptor in (0, 1, 2): os.dup2(null, descriptor)
    if null > 2: os.close(null)
fd_name = "BYCLAW_BROWSER_SECRET_FD"
fd = int(os.environ.pop(fd_name))
secret = os.read(fd, 512)
os.close(fd)
assert secret
assert secret.decode() not in "\0".join(os.environ.values())
assert secret.decode() not in "\0".join(sys.argv)
record = {
    "digest": hashlib.sha256(secret).hexdigest(),
    "uid": os.getuid(),
    "gid": os.getgid(),
    "home": os.environ.get("HOME"),
    "argv": sys.argv[1:],
    "ownsRuntime": os.environ.get("BYCLAW_BROWSER_OWNS_RUNTIME"),
    "display": os.environ.get("DISPLAY"),
    "fdEnvRemoved": fd_name not in os.environ,
}
def stop(signum, _frame):
    with open(os.environ["FAKE_DSH_SIGNAL"], "w") as output:
        output.write(str(signum))
    raise SystemExit(0)
signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
open(os.environ["FAKE_DSH_RECORD"], "w").write(json.dumps(record))
if os.environ.get("FAKE_DSH_MODE") == "exit7":
    raise SystemExit(7)
if os.environ.get("FAKE_DSH_MODE") == "orphan":
    child = os.fork()
    if child == 0:
        os.setsid()
        def stop_orphan(signum, _frame):
            with open(os.environ["FAKE_DSH_ORPHAN_SIGNAL"], "w") as output:
                output.write(str(signum))
            raise SystemExit(0)
        signal.signal(signal.SIGTERM, stop_orphan)
        signal.signal(signal.SIGINT, stop_orphan)
        open(os.environ["FAKE_DSH_ORPHAN_READY"], "w").write(str(os.getpid()))
        while True: time.sleep(.05)
    deadline = time.monotonic() + 2
    while not os.path.exists(os.environ["FAKE_DSH_ORPHAN_READY"]):
        if time.monotonic() >= deadline: raise RuntimeError("orphan-not-ready")
        time.sleep(.01)
    raise SystemExit(7)
if os.environ.get("FAKE_DSH_MODE") == "nested-orphan":
    orphan_parent = os.fork()
    if orphan_parent == 0:
        os.setsid()
        silence_stdio()
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        orphan_child = os.fork()
        if orphan_child == 0:
            os.setsid()
            signal.signal(signal.SIGTERM, signal.SIG_IGN)
            while True: time.sleep(.05)
        open(os.environ["FAKE_DSH_NESTED_READY"], "w").write(
            json.dumps({"parent": os.getpid(), "child": orphan_child})
        )
        while True: time.sleep(.05)
    deadline = time.monotonic() + 2
    while not os.path.exists(os.environ["FAKE_DSH_NESTED_READY"]):
        if time.monotonic() >= deadline: raise RuntimeError("nested-orphan-not-ready")
        time.sleep(.01)
    raise SystemExit(7)
while True: time.sleep(.05)
"""


FAKE_DESKTOP = r"""#!/usr/bin/env python3
import json, os, signal, time
with open(os.environ["FAKE_DESKTOP_RECORD"], "w") as output:
    json.dump({"display": os.environ.get("DISPLAY"), "viewer": os.environ.get("BYCLAW_BROWSER_VIEWER")}, output)
open(os.environ["BYCLAW_BROWSER_DESKTOP_READY_FILE"], "w").close()
def stop(signum, _frame):
    with open(os.environ["FAKE_DESKTOP_SIGNAL"], "w") as output:
        output.write(str(signum))
    raise SystemExit(0)
signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
while True: time.sleep(.05)
"""


FAKE_BYCLI_DAEMON = r"""#!/usr/bin/env python3
import json, os
path = os.environ["FAKE_BYCLI_RECORD"]
calls = 0
if os.path.exists(path): calls = json.loads(open(path).read()).get("calls", 0)
with open(os.environ["FAKE_BYCLI_RECORD"], "w") as output:
    json.dump({"uid": os.getuid(), "gid": os.getgid(), "home": os.environ.get("HOME"), "calls": calls + 1}, output)
"""


FAKE_BYCLI_STATUS = r"""#!/usr/bin/env python3
import json, os
path = os.environ["FAKE_BYCLI_STATUS_RECORD"]
calls = int(open(path).read()) if os.path.exists(path) else 0
open(path, "w").write(str(calls + 1))
states = os.environ.get("FAKE_BYCLI_STATUS_SEQUENCE", "ready").split(",")
state = states[min(calls, len(states) - 1)]
if state == "malformed":
    print("not-json")
else:
    ready = state == "ready"
    print(json.dumps({
        "ok": True,
        "state": "ready" if ready else "extension_disconnected",
        "daemon": {"state": "running", "stale": False},
        "extension": {"state": "connected" if ready else "disconnected"},
    }))
"""


FAKE_PREPARE = r"""#!/usr/bin/env python3
import json, os, signal, time
assert os.environ.get("BYCLAW_DSH_PREPARE_ONLY") == "1"
assert "BYCLAW_BROWSER_SECRET" not in os.environ
assert "BYCLAW_BROWSER_SECRET_FD" not in os.environ
assert not os.path.exists(os.environ["FAKE_BROWSER_RECORD"])
def stop(signum, _frame):
    with open(os.environ["FAKE_PREPARE_SIGNAL"], "w") as output:
        output.write(str(signum))
    raise SystemExit(0)
if os.environ.get("FAKE_PREPARE_MODE") == "wait":
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
with open(os.environ["FAKE_PREPARE_RECORD"], "w") as output:
    json.dump({"uid": os.getuid(), "gid": os.getgid()}, output)
if os.environ.get("FAKE_PREPARE_MODE") == "wait":
    while True: time.sleep(.05)
"""


def wait_for(path: Path, process: subprocess.Popen[str], timeout: float = 3) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if path.exists():
            return
        if process.poll() is not None:
            raise AssertionError(f"supervisor exited early: {process.returncode}")
        time.sleep(0.02)
    raise AssertionError(f"timed out waiting for {path}")


def fixture(
    directory: Path,
    *,
    dsh_mode: str = "",
    browser_mode: str = "",
    viewer: str = "none",
    prepare: bool = False,
    bycli: bool = False,
    readiness_timeout: float = 2,
    prepare_mode: str = "",
    bycli_status_sequence: str = "ready",
    bycli_health_interval: float = 0.1,
    browser_profile: Path | None = None,
):
    browser = directory / "fake-browserd.py"
    dsh = directory / "fake-dsh.py"
    desktop = directory / "fake-desktop.py"
    prepare_command = directory / "fake-prepare.py"
    bycli_daemon = directory / "fake-bycli-daemon.py"
    bycli_status = directory / "fake-bycli-status.py"
    browser.write_text(FAKE_BROWSERD)
    dsh.write_text(FAKE_DSH)
    desktop.write_text(FAKE_DESKTOP)
    prepare_command.write_text(FAKE_PREPARE)
    bycli_daemon.write_text(FAKE_BYCLI_DAEMON)
    bycli_status.write_text(FAKE_BYCLI_STATUS)
    browser.chmod(0o755)
    dsh.chmod(0o755)
    desktop.chmod(0o755)
    prepare_command.chmod(0o755)
    bycli_daemon.chmod(0o755)
    bycli_status.chmod(0o755)
    socket_path = directory / "browserd.sock"
    browser_record = directory / "browser.json"
    dsh_record = directory / "dsh.json"
    env = {
        **os.environ,
        "FAKE_BROWSER_RECORD": str(browser_record),
        "FAKE_BROWSER_SIGNAL": str(directory / "browser.signal"),
        "FAKE_DSH_RECORD": str(dsh_record),
        "FAKE_DSH_SIGNAL": str(directory / "dsh.signal"),
        "FAKE_DSH_ORPHAN_READY": str(directory / "dsh-orphan.ready"),
        "FAKE_DSH_ORPHAN_SIGNAL": str(directory / "dsh-orphan.signal"),
        "FAKE_DSH_NESTED_READY": str(directory / "dsh-nested.ready"),
        "FAKE_DSH_MODE": dsh_mode,
        "FAKE_BROWSER_MODE": browser_mode,
        "FAKE_DESKTOP_RECORD": str(directory / "desktop.json"),
        "FAKE_DESKTOP_SIGNAL": str(directory / "desktop.signal"),
        "FAKE_PREPARE_RECORD": str(directory / "prepare.json"),
        "FAKE_PREPARE_SIGNAL": str(directory / "prepare.signal"),
        "FAKE_PREPARE_MODE": prepare_mode,
        "FAKE_BYCLI_RECORD": str(directory / "bycli.json"),
        "FAKE_BYCLI_STATUS_RECORD": str(directory / "bycli-status-count"),
        "FAKE_BYCLI_STATUS_SEQUENCE": bycli_status_sequence,
        "BYCLAW_BYCLI_ENABLED": "true" if bycli else "false",
        "BYCLAW_BROWSER_VIEWER": viewer,
        **({"BYCLAW_BROWSER_USER_DATA_DIR": str(browser_profile)} if browser_profile else {}),
    }
    user = getpass.getuser()
    command = [
        sys.executable,
        str(SUPERVISOR),
        "--browser-user",
        user,
        "--dsh-user",
        user,
        "--socket-path",
        str(socket_path),
        "--readiness-timeout",
        str(readiness_timeout),
        "--browserd-command",
        str(browser),
    ]
    if bycli:
        command.extend([
            "--bycli-daemon-command", str(bycli_daemon),
            "--bycli-status-command", str(bycli_status),
            "--bycli-health-interval", str(bycli_health_interval),
        ])
    if prepare:
        command.extend(["--prepare-command", str(prepare_command)])
    command.extend(["--", str(dsh), "web", "--port", "8080", "--no-open"])
    return command, env, socket_path, browser_record, dsh_record


def run_exit_propagation(root: Path) -> None:
    command, env, _socket, browser_record, dsh_record = fixture(root, dsh_mode="exit7")
    result = subprocess.run(command, env=env, text=True, capture_output=True, timeout=5)
    assert result.returncode == 7, result
    browser = json.loads(browser_record.read_text())
    dsh = json.loads(dsh_record.read_text())
    assert browser["digest"] == dsh["digest"]
    assert browser["fdEnvRemoved"] and dsh["fdEnvRemoved"]
    assert browser["headless"] == "true"
    assert dsh["ownsRuntime"] == "false"
    assert dsh["display"] is None
    assert dsh["argv"] == ["web", "--port", "8080", "--no-open"]
    assert browser["uid"] == os.getuid() == dsh["uid"]
    assert browser["gid"] == os.getgid() == dsh["gid"]
    assert browser["home"] == dsh["home"]
    assert browser["downloadRoot"].endswith("/downloads")
    assert browser["screenshotRoot"].endswith("/screenshots")
    assert browser["socketMode"] == "0600"
    assert browser["digest"] not in result.stdout + result.stderr
    wait_for(root / "browser.signal", subprocess.Popen(["true"]))
    assert (root / "browser.signal").read_text() == str(int(signal.SIGTERM))


def run_signal_forwarding(root: Path) -> None:
    command, env, _socket, browser_record, dsh_record = fixture(root)
    process = subprocess.Popen(
        command, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE
    )
    wait_for(browser_record, process)
    wait_for(dsh_record, process)
    process.send_signal(signal.SIGTERM)
    stdout, stderr = process.communicate(timeout=5)
    assert process.returncode == 128 + signal.SIGTERM, (
        process.returncode,
        stdout,
        stderr,
    )
    wait_for(root / "browser.signal", subprocess.Popen(["true"]))
    wait_for(root / "dsh.signal", subprocess.Popen(["true"]))
    assert (root / "browser.signal").read_text() == str(int(signal.SIGTERM))
    assert (root / "dsh.signal").read_text() == str(int(signal.SIGTERM))


def run_profile_exclusive_lock(root: Path) -> None:
    profile = root / "shared-profile"
    first_root = root / "first"
    second_root = root / "second"
    first_root.mkdir()
    second_root.mkdir()
    first_command, first_env, _socket, first_browser, first_dsh = fixture(
        first_root,
        browser_profile=profile,
    )
    first = subprocess.Popen(
        first_command,
        env=first_env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    try:
        wait_for(first_browser, first)
        wait_for(first_dsh, first)
        first_record = json.loads(first_browser.read_text())
        assert first_record["profileExclusive"] == "true"

        second_command, second_env, _socket, second_browser, _dsh = fixture(
            second_root,
            browser_profile=profile,
        )
        second = subprocess.run(
            second_command,
            env=second_env,
            text=True,
            capture_output=True,
            timeout=5,
        )
        assert second.returncode == 1, second
        assert "browser-supervisor-profile-in-use" in second.stderr
        assert not second_browser.exists()
    finally:
        first.send_signal(signal.SIGTERM)
        first.communicate(timeout=5)


def run_browser_failure(root: Path) -> None:
    command, env, _socket, browser_record, dsh_record = fixture(
        root, browser_mode="exit23"
    )
    result = subprocess.run(command, env=env, text=True, capture_output=True, timeout=5)
    assert result.returncode == 23, result
    assert browser_record.exists() and dsh_record.exists()
    wait_for(root / "dsh.signal", subprocess.Popen(["true"]))


def run_viewer_mode(root: Path) -> None:
    command, env, _socket, browser_record, dsh_record = fixture(
        root, dsh_mode="exit7", viewer="novnc"
    )
    result = subprocess.run(command, env=env, text=True, capture_output=True, timeout=5)
    assert result.returncode == 7, result
    browser = json.loads(browser_record.read_text())
    dsh = json.loads(dsh_record.read_text())
    assert browser["headless"] == "true"
    assert browser["viewer"] == "novnc"
    assert browser["display"] is None
    assert dsh["display"] is None
    assert not (root / "desktop.json").exists()
    assert not (root / "desktop.signal").exists()


def run_shared_viewer_mode(root: Path) -> None:
    command, env, _socket, browser_record, dsh_record = fixture(
        root, dsh_mode="exit7", viewer="shared-novnc"
    )
    result = subprocess.run(command, env=env, text=True, capture_output=True, timeout=5)
    assert result.returncode == 7, result
    browser = json.loads(browser_record.read_text())
    dsh = json.loads(dsh_record.read_text())
    assert browser["headless"] == "false"
    assert browser["viewer"] == "shared-novnc"
    assert browser["display"] is None
    assert dsh["display"] is None


def run_prepare_before_secret(root: Path) -> None:
    command, env, _socket, _browser_record, _dsh_record = fixture(
        root, dsh_mode="exit7", prepare=True
    )
    result = subprocess.run(command, env=env, text=True, capture_output=True, timeout=5)
    assert result.returncode == 7, result
    prepared = json.loads((root / "prepare.json").read_text())
    assert prepared == {"uid": os.getuid(), "gid": os.getgid()}


def run_bycli_daemon_lifecycle(root: Path) -> None:
    command, env, _socket, _browser_record, _dsh_record = fixture(
        root, dsh_mode="exit7", bycli=True
    )
    result = subprocess.run(command, env=env, text=True, capture_output=True, timeout=5)
    assert result.returncode == 7, result
    daemon = json.loads((root / "bycli.json").read_text())
    assert daemon["uid"] == os.getuid()
    assert daemon["gid"] == os.getgid()
    assert daemon["home"] == os.path.expanduser("~")


def run_bycli_connected_status(root: Path) -> None:
    command, env, _socket, _browser_record, _dsh_record = fixture(
        root, dsh_mode="exit7", viewer="shared-novnc", bycli=True
    )
    result = subprocess.run(command, env=env, text=True, capture_output=True, timeout=5)
    assert result.returncode == 7, result
    assert "byCLI Browser Bridge connected" in result.stderr


def run_bycli_startup_gate(root: Path) -> None:
    command, env, _socket, browser_record, dsh_record = fixture(
        root,
        viewer="shared-novnc",
        bycli=True,
        readiness_timeout=0.3,
        bycli_status_sequence="disconnected",
    )
    result = subprocess.run(command, env=env, text=True, capture_output=True, timeout=5)
    assert result.returncode == 1, result
    assert "browser-supervisor-bycli-readiness-timeout" in result.stderr
    assert browser_record.exists()
    assert not dsh_record.exists()


def run_bycli_watchdog_recovery(root: Path) -> None:
    command, env, _socket, _browser_record, dsh_record = fixture(
        root,
        viewer="shared-novnc",
        bycli=True,
        readiness_timeout=0.5,
        bycli_status_sequence="ready,disconnected,disconnected,ready",
        bycli_health_interval=0.05,
    )
    process = subprocess.Popen(command, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    wait_for(dsh_record, process)
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        record = root / "bycli.json"
        status_record = root / "bycli-status-count"
        if (
            record.exists()
            and json.loads(record.read_text()).get("calls") == 2
            and status_record.exists()
            and int(status_record.read_text()) >= 3
        ):
            break
        if process.poll() is not None:
            raise AssertionError(f"supervisor exited early: {process.returncode}")
        time.sleep(0.02)
    else:
        raise AssertionError("watchdog did not restart byCLI daemon")
    process.send_signal(signal.SIGTERM)
    _stdout, stderr = process.communicate(timeout=5)
    assert process.returncode == 128 + signal.SIGTERM
    assert "byCLI Browser Bridge disconnected" in stderr
    assert "byCLI Browser Bridge reconnected" in stderr


def run_bycli_watchdog_tolerates_transient_disconnect(root: Path) -> None:
    command, env, _socket, _browser_record, dsh_record = fixture(
        root,
        viewer="shared-novnc",
        bycli=True,
        readiness_timeout=0.5,
        bycli_status_sequence="ready,disconnected,ready",
        bycli_health_interval=0.05,
    )
    process = subprocess.Popen(command, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    wait_for(dsh_record, process)
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        status_count = root / "bycli-status-count"
        if status_count.exists() and int(status_count.read_text()) >= 3:
            break
        time.sleep(0.02)
    assert status_count.exists() and int(status_count.read_text()) >= 3
    process.send_signal(signal.SIGTERM)
    _stdout, stderr = process.communicate(timeout=5)
    assert process.returncode == 128 + signal.SIGTERM
    assert json.loads((root / "bycli.json").read_text())["calls"] == 1
    assert "byCLI Browser Bridge disconnected" in stderr
    assert "byCLI Browser Bridge reconnected" in stderr


def run_bycli_browser_generation_recovery(root: Path) -> None:
    command, env, _socket, browser_record, dsh_record = fixture(
        root,
        browser_mode="restart-generation",
        viewer="shared-novnc",
        bycli=True,
        readiness_timeout=0.5,
        bycli_status_sequence="ready,disconnected,ready",
        bycli_health_interval=30,
    )
    process = subprocess.Popen(
        command, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE
    )
    wait_for(browser_record, process)
    wait_for(dsh_record, process)
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        record = root / "bycli.json"
        status_record = root / "bycli-status-count"
        if (
            record.exists()
            and json.loads(record.read_text()).get("calls") == 2
            and status_record.exists()
            and int(status_record.read_text()) >= 3
        ):
            break
        if process.poll() is not None:
            raise AssertionError(f"supervisor exited early: {process.returncode}")
        time.sleep(0.02)
    else:
        raise AssertionError("browser generation change did not restart byCLI daemon")
    process.send_signal(signal.SIGTERM)
    _stdout, stderr = process.communicate(timeout=5)
    assert process.returncode == 128 + signal.SIGTERM
    assert "browser generation changed from 1 to 2" in stderr
    assert "byCLI Browser Bridge reconnected" in stderr
    browser = json.loads(browser_record.read_text())
    assert browser["generationFile"].endswith("/browser-generation.json")


def run_bycli_watchdog_failure(root: Path) -> None:
    command, env, _socket, _browser_record, dsh_record = fixture(
        root,
        viewer="shared-novnc",
        bycli=True,
        readiness_timeout=0.3,
        bycli_status_sequence="ready,disconnected",
        bycli_health_interval=0.05,
    )
    result = subprocess.run(command, env=env, text=True, capture_output=True, timeout=5)
    assert result.returncode == 1, result
    assert dsh_record.exists()
    assert "browser-supervisor-bycli-bridge-unrecoverable" in result.stderr
    assert json.loads((root / "bycli.json").read_text())["calls"] == 2
    assert (root / "dsh.signal").read_text() == str(int(signal.SIGTERM))


def run_bycli_malformed_status(root: Path) -> None:
    command, env, _socket, _browser_record, dsh_record = fixture(
        root,
        viewer="shared-novnc",
        bycli=True,
        readiness_timeout=0.3,
        bycli_status_sequence="malformed",
    )
    result = subprocess.run(command, env=env, text=True, capture_output=True, timeout=5)
    assert result.returncode == 1, result
    assert "browser-supervisor-bycli-readiness-timeout" in result.stderr
    assert not dsh_record.exists()


def run_readiness_timeout(root: Path) -> None:
    command, env, _socket, browser_record, dsh_record = fixture(
        root, browser_mode="no-socket", readiness_timeout=1.0
    )
    result = subprocess.run(command, env=env, text=True, capture_output=True, timeout=5)
    assert result.returncode == 1, result
    assert "browser-supervisor-browserd-readiness-timeout" in result.stderr
    assert browser_record.exists()
    assert not dsh_record.exists()
    assert (root / "browser.signal").read_text() == str(int(signal.SIGTERM))


def run_prepare_signal(root: Path) -> None:
    command, env, _socket, browser_record, _dsh_record = fixture(
        root, prepare=True, prepare_mode="wait"
    )
    process = subprocess.Popen(
        command, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE
    )
    wait_for(root / "prepare.json", process)
    process.send_signal(signal.SIGTERM)
    stdout, stderr = process.communicate(timeout=5)
    assert process.returncode == 128 + signal.SIGTERM, (
        process.returncode,
        stdout,
        stderr,
    )
    assert (root / "prepare.signal").read_text() == str(int(signal.SIGTERM))
    assert not browser_record.exists()


def run_orphan_cleanup(root: Path) -> None:
    if not sys.platform.startswith("linux"):
        return
    command, env, _socket, _browser_record, _dsh_record = fixture(
        root, dsh_mode="orphan"
    )
    result = subprocess.run(command, env=env, text=True, capture_output=True, timeout=8)
    assert result.returncode == 7, result
    orphan_pid = int((root / "dsh-orphan.ready").read_text())
    assert (root / "dsh-orphan.signal").read_text() == str(int(signal.SIGTERM))
    assert not Path(f"/proc/{orphan_pid}").exists(), "adopted descendant was not reaped"


def run_nested_orphan_cleanup(root: Path) -> None:
    if not sys.platform.startswith("linux"):
        return
    command, env, _socket, _browser_record, _dsh_record = fixture(
        root, dsh_mode="nested-orphan"
    )
    process_ids: list[int] = []
    try:
        result = subprocess.run(
            command, env=env, text=True, capture_output=True, timeout=10
        )
        assert result.returncode == 7, result
        nested = json.loads((root / "dsh-nested.ready").read_text())
        process_ids = [nested["parent"], nested["child"]]
        assert all(
            not Path(f"/proc/{pid}").exists() for pid in process_ids
        ), "newly adopted descendant survived the SIGKILL/reap window"
    finally:
        ready = root / "dsh-nested.ready"
        if not process_ids and ready.exists():
            nested = json.loads(ready.read_text())
            process_ids = [nested["parent"], nested["child"]]
        for pid in process_ids:
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass


def main() -> None:
    # macOS has a short AF_UNIX path limit; keep the fixture root compact.
    with tempfile.TemporaryDirectory(prefix="bsv-", dir="/tmp") as temporary:
        base = Path(temporary)
        for name, check in [
            ("exit", run_exit_propagation),
            ("signal", run_signal_forwarding),
            ("profile-exclusive-lock", run_profile_exclusive_lock),
            ("broker-failure", run_browser_failure),
            ("viewer", run_viewer_mode),
            ("shared-viewer", run_shared_viewer_mode),
            ("prepare", run_prepare_before_secret),
            ("bycli-daemon", run_bycli_daemon_lifecycle),
            ("bycli-connected-status", run_bycli_connected_status),
            ("bycli-startup-gate", run_bycli_startup_gate),
            ("bycli-watchdog-recovery", run_bycli_watchdog_recovery),
            ("bycli-watchdog-transient", run_bycli_watchdog_tolerates_transient_disconnect),
            ("bycli-browser-generation", run_bycli_browser_generation_recovery),
            ("bycli-watchdog-failure", run_bycli_watchdog_failure),
            ("bycli-malformed-status", run_bycli_malformed_status),
            ("timeout", run_readiness_timeout),
            ("prepare-signal", run_prepare_signal),
            ("orphan-cleanup", run_orphan_cleanup),
            ("nested-orphan-cleanup", run_nested_orphan_cleanup),
        ]:
            directory = base / name
            directory.mkdir()
            check(directory)
    print("browser supervisor verification passed")


if __name__ == "__main__":
    main()
