"""Exercise the installed SearXNG wheel through the image's launcher.

Set SEARXNG_TEST_PYTHON to a Python environment with the constrained
searxng-cli 0.1.0 installation. No public search endpoint is required.
"""

from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

HARNESS = Path(__file__).resolve().parents[1] / 'byclaw-harness'
SCRIPTS = HARNESS / 'scripts'
PYTHON = os.environ.get('SEARXNG_TEST_PYTHON', sys.executable)


class SearchRuntimeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        available = subprocess.run([PYTHON, '-c', 'import searxng_cli'], capture_output=True)
        if available.returncode:
            raise unittest.SkipTest('install the constrained searxng-cli wheel and set SEARXNG_TEST_PYTHON')

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='byclaw-search-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.launcher = self.root / 'launcher.sh'
        source = (SCRIPTS / 'searxng-cli/launcher.sh').read_text()
        self.launcher.write_text(source.replace('/opt/searxng-cli-venv/bin/python', PYTHON)
                                 .replace('/opt/searxng-cli/runtime.py',
                                          str(SCRIPTS / 'searxng-cli/runtime.py')))
        self.env = dict(os.environ, HOME=str(self.root / 'home'),
                        SEARXNG_CLI_SETTINGS=str(SCRIPTS / 'searxng-cli/searxng_pack_settings.yml'))
        self.env.pop('XDG_CACHE_HOME', None)
        self.cache = self.root / f'home/.cache/byclaw/searxng/{os.getuid()}'

    def invoke(self, env=None):
        return subprocess.run(['sh', str(self.launcher), '--list-engines'],
                              env=env or self.env, capture_output=True, text=True, timeout=30)

    def assert_loaded(self, result):
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotRegex(result.stderr, r'readonly database|no such table|database is locked|ahmia|torch')
        engines = {name for group in json.loads(result.stdout).values() for name in group}
        self.assertTrue({'bing', 'github', 'wikidata', 'radio browser'} <= engines)
        self.assertTrue({'ahmia', 'torch'}.isdisjoint(engines))

    def test_repeated_calls_initialize_complete_private_schema(self):
        for _ in range(3):
            self.assert_loaded(self.invoke())
        database = self.cache / 'sxng_cache_ENGINES_CACHE.db'
        self.assertEqual(self.cache.stat().st_mode & 0o777, 0o700)
        self.assertEqual(database.stat().st_mode & 0o777, 0o600)
        with sqlite3.connect(database) as conn:
            self.assertIsNotNone(conn.execute("SELECT name FROM sqlite_master WHERE name='properties'").fetchone())
            self.assertIsNone(conn.execute("SELECT name FROM sqlite_master WHERE name='byclaw_cache_probe'").fetchone())

    def test_concurrent_first_calls(self):
        with ThreadPoolExecutor(max_workers=4) as pool:
            for result in pool.map(lambda _: self.invoke(), range(4)):
                self.assert_loaded(result)

    def test_legacy_readonly_temp_database_is_not_used(self):
        legacy = self.root / 'shared-tmp'
        legacy.mkdir()
        database = legacy / 'sxng_cache_ENGINES_CACHE.db'
        database.write_bytes(b'legacy cache must not be opened')
        database.chmod(0o444)
        self.assert_loaded(self.invoke(dict(self.env, TMPDIR=str(legacy))))
        self.assertEqual(database.read_bytes(), b'legacy cache must not be opened')

    def test_uid_isolates_cache_even_with_shared_home_and_xdg(self):
        tools = self.root / 'bin'
        tools.mkdir()
        fake_id = tools / 'id'
        fake_id.write_text('#!/bin/sh\nprintf "%s\\n" "$TEST_UID"\n')
        fake_id.chmod(0o755)
        for uid in ('0', '1001'):
            env = dict(self.env, TEST_UID=uid, PATH=f'{tools}:{os.environ["PATH"]}',
                       XDG_CACHE_HOME=str(self.root / 'xdg'))
            self.assert_loaded(self.invoke(env))
            self.assertTrue((self.root / f'xdg/byclaw/searxng/{uid}/sxng_cache_ENGINES_CACHE.db').is_file())

    @unittest.skipIf(os.geteuid() == 0, 'root bypasses file write permissions')
    def test_readonly_cache_fails_the_command(self):
        self.assert_loaded(self.invoke())
        (self.cache / 'sxng_cache_ENGINES_CACHE.db').chmod(0o444)
        result = self.invoke()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('readonly database', result.stderr)

    def test_invalid_cache_directory_fails_the_command(self):
        self.cache.parent.mkdir(parents=True)
        self.cache.write_text('not a directory')
        self.assertNotEqual(self.invoke().returncode, 0)

    def test_relative_settings_path(self):
        env = dict(self.env, SEARXNG_CLI_SETTINGS=os.path.relpath(self.env['SEARXNG_CLI_SETTINGS']))
        self.assert_loaded(self.invoke(env))


if __name__ == '__main__':
    unittest.main()
