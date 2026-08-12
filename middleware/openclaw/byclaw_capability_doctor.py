#!/usr/bin/env python3
"""Aggregate ByClaw capability health without activating optional services."""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Callable, NamedTuple


class CommandResult(NamedTuple):
    returncode: int
    stdout: str
    stderr: str


CommandRunner = Callable[[list[str], float], CommandResult]

STATUS_MAP = {
    "ok": "ready",
    "warn": "degraded",
    "off": "configuration_required",
    "error": "unavailable",
}
MIN_TIMEOUT_SECONDS = 0.1
MAX_TIMEOUT_SECONDS = 60.0
BYCLI_SCHEMA_VERSION = "1.0"
BYCLI_STATES = {
    "stopped",
    "daemon_stale",
    "extension_disconnected",
    "profile_required",
    "profile_disconnected",
    "ready",
    "degraded",
}
BYCLI_ERROR_CODES = {
    "daemon_status_timeout",
    "daemon_http_error",
    "invalid_daemon_response",
    "daemon_unreachable",
    "invalid_daemon_config",
    "invalid_arguments",
}
BYCLI_OVERRIDDEN_AGENT_REACH_BACKENDS = {"jina reader", "opencli"}


def run_command(argv: list[str], timeout_seconds: float) -> CommandResult:
    completed = subprocess.run(
        argv,
        capture_output=True,
        check=False,
        text=True,
        timeout=timeout_seconds,
    )
    return CommandResult(completed.returncode, completed.stdout, completed.stderr)


def error_result(code: str, message: str) -> dict[str, object]:
    return {
        "status": "unavailable",
        "error": {"code": code, "message": message},
    }


def degraded_result(code: str, message: str) -> dict[str, object]:
    return {
        "status": "degraded",
        "error": {"code": code, "message": message},
    }


def resolve_agent_reach_effective_backend(
    diagnostic_backend: object,
    available_backends: object,
) -> object:
    if (
        isinstance(diagnostic_backend, str)
        and diagnostic_backend.strip().casefold() in BYCLI_OVERRIDDEN_AGENT_REACH_BACKENDS
    ):
        return "bycli"
    if diagnostic_backend is None and isinstance(available_backends, list):
        for backend in available_backends:
            if (
                isinstance(backend, str)
                and backend.strip().casefold() in BYCLI_OVERRIDDEN_AGENT_REACH_BACKENDS
            ):
                return "bycli"
    return diagnostic_backend


def check_cli_version(
    command_runner: CommandRunner,
    binary: str,
    timeout_seconds: float,
) -> dict[str, object]:
    try:
        result = command_runner([binary, "--version"], timeout_seconds)
    except FileNotFoundError:
        return error_result("binary_missing", f"{binary} is not installed")
    except subprocess.TimeoutExpired:
        return error_result("check_timeout", f"{binary} version check timed out")
    except OSError:
        return error_result(
            "version_check_failed",
            f"{binary} version check could not be executed",
        )

    if result.returncode != 0:
        return error_result(
            "version_check_failed",
            f"{binary} version check returned a non-zero exit code",
        )
    return {"status": "ready", "version": result.stdout.strip()}


def check_agent_reach(command_runner: CommandRunner, timeout_seconds: float) -> dict[str, object]:
    try:
        result = command_runner(["agent-reach", "doctor", "--json"], timeout_seconds)
    except FileNotFoundError:
        return error_result("binary_missing", "agent-reach is not installed")
    except subprocess.TimeoutExpired:
        return error_result("check_timeout", "agent-reach doctor timed out")
    except OSError:
        return error_result("doctor_failed", "agent-reach doctor could not be executed")

    if result.returncode != 0:
        return error_result("doctor_failed", "agent-reach doctor returned a non-zero exit code")

    try:
        raw_channels = json.loads(result.stdout)
    except (json.JSONDecodeError, TypeError):
        return error_result("invalid_probe_output", "agent-reach doctor returned invalid JSON")
    if not isinstance(raw_channels, dict):
        return error_result("invalid_probe_output", "agent-reach doctor JSON must be an object")

    channels: dict[str, dict[str, object]] = {}
    for channel_id, raw in raw_channels.items():
        if not isinstance(raw, dict):
            continue
        diagnostic_backend = raw.get("active_backend")
        available_backends = raw.get("backends", [])
        channel_id_text = str(channel_id)
        effective_backend = (
            "bycli"
            if channel_id_text.casefold() == "web"
            else resolve_agent_reach_effective_backend(
                diagnostic_backend,
                available_backends,
            )
        )
        normalized = {
            "status": STATUS_MAP.get(str(raw.get("status")), "unavailable"),
            "name": raw.get("name"),
            "message": raw.get("message"),
            "tier": raw.get("tier"),
            "backends": available_backends,
            "diagnosticBackend": diagnostic_backend,
            "effectiveBackend": effective_backend,
            # Compatibility alias for consumers written before effectiveBackend existed.
            "activeBackend": effective_backend,
        }
        channels[channel_id_text] = {key: value for key, value in normalized.items() if value is not None}

    if not channels:
        return error_result("invalid_probe_output", "agent-reach doctor returned no channels")

    mandatory_channels = [channel for channel in channels.values() if channel.get("tier") == 0]
    health_channels = mandatory_channels or list(channels.values())
    states = {channel["status"] for channel in health_channels}
    if states == {"ready"}:
        status = "ready"
    elif "ready" in states or "degraded" in states or "configuration_required" in states:
        status = "degraded"
    else:
        status = "unavailable"
    return {"status": status, "channels": channels}


