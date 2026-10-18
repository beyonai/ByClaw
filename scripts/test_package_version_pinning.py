import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "pinning", Path(__file__).with_name("check-package-version-pinning.py")
)
pinning = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pinning)


class VersionPinningTest(unittest.TestCase):
    def test_rejects_ranges_in_each_install_section(self):
        for section in ("dependencies", "devDependencies", "optionalDependencies"):
            for version in ("^1.2.3", "~1.2.3"):
                with self.subTest(section=section, version=version):
                    self.assertEqual(
                        list(pinning.violations({section: {"example": version}})),
                        [f"{section}.example: {version}"],
                    )

    def test_preserves_host_compatibility_and_local_dependencies(self):
        self.assertEqual(list(pinning.violations({
            "engines": {"node": "^22.19.0 || >=24"},
            "peerDependencies": {"react": "^18.2.0"},
            "dependencies": {"host": "workspace:*", "sdk": "0.1.5-rc.2"},
        })), [])


if __name__ == "__main__":
    unittest.main()
