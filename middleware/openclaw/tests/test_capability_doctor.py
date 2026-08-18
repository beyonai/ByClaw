import importlib.util
import json
import subprocess
import threading
import unittest
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).parents[1] / "byclaw_capability_doctor.py"
SPEC = importlib.util.spec_from_file_location("byclaw_capability_doctor", MODULE_PATH)
doctor = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(doctor)


class CapabilityDoctorTest(unittest.TestCase):
    def test_by_reach_maps_channel_statuses(self):
        payload = {
            "github": {"status": "ok", "active_backend": "gh", "message": "available"},
            "twitter": {"status": "warn", "message": "limited"},
            "reddit": {"status": "off", "message": "login required"},
            "rss": {"status": "error", "message": "broken"},
        }

        result = doctor.check_by_reach(
            lambda argv, timeout: doctor.CommandResult(0, json.dumps(payload), ""),
            1.0,
        )

        self.assertEqual("degraded", result["status"])
        self.assertEqual("ready", result["channels"]["github"]["status"])
        self.assertEqual("degraded", result["channels"]["twitter"]["status"])
        self.assertEqual("configuration_required", result["channels"]["reddit"]["status"])
        self.assertEqual("unavailable", result["channels"]["rss"]["status"])
        self.assertEqual("gh", result["channels"]["github"]["activeBackend"])

    def test_by_reach_separates_diagnostic_and_effective_backends(self):
        payload = {
            "web": {"status": "ok", "backends": ["bycli"], "active_backend": "bycli"},
            "xiaohongshu": {"status": "ok", "active_backend": "bycli"},
            "reddit": {"status": "off", "backends": ["rdt-cli", "bycli"]},
            "github": {"status": "ok", "active_backend": "gh"},
        }

        result = doctor.check_by_reach(
            lambda argv, timeout: doctor.CommandResult(0, json.dumps(payload), ""),
            1.0,
        )

        web = result["channels"]["web"]
        self.assertEqual("bycli", web["diagnosticBackend"])
        self.assertEqual(["bycli"], web["backends"])
        self.assertEqual("bycli", web["effectiveBackend"])
        self.assertEqual("bycli", web["activeBackend"])

        xiaohongshu = result["channels"]["xiaohongshu"]
        self.assertEqual("bycli", xiaohongshu["diagnosticBackend"])
        self.assertEqual("bycli", xiaohongshu["effectiveBackend"])
        self.assertEqual("bycli", xiaohongshu["activeBackend"])

        reddit = result["channels"]["reddit"]
        self.assertNotIn("diagnosticBackend", reddit)
        self.assertNotIn("effectiveBackend", reddit)
        self.assertNotIn("activeBackend", reddit)

        github = result["channels"]["github"]
        self.assertEqual("gh", github["diagnosticBackend"])
        self.assertEqual("gh", github["effectiveBackend"])
        self.assertEqual("gh", github["activeBackend"])

    def test_by_reach_preserves_the_web_executor_reported_by_v2(self):
        payload = {
            "web": {"status": "ok", "backends": ["bycli"], "active_backend": "bycli"},
            "github": {"status": "ok", "active_backend": "gh"},
        }

        result = doctor.check_by_reach(
            lambda argv, timeout: doctor.CommandResult(0, json.dumps(payload), ""),
            1.0,
        )

        web = result["channels"]["web"]
        self.assertEqual("bycli", web["diagnosticBackend"])
        self.assertEqual(["bycli"], web["backends"])
        self.assertEqual("bycli", web["effectiveBackend"])
        self.assertEqual("bycli", web["activeBackend"])
        self.assertEqual("gh", result["channels"]["github"]["effectiveBackend"])

    def test_by_reach_invalid_json_is_isolated(self):
        result = doctor.check_by_reach(
            lambda argv, timeout: doctor.CommandResult(0, "not-json", ""),
            1.0,
        )

        self.assertEqual("unavailable", result["status"])
        self.assertEqual("invalid_probe_output", result["error"]["code"])

    def test_by_reach_timeout_is_isolated(self):
        def timeout(argv, timeout):
            raise subprocess.TimeoutExpired(argv, timeout)

        result = doctor.check_by_reach(timeout, 1.0)

        self.assertEqual("unavailable", result["status"])
        self.assertEqual("check_timeout", result["error"]["code"])

    def test_by_reach_nonzero_exit_is_isolated(self):
        result = doctor.check_by_reach(
            lambda argv, timeout: doctor.CommandResult(1, "", "failed"),
            1.0,
        )

        self.assertEqual("unavailable", result["status"])
        self.assertEqual("doctor_failed", result["error"]["code"])

    def test_optional_unconfigured_channels_do_not_degrade_by_reach(self):
        payload = {
            "web": {"status": "ok", "tier": 0, "message": "available"},
            "github": {"status": "ok", "tier": 0, "message": "available"},
            "reddit": {"status": "off", "tier": 2, "message": "not configured"},
        }

        result = doctor.check_by_reach(
            lambda argv, timeout: doctor.CommandResult(0, json.dumps(payload), ""),
            1.0,
        )

        self.assertEqual("ready", result["status"])
        self.assertEqual("configuration_required", result["channels"]["reddit"]["status"])

        report = doctor.build_report(
            result,
            {"status": "ready", "daemon": "running"},
            {"status": "installed"},
            {"status": "authorization_required"},
            {"status": "ready"},
        )
        self.assertEqual("available", report["overallStatus"])

    def test_bycli_disconnected_extension_is_available_on_demand_and_passive(self):
        commands = []

        def run_command(argv, timeout):
            commands.append(argv)
            return doctor.CommandResult(
                0,
                json.dumps(self.bycli_payload("extension_disconnected")),
                "",
            )

        result = doctor.check_bycli(run_command, 1.0)

        self.assertEqual([["bycli", "daemon", "status", "--json"]], commands)
        self.assertEqual("available_on_demand", result["status"])
        self.assertEqual("2.1.13", result["version"])
        self.assertEqual("running", result["daemon"])
        self.assertEqual("stopped", result["chrome"])
        self.assertEqual("disconnected", result["extension"])
        self.assertNotIn("doctor", " ".join(commands[0]))
        self.assertNotIn("recover", " ".join(commands[0]))

    @staticmethod
    def bycli_payload(state, *, ok=True, error=None):
        daemon_state = "stopped" if state == "stopped" else "running"
        extension_state = "connected" if state in {
            "ready",
            "daemon_stale",
            "profile_required",
            "degraded",
        } else "disconnected" if state in {
            "extension_disconnected",
            "profile_disconnected",
        } else "unknown"
        payload = {
            "schemaVersion": "1.0",
            "command": "daemon.status",
            "ok": ok,
            "state": state,
            "cli": {"version": "2.1.13"},
            "daemon": {
                "state": daemon_state,
                "version": "2.1.13" if daemon_state == "running" else None,
                "port": 19825,
                "stale": state == "daemon_stale",
            },
            "extension": {
                "state": extension_state,
                "version": "2.1.13" if extension_state == "connected" else None,
                "compatibility": "compatible" if extension_state == "connected" else "unknown",
            },
            "profiles": {
                "connectedCount": 1 if extension_state == "connected" else 0,
                "selectionRequired": state == "profile_required",
            },
            "issues": [],
        }
        if error is not None:
            payload["error"] = error
        return payload

    def test_bycli_stopped_daemon_is_available_on_demand(self):
        result = doctor.check_bycli(
            lambda argv, timeout: doctor.CommandResult(
                0,
                json.dumps(self.bycli_payload("stopped")),
                "",
            ),
            1.0,
        )

        self.assertEqual("available_on_demand", result["status"])
        self.assertEqual("stopped", result["daemon"])
        self.assertEqual("stopped", result["chrome"])
        self.assertEqual("unknown", result["extension"])

    def test_bycli_connected_extension_is_ready(self):
        result = doctor.check_bycli(
            lambda argv, timeout: doctor.CommandResult(
                0,
                json.dumps(self.bycli_payload("ready")),
                "",
            ),
            1.0,
        )

        self.assertEqual("ready", result["status"])
        self.assertEqual("running", result["chrome"])
        self.assertEqual("connected", result["extension"])

    def test_bycli_profile_states_require_configuration(self):
        for state in ("profile_required", "profile_disconnected"):
            with self.subTest(state=state):
                result = doctor.check_bycli(
                    lambda argv, timeout: doctor.CommandResult(
                        0,
                        json.dumps(self.bycli_payload(state)),
                        "",
                    ),
                    1.0,
                )

                self.assertEqual("configuration_required", result["status"])

    def test_bycli_stale_and_incompatible_states_are_degraded(self):
        for state in ("daemon_stale", "degraded"):
            with self.subTest(state=state):
                result = doctor.check_bycli(
                    lambda argv, timeout: doctor.CommandResult(
                        0,
                        json.dumps(self.bycli_payload(state)),
                        "",
                    ),
                    1.0,
                )

                self.assertEqual("degraded", result["status"])

    def test_bycli_missing_binary_is_unavailable(self):
        def missing(argv, timeout):
            raise FileNotFoundError("bycli")

        result = doctor.check_bycli(missing, 1.0)

        self.assertEqual("unavailable", result["status"])
        self.assertEqual("binary_missing", result["error"]["code"])

    def test_bycli_command_timeout_is_degraded(self):
        result = doctor.check_bycli(
            lambda argv, timeout: (_ for _ in ()).throw(subprocess.TimeoutExpired(argv, timeout)),
            1.0,
        )

        self.assertEqual("degraded", result["status"])
        self.assertEqual("check_timeout", result["error"]["code"])

    def test_bycli_error_envelope_is_degraded_and_sanitized(self):
        payload = self.bycli_payload(
            "degraded",
            ok=False,
            error={"code": "daemon_status_timeout", "message": "Timed out while requesting daemon status."},
        )
        result = doctor.check_bycli(
            lambda argv, timeout: doctor.CommandResult(75, json.dumps(payload), "secret-stderr"),
            1.0,
        )

        self.assertEqual("degraded", result["status"])
        self.assertEqual("daemon_status_timeout", result["error"]["code"])
        self.assertNotIn("secret-stderr", json.dumps(result))

    def test_bycli_rejects_malformed_daemon_status_payloads(self):
        payloads = (
            {},
            {**self.bycli_payload("ready"), "schemaVersion": "2.0"},
            {**self.bycli_payload("ready"), "command": "doctor"},
            {**self.bycli_payload("ready"), "state": "unknown-state"},
            {**self.bycli_payload("ready"), "cli": {"version": 2}},
            {**self.bycli_payload("ready"), "daemon": {}},
            {**self.bycli_payload("ready"), "extension": {"state": "connected"}},
            {**self.bycli_payload("ready"), "profiles": {"connectedCount": "1"}},
            {**self.bycli_payload("ready"), "issues": {}},
        )

        for payload in payloads:
            with self.subTest(payload=payload):
                result = doctor.check_bycli(
                    lambda argv, timeout: doctor.CommandResult(0, json.dumps(payload), "secret-stderr"),
                    1.0,
                )
                self.assertEqual("degraded", result["status"])
                self.assertEqual("invalid_probe_output", result["error"]["code"])
                self.assertNotIn("secret-stderr", json.dumps(result))

    def test_bycli_requires_nullable_version_fields_to_be_present(self):
        for section in ("daemon", "extension"):
            with self.subTest(section=section):
                payload = self.bycli_payload("ready")
                del payload[section]["version"]

                result = doctor.check_bycli(
                    lambda argv, timeout: doctor.CommandResult(0, json.dumps(payload), ""),
                    1.0,
                )

                self.assertEqual("degraded", result["status"])
                self.assertEqual("invalid_probe_output", result["error"]["code"])

    def test_bycli_rejects_invalid_json_and_nonzero_success_envelope(self):
        cases = (
            doctor.CommandResult(1, "not-json secret-output", "secret-stderr"),
            doctor.CommandResult(1, json.dumps(self.bycli_payload("ready")), "secret-stderr"),
        )

        for command_result in cases:
            with self.subTest(stdout=command_result.stdout):
                result = doctor.check_bycli(lambda argv, timeout: command_result, 1.0)
                self.assertEqual("degraded", result["status"])
                self.assertEqual("invalid_probe_output", result["error"]["code"])
                serialized = json.dumps(result)
                self.assertNotIn("secret-output", serialized)
                self.assertNotIn("secret-stderr", serialized)

    def test_timeout_must_be_finite_and_bounded(self):
        for value in ("0", "-1", "61", "nan", "inf", "invalid"):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    doctor.normalize_timeout(value)

        self.assertEqual(0.1, doctor.normalize_timeout("0.1"))
        self.assertEqual(60.0, doctor.normalize_timeout("60"))

    def test_default_timeout_is_sixty_seconds(self):
        with patch.dict("os.environ", {}, clear=True), patch("sys.argv", ["doctor"]):
            args = doctor.parse_args()

        self.assertEqual("60", args.timeout)

    def test_wecom_reports_installation_without_claiming_authorization(self):
        result = doctor.check_wecom(
            lambda argv, timeout: doctor.CommandResult(0, "wecom-cli 0.1.9\n", ""),
            1.0,
        )

        self.assertEqual("installed", result["status"])
        self.assertEqual("wecom-cli 0.1.9", result["version"])
        self.assertEqual("ready", result["installation"])
        self.assertEqual("not_checked", result["authorization"])

    def test_wecom_missing_binary_is_unavailable(self):
        def missing(argv, timeout):
            raise FileNotFoundError("wecom-cli")

        result = doctor.check_wecom(missing, 1.0)

        self.assertEqual("unavailable", result["status"])
        self.assertEqual("binary_missing", result["error"]["code"])

    def test_lark_reports_ready_for_available_selected_identity_with_passive_json_probe(self):
        for identity in ("user", "bot"):
            with self.subTest(identity=identity):
                commands = []

                def run_command(argv, timeout):
                    commands.append(argv)
                    if argv == ["lark-cli", "--version"]:
                        return doctor.CommandResult(0, "1.0.67\n", "")
                    if argv == ["lark-cli", "auth", "status", "--json"]:
                        return doctor.CommandResult(
                            0,
                            json.dumps(
                                {
                                    "appId": "secret-app-id",
                                    "brand": "lark",
                                    "defaultAs": identity,
                                    "identities": {
                                        "user": {"status": "active", "available": identity == "user"},
                                        "bot": {"status": "active", "available": identity == "bot"},
                                    },
                                    "identity": identity,
                                }
                            ),
                            "",
                        )
                    self.fail(f"unexpected command: {argv}")

                result = doctor.check_lark(run_command, 1.0)

                self.assertEqual(
                    [
                        ["lark-cli", "--version"],
                        ["lark-cli", "auth", "status", "--json"],
                    ],
                    commands,
                )
                self.assertEqual("ready", result["status"])
                self.assertEqual("1.0.67", result["version"])
                self.assertEqual("ready", result["installation"])
                self.assertEqual("ready", result["authorization"])
                self.assertNotIn("secret-app-id", json.dumps(result))
                self.assertNotIn(identity, json.dumps(result))

    def test_lark_identity_none_requires_authorization(self):
        payload = {
            "appId": "secret-app-id",
            "brand": "lark",
            "defaultAs": "user",
            "identities": {
                "user": {"status": "inactive", "available": False},
                "bot": {"status": "inactive", "available": False},
            },
            "identity": "none",
        }

        def run_command(argv, timeout):
            if argv == ["lark-cli", "--version"]:
                return doctor.CommandResult(0, "1.0.67", "")
            return doctor.CommandResult(0, json.dumps(payload), "")

        result = doctor.check_lark(run_command, 1.0)

        self.assertEqual("authorization_required", result["status"])
        self.assertEqual("required", result["authorization"])
        self.assertNotIn("secret-app-id", json.dumps(result))

    def test_lark_unavailable_selected_identity_requires_authorization(self):
        payload = {
            "identities": {
                "user": {"status": "inactive", "available": False},
                "bot": {"status": "active", "available": True},
            },
            "identity": "user",
        }

        def run_command(argv, timeout):
            if argv == ["lark-cli", "--version"]:
                return doctor.CommandResult(0, "1.0.67", "")
            return doctor.CommandResult(0, json.dumps(payload), "")

        result = doctor.check_lark(run_command, 1.0)

        self.assertEqual("authorization_required", result["status"])
        self.assertEqual("required", result["authorization"])

    def test_lark_invalid_auth_payload_is_degraded_and_sanitized(self):
        invalid_payloads = (
            "not-json secret-app-id",
            json.dumps([]),
            json.dumps({"identity": "user"}),
            json.dumps({"identity": "user", "identities": []}),
            json.dumps({"identity": "invalid", "identities": {}}),
            json.dumps({"identity": [], "identities": {}}),
            json.dumps({"identity": "user", "identities": {"bot": {"available": True}}}),
            json.dumps({"identity": "user", "identities": {"user": []}}),
            json.dumps({"identity": "user", "identities": {"user": {}}}),
            json.dumps({"identity": "user", "identities": {"user": {"available": "true"}}}),
        )

        for stdout in invalid_payloads:
            with self.subTest(stdout=stdout):
                def run_command(argv, timeout):
                    if argv == ["lark-cli", "--version"]:
                        return doctor.CommandResult(0, "1.0.67", "")
                    return doctor.CommandResult(0, stdout, "secret-stderr")

                result = doctor.check_lark(run_command, 1.0)

                self.assertEqual("degraded", result["status"])
                self.assertEqual("unknown", result["authorization"])
                self.assertEqual("invalid_probe_output", result["error"]["code"])
                serialized = json.dumps(result)
                self.assertNotIn("secret-app-id", serialized)
                self.assertNotIn("secret-stderr", serialized)

    def test_lark_auth_probe_failures_are_degraded_and_sanitized(self):
        def timeout_runner(argv, timeout):
            if argv == ["lark-cli", "--version"]:
                return doctor.CommandResult(0, "1.0.67", "")
            raise subprocess.TimeoutExpired(argv, timeout, output="secret-output", stderr="secret-error")

        def os_error_runner(argv, timeout):
            if argv == ["lark-cli", "--version"]:
                return doctor.CommandResult(0, "1.0.67", "")
            raise OSError("secret-path")

        for runner, expected_code in (
            (timeout_runner, "check_timeout"),
            (os_error_runner, "authorization_check_failed"),
        ):
            with self.subTest(expected_code=expected_code):
                result = doctor.check_lark(runner, 1.0)

                self.assertEqual("degraded", result["status"])
                self.assertEqual(expected_code, result["error"]["code"])
                serialized = json.dumps(result)
                self.assertNotIn("secret-output", serialized)
                self.assertNotIn("secret-error", serialized)
                self.assertNotIn("secret-path", serialized)

    def test_lark_nonzero_auth_status_is_degraded_without_exposing_output(self):
        def run_command(argv, timeout):
            if argv == ["lark-cli", "--version"]:
                return doctor.CommandResult(0, "1.0.67", "")
            return doctor.CommandResult(1, "token details", "login required")

        result = doctor.check_lark(run_command, 1.0)

        self.assertEqual("degraded", result["status"])
        self.assertEqual("ready", result["installation"])
        self.assertEqual("unknown", result["authorization"])
        self.assertEqual("authorization_check_failed", result["error"]["code"])
        self.assertNotIn("token details", json.dumps(result))
        self.assertNotIn("login required", json.dumps(result))

    def test_dws_reports_ready_from_sanitized_auth_status(self):
        commands = []

        def run_command(argv, timeout):
            commands.append(argv)
            if argv == ["dws", "--version"]:
                return doctor.CommandResult(0, "dws version v1.0.52", "")
            return doctor.CommandResult(
                0,
                json.dumps(
                    {
                        "success": True,
                        "authenticated": True,
                        "token_valid": True,
                        "corp_name": "secret organization",
                        "user_name": "secret user",
                    }
                ),
                "",
            )

        result = doctor.check_dws(run_command, 1.0)

        self.assertEqual(
            [["dws", "--version"], ["dws", "auth", "status", "--format", "json"]],
            commands,
        )
        self.assertEqual("ready", result["status"])
        self.assertEqual("ready", result["installation"])
        self.assertEqual("ready", result["authorization"])
        self.assertNotIn("secret organization", json.dumps(result))
        self.assertNotIn("secret user", json.dumps(result))

    def test_dws_reports_authorization_required_from_auth_payload(self):
        def run_command(argv, timeout):
            if argv == ["dws", "--version"]:
                return doctor.CommandResult(0, "dws version v1.0.52", "")
            return doctor.CommandResult(
                0,
                json.dumps({"success": True, "authenticated": False, "token_valid": False}),
                "",
            )

        result = doctor.check_dws(run_command, 1.0)

        self.assertEqual("authorization_required", result["status"])
        self.assertEqual("required", result["authorization"])

    def test_provider_checks_run_in_parallel(self):
        barrier = threading.Barrier(5)

        def agent_check():
            barrier.wait(timeout=0.5)
            return {"status": "ready", "channels": {}}

        def bycli_check():
            barrier.wait(timeout=0.5)
            return {"status": "available_on_demand", "daemon": "running"}

        def wecom_check():
            barrier.wait(timeout=0.5)
            return {"status": "installed", "installation": "ready"}

        def lark_check():
            barrier.wait(timeout=0.5)
            return {"status": "authorization_required", "installation": "ready"}

        def dws_check():
            barrier.wait(timeout=0.5)
            return {"status": "ready", "installation": "ready"}

        report = doctor.collect_report(agent_check, bycli_check, wecom_check, lark_check, dws_check)

        self.assertEqual("available", report["overallStatus"])

    def test_provider_exception_is_isolated_from_other_provider(self):
        def failed_check():
            raise RuntimeError("unexpected")

        report = doctor.collect_report(
            failed_check,
            lambda: {"status": "ready", "daemon": "running"},
            lambda: {"status": "installed", "installation": "ready"},
            lambda: {"status": "authorization_required", "installation": "ready"},
            lambda: {"status": "ready", "installation": "ready"},
        )

        self.assertEqual("degraded", report["overallStatus"])
        self.assertEqual("internal_check_failed", report["providers"]["byReach"]["error"]["code"])
        self.assertEqual("ready", report["providers"]["bycli"]["status"])

    def test_report_includes_enterprise_probes_without_changing_overall_status(self):
        result = doctor.build_report(
            {"status": "ready", "channels": {}},
            {"status": "available_on_demand", "daemon": "running"},
            {"status": "installed", "installation": "ready"},
            {"status": "authorization_required", "installation": "ready"},
            {"status": "ready", "installation": "ready"},
        )

        self.assertEqual("available", result["overallStatus"])
        self.assertEqual(2, result["schemaVersion"])
        self.assertIn("byReach", result["providers"])
        self.assertNotIn("agentReach", result["providers"])
        self.assertEqual("installed", result["providers"]["wecom"]["status"])
        self.assertEqual("authorization_required", result["providers"]["lark"]["status"])
        self.assertEqual("ready", result["providers"]["dws"]["status"])

    def test_report_is_unavailable_when_both_providers_are_unavailable(self):
        result = doctor.build_report(
            {"status": "unavailable"},
            {"status": "unavailable"},
            {"status": "installed"},
            {"status": "ready"},
            {"status": "ready"},
        )

        self.assertEqual("unavailable", result["overallStatus"])


if __name__ == "__main__":
    unittest.main()