def normalize_timeout(raw_timeout: object) -> float:
    try:
        timeout_seconds = float(raw_timeout)
    except (TypeError, ValueError) as error:
        raise ValueError("timeout must be a number") from error
    if not math.isfinite(timeout_seconds):
        raise ValueError("timeout must be finite")
    if not MIN_TIMEOUT_SECONDS <= timeout_seconds <= MAX_TIMEOUT_SECONDS:
        raise ValueError(
            f"timeout must be between {MIN_TIMEOUT_SECONDS} and {MAX_TIMEOUT_SECONDS} seconds"
        )
    return timeout_seconds


def is_optional_string(value: object) -> bool:
    return value is None or isinstance(value, str)


def is_integer(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def is_valid_bycli_status(payload: object) -> bool:
    if not isinstance(payload, dict):
        return False
    if payload.get("schemaVersion") != BYCLI_SCHEMA_VERSION:
        return False
    if payload.get("command") != "daemon.status":
        return False
    if not isinstance(payload.get("ok"), bool) or payload.get("state") not in BYCLI_STATES:
        return False

    cli = payload.get("cli")
    daemon = payload.get("daemon")
    extension = payload.get("extension")
    profiles = payload.get("profiles")
    issues = payload.get("issues")
    if not isinstance(cli, dict) or not isinstance(cli.get("version"), str) or not cli["version"]:
        return False
    if not isinstance(daemon, dict):
        return False
    if (
        daemon.get("state") not in {"stopped", "running", "unknown"}
        or "version" not in daemon
        or not is_optional_string(daemon.get("version"))
        or not is_integer(daemon.get("port"))
        or not isinstance(daemon.get("stale"), bool)
    ):
        return False
    if not isinstance(extension, dict):
        return False
    if (
        extension.get("state") not in {"unknown", "disconnected", "connected"}
        or "version" not in extension
        or not is_optional_string(extension.get("version"))
        or extension.get("compatibility") not in {"unknown", "compatible", "incompatible"}
    ):
        return False
    if not isinstance(profiles, dict):
        return False
    if (
        not is_integer(profiles.get("connectedCount"))
        or profiles["connectedCount"] < 0
        or not isinstance(profiles.get("selectionRequired"), bool)
        or not isinstance(issues, list)
    ):
        return False

    if payload["ok"] is False:
        error = payload.get("error")
        if not isinstance(error, dict):
            return False
        if not isinstance(error.get("code"), str) or not isinstance(error.get("message"), str):
            return False
    return True


def check_bycli(command_runner: CommandRunner, timeout_seconds: float) -> dict[str, object]:
    try:
        result = command_runner(["bycli", "daemon", "status", "--json"], timeout_seconds)
    except FileNotFoundError:
        return error_result("binary_missing", "bycli is not installed")
    except subprocess.TimeoutExpired:
        return degraded_result("check_timeout", "byCLI daemon status check timed out")
    except OSError:
        return error_result("status_check_failed", "byCLI daemon status check could not be executed")

    try:
        payload = json.loads(result.stdout)
    except (json.JSONDecodeError, TypeError):
        return degraded_result("invalid_probe_output", "byCLI daemon status returned invalid JSON")
    if not is_valid_bycli_status(payload):
        return degraded_result("invalid_probe_output", "byCLI daemon status returned an invalid payload")
    if result.returncode != 0 and payload["ok"] is True:
        return degraded_result("invalid_probe_output", "byCLI daemon status exit code did not match its payload")

    daemon = payload["daemon"]
    extension = payload["extension"]
    if payload["ok"] is False:
        raw_error_code = payload["error"]["code"]
        error_code = raw_error_code if raw_error_code in BYCLI_ERROR_CODES else "bycli_status_error"
        normalized_status = "degraded"
        error = {
            "code": error_code,
            "message": "byCLI daemon status check reported an error",
        }
    else:
        normalized_status = {
            "ready": "ready",
            "stopped": "available_on_demand",
            "extension_disconnected": "available_on_demand",
            "profile_required": "configuration_required",
            "profile_disconnected": "configuration_required",
            "daemon_stale": "degraded",
            "degraded": "degraded",
        }[payload["state"]]
        error = None

    return {
        "status": normalized_status,
        "version": payload["cli"]["version"],
        "daemon": daemon["state"],
        "chrome": "running" if extension["state"] == "connected" else "stopped",
        "extension": extension["state"],
        **({"error": error} if error is not None else {}),
    }


def check_wecom(command_runner: CommandRunner, timeout_seconds: float) -> dict[str, object]:
    version = check_cli_version(command_runner, "wecom-cli", timeout_seconds)
    if version["status"] != "ready":
        return version
    return {
        "status": "installed",
        "version": version["version"],
        "installation": "ready",
        "authorization": "not_checked",
    }


def check_lark(command_runner: CommandRunner, timeout_seconds: float) -> dict[str, object]:
    version = check_cli_version(command_runner, "lark-cli", timeout_seconds)
    if version["status"] != "ready":
        return version

    try:
        auth_result = command_runner(
            ["lark-cli", "auth", "status", "--json"],
            timeout_seconds,
        )
    except subprocess.TimeoutExpired:
        return {
            "status": "degraded",
            "version": version["version"],
            "installation": "ready",
            "authorization": "unknown",
            "error": {"code": "check_timeout", "message": "lark-cli auth status timed out"},
        }
    except OSError:
        return {
            "status": "degraded",
            "version": version["version"],
            "installation": "ready",
            "authorization": "unknown",
            "error": {
                "code": "authorization_check_failed",
                "message": "lark-cli auth status could not be executed",
            },
        }

    if auth_result.returncode != 0:
        return {
            "status": "degraded",
            "version": version["version"],
            "installation": "ready",
            "authorization": "unknown",
            "error": {
                "code": "authorization_check_failed",
                "message": "lark-cli auth status returned a non-zero exit code",
            },
        }

    try:
        auth_payload = json.loads(auth_result.stdout)
    except (json.JSONDecodeError, TypeError):
        auth_payload = None

    identity = auth_payload.get("identity") if isinstance(auth_payload, dict) else None
    identities = auth_payload.get("identities") if isinstance(auth_payload, dict) else None
    if (
        not isinstance(identity, str)
        or identity not in {"user", "bot", "none"}
        or not isinstance(identities, dict)
    ):
        return {
            "status": "degraded",
            "version": version["version"],
            "installation": "ready",
            "authorization": "unknown",
            "error": {
                "code": "invalid_probe_output",
                "message": "lark-cli auth status returned an invalid JSON payload",
            },
        }

    if identity == "none":
        return {
            "status": "authorization_required",
            "version": version["version"],
            "installation": "ready",
            "authorization": "required",
        }

    selected_identity = identities.get(identity)
    available = selected_identity.get("available") if isinstance(selected_identity, dict) else None
    if not isinstance(available, bool):
        return {
            "status": "degraded",
            "version": version["version"],
            "installation": "ready",
            "authorization": "unknown",
            "error": {
                "code": "invalid_probe_output",
                "message": "lark-cli auth status returned an invalid JSON payload",
            },
        }

    if not available:
        return {
            "status": "authorization_required",
            "version": version["version"],
            "installation": "ready",
            "authorization": "required",
        }
    return {
        "status": "ready",
        "version": version["version"],
        "installation": "ready",
        "authorization": "ready",
    }


def check_dws(command_runner: CommandRunner, timeout_seconds: float) -> dict[str, object]:
    version = check_cli_version(command_runner, "dws", timeout_seconds)
    if version["status"] != "ready":
        return version

    try:
        auth_result = command_runner(
            ["dws", "auth", "status", "--format", "json"],
            timeout_seconds,
        )
    except subprocess.TimeoutExpired:
        return {
            "status": "degraded",
            "version": version["version"],
            "installation": "ready",
            "authorization": "unknown",
            "error": {"code": "check_timeout", "message": "dws auth status timed out"},
        }
    except OSError:
        return {
            "status": "degraded",
            "version": version["version"],
            "installation": "ready",
            "authorization": "unknown",
            "error": {
                "code": "authorization_check_failed",
                "message": "dws auth status could not be executed",
            },
        }

    if auth_result.returncode != 0:
        return {
            "status": "authorization_required",
            "version": version["version"],
            "installation": "ready",
            "authorization": "required",
        }
    try:
        auth_payload = json.loads(auth_result.stdout)
    except (json.JSONDecodeError, TypeError):
        auth_payload = None
    if not isinstance(auth_payload, dict) or not isinstance(
        auth_payload.get("authenticated"), bool
    ) or not isinstance(auth_payload.get("token_valid"), bool):
        return {
            "status": "degraded",
            "version": version["version"],
            "installation": "ready",
            "authorization": "unknown",
            "error": {
                "code": "invalid_probe_output",
                "message": "dws auth status returned an invalid JSON payload",
            },
        }
    if not auth_payload["authenticated"] or not auth_payload["token_valid"]:
        return {
            "status": "authorization_required",
            "version": version["version"],
            "installation": "ready",
            "authorization": "required",
        }
    return {
        "status": "ready",
        "version": version["version"],
        "installation": "ready",
        "authorization": "ready",
    }


def build_report(
    agent_reach: dict[str, object],
    bycli: dict[str, object],
    wecom: dict[str, object],
    lark: dict[str, object],
    dws: dict[str, object],
) -> dict[str, object]:
    enabled_states = [str(agent_reach.get("status")), str(bycli.get("status"))]
    agent_channels = agent_reach.get("channels")
    optional_configuration_required = isinstance(agent_channels, dict) and any(
        isinstance(channel, dict)
        and channel.get("tier") != 0
        and channel.get("status") == "configuration_required"
        for channel in agent_channels.values()
    )
    if all(state == "ready" for state in enabled_states) and not optional_configuration_required:
        overall_status = "ready"
    elif all(state in {"ready", "available_on_demand", "configuration_required"} for state in enabled_states):
        overall_status = "available"
    elif all(state == "unavailable" for state in enabled_states):
        overall_status = "unavailable"
    else:
        overall_status = "degraded"

    return {
        "overallStatus": overall_status,
        "checkedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "providers": {
            "agentReach": agent_reach,
            "bycli": bycli,
            "wecom": wecom,
            "lark": lark,
            "dws": dws,
        },
    }


