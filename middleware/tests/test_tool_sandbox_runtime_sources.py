"""Exercise persistent download defaults in an isolated filesystem, without network."""
from pathlib import Path
import os
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'byclaw-harness/tool-sandbox/configure-cn-sources.sh'


class ToolSandboxRuntimeSourcesTest(unittest.TestCase):
    def test_configuration_survives_login_shell_and_preserves_unrelated_session_values(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            etc = root / 'etc'
            (etc / 'apt/sources.list.d').mkdir(parents=True)
            (etc / 'apt/sources.list.d/debian.sources').write_text(
                'Types: deb\nURIs: https://deb.debian.org/debian\nSuites: trixie\n')
            (etc / 'apt/sources.list').write_text(
                'deb https://security.debian.org/debian-security trixie-security main\n')
            session = etc / 'byclaw-tool-env.session-env'
            session.write_text('KEEP_ME=kept\nPLAYWRIGHT_DOWNLOAD_HOST=https://old.invalid\nMAVEN_ARGS=old\n')
            executable_dir = root / 'bin'
            executable_dir.mkdir()
            npm = executable_dir / 'npm'
            npm.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >>"$NPM_TEST_LOG"\n')
            npm.chmod(0o755)
            # Normalize GNU in-place syntax on macOS; transformations use real sed.
            sed = executable_dir / 'sed'
            sed.write_text(
                f'#!{sys.executable}\nimport subprocess, sys\nfrom pathlib import Path\n'
                'args = sys.argv[1:]\n'
                'if args[0] == "-i":\n'
                ' result = subprocess.run(["/usr/bin/sed", *args[1:]], capture_output=True, check=True)\n'
                ' Path(args[-1]).write_bytes(result.stdout)\n'
                'else:\n'
                ' subprocess.run(["/usr/bin/sed", *args], check=True)\n')
            sed.chmod(0o755)
            isolated = root / 'configure.sh'
            isolated.write_text(SCRIPT.read_text().replace('/etc/', str(etc) + '/'))
            environment = dict(os.environ, PATH=str(executable_dir) + os.pathsep + os.environ['PATH'],
                               NPM_TEST_LOG=str(root / 'npm.log'))
            subprocess.run(['bash', str(isolated)], env=environment, check=True, capture_output=True)
            self.assertTrue((etc / 'byclaw-tool-sandbox/maven-settings.xml').is_file())
            self.assertFalse((etc / 'maven').exists())
            # A later Debian Maven install receives the global policy on reapply.
            (etc / 'maven').mkdir()
            subprocess.run(['bash', str(isolated)], env=environment, check=True, capture_output=True)
            self.assertIn('https://mirrors.aliyun.com/debian-security', (etc / 'apt/sources.list').read_text())
            self.assertNotIn('deb.debian.org', (etc / 'apt/sources.list.d/debian.sources').read_text())
            self.assertIn('index-url = https://pypi.tuna.tsinghua.edu.cn/simple', (etc / 'pip.conf').read_text())
            self.assertIn('python-downloads = "never"', (etc / 'uv/uv.toml').read_text())
            self.assertEqual((etc / 'maven/settings.xml').read_bytes(),
                             (etc / 'byclaw-tool-sandbox/maven-settings.xml').read_bytes())
            persisted = session.read_text()
            self.assertIn('KEEP_ME=kept\n', persisted)
            self.assertEqual(persisted.count('\nPLAYWRIGHT_DOWNLOAD_HOST='), 1)
            self.assertIn('MAVEN_ARGS=--settings ' + str(etc) + '/byclaw-tool-sandbox/maven-settings.xml\n', persisted)
            profile = etc / 'profile.d/byclaw-domestic-sources.sh'
            result = subprocess.run(['bash', '-c', '. "$1"; printf "%s\\n" "$PLAYWRIGHT_DOWNLOAD_HOST" '
                                     '"$PUPPETEER_CHROME_DOWNLOAD_BASE_URL" "$MAVEN_ARGS" "$PIP_EXTRA_INDEX_URL"',
                                     'test', str(profile)], env=environment, check=True, capture_output=True, text=True)
            self.assertEqual(result.stdout.splitlines(), [
                'https://npmmirror.com/mirrors/playwright',
                'https://npmmirror.com/mirrors/chrome-for-testing',
                '--settings ' + str(etc) + '/byclaw-tool-sandbox/maven-settings.xml', ''])
            self.assertIn('config set registry https://registry.npmmirror.com --location=global',
                          (root / 'npm.log').read_text())


if __name__ == '__main__':
    unittest.main()
