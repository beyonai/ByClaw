import importlib.util
import json
import os
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).parents[1] / "verify_by_reach_image.py"
SPEC = importlib.util.spec_from_file_location("verify_by_reach_image", MODULE_PATH)
validator = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(validator)


class ByReachImageValidationTest(unittest.TestCase):
    def test_doctor_report_requires_v2_and_by_reach_provider(self):
        report = validator._parse_doctor_report(
            json.dumps({"schemaVersion": 2, "providers": {"byReach": {}}})
        )
        self.assertIn("byReach", report["providers"])

        with self.assertRaisesRegex(validator.ImageValidationError, "schemaVersion 2"):
            validator._parse_doctor_report(json.dumps({"schemaVersion": 1, "providers": {"byReach": {}}}))
        with self.assertRaisesRegex(validator.ImageValidationError, "legacy"):
            validator._parse_doctor_report(
                json.dumps(
                    {
                        "schemaVersion": 2,
                        "providers": {"byReach": {}, "agentReach": {}},
                    }
                )
            )

    def test_generic_url_requires_exact_bycli_probe_then_web_read(self):
        url = "https://q.shanyue.tech/"
        validator._assert_exact_web_routing(
            [["list", "-f", "json"], ["web", "read", "--url", url, "--stdout"]],
            url,
        )
        with self.assertRaisesRegex(validator.ImageValidationError, "must invoke only"):
            validator._assert_exact_web_routing(
                [["web", "read", "--url", url, "--stdout"]],
                url,
            )
        with self.assertRaisesRegex(validator.ImageValidationError, "forbidden"):
            validator._assert_exact_web_routing(
                [
                    ["list", "-f", "json"],
                    ["web", "read", "--url", url, "--stdout", "jina"],
                ],
                url,
            )

    def test_runner_uses_local_shim_and_does_not_fetch_the_target_url(self):
        source = MODULE_PATH.read_text(encoding="utf-8")
        self.assertIn('entrypoint="by-reach"', source)
        self.assertIn('entrypoint="byclaw-capability-doctor"', source)
        self.assertIn("--mount", source)
        self.assertIn("BY_REACH_CALL_LOG", source)
        self.assertIn("by-reach read {shlex.quote(url)} >/dev/null", source)
        self.assertNotIn("requests.get", source)
        self.assertNotIn("urllib.request", source)

    def test_probe_mount_is_traversable_and_logs_are_writable_by_image_user(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            mount_dir = Path(temp_dir)
            bycli_log, forbidden_log = validator._prepare_probe_mount(mount_dir)

            self.assertEqual(0o755, stat.S_IMODE(mount_dir.stat().st_mode))
            self.assertEqual(0o755, stat.S_IMODE((mount_dir / "bycli").stat().st_mode))
            self.assertEqual(0o666, stat.S_IMODE(bycli_log.stat().st_mode))
            self.assertEqual(0o666, stat.S_IMODE(forbidden_log.stat().st_mode))

    def test_forbidden_executor_shim_logs_and_rejects_invocation(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            mount_dir = Path(temp_dir)
            _, forbidden_log = validator._prepare_probe_mount(mount_dir)
            environment = dict(os.environ, BY_REACH_FORBIDDEN_CALL_LOG=str(forbidden_log))

            completed = subprocess.run(
                [str(mount_dir / "curl"), "https://example.invalid/"],
                check=False,
                env=environment,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )

            self.assertEqual(86, completed.returncode)
            self.assertIn("forbidden webpage executor", completed.stderr)
            self.assertEqual(
                [["curl", "https://example.invalid/"]],
                validator._parse_call_log(forbidden_log.read_text(encoding="utf-8")),
            )

    def test_installed_web_runtime_contract_rejects_non_bycli_policy_and_http_sources(self):
        valid = json.dumps(
            {
                "policy": [["bycli", "bycli", "web/read", True]],
                "sources": {
                    "web": "from by_reach.bycli import read_web\n",
                    "bycli": "def read_web():\n    return run_command()\n",
                },
            }
        )
        validator._assert_installed_web_runtime_contract(valid)

        with self.assertRaisesRegex(validator.ImageValidationError, "policy"):
            validator._assert_installed_web_runtime_contract(
                json.dumps({"policy": [["jina", "api", "web/read", True]], "sources": {}})
            )
        with self.assertRaisesRegex(validator.ImageValidationError, "direct HTTP"):
            validator._assert_installed_web_runtime_contract(
                json.dumps(
                    {
                        "policy": [["bycli", "bycli", "web/read", True]],
                        "sources": {
                            "web": "from by_reach.bycli import read_web\n",
                            "bycli": "import requests\n",
                        },
                    }
                )
            )


if __name__ == "__main__":
    unittest.main()
