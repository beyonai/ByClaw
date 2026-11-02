"""Run the installer against temporary paths without installing system packages."""

import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parents[1] / 'byclaw-harness/scripts'


class SearchRuntimeInstallTest(unittest.TestCase):
    def run_installer(self, fail=False, extra_env=None):
        temporary = tempfile.TemporaryDirectory(prefix='byclaw-search-install-')
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        tools = root / 'bin'
        tools.mkdir()
        installed = root / 'opt'
        log = root / 'commands.log'
        fake_python = tools / 'python3'
        fake_python.write_text(f'#!{sys.executable}\n' + '''
import os, pathlib, sys
if sys.argv[1:3] != ['-m', 'venv']:
    os.execv(sys.executable, [sys.executable, *sys.argv[1:]])
binary = pathlib.Path(sys.argv[3]) / 'bin/python'
binary.parent.mkdir(parents=True)
binary.write_text('#!' + sys.executable + '\\n' + """
import json, os, pathlib, sys, time
pathlib.Path(os.environ['INSTALL_LOG']).write_text(' '.join(sys.argv[1:]) + chr(10))
pathlib.Path(os.environ['INSTALL_LOG'] + '.env').write_text(json.dumps({k:os.environ.get(k) for k in ['PIP_CONFIG_FILE', 'PIP_EXTRA_INDEX_URL']}))
if os.environ.get('HANG_PIP') == '1': time.sleep(60)
sys.exit(1 if os.environ.get('FAIL_PIP') == '1' else 0)
""")
binary.chmod(0o755)
''')
        fake_python.chmod(0o755)
        fixture_scripts = root / 'scripts'
        (fixture_scripts / 'searxng-cli').mkdir(parents=True)
        for name in ('launcher.sh', 'runtime.py'):
            (fixture_scripts / 'searxng-cli' / name).write_bytes((SCRIPTS / 'searxng-cli' / name).read_bytes())
        source = (SCRIPTS / 'install-search-runtime.sh').read_text()
        installer = fixture_scripts / 'install-search-runtime.sh'
        installer.write_text(source.replace('/opt/', f'{installed}/')
                             .replace('/usr/local/bin/', f'{tools}/'))
        settings = root / 'settings.yml'
        settings.write_text('use_default_settings: true\n')
        constraints = root / 'constraints.txt'
        constraints.write_text('')
        result = subprocess.run(['sh', str(installer), str(settings), str(constraints)],
                                env=dict(os.environ, PATH=f'{tools}:{os.environ["PATH"]}',
                                         INSTALL_LOG=str(log), FAIL_PIP='1' if fail else '',
                                         **(extra_env or {})),
                                text=True, capture_output=True, timeout=10)
        return result, installed, tools, log

    def test_installation_stages_runtime_without_initializing_engines(self):
        result, installed, tools, log = self.run_installer()
        self.assertEqual(result.returncode, 0, result.stderr)
        commands = log.read_text().splitlines()
        self.assertEqual(len(commands), 1, commands)
        self.assertTrue(commands[0].startswith('-m pip install '))
        self.assertNotIn('--list-engines', commands[0])
        self.assertTrue((installed / 'searxng-cli/runtime.py').is_file())
        self.assertTrue((tools / 'searxng-cli').is_symlink())

    def test_dependency_install_failure_stops_installation(self):
        result, installed, _, _ = self.run_installer(fail=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((installed / 'searxng-cli/runtime.py').exists())

    def test_online_install_uses_only_tsinghua_even_with_inherited_extra_index(self):
        import json
        result, _, _, log = self.run_installer(extra_env={'PIP_EXTRA_INDEX_URL': 'https://pypi.org/simple'})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('--index-url https://pypi.tuna.tsinghua.edu.cn/simple', log.read_text())
        self.assertNotIn('--extra-index-url', log.read_text())
        env = json.loads(Path(str(log) + '.env').read_text())
        self.assertFalse(env['PIP_EXTRA_INDEX_URL'])
        self.assertEqual(env['PIP_CONFIG_FILE'], os.devnull)

    def test_total_deadline_stops_a_continuously_slow_download(self):
        result, installed, _, _ = self.run_installer(extra_env={
            'HANG_PIP': '1', 'SEARXNG_INSTALL_TIMEOUT_SECONDS': '0.2',
        })
        self.assertEqual(result.returncode, 124, result.stderr)
        self.assertIn('total deadline', result.stderr)
        self.assertFalse((installed / 'searxng-cli/runtime.py').exists())

    def test_offline_wheelhouse_remains_offline(self):
        result, _, _, log = self.run_installer(extra_env={'SEARXNG_WHEELHOUSE': '/fixture/wheels'})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('--no-index --find-links /fixture/wheels', log.read_text())
        self.assertNotIn('--index-url', log.read_text())

    def test_invalid_deadline_fails_before_pip(self):
        result, _, _, log = self.run_installer(extra_env={'SEARXNG_INSTALL_TIMEOUT_SECONDS': '0'})
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(log.exists())


if __name__ == '__main__':
    unittest.main()
