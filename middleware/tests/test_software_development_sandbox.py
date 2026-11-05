"""Contract checks, plus opt-in real PostgreSQL tests in an isolated container.

BYCLAW_SOFTWARE_DEVELOPMENT_INTEGRATION=1 enables real database/process checks.
They require container root, PostgreSQL 17 + pgvector, postgres and byclaw users.
"""
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

HARNESS = Path(__file__).resolve().parents[1] / 'byclaw-harness'
ENTRY = HARNESS / 'scripts/software-development-entrypoint.py'
spec = importlib.util.spec_from_file_location('development_entrypoint', ENTRY)
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


class SoftwareDevelopmentContractTest(unittest.TestCase):
    def test_market_and_image_handshake_match(self):
        manifest = json.loads((HARNESS / 'tool-sandbox/software-development.capabilities.json').read_text())
        example = json.loads((HARNESS / 'tool-sandbox/software-development.spec.example.json').read_text())
        market = example['runtimeOptions']['toolSandbox']
        self.assertEqual(manifest['purpose'], 'software-development')
        self.assertEqual(market['purpose'], manifest['purpose'])
        self.assertEqual(market['templateKey'], manifest['purpose'])
        self.assertEqual(json.loads(market['capabilities']), manifest['capabilities'])
        self.assertEqual(manifest['operations'], json.loads(market['operations']))
        self.assertNotIn(5432, [port['port'] for port in example['ports']])
        self.assertEqual(example['env']['BYCLAW_BROWSER_STARTUP'], 'eager')
        self.assertFalse(any(v['mountPath'].startswith('/var/lib/postgresql') for v in example['volumes']))
        self.assertNotIn('PGPASSWORD', example['env'])

    def test_build_is_narrow_and_has_no_build_time_cluster(self):
        dockerfile = (HARNESS / 'Dockerfile.tools.software-development').read_text()
        self.assertIn('192.168.0.81:8080/byclaw/byclaw-harness-tools:D0.6.0_browser', dockerfile)
        self.assertIn('create_main_cluster = false', dockerfile)
        self.assertNotIn('initdb ', dockerfile)
        self.assertIn('postgresql-17-pgvector=${PGVECTOR_PACKAGE_VERSION}', dockerfile)
        self.assertIn('npm_package_config_node_gyp_dist_url=https://npmmirror.com/mirrors/node', dockerfile)
        ignore = (HARNESS / 'Dockerfile.tools.software-development.dockerignore').read_text()
        self.assertTrue(ignore.startswith('**\n'))
        self.assertNotIn('!middleware/byclaw-harness/**', ignore)

    def test_rejects_unsafe_data_paths(self):
        for value in ('relative/data', '/', '/by', '/tmp/../etc/postgres'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                runtime.data_path(value)
        with tempfile.TemporaryDirectory() as temporary:
            link = Path(temporary) / 'alias'
            link.symlink_to('/tmp')
            with self.assertRaises(ValueError):
                runtime.data_path(str(link / 'database'))


@unittest.skipUnless(os.environ.get('BYCLAW_SOFTWARE_DEVELOPMENT_INTEGRATION') == '1',
                     'real PostgreSQL checks are opt-in inside an isolated container')
class SoftwareDevelopmentDatabaseTest(unittest.TestCase):
    def setUp(self):
        self.assertEqual(os.geteuid(), 0)
        self.temporary = tempfile.TemporaryDirectory(prefix='software-development-test-')
        self.root = Path(self.temporary.name)
        self.root.chmod(0o755)
        self.data = self.root / 'postgres/data'
        self.run = self.root / 'run'
        self.tools = self.root / 'tools'
        self.tools.write_text('#!/usr/bin/python3\nimport time\nwhile True: time.sleep(1)\n')
        self.tools.chmod(0o755)
        # Dedicated test port, not any host service; tests run in a private network namespace.
        self.env = {**os.environ, 'BYCLAW_SOFTWARE_DEVELOPMENT_PGDATA': str(self.data),
                    'BYCLAW_SOFTWARE_DEVELOPMENT_PGPORT': '15432'}
        self.log = open(self.root / 'runtime.log', 'w+')
        self.processes = []

    def tearDown(self):
        for process in self.processes:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=40)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
        self.log.close()
        self.temporary.cleanup()

    def start(self, expect_ready=True):
        code = (f'import importlib.util,pathlib,sys; s=importlib.util.spec_from_file_location("entry",{str(ENTRY)!r}); '
                f'm=importlib.util.module_from_spec(s); s.loader.exec_module(m); '
                f'm.RUNTIME=pathlib.Path({str(self.run)!r}); m.TOOL_ENTRYPOINT={str(self.tools)!r}; '
                'sys.exit(m.main())')
        process = subprocess.Popen([sys.executable, '-c', code], env=self.env,
                                   stdout=self.log, stderr=self.log)
        self.processes.append(process)
        if expect_ready:
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                if (self.run / 'ready').exists():
                    return process
                if process.poll() is not None:
                    self.log.seek(0)
                    self.fail('Runtime startup failed: ' + self.log.read())
                time.sleep(0.1)
            self.fail('Database readiness timed out')
        return process

    def sql(self, sql, database='development', password=None, check=True):
        command = '. "$1"; psql -X -At -v ON_ERROR_STOP=1 -d "$2"'
        env = self.env.copy()
        if password is not None:
            command = '. "$1"; export PGPASSWORD=incorrect; psql -X -At -d "$2"'
        return subprocess.run(['runuser', '-u', 'byclaw', '--', 'bash', '-c', command,
                               'check', str(self.run / 'client/database.env'), database],
                              input=sql, text=True, capture_output=True, check=check, env=env, timeout=10)

    def stop(self, process):
        process.terminate()
        self.assertEqual(process.wait(timeout=40), 0)
        self.assertFalse((self.run / 'ready').exists())
        self.assertFalse((self.run / 'client/database.env').exists())
        state = subprocess.check_output(['runuser', '-u', 'postgres', '--',
                                         '/usr/lib/postgresql/17/bin/pg_controldata', str(self.data)], text=True)
        self.assertRegex(state, r'Database cluster state:\s+shut down')

    def test_real_vector_authentication_roles_and_project_database(self):
        process = self.start()
        self.assertEqual(self.sql('SELECT current_user;').stdout.strip(), 'byclaw')
        self.assertEqual(self.sql('SELECT rolsuper FROM pg_roles WHERE rolname=current_user;').stdout.strip(), 'f')
        self.assertAlmostEqual(float(self.sql("SELECT '[1,0]'::vector <-> '[0,1]'::vector;").stdout), 2 ** 0.5)
        self.sql('CREATE DATABASE project_test;')
        self.assertTrue(self.sql("SELECT extversion FROM pg_extension WHERE extname='vector';", 'project_test').stdout.strip())
        self.assertNotEqual(self.sql('SELECT 1;', password='incorrect', check=False).returncode, 0)
        self.assertNotEqual(self.sql('ALTER ROLE byclaw SUPERUSER;', check=False).returncode, 0)
        self.assertEqual((self.run / 'client/database.env').stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.sql('SHOW listen_addresses;').stdout.strip(), '127.0.0.1')
        self.stop(process)

    def test_restart_preserves_data_and_rotates_runtime_credentials(self):
        process = self.start()
        self.sql('CREATE TABLE recovery_test(value int); INSERT INTO recovery_test VALUES(42);')
        before = (self.run / 'client/database.env').read_text()
        self.stop(process)
        process = self.start()
        self.assertEqual(self.sql('SELECT value FROM recovery_test;').stdout.strip(), '42')
        self.assertNotEqual(before, (self.run / 'client/database.env').read_text())
        self.stop(process)

    def test_empty_root_owned_volume_can_initialize(self):
        self.data.mkdir(parents=True)
        self.assertEqual(self.data.stat().st_uid, 0)
        process = self.start()
        self.assertEqual(self.data.stat().st_uid, runtime.pwd.getpwnam('postgres').pw_uid)
        self.assertEqual(self.sql('SELECT 1;').stdout.strip(), '1')
        self.stop(process)

    def test_wrong_major_version_is_not_reinitialized(self):
        self.data.mkdir(parents=True)
        os.chown(self.data, runtime.pwd.getpwnam('postgres').pw_uid, runtime.pwd.getpwnam('postgres').pw_gid)
        (self.data / 'PG_VERSION').write_text('16\n')
        process = self.start(False)
        self.assertNotEqual(process.wait(timeout=10), 0)
        self.assertEqual((self.data / 'PG_VERSION').read_text(), '16\n')
        self.assertFalse((self.run / 'ready').exists())

    def test_second_owner_cannot_start_or_interrupt_first(self):
        first = self.start()
        second = self.start(False)
        self.assertNotEqual(second.wait(timeout=10), 0)
        self.assertIsNone(first.poll())
        self.assertEqual(self.sql('SELECT 1;').stdout.strip(), '1')
        self.stop(first)

    def test_existing_unrecognized_directory_is_preserved(self):
        self.data.mkdir(parents=True)
        os.chown(self.data, runtime.pwd.getpwnam('postgres').pw_uid, runtime.pwd.getpwnam('postgres').pw_gid)
        marker = self.data / 'keep.txt'
        marker.write_text('user data')
        process = self.start(False)
        self.assertNotEqual(process.wait(timeout=10), 0)
        self.assertEqual(marker.read_text(), 'user data')
        self.assertFalse((self.data / 'PG_VERSION').exists())

    def test_tool_failure_stops_database_and_returns_exit_code(self):
        self.tools.write_text('#!/bin/sh\nexit 7\n')
        process = self.start(False)
        self.assertEqual(process.wait(timeout=20), 7)
        self.assertFalse((self.run / 'ready').exists())
        self.assertFalse((self.data / 'postmaster.pid').exists())

    def test_database_failure_stops_tools(self):
        process = self.start()
        postgres_pid = int((self.data / 'postmaster.pid').read_text().splitlines()[0])
        os.kill(postgres_pid, signal.SIGINT)
        self.assertNotEqual(process.wait(timeout=20), 0)
        self.assertFalse((self.run / 'ready').exists())


if __name__ == '__main__':
    unittest.main()
