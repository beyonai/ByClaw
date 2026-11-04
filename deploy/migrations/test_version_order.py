import unittest
import merge_migrations as migrations


class VersionOrderTest(unittest.TestCase):
    def test_requested_four_part_release_orders_numerically(self):
        expected = ["V0.5.2-alpha.2", "V0.5.2-alpha.10", "V0.5.2-rc.1", "V0.5.2", "V0.5.2.1-alpha.1", "V0.5.2.1", "V0.5.2.2", "V0.5.2.10", "V0.5.3"]
        self.assertEqual(sorted(reversed(expected), key=migrations.parse_version_sort_key), expected)
        self.assertTrue(all(migrations.VERSION_DIR_PATTERN.fullmatch(item) for item in expected))
        self.assertEqual(migrations.parse_version_sort_key("V0.5.2"), migrations.parse_version_sort_key("V0.5.2.0"))

    def test_invalid_directories_are_rejected(self):
        for item in ["0.5.2.1", "V0.5", "V0.5.2.1.1", "V0.5.2.x"]:
            self.assertIsNone(migrations.VERSION_DIR_PATTERN.fullmatch(item))


if __name__ == "__main__":
    unittest.main()
