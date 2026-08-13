#!/usr/bin/env python3
"""Validate the By-Reach routing contract in a built OpenClaw image.

The check is deliberately opt-in: it requires a locally available image and
does not build or pull one. It replaces ``bycli`` and shadows prohibited web
executors only for the final ``by-reach read`` invocation, so the assertion
records the exact command that By-Reach resolves for a generic webpage without
fetching that webpage.

Example (on a Docker-capable build host):

    python3 middleware/openclaw/verify_by_reach_image.py \
      --image ghcr.io/beyonai/byclaw-openclaw:candidate
"""

from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
import tempfile
from pathlib import Path
from typing import Sequence


DEFAULT_URL = "https://q.shanyue.tech/"
EXPECTED_BY_REACH_VERSION = "2.0.0b1"
_MOUNT_TARGET = "/tmp/by-reach-image-validation"
_FORBIDDEN_WEB_EXECUTORS = frozenset(
    {
        "web_fetch",
        "browser",
        "jina",
        "jina-reader",
        "web-reader-mcp",
        "opencli",
        "curl",
        "wget",
        "requests",
    }
)
_FORBIDDEN_WEB_SOURCE_MARKERS = frozenset(
    {
        "aiohttp",
        "curl",
        "http.client",
        "httpx",
        "jina",
        "opencli",
        "os.system",
        "requests",
        "socket.create_connection",
        "subprocess",
        "urlopen",
        "urllib",
        "web-reader",
        "web_fetch",
        "wget",
    }
)
_EXPECTED_WEB_POLICY = [["bycli", "bycli", "web/read", True]]


class ImageValidationError(RuntimeError):
    """The candidate image does not satisfy the By-Reach contract."""


