import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class GbrainRemovalTest(unittest.TestCase):
    def test_startup_ignores_legacy_initializer_and_reaches_gateway(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ['filebrowser', 'display', 'vnc', 'opencli', 'openclaw', 'gbrain']:
                script = root / f'start-{name}.sh'
                script.write_text(f'#!/bin/sh\necho {name} >> "$TEST_CALLS"\n' +
                                  ('exit 99\n' if name == 'gbrain' else ''))
                script.chmod(0o755)
            result = subprocess.run(
                ['sh', str(ROOT / 'startAll.sh')], capture_output=True, text=True, timeout=10,
                env={**os.environ, 'PATH': f'{root}:/usr/bin:/bin',
                     'TEST_CALLS': str(root / 'calls'), 'OPENCLAW_STATE_DIR': str(root / 'state'),
                     'OPENCLAW_NODE_DIAGNOSTICS_DIR': str(root / 'diagnostics')},
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            calls = (root / 'calls').read_text().splitlines()
            self.assertIn('openclaw', calls)
            self.assertNotIn('gbrain', calls)

    def test_images_do_not_ship_gbrain(self):
        self.assertFalse((ROOT / 'start-gbrain.sh').exists())
        self.assertFalse((ROOT / 'skills/gbrain').exists())
        for name in ['Dockerfile', 'Dockerfile.byclaw', 'Dockerfile.cubesandbox']:
            self.assertNotIn('gbrain', (ROOT / name).read_text())

    @unittest.skipUnless(os.environ.get('BYCLAW_TEST_OPENGAUSS_CONTAINER'), 'requires OpenGauss')
    def test_migration_preserves_other_settings_and_is_idempotent(self):
        migration = (ROOT.parents[1] / 'deploy/migrations/versions/V0.5.0/V0.5.0__dml.sql').read_text()
        cleanup = migration.split('-- gbrain runtime removal: begin')[1].split('-- gbrain runtime removal: end')[0]
        cleanup = cleanup.replace('byai.sandbox_service_spec', 'test_specs').replace(
            'byai.byai_system_config', 'test_config')
        sql = '''BEGIN;
CREATE TEMP TABLE test_specs (service_key text, spec_json jsonb, template_json jsonb);
CREATE TEMP TABLE test_config (param_code text, param_value text);
INSERT INTO test_specs VALUES ('openclaw',
    '{"env":{"GBRAIN_HOME":"old","GBRAIN_MODEL":"old","GBRAIN_EMBEDDING_MODEL":"old","GBRAIN_EMBEDDING_DIMENSIONS":"1024","MODEL_NAME":"keep"}}',
    '{"mcp":{"servers":{"gbrain":{"command":"gbrain"},"env":{"GBRAIN_HOME":"old"},"other":{"command":"keep"}}},"models":{"keep":true}}');
INSERT INTO test_config VALUES ('OPENCLAW_BUNDLED_SKILLS', '[{"skillCode":"bycli"},{"skillCode":"gbrain"},{"skillCode":"mail"}]');
'''
        snapshot = "SELECT 'row:' || row_to_json(t)::text FROM test_specs t;\nSELECT 'skills:' || param_value FROM test_config;\n"
        result = subprocess.run(
            ['podman', 'exec', '-i', '-u', 'omm', os.environ['BYCLAW_TEST_OPENGAUSS_CONTAINER'],
             'bash', '-lc', 'gsql -d postgres -p 5432 -At -v ON_ERROR_STOP=1'],
            input=sql + cleanup + snapshot + cleanup + snapshot + 'ROLLBACK;',
            capture_output=True, text=True, timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('ERROR:', result.stderr)
        rows = [json.loads(line[4:]) for line in result.stdout.splitlines() if line.startswith('row:')]
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0], rows[1])
        self.assertEqual(rows[0]['spec_json'], {'env': {'MODEL_NAME': 'keep'}})
        self.assertEqual(rows[0]['template_json'], {
            'mcp': {'servers': {'other': {'command': 'keep'}}}, 'models': {'keep': True}})
        skills = [json.loads(line[7:]) for line in result.stdout.splitlines() if line.startswith('skills:')]
        self.assertEqual(skills, [[{'skillCode': 'bycli'}, {'skillCode': 'mail'}]] * 2)


if __name__ == '__main__':
    unittest.main()
