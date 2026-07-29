import unittest
from pathlib import Path


OPENCLAW_ROOT = Path(__file__).parents[1]
DOCKERFILES = (OPENCLAW_ROOT / "Dockerfile",)


class AgentReachImageWiringTest(unittest.TestCase):
    def test_production_images_pin_and_verify_agent_reach(self):
        for dockerfile in DOCKERFILES:
            with self.subTest(dockerfile=dockerfile.name):
                content = dockerfile.read_text(encoding="utf-8")
                self.assertIn("ARG AGENT_REACH_VERSION=1.5.0", content)
                self.assertIn(
                    "ARG AGENT_REACH_COMMIT=f65526cbaaad3879473acc1ba6dbefd195caf2be",
                    content,
                )
                self.assertIn(
                    "ARG AGENT_REACH_SHA256=456a3ab86e56366ba665dc4bade5c0839c3043266e2a192efa09f4fdec415e20",
                    content,
                )
                self.assertIn("Agent-Reach/archive/${AGENT_REACH_COMMIT}.tar.gz", content)
                self.assertIn('echo "${AGENT_REACH_SHA256}  /tmp/agent-reach.tar.gz" | sha256sum -c -', content)
                self.assertIn("-c /tmp/agent-reach/constraints.txt", content)
                self.assertIn("agent-reach --version", content)

    def test_production_images_install_aggregate_doctor(self):
        for dockerfile in DOCKERFILES:
            with self.subTest(dockerfile=dockerfile.name):
                content = dockerfile.read_text(encoding="utf-8")
                self.assertIn(
                    "COPY middleware/openclaw/byclaw_capability_doctor.py /usr/local/bin/byclaw-capability-doctor",
                    content,
                )
                chmod_block = content.split("RUN chmod +x", 1)[1].split("\n\n", 1)[0]
                self.assertIn("/usr/local/bin/byclaw-capability-doctor", chmod_block)


if __name__ == "__main__":
    unittest.main()
