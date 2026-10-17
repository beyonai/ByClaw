import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
DOCKERFILE = REPO_ROOT / "middleware" / "openclaw" / "Dockerfile"


class OpenClawRuntimeImageHealthcheckTest(unittest.TestCase):
    def test_healthcheck_uses_the_runtime_gateway_port(self):
        dockerfile = DOCKERFILE.read_text(encoding="utf-8")

        self.assertIn("HEALTHCHECK", dockerfile)
        self.assertIn("OPENCLAW_GATEWAY_PORT", dockerfile)
        self.assertIn("'8080'", dockerfile)
        self.assertIn("/healthz", dockerfile)
        self.assertNotIn("fetch('http://127.0.0.1:18789/healthz')", dockerfile)

    def test_healthcheck_is_not_disabled(self):
        dockerfile = DOCKERFILE.read_text(encoding="utf-8")

        self.assertNotIn("HEALTHCHECK NONE", dockerfile)


if __name__ == "__main__":
    unittest.main()