def _run(command: Sequence[str]) -> str:
    completed = subprocess.run(
        list(command),
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip() or "no output"
        raise ImageValidationError(f"command failed ({completed.returncode}): {detail}")
    return completed.stdout


def _docker_run(image: str, *, entrypoint: str, arguments: Sequence[str]) -> list[str]:
    return [
        "docker",
        "run",
        "--rm",
        "--entrypoint",
        entrypoint,
        image,
        *arguments,
    ]


def _parse_doctor_report(payload: str) -> dict[str, object]:
    try:
        report = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise ImageValidationError("byclaw-capability-doctor did not return JSON") from exc
    if not isinstance(report, dict):
        raise ImageValidationError("byclaw-capability-doctor did not return an object")
    if report.get("schemaVersion") != 2:
        raise ImageValidationError("byclaw-capability-doctor must expose schemaVersion 2")
    providers = report.get("providers")
    if not isinstance(providers, dict) or "byReach" not in providers:
        raise ImageValidationError("doctor report must expose providers.byReach")
    if "agentReach" in providers:
        raise ImageValidationError("doctor report must not expose legacy providers.agentReach")
    return report


def _parse_call_log(payload: str) -> list[list[str]]:
    calls: list[list[str]] = []
    for line in payload.splitlines():
        if not line:
            continue
        parts = line.split("\x1f")
        if not parts or parts[-1] != "":
            raise ImageValidationError("bycli probe log is malformed")
        calls.append(parts[:-1])
    return calls


def _assert_exact_web_routing(calls: list[list[str]], url: str) -> None:
    expected_probe = ["list", "-f", "json"]
    expected_read = ["web", "read", "--url", url, "--stdout"]
    for call in calls:
        if any(part.lower() in _FORBIDDEN_WEB_EXECUTORS for part in call):
            raise ImageValidationError(f"forbidden webpage executor in bycli call: {call!r}")
    if calls != [expected_probe, expected_read]:
        raise ImageValidationError(
            "generic webpage routing must invoke only "
            f"bycli {expected_probe!r} then bycli {expected_read!r}; got {calls!r}"
        )


def _assert_installed_web_runtime_contract(payload: str) -> None:
    """Reject an installed generic-web runtime that can bypass byCLI."""

    try:
        report = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise ImageValidationError("installed By-Reach runtime contract is not JSON") from exc
    if not isinstance(report, dict) or report.get("policy") != _EXPECTED_WEB_POLICY:
        raise ImageValidationError("installed By-Reach web policy must be bycli web/read only")

    sources = report.get("sources")
    if not isinstance(sources, dict):
        raise ImageValidationError("installed By-Reach web runtime sources are missing")
    web_source = sources.get("web")
    bycli_source = sources.get("bycli")
    if not isinstance(web_source, str) or not isinstance(bycli_source, str):
        raise ImageValidationError("installed By-Reach web runtime sources are invalid")
    if "from by_reach.bycli import" not in web_source:
        raise ImageValidationError("installed web channel must delegate through by_reach.bycli")

    source = f"{web_source}\n{bycli_source}".lower()
    if any(marker in source for marker in _FORBIDDEN_WEB_SOURCE_MARKERS):
        raise ImageValidationError("installed By-Reach web runtime contains a direct HTTP executor")


def _installed_web_runtime_contract_command() -> list[str]:
    """Return a no-network command that reports installed web routing code."""

    script = "\n".join(
        (
            "import json",
            "from pathlib import Path",
            "import by_reach.bycli as bycli",
            "import by_reach.channels.web as web",
            "from by_reach.executor_policy import POLICIES",
            "print(json.dumps({",
            "    'policy': [[item.name, item.kind.value, item.capability, item.terminal]",
            "               for item in POLICIES['web'].executors],",
            "    'sources': {",
            "        'web': Path(web.__file__).read_text(encoding='utf-8'),",
            "        'bycli': Path(bycli.__file__).read_text(encoding='utf-8'),",
            "    },",
            "}))",
        )
    )
    return ["-c", script]


def _write_bycli_probe(directory: Path) -> Path:
    shim = directory / "bycli"
    shim.write_text(
        "#!/bin/sh\n"
        "set -eu\n"
        'log="${BY_REACH_CALL_LOG:?BY_REACH_CALL_LOG is required}"\n'
        "printf '%s\\037' \"$@\" >> \"$log\"\n"
        "printf '\\n' >> \"$log\"\n"
        "if [ \"$#\" -eq 3 ] && [ \"$1\" = list ] && [ \"$2\" = -f ] && [ \"$3\" = json ]; then\n"
        "  printf '%s\\n' '[{\"command\":\"web/read\",\"access\":\"read\"}]'\n"
        "  exit 0\n"
        "fi\n"
        "if [ \"$#\" -eq 5 ] && [ \"$1\" = web ] && [ \"$2\" = read ] && [ \"$3\" = --url ] && [ \"$5\" = --stdout ]; then\n"
        "  printf '%s\\n' '# By-Reach routing fixture'\n"
        "  exit 0\n"
        "fi\n"
        "printf '%s\\n' 'unexpected bycli invocation' >&2\n"
        "exit 64\n",
        encoding="utf-8",
    )
    shim.chmod(0o755)
    return shim


def _write_forbidden_executor_probes(directory: Path) -> None:
    """Install PATH shadows that record and reject prohibited executors."""

    for executor in _FORBIDDEN_WEB_EXECUTORS:
        shim = directory / executor
        shim.write_text(
            "#!/bin/sh\n"
            "set -eu\n"
            'log="${BY_REACH_FORBIDDEN_CALL_LOG:?BY_REACH_FORBIDDEN_CALL_LOG is required}"\n'
            f"printf '%s\\037' {shlex.quote(executor)} >> \"$log\"\n"
            "for argument in \"$@\"; do\n"
            "  printf '%s\\037' \"$argument\" >> \"$log\"\n"
            "done\n"
            "printf '\\n' >> \"$log\"\n"
            "printf '%s\\n' 'forbidden webpage executor invoked' >&2\n"
            "exit 86\n",
            encoding="utf-8",
        )
        shim.chmod(0o755)


def _prepare_probe_mount(directory: Path) -> tuple[Path, Path]:
    """Prepare a bind mount usable by the image's non-root ``appuser``."""

    directory.chmod(0o755)
    _write_bycli_probe(directory)
    _write_forbidden_executor_probes(directory)
    bycli_log = directory / "bycli-calls.log"
    forbidden_log = directory / "forbidden-web-executors.log"
    for log in (bycli_log, forbidden_log):
        log.touch(exist_ok=False)
        log.chmod(0o666)
    return bycli_log, forbidden_log


def validate_image(image: str, *, url: str = DEFAULT_URL) -> None:
    """Run the opt-in Docker image contract check without fetching ``url``."""

    version = _run(_docker_run(image, entrypoint="by-reach", arguments=["--version"])).strip()
    if version != f"By-Reach v{EXPECTED_BY_REACH_VERSION}":
        raise ImageValidationError(
            f"expected By-Reach v{EXPECTED_BY_REACH_VERSION}, got {version!r}"
        )

    _parse_doctor_report(
        _run(_docker_run(image, entrypoint="byclaw-capability-doctor", arguments=[]))
    )
    _assert_installed_web_runtime_contract(
        _run(
            _docker_run(
                image,
                entrypoint="python3",
                arguments=_installed_web_runtime_contract_command(),
            )
        )
    )

    with tempfile.TemporaryDirectory(prefix="by-reach-image-validation-") as temp_dir:
        host_dir = Path(temp_dir)
        call_log, forbidden_log = _prepare_probe_mount(host_dir)
        shell = (
            f"PATH={_MOUNT_TARGET}:$PATH "
            f"BY_REACH_CALL_LOG={_MOUNT_TARGET}/{call_log.name} "
            f"BY_REACH_FORBIDDEN_CALL_LOG={_MOUNT_TARGET}/{forbidden_log.name} "
            f"by-reach read {shlex.quote(url)} >/dev/null"
        )
        command = [
            "docker",
            "run",
            "--rm",
            "--mount",
            f"type=bind,source={host_dir},target={_MOUNT_TARGET}",
            "--entrypoint",
            "/bin/sh",
            image,
            "-lc",
            shell,
        ]
        _run(command)
        if not call_log.exists():
            raise ImageValidationError("by-reach did not invoke the bycli probe shim")
        forbidden_calls = _parse_call_log(forbidden_log.read_text(encoding="utf-8"))
        if forbidden_calls:
            raise ImageValidationError(
                f"By-Reach invoked forbidden webpage executor: {forbidden_calls!r}"
            )
        _assert_exact_web_routing(_parse_call_log(call_log.read_text(encoding="utf-8")), url)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--image",
        default=os.environ.get("BY_REACH_IMAGE"),
        help="locally available ByClaw OpenClaw image (or set BY_REACH_IMAGE)",
    )
    parser.add_argument("--url", default=DEFAULT_URL, help="generic public URL to route")
    args = parser.parse_args()
    if not args.image:
        parser.error("--image is required (or set BY_REACH_IMAGE)")
    return args


def main() -> int:
    args = parse_args()
    try:
        validate_image(args.image, url=args.url)
    except (ImageValidationError, OSError) as exc:
        print(f"By-Reach image validation failed: {exc}")
        return 1
    print(f"By-Reach image validation passed: {args.image}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
