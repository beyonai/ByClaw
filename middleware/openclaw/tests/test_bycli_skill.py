import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BYCLI = ROOT / "skills" / "bycli"


class BycliBridgeContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.skill = (BYCLI / "SKILL.md").read_text(encoding="utf-8")
        cls.weixin = (BYCLI / "references" / "weixin.md").read_text(encoding="utf-8")
        cls.autofix = (BYCLI / "references" / "autofix.md").read_text(encoding="utf-8")
        cls.evals = json.loads(
            (BYCLI / "evals" / "evals.json").read_text(encoding="utf-8")
        )["evals"]
        cls.eval_text = "\n".join(
            f"{item['prompt']}\n{item['expected_output']}" for item in cls.evals
        )

    def test_skill_routes_generic_bridge_recovery_to_executable_bootstrap(self):
        self.assertIn("scripts/bridge-bootstrap.mjs", self.skill)
        self.assertIn("BRIDGE_RECOVERY_BUSY", self.skill)
        self.assertIn("BRIDGE_UNAVAILABLE", self.skill)

    def test_browser_backed_weixin_examples_use_runner_not_gate_cli(self):
        self.assertIn("scripts/weixin-browser-runner.mjs", self.skill)
        self.assertIn("scripts/weixin-browser-runner.mjs", self.weixin)
        self.assertNotIn("node scripts/weixin-login-gate.mjs", self.weixin)

    def test_autofix_delegates_browser_connect_before_user_stop(self):
        self.assertIn("bridge-bootstrap.mjs", self.autofix)
        self.assertNotIn(
            "**BROWSER_CONNECT** (exit 69) — 提示用户运行 `bycli doctor`",
            self.autofix,
        )

    def test_contract_documents_gate_first_and_no_confirmed_rerun_preflight(self):
        self.assertIn("waiting-confirmation", self.weixin)
        self.assertIn("confirmed-rerun", self.weixin)
        self.assertIn("不得执行 structured help", self.weixin)
        self.assertIn("不得执行桥接预检", self.weixin)

    def test_eval_regressions_cover_managed_profile_start_and_outer_budget(self):
        for required in (
            "随机 profile",
            "start-chrome.sh",
            "Chromium 已运行",
            "普通“重试”",
            "BRIDGE_RECOVERY_BUSY",
            "不得再次执行",
        ):
            self.assertIn(required, self.eval_text)

    def test_final_runner_bridge_codes_are_not_recovered_again_by_outer_agent(self):
        self.assertIn("details.bridgeCode=BRIDGE_UNAVAILABLE", self.skill)
        self.assertIn("不得再", self.skill)


if __name__ == "__main__":
    unittest.main()
