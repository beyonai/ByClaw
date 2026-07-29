import json
import unittest
from pathlib import Path


OPENCLAW_DIR = Path(__file__).parents[1]
SKILL_PATH = OPENCLAW_DIR / "skills" / "bycli" / "SKILL.md"
EVALS_PATH = OPENCLAW_DIR / "skills" / "bycli" / "evals" / "evals.json"


class BycliResultLinkContractTest(unittest.TestCase):
    def test_user_facing_results_keep_returned_urls_clickable(self):
        content = SKILL_PATH.read_text(encoding="utf-8")
        required = (
            "结果链接展示（强制）",
            "非空 `url`",
            "[title](url)",
            "表格太宽",
            "不得省略",
            "不得猜造",
        )
        for expected in required:
            self.assertIn(expected, content)

    def test_eval_covers_pressure_to_omit_links(self):
        evals = json.loads(EVALS_PATH.read_text(encoding="utf-8"))["evals"]
        result_link_eval = next(item for item in evals if item["id"] == 12)
        self.assertIn("url", result_link_eval["prompt"])
        self.assertIn("可点击", result_link_eval["expected_output"])
        self.assertIn("不得省略", result_link_eval["expected_output"])


if __name__ == "__main__":
    unittest.main()
