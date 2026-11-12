"""Tool sandbox entrypoint: SSH stays up while services and workloads come and go."""
from pathlib import Path
import getpass
import importlib.util
import json
import os
import signal
import subprocess
import sys
import tempfile
import textwrap
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / 'middleware/byclaw-harness/plugins/dsh-tool-env/scripts'
ENTRYPOINT = SCRIPTS / 'tool-base-entrypoint.py'
WORKLOAD = SCRIPTS / 'tool-workload.sh'

spec = importlib.util.spec_from_file_location('tool_base_entrypoint', ENTRYPOINT)
entrypoint = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = entrypoint
spec.loader.exec_module(entrypoint)


def declare(directory: Path, name: str, body: dict) -> None:
    (directory / f'{name}.json').write_text(json.dumps(body))


class ServiceDeclarationTest(unittest.TestCase):
    def test_defaults_skips_and_invalid_declarations(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            declare(directory, '10-browser', {'name': 'browser', 'command': ['/bin/true'], 'user': 'root'})
            declare(directory, '20-guard', {'name': 'guard', 'command': ['/bin/true'], 'group': 'transport'})
            declare(directory, '30-bycli', {'name': 'bycli', 'command': ['/bin/true'],
                                            'skipIfEnv': {'BYCLAW_BYCLI_ENABLED': ['false', '0']}})
            declare(directory, '40-bad', {'name': 'Bad Name', 'command': ['/bin/true']})
            declare(directory, '50-empty', {'name': 'empty', 'command': []})
            (directory / '60-broken.json').write_text('{')
            services = entrypoint.load_services(directory, {'BYCLAW_BYCLI_ENABLED': 'false'})
        self.assertEqual([service.name for service in services], ['browser', 'guard'])
        browser, guard = services
        self.assertEqual((browser.group, browser.oom_score_adj, browser.restart, browser.user), ('work', 500, 'always', 'root'))
        self.assertEqual((guard.group, guard.oom_score_adj), ('transport', -1000))

    def test_missing_directory_declares_nothing(self):
        self.assertEqual(entrypoint.load_services(Path('/nonexistent/services.d'), {}), [])


class IsolationTest(unittest.TestCase):
    def fake_root(self, directory: Path, controllers: str) -> Path:
        # A real cgroupfs creates control files on mkdir; the fake creates them up front.
        (directory / 'cgroup.controllers').write_text(controllers)
        (directory / 'cgroup.subtree_control').write_text('')
        parent = directory / 'byclaw'
        for group in (parent, parent / 'transport', parent / 'work'):
            group.mkdir(parents=True)
            (group / 'cgroup.procs').write_text('')
            (group / 'cgroup.subtree_control').write_text('')
        return directory

    def test_creates_transport_floor_and_work_cap(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = self.fake_root(Path(temporary), 'cpuset cpu io memory pids')
            total = 961 * entrypoint.MIB
            isolation = entrypoint.setup_isolation(root, os.getuid(), os.getgid(), total)
            self.assertEqual(isolation.mode, 'cgroup')
            self.assertEqual((root / 'cgroup.subtree_control').read_text(), '+memory')
            self.assertEqual((root / 'byclaw/cgroup.subtree_control').read_text(), '+memory')
            self.assertEqual(int((root / 'byclaw/transport/memory.min').read_text()), entrypoint.TRANSPORT_MEMORY_MIN)
            self.assertEqual(int((root / 'byclaw/work/memory.max').read_text()), total - entrypoint.WORK_MEMORY_RESERVE)

    def test_falls_back_without_a_memory_controller(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = self.fake_root(Path(temporary), 'cpu pids')
            isolation = entrypoint.setup_isolation(root, os.getuid(), os.getgid(), 1024 * entrypoint.MIB)
        self.assertEqual((isolation.mode, isolation.work), ('oom-score', None))

    def test_work_cap_never_below_half_the_machine(self):
        self.assertEqual(entrypoint.work_memory_max(300 * entrypoint.MIB), 150 * entrypoint.MIB)


class WorkloadWrapperTest(unittest.TestCase):
    def run_wrapped(self, state: Path) -> list[str]:
        result = subprocess.run(
            ['sh', str(WORKLOAD), 'sh', '-c', 'echo $$; cat /proc/$$/oom_score_adj'],
            env={**os.environ, 'BYCLAW_TOOL_ISOLATION_FILE': str(state)},
            capture_output=True, text=True, timeout=10, check=True,
        )
        return result.stdout.split()

    def test_joins_work_and_raises_its_oom_score_in_place(self):
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary) / 'work'
            work.mkdir()
            (work / 'cgroup.procs').write_text('')
            state = Path(temporary) / 'isolation'
            entrypoint.write_isolation_state(state, entrypoint.Isolation('cgroup', None, work))
            pid, score = self.run_wrapped(state)
            self.assertEqual((work / 'cgroup.procs').read_text().strip(), pid)
        self.assertEqual(score, '500')

    def test_runs_the_command_without_isolation_state(self):
        pid, score = self.run_wrapped(Path('/nonexistent/isolation'))
        self.assertTrue(pid.isdigit())

    def test_requires_a_command(self):
        result = subprocess.run(['sh', str(WORKLOAD)], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 2)


DRIVER = textwrap.dedent('''
    import importlib.util, sys
    spec = importlib.util.spec_from_file_location('e', sys.argv[1])
    e = importlib.util.module_from_spec(spec); sys.modules['e'] = e; spec.loader.exec_module(e)
    e.RESTART_MAX_DELAY = 0.5
    user, flaky, steady = sys.argv[2], sys.argv[3], sys.argv[4]
    services = [
        e.Service('flaky', ['sh', '-c', f'echo run >> {flaky}; exit 3'], user, 'work', 500),
        e.Service('steady', ['sh', '-c', f'echo $$ > {steady}; exec sleep 60'], user, 'transport', 0),
    ]
    raise SystemExit(e.Entrypoint(e.Isolation('oom-score'), services, {'PATH': '/usr/bin:/bin'}).run())
''')


class SupervisionTest(unittest.TestCase):
    def test_restarts_a_failing_service_without_touching_the_others(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            driver = directory / 'driver.py'
            driver.write_text(DRIVER)
            flaky, steady = directory / 'flaky.log', directory / 'steady.pid'
            process = subprocess.Popen([sys.executable, str(driver), str(ENTRYPOINT), getpass.getuser(), str(flaky), str(steady)],
                                       stderr=subprocess.PIPE, text=True)
            try:
                deadline = time.monotonic() + 10
                while not (flaky.exists() and len(flaky.read_text().split()) >= 3 and steady.exists()):
                    if process.poll() is not None:
                        self.fail(f'entrypoint exited early: {process.communicate()[1]}')
                    self.assertLess(time.monotonic(), deadline, 'flaky service was not restarted')
                    time.sleep(0.05)
                steady_pid = int(steady.read_text())
                os.kill(steady_pid, 0)  # still the first instance: the flaky restarts left it alone
                self.assertEqual(int(steady.read_text()), steady_pid)
            finally:
                process.send_signal(signal.SIGTERM)
                _, stderr = process.communicate(timeout=15)
            self.assertEqual(process.returncode, 0, stderr)
            self.assertIn('flaky exited with 3', stderr)
            with self.assertRaises(ProcessLookupError):
                os.kill(steady_pid, 0)


class ImageWiringTest(unittest.TestCase):
    HARNESS = ROOT / 'middleware/byclaw-harness'

    def test_base_slim_runs_the_entrypoint_and_ships_the_wrapper(self):
        source = (self.HARNESS / 'Dockerfile.tools.base-slim').read_text()
        self.assertIn('tool-base-entrypoint.py /usr/local/bin/byclaw-tool-base-entrypoint', source)
        self.assertIn('tool-workload.sh /usr/local/bin/byclaw-tool-workload', source)
        self.assertIn('ln -s /usr/local/bin/byclaw-tool-base-entrypoint /usr/local/bin/byclaw-dsh-entrypoint', source)
        self.assertNotIn('ln -s /usr/local/bin/byclaw-tool-env-sshd', source)
        ignore = (self.HARNESS / 'Dockerfile.tools.base-slim.dockerignore').read_text()
        for name in ('tool-base-entrypoint.py', 'tool-workload.sh'):
            self.assertIn(f'!middleware/byclaw-harness/plugins/dsh-tool-env/scripts/{name}', ignore)

    def test_browser_runs_as_a_declared_service(self):
        declaration = json.loads((self.HARNESS / 'tool-sandbox/services.d/browser.json').read_text())
        self.assertEqual(declaration['command'][0], '/usr/local/bin/byclaw-browser-supervisor')
        self.assertIn('--browser-service', declaration['command'])
        self.assertNotIn('--', declaration['command'])
        self.assertEqual((declaration['group'], declaration['oomScoreAdj']), ('work', 500))
        for name in ('Dockerfile.tools.browser', 'Dockerfile.tool_slim'):
            self.assertIn('services.d/browser.json /etc/byclaw-tool-sandbox/services.d/browser.json',
                          (self.HARNESS / name).read_text(), name)


if __name__ == '__main__':
    unittest.main()
