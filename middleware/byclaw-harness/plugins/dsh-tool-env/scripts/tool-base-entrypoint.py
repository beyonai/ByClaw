#!/usr/bin/env python3
"""Tool sandbox (B) entrypoint: keep SSH reachable whatever the workload does.

A reaches B only through sshd (and, behind an HTTP ingress, the WebSocket bridge in
front of it). This root process runs each of them, and every business service the
image declares, as an independent child: one that exits is restarted on its own,
with backoff, and nothing else is touched. The entrypoint itself never exits except
on SIGTERM/SIGINT, because a MicroVM runs it as a plain service with no restart.

Memory: when cgroup v2 is writable, sshd and the bridge live in a `transport` group
with a memory floor and services/tool commands in a `work` group capped below the
machine's memory, so a workload that exhausts memory is reclaimed or killed first.
Otherwise only OOM priorities are set. The result is published for
`byclaw-tool-workload`, which A puts in front of every command it starts on B.

Business layers declare services in /etc/byclaw-tool-sandbox/services.d/*.json:
  {"name": "browser", "command": ["/usr/local/bin/…", "…"], "user": "root",
   "group": "work", "oomScoreAdj": 500, "restart": "always",
   "skipIfEnv": {"BYCLAW_BYCLI_ENABLED": ["false", "0"]}, "env": {"NAME": "value"}}
"""
from __future__ import annotations

import errno
import json
import os
import pwd
import re
import signal
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

LOG_PREFIX = "byclaw-tool-entrypoint:"
TOOL_USER = os.environ.get("BYCLAW_TOOL_ENV_USER", "byclaw")
SERVICES_DIR = Path(os.environ.get("BYCLAW_TOOL_SERVICES_DIR", "/etc/byclaw-tool-sandbox/services.d"))
CGROUP_ROOT = Path(os.environ.get("BYCLAW_TOOL_CGROUP_ROOT", "/sys/fs/cgroup"))
ISOLATION_FILE = Path(os.environ.get("BYCLAW_TOOL_ISOLATION_FILE", "/run/byclaw-tool-sandbox/isolation"))
HOME_SEED = Path(os.environ.get("BYCLAW_TOOL_HOME_SEED", "/usr/local/share/byclaw-tool-home"))
TOOL_HOME = Path(os.environ.get("BYCLAW_TOOL_HOME", "/home/byclaw"))
SSHD_PREPARE = os.environ.get("BYCLAW_TOOL_ENV_SERVER", "/usr/local/bin/byclaw-tool-env-sshd")
SSHD = os.environ.get("BYCLAW_TOOL_ENV_SSHD", "/usr/sbin/sshd")
WS_BRIDGE = os.environ.get("BYCLAW_TOOL_ENV_WS_BRIDGE", "/usr/local/bin/byclaw-tool-env-ws-bridge")
RUN_DIR = Path(os.environ.get("BYCLAW_TOOL_ENV_RUN_DIR", "/run/byclaw-tool-env"))
MIB = 1024 * 1024
TRANSPORT_MEMORY_MIN = int(os.environ.get("BYCLAW_TOOL_TRANSPORT_MEMORY_MIN", str(160 * MIB)))
WORK_MEMORY_RESERVE = int(os.environ.get("BYCLAW_TOOL_WORK_MEMORY_RESERVE", str(256 * MIB)))
WORKLOAD_OOM_SCORE = 500
PROTECTED_OOM_SCORE = -1000
SECRET_ENVIRONMENT = ("BYCLAW_TOOL_ENV_HOST_KEY", "BYCLAW_TOOL_ENV_AUTHORIZED_KEY")
SERVICE_NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")
RESTART_MAX_DELAY = 30.0
HEALTHY_AFTER = 60.0


def log(message: str) -> None:
    sys.stderr.write(f"{LOG_PREFIX} {message}\n")
    sys.stderr.flush()


@dataclass
class Isolation:
    mode: str  # "cgroup" or "oom-score"
    transport: Path | None = None
    work: Path | None = None


