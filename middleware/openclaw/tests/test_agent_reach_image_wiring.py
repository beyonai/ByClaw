import unittest
from pathlib import Path


OPENCLAW_ROOT = Path(__file__).parents[1]
DOCKERFILES = (OPENCLAW_ROOT / "Dockerfile", OPENCLAW_ROOT / "Dockerfile.byclaw")


class ByReachImageWiringTest(unittest.TestCase):
    def test_production_images_pin_and_verify_by_reach(self):
        for dockerfile in DOCKERFILES:
            with self.subTest(dockerfile=dockerfile.name):
                content = dockerfile.read_text(encoding="utf-8")
                self.assertIn("ARG BY_REACH_VERSION=2.0.0b1", content)
                self.assertIn(
                    "ARG BY_REACH_COMMIT=9d4cc902195c180767d283787b980438f80871ad",
                    content,
                )
                self.assertIn(
                    "ARG BY_REACH_SHA256=d4b3404ffdbf1247a07c45f85d21a645463cb9968673bbb3cfa048a21d37cb35",
                    content,
                )
                self.assertIn("sovovs/By-Reach/archive/${BY_REACH_COMMIT}.tar.gz", content)
                self.assertIn('echo "${BY_REACH_SHA256}  /tmp/by-reach.tar.gz" | sha256sum -c -', content)
                self.assertIn("-c /tmp/by-reach/constraints.txt", content)
                self.assertIn("by-reach --version", content)
                self.assertNotIn("AGENT_REACH_", content)

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
