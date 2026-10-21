"""Run the installer against temporary paths without installing system packages."""

import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parents[1] / 'byclaw-harness/scripts'


class SearchRuntimeInstallTest(unittest.TestCase):
    def run_installer(self, fail=False):
        temporary = tempfile.TemporaryDirectory(prefix='byclaw-search-install-')
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        tools = root / 'bin'
        tools.mkdir()
        installed = root / 'opt'
        log = root / 'commands.log'
        fake_python = tools / 'python3'
        fake_python.write_text(f'#!{sys.executable}\n' + '''
import pathlib, sys
assert sys.argv[1:3] == ['-m', 'venv']
binary = pathlib.Path(sys.argv[3]) / 'bin/python'
binary.parent.mkdir(parents=True)
binary.write_text('#!/bin/sh\\nprintf "%s\\n" "$*" >> "$INSTALL_LOG"\\n[ "${FAIL_PIP:-}" != 1 ]\\n')
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
                                         INSTALL_LOG=str(log), FAIL_PIP='1' if fail else ''),
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


if __name__ == '__main__':
    unittest.main()