def collect_report(
    agent_reach_check: Callable[[], dict[str, object]],
    bycli_check: Callable[[], dict[str, object]],
    wecom_check: Callable[[], dict[str, object]],
    lark_check: Callable[[], dict[str, object]],
    dws_check: Callable[[], dict[str, object]],
) -> dict[str, object]:
    checks = {
        "agentReach": agent_reach_check,
        "bycli": bycli_check,
        "wecom": wecom_check,
        "lark": lark_check,
        "dws": dws_check,
    }
    results: dict[str, dict[str, object]] = {}
    with ThreadPoolExecutor(max_workers=len(checks)) as executor:
        futures = {name: executor.submit(check) for name, check in checks.items()}
        for name, future in futures.items():
            try:
                results[name] = future.result()
            except Exception:
                results[name] = error_result(
                    "internal_check_failed",
                    f"{name} capability check failed unexpectedly",
                )
    return build_report(
        results["agentReach"],
        results["bycli"],
        results["wecom"],
        results["lark"],
        results["dws"],
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--timeout",
        default=os.environ.get("BYCLAW_CAPABILITY_DOCTOR_TIMEOUT_SECONDS", "60"),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        timeout_seconds = normalize_timeout(args.timeout)
    except ValueError as error:
        configuration_error = error_result("invalid_configuration", str(error))
        print(
            json.dumps(
                build_report(
                    configuration_error,
                    configuration_error,
                    configuration_error,
                    configuration_error,
                    configuration_error,
                ),
                ensure_ascii=False,
            )
        )
        return 0

    report = collect_report(
        lambda: check_agent_reach(run_command, timeout_seconds),
        lambda: check_bycli(run_command, timeout_seconds),
        lambda: check_wecom(run_command, timeout_seconds),
        lambda: check_lark(run_command, timeout_seconds),
        lambda: check_dws(run_command, timeout_seconds),
    )
    print(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
