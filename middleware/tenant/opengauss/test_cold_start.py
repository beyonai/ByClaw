import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


ENTRYPOINT = (
    Path(__file__).resolve().parents[3]
    / "byclaw-be/src/main/resources/tenant/opengauss-entrypoint.py"
)
SPEC = importlib.util.spec_from_file_location("tenant_opengauss", ENTRYPOINT)
entrypoint = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(entrypoint)


class ColdStartTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.volume = Path(self.temp.name)

    def stage_cluster(self, _script, _args, env, **_kwargs):
        data = Path(env["PGDATA"])
        self.assertNotEqual(data.parent, self.volume)
        data.mkdir(mode=0o700)
        (data / "PG_VERSION").write_text("6.0\n")
        (data / "tenant-data").write_text("initialized")

    def test_fresh_volume_publishes_only_the_complete_cluster_and_reuses_it(self):
        with patch.object(entrypoint, "run_local_initializer", side_effect=self.stage_cluster) as run:
            active = entrypoint.prepare_database(self.volume, "", ["gaussdb"], {})
            self.assertEqual("initialized", (active / "tenant-data").read_text())
            self.assertEqual(active, entrypoint.prepare_database(self.volume, "", ["gaussdb"], {}))
        run.assert_called_once()

    def test_legacy_cluster_keeps_its_original_data_directory(self):
        (self.volume / "PG_VERSION").write_text("6.0\n")
        with patch.object(entrypoint, "run_local_initializer") as run:
            self.assertEqual(self.volume, entrypoint.prepare_database(self.volume, "", ["gaussdb"], {}))
        run.assert_not_called()

    def test_interrupted_copy_does_not_publish_and_next_attempt_can_recover(self):
        with patch.object(entrypoint, "run_local_initializer", side_effect=self.stage_cluster):
            with patch.object(entrypoint, "copy_synced_file", side_effect=OSError("copy interrupted")):
                with self.assertRaisesRegex(OSError, "copy interrupted"):
                    entrypoint.prepare_database(self.volume, "", ["gaussdb"], {})
                self.assertEqual([], list(self.volume.iterdir()))
            active = entrypoint.prepare_database(self.volume, "", ["gaussdb"], {})
        self.assertTrue((active / "PG_VERSION").is_file())

    def test_nonempty_unrecognized_volume_is_left_untouched(self):
        (self.volume / "unknown-data").write_text("keep")
        with patch.object(entrypoint, "run_local_initializer") as run:
            self.assertEqual(self.volume, entrypoint.prepare_database(self.volume, "", ["gaussdb"], {}))
        run.assert_not_called()
        self.assertEqual("keep", (self.volume / "unknown-data").read_text())


if __name__ == "__main__":
    unittest.main()