@dataclass
class Service:
    name: str
    command: list[str]
    user: str = "root"
    group: str = "work"  # cgroup group: "work" or "transport"
    oom_score_adj: int = WORKLOAD_OOM_SCORE
    restart: str = "always"  # "always" or "on-failure"
    env: dict[str, str] = field(default_factory=dict)


@dataclass
class Child:
    service: Service
    process: subprocess.Popen[bytes] | None = None
    started_at: float = 0.0
    failures: int = 0
    next_start: float = 0.0
    finished: bool = False


def memory_total(meminfo: Path = Path("/proc/meminfo")) -> int:
    for line in meminfo.read_text().splitlines():
        if line.startswith("MemTotal:"):
            return int(line.split()[1]) * 1024
    raise RuntimeError("MemTotal missing")


def work_memory_max(total: int, reserve: int = WORK_MEMORY_RESERVE) -> int:
    """Cap workloads below the machine, but never under half of it."""
    return max(total - reserve, total // 2)


def setup_isolation(root: Path, uid: int, gid: int, total: int) -> Isolation:
    """Create byclaw/{transport,work} under the cgroup root; fall back to OOM scores.

    The groups sit under the root, not under the service's own cgroup: that service is
    not delegated, and with memory_recursiveprot a floor is capped by every ancestor's,
    which the init system leaves at zero. The tool user may write the parent's and
    work's cgroup.procs, because moving a process between groups needs write access to
    their common ancestor's; it may thus also join transport, which protects nothing it
    could not already use.
    """
    try:
        if "memory" not in (root / "cgroup.controllers").read_text().split():
            raise OSError("memory controller unavailable")
        if "memory" not in (root / "cgroup.subtree_control").read_text().split():
            enable_memory_controller(root)
        parent = root / "byclaw"
        parent.mkdir(exist_ok=True)
        if "memory" not in (parent / "cgroup.subtree_control").read_text().split():
            (parent / "cgroup.subtree_control").write_text("+memory")
        transport, work = parent / "transport", parent / "work"
        transport.mkdir(exist_ok=True)
        work.mkdir(exist_ok=True)
        (transport / "memory.min").write_text(str(TRANSPORT_MEMORY_MIN))
        (work / "memory.max").write_text(str(work_memory_max(total)))
        for procs in (parent / "cgroup.procs", work / "cgroup.procs"):
            os.chown(procs, uid, gid)
        return Isolation("cgroup", transport, work)
    except OSError as error:
        log(f"cgroup isolation unavailable ({error}); using OOM priorities only")
        return Isolation("oom-score")


def enable_memory_controller(root: Path) -> None:
    """Delegate memory below root. A container's namespaced root holds processes and
    may not delegate (EBUSY); move them to a leaf first, as an init in a container does.
    A real root is exempt, so a MicroVM never moves its start service."""
    try:
        (root / "cgroup.subtree_control").write_text("+memory")
        return
    except OSError as error:
        if error.errno != errno.EBUSY:
            raise
    leaf = root / "init"
    leaf.mkdir(exist_ok=True)
    for pid in (root / "cgroup.procs").read_text().split():
        try:
            (leaf / "cgroup.procs").write_text(pid)
        except OSError:
            pass  # exited meanwhile, or a kernel thread
    (root / "cgroup.subtree_control").write_text("+memory")


def write_isolation_state(path: Path, isolation: Isolation) -> None:
    """KEY=VALUE lines read by byclaw-tool-workload without forking."""
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [f"mode={isolation.mode}", f"oom={WORKLOAD_OOM_SCORE}"]
    if isolation.work is not None:
        lines.append(f"work={isolation.work}")
    temporary = path.with_suffix(".tmp")
    temporary.write_text("\n".join(lines) + "\n")
    temporary.chmod(0o644)
    temporary.replace(path)


def load_services(directory: Path, environment: dict[str, str]) -> list[Service]:
    """Declared business services; an invalid one is skipped, never fatal to SSH."""
    services: list[Service] = []
    if not directory.is_dir():
        return services
    for path in sorted(directory.glob("*.json")):
        try:
            raw = json.loads(path.read_text())
            name = raw["name"]
            command = raw["command"]
            if not isinstance(name, str) or not SERVICE_NAME.match(name):
                raise ValueError("invalid name")
            if not isinstance(command, list) or not command or not all(isinstance(part, str) for part in command):
                raise ValueError("command must be a non-empty list of strings")
            group = raw.get("group", "work")
            if group not in {"work", "transport"}:
                raise ValueError("group must be work or transport")
            default_score = WORKLOAD_OOM_SCORE if group == "work" else PROTECTED_OOM_SCORE
            score = raw.get("oomScoreAdj", default_score)
            if not isinstance(score, int) or not -1000 <= score <= 1000:
                raise ValueError("oomScoreAdj must be an integer in [-1000, 1000]")
            restart = raw.get("restart", "always")
            if restart not in {"always", "on-failure"}:
                raise ValueError("restart must be always or on-failure")
            user = raw.get("user", TOOL_USER)
            if not isinstance(user, str):
                raise ValueError("user must be a string")
            env = raw.get("env", {})
            if not isinstance(env, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in env.items()):
                raise ValueError("env must map strings to strings")
            skip = raw.get("skipIfEnv", {})
            if not isinstance(skip, dict):
                raise ValueError("skipIfEnv must be an object")
            if any(environment.get(variable) in values for variable, values in skip.items() if isinstance(values, list)):
                log(f"service {name} skipped by its environment condition")
                continue
            services.append(Service(name, command, user, group, score, restart, env))
        except (OSError, ValueError, KeyError, TypeError) as error:
            log(f"ignoring service declaration {path.name}: {error}")
    return services


def seed_home() -> None:
    """Fill a persistent home volume from the image's home, keeping user changes."""
    if not HOME_SEED.is_dir():
        return
    account = pwd.getpwnam(TOOL_USER)
    TOOL_HOME.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(["rsync", "-a", "--ignore-existing", f"{HOME_SEED}/", f"{TOOL_HOME}/"], check=False)
    if result.returncode != 0:
        log(f"home seed copy exited {result.returncode}")
    os.chown(TOOL_HOME, account.pw_uid, account.pw_gid)


def set_oom_score(pid: int | str, score: int) -> None:
    with open(f"/proc/{pid}/oom_score_adj", "w") as handle:
        handle.write(str(score))


def child_preparer(procs: Path | None, score: int, user: str):
    """Runs in the child before exec: join the cgroup and set the OOM score as root, then drop."""
    account = pwd.getpwnam(user)

    def prepare() -> None:
        if procs is not None:
            try:
                procs.write_text(str(os.getpid()))
            except OSError:
                pass
        try:
            set_oom_score("self", score)
        except OSError:
            pass
        if account.pw_uid != os.getuid():
            os.initgroups(account.pw_name, account.pw_gid)
            os.setgid(account.pw_gid)
            os.setuid(account.pw_uid)

    return prepare


class Entrypoint:
    def __init__(self, isolation: Isolation, services: list[Service], environment: dict[str, str]) -> None:
        self.isolation = isolation
        self.children = [Child(service) for service in services]
        self.environment = environment
        self.stopping = 0

    def cgroup_procs(self, service: Service) -> Path | None:
        group = self.isolation.transport if service.group == "transport" else self.isolation.work
        return None if group is None else group / "cgroup.procs"

    def start(self, child: Child) -> None:
        service = child.service
        environment = {**self.environment, **service.env}
        if service.user != "root":
            account = pwd.getpwnam(service.user)
            environment.update(HOME=account.pw_dir, USER=account.pw_name, LOGNAME=account.pw_name)
        try:
            child.process = subprocess.Popen(
                service.command,
                env=environment,
                start_new_session=True,
                preexec_fn=child_preparer(self.cgroup_procs(service), service.oom_score_adj, service.user),
            )
        except OSError as error:
            log(f"{service.name} failed to start: {error}")
            self.schedule_restart(child, time.monotonic())
            return
        child.started_at = time.monotonic()
        log(f"{service.name} started (pid {child.process.pid})")

    def schedule_restart(self, child: Child, now: float) -> None:
        if now - child.started_at >= HEALTHY_AFTER:
            child.failures = 0
        delay = min(RESTART_MAX_DELAY, 2.0 ** child.failures)
        child.failures += 1
        child.next_start = now + delay
        child.process = None

    def exited(self, child: Child, code: int) -> None:
        now = time.monotonic()
        log(f"{child.service.name} exited with {code}")
        if self.stopping:
            child.process = None
            return
        if child.service.restart == "on-failure" and code == 0:
            child.finished = True
            child.process = None
            return
        self.schedule_restart(child, now)

    def reap(self) -> None:
        """Collect every exited descendant, including orphans when this is PID 1."""
        by_pid = {child.process.pid: child for child in self.children if child.process is not None}
        while True:
            try:
                pid, status = os.waitpid(-1, os.WNOHANG)
            except ChildProcessError:
                return
            if pid == 0:
                return
            child = by_pid.get(pid)
            if child is not None:
                assert child.process is not None
                child.process.returncode = os.waitstatus_to_exitcode(status)
                self.exited(child, child.process.returncode)

    def stop(self) -> None:
        for child in self.children:
            if child.process is not None:
                try:
                    os.killpg(child.process.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and any(child.process is not None for child in self.children):
            self.reap()
            time.sleep(0.05)
        for child in self.children:
            if child.process is not None:
                try:
                    os.killpg(child.process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        self.reap()

    def run(self) -> int:
        def request_stop(signum: int, _frame: object) -> None:
            self.stopping = signum

        signal.signal(signal.SIGTERM, request_stop)
        signal.signal(signal.SIGINT, request_stop)
        while not self.stopping:
            now = time.monotonic()
            for child in self.children:
                if child.process is None and not child.finished and now >= child.next_start:
                    self.start(child)
            self.reap()
            time.sleep(0.2)
        log(f"stopping on signal {self.stopping}")
        self.stop()
        return 0


def prepare_sshd(environment: dict[str, str]) -> None:
    """Write keys and sshd_config; retried until it succeeds (keys may arrive late)."""
    delay = 1.0
    while True:
        result = subprocess.run([SSHD_PREPARE], env={**environment, "BYCLAW_TOOL_ENV_PREPARE_ONLY": "1"}, check=False)
        if result.returncode == 0:
            return
        log(f"sshd preparation exited {result.returncode}; retrying in {delay:.0f}s")
        time.sleep(delay)
        delay = min(RESTART_MAX_DELAY, delay * 2)


def transport_services(environment: dict[str, str]) -> list[Service]:
    # sshd starts at score 0: OpenSSH sets its listener to -1000 and gives sessions the
    # score it started with, so helpers and commands stay killable.
    services = [Service("sshd", [SSHD, "-D", "-e", "-f", str(RUN_DIR / "sshd_config")], "root", "transport", 0)]
    ws_port = environment.get("BYCLAW_TOOL_ENV_WS_PORT", "")
    if ws_port:
        port = environment.get("BYCLAW_TOOL_ENV_PORT", "22")
        services.append(Service(
            "ws-bridge",
            ["python3", WS_BRIDGE, "--listen", ws_port, "--target", f"127.0.0.1:{port}"],
            "root", "transport", PROTECTED_OOM_SCORE,
        ))
    return services


def main(argv: list[str]) -> int:
    if argv[1:2] not in ([], ["tools"]):
        log("tool sandbox supports tools mode only")
        return 2
    if os.geteuid() != 0:
        log("tool sandbox requires root to prepare SSH, cgroups and service users")
        return 2
    environment = dict(os.environ)
    seed_home()
    account = pwd.getpwnam(TOOL_USER)
    isolation = setup_isolation(CGROUP_ROOT, account.pw_uid, account.pw_gid, memory_total())
    write_isolation_state(ISOLATION_FILE, isolation)
    try:
        set_oom_score("self", PROTECTED_OOM_SCORE)
    except OSError as error:
        log(f"cannot protect the entrypoint from the OOM killer: {error}")
    log(f"isolation={isolation.mode}")
    prepare_sshd(environment)
    for name in SECRET_ENVIRONMENT:
        environment.pop(name, None)
    services = transport_services(environment) + load_services(SERVICES_DIR, environment)
    return Entrypoint(isolation, services, environment).run()


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
