import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
DOCKERFILE = REPO_ROOT / "middleware" / "openclaw" / "Dockerfile.cubesandbox"


class OpenClawCubeSandboxImageTest(unittest.TestCase):
    def test_healthcheck_uses_the_runtime_gateway_port(self):
        dockerfile = DOCKERFILE.read_text(encoding="utf-8")

        self.assertIn("HEALTHCHECK", dockerfile)
        self.assertIn(
            "[process.env.OPENCLAW_GATEWAY_PORT,'8080','18789']",
            dockerfile,
        )
        self.assertIn("Promise.any", dockerfile)
        self.assertIn("/healthz", dockerfile)
        self.assertNotIn("fetch('http://127.0.0.1:18789/healthz')", dockerfile)

    def test_knowledge_collection_runtime_dependencies_are_installed(self):
        dockerfile = DOCKERFILE.read_text(encoding="utf-8")

        self.assertIn("cd /app/skills/knowledge-collection/scripts", dockerfile)
        self.assertIn("npm ci --omit=dev", dockerfile)


if __name__ == "__main__":
    unittest.main()
