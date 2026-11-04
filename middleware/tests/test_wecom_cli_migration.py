"""Guard the scoped WeCom 1.3.4 migration and its executable command catalog."""
import json
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'deploy/migrations/versions/V0.6.0/V0.6.0__dml.sql'
MARKER = '-- WeCom CLI 1.3.4'


class WecomCliMigrationTest(unittest.TestCase):
    def migration(self):
        sql = MIGRATION.read_text()
        self.assertTrue(MARKER in sql, 'the approved V0.6.0 migration must upgrade WeCom')
        return sql.split(MARKER, 1)[1]

    def json_assignment(self, path):
        sql = self.migration()
        match = re.search(r"'\{" + re.escape(path) + r"\}'\s*,\s*'([^']+)'::jsonb", sql)
        self.assertIsNotNone(match, f'missing JSON assignment for {path}')
        return json.loads(match.group(1))

    def test_updates_only_wecom_template_and_preserves_user_state(self):
        sql = re.sub(r'--[^\n]*', '', self.migration())
        normalized = re.sub(r'\s+', ' ', sql).lower()
        self.assertIn("where connector_code = 'wecom'", normalized)
        self.assertIn("and provider_code = 'wecom-cli'", normalized)
        self.assertIn('runtime_manifest::jsonb', normalized)
        self.assertNotRegex(normalized, r'\b(?:insert|delete|drop|alter|truncate)\b')
        self.assertNotRegex(normalized, r'\b(?:status_cd|request_config|auth_storage)\s*=')
        self.assertNotIn('byai_connector_auth', normalized)

    def test_command_catalog_uses_new_auth_commands(self):
        self.assertEqual(self.json_assignment('version'), '1.3.4')
        self.assertEqual(self.json_assignment('runtime,commands,login'), [
            ['wecom-cli', 'auth', 'init', '--noninteractive', '--no-browser']
        ])
        self.assertEqual(self.json_assignment('runtime,commands,status'), [
            ['wecom-cli', 'auth', 'show', '--status']
        ])
        # Cache cleanup is only one part of provider-managed credential revocation.
        self.assertEqual(self.json_assignment('runtime,commands,logout'), [
            ['wecom-cli', 'cache', 'clear']
        ])

    def test_probe_config_preserves_other_fields_and_allows_full_qr_timeout(self):
        sql = self.migration()
        self.assertIn("NULLIF(auth_config, '')", sql)
        self.assertEqual(self.json_assignment('probeCommand'),
                         ['wecom-cli', 'auth', 'show', '--status'])
        self.assertEqual(self.json_assignment('authorizationTimeoutSeconds'), 300)
        self.assertNotIn('get_userlist', sql)
        self.assertNotIn('--no-open', sql)


if __name__ == '__main__':
    unittest.main()
