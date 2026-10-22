"""Offline CLI contract; live catalog and execution are covered by the Node integration fixture."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

SCRIPT = Path(__file__).resolve().parents[2] / 'scripts/package_tenant_schema_bundle.py'

class TenantBundleTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.source = self.root / 'source.sql'
        self.source.write_text('CREATE TABLE byai.byai_group_chat_forward_request (id bigint);\n')
        self.catalog = self.root / 'catalog.json'
        self.capture()

    def capture(self):
        self.catalog.write_text(json.dumps({
            'formatVersion': 1, 'engineName': 'PostgreSQL', 'engineVersion': '17.11',
            'sourceSqlSha256': hashlib.sha256(self.source.read_bytes()).hexdigest(),
            'parentMarker': {'version': 'V0.5.0'},
            'catalog': {'objects': [{'name': 'byai_group_chat_forward_request', 'kind': 'r', 'comment': None}],
                        'columns': [], 'indexes': [], 'constraints': [], 'sequences': []}}))

    def run_cli(self, *extra):
        return subprocess.run([sys.executable, str(SCRIPT), '--version', 'V0.6.0',
            '--source', str(self.source), '--catalog', str(self.catalog),
            '--output', str(self.root / 'V0.6.0__update.zip'), *extra], capture_output=True, text=True)

    def test_invalid_kind_is_rejected_without_output(self):
        result = self.run_cli('--kind', 'wrong')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('invalid choice', result.stderr)
        self.assertFalse((self.root / 'V0.6.0__update.zip').exists())

    def test_update_requires_explicit_actual_parent(self):
        result = self.run_cli('--kind', 'update')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('parent-version is required', result.stderr)

    def test_increment_cannot_masquerade_as_complete_baseline(self):
        result = self.run_cli('--kind', 'baseline')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('complete tenant baseline', result.stderr)

    def test_catalog_must_bind_source_and_observed_parent(self):
        self.source.write_text(self.source.read_text() + '-- changed\n')
        self.assertIn('source SQL hash', self.run_cli('--kind', 'update', '--parent-version', 'V0.5.0').stderr)
        self.capture()
        self.assertIn('observed parent', self.run_cli('--kind', 'update', '--parent-version', 'V0.4.0').stderr)

    def test_deterministic_bundle_preserves_sql_and_capture_engine(self):
        args = ('--kind', 'update', '--parent-version', 'V0.5.0')
        result = self.run_cli(*args)
        self.assertEqual(result.returncode, 0, result.stderr)
        path = self.root / 'V0.6.0__update.zip'
        first = path.read_bytes()
        self.assertEqual(self.run_cli(*args).returncode, 0)
        self.assertEqual(first, path.read_bytes())
        with zipfile.ZipFile(path) as bundle:
            self.assertEqual(bundle.namelist(), ['versions/V0.6.0/__ddl.sql', 'versions/V0.6.0/manifest.json'])
            self.assertEqual(bundle.read('versions/V0.6.0/__ddl.sql'), self.source.read_bytes())
            manifest = json.loads(bundle.read('versions/V0.6.0/manifest.json'))
        self.assertEqual(manifest['engine'], 'openGauss')
        self.assertEqual(manifest['parentVersion'], 'V0.5.0')
        self.assertEqual(manifest['sqlSha256'], hashlib.sha256(self.source.read_bytes()).hexdigest())
        provenance = json.loads((self.root / 'V0.6.0__update__provenance.json').read_text())
        self.assertEqual(provenance['captureEngine'], {'name': 'PostgreSQL', 'version': '17.11'})
        self.assertFalse(provenance['targetEngineVerified'])
        self.assertEqual(provenance['bundleSha256'], hashlib.sha256(first).hexdigest())
        self.assertEqual(json.loads((self.root / 'V0.6.0__update__manifest.json').read_text()), manifest)

if __name__ == '__main__':
    unittest.main()
