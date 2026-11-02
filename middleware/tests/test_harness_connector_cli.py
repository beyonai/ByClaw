"""Exercise the connector install RUN instructions without Docker or network access."""
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
HARNESS = ROOT / 'middleware/byclaw-harness'
DOCKERFILES = ('Dockerfile', 'Dockerfile.extensions')
VERSION_ARGS = ('WECOM_CLI_VERSION', 'LARKSUITE_CLI_VERSION')

NPM_STUB = r"""#!/bin/sh
printf 'npm %s\n' "$*" >> "$COMMAND_LOG"
if [ "$1" = install ] && [ "${FAIL_INSTALL:-}" = 1 ]; then exit 23; fi
"""

CLI_STUB = r"""#!/bin/sh
tool="${0##*/}"
printf '%s %s user=%s\n' "$tool" "$*" "${MOCK_USER:-root}" >> "$COMMAND_LOG"
case "$tool" in
    wecom-cli) version="$WECOM_CLI_VERSION"; prefix=wecom-cli ;;
    lark-cli) version="$LARKSUITE_CLI_VERSION"; prefix='lark-cli version' ;;
esac
if [ "${WRONG_VERSION:-}" = "$tool" ]; then version=0.0.0; fi
case "$1" in
    --version)
        printf '%s %s\n' "$prefix" "$version"
        [ "${FAIL_VERSION:-}" != "$tool" ] ;;
    --help) [ "${FAIL_HELP:-}" != "$tool" ] ;;
    *) exit 2 ;;
esac
"""

# Model the child command boundary only; real user permissions require an image build.
SU_STUB = r"""#!/bin/sh
[ "$#" -eq 5 ] && [ "$1" = -s ] && [ "$2" = /bin/sh ] \
    && [ "$3" = byclaw ] && [ "$4" = -c ] || exit 2
export MOCK_USER="$3"
exec /bin/sh -c "$5"
"""


class HarnessConnectorCliTest(unittest.TestCase):
    def install_contract(self, name):
        text = (HARNESS / name).read_text()
        runtime = text.rsplit('\nFROM ', 1)[-1]
        versions = {}
        openclaw = (ROOT / 'middleware/openclaw/Dockerfile').read_text()
        for argument in VERSION_ARGS:
            pattern = rf'^ARG {argument}=(\d+\.\d+\.\d+)$'
            actual = re.search(pattern, runtime, re.MULTILINE)
            expected = re.search(pattern, openclaw, re.MULTILINE)
            self.assertIsNotNone(actual, f'{name}: missing pinned runtime {argument}')
            self.assertIsNotNone(expected, f'OpenClaw: missing pinned {argument}')
            self.assertEqual(actual.group(1), expected.group(1), f'{name}: {argument} drift')
            versions[argument] = actual.group(1)

        instructions = runtime.replace('\\\n', ' ').splitlines()
        installs = [line for line in instructions if line.startswith('RUN ') and '@wecom/cli@' in line]
        self.assertEqual(len(installs), 1, f'{name}: connector installation must be in the final stage')
        install = installs[0]
        previous_users = [line for line in instructions[:instructions.index(install)] if line.startswith('USER ')]
        self.assertTrue(previous_users, f'{name}: missing installation user')
        self.assertEqual(previous_users[-1], 'USER root')
        self.assertIn('"@wecom/cli@${WECOM_CLI_VERSION}"', install)
        self.assertIn('"@larksuite/cli@${LARKSUITE_CLI_VERSION}"', install)
        self.assertNotIn('--ignore-scripts', install)
        return install.removeprefix('RUN '), versions

    def run_install(self, name, overrides=None, missing=None):
        command, versions = self.install_contract(name)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            scripts = {'npm': NPM_STUB, 'wecom-cli': CLI_STUB, 'lark-cli': CLI_STUB, 'su': SU_STUB}
            for executable, script in scripts.items():
                if executable == missing:
                    continue
                path = root / executable
                path.write_text(script)
                path.chmod(0o755)
            log = root / 'commands.log'
            # An isolated PATH prevents accidentally invoking an installed CLI or npm.
            environment = {
                'PATH': str(root), 'HOME': str(root), 'COMMAND_LOG': str(log),
                **versions, **(overrides or {}),
            }
            result = subprocess.run(
                ['/bin/sh', '-c', command], env=environment,
                cwd=root, capture_output=True, text=True, timeout=10,
            )
            return result, log.read_text() if log.exists() else ''

    def test_installs_pinned_packages_and_checks_runtime_user(self):
        for name in DOCKERFILES:
            with self.subTest(dockerfile=name):
                result, log = self.run_install(name)
                self.assertEqual(result.returncode, 0, result.stderr)
                _, versions = self.install_contract(name)
                self.assertIn(
                    'npm install --global '
                    f'@wecom/cli@{versions["WECOM_CLI_VERSION"]} '
                    f'@larksuite/cli@{versions["LARKSUITE_CLI_VERSION"]}', log,
                )
                for executable in ('wecom-cli', 'lark-cli'):
                    self.assertIn(f'{executable} --version user=root', log)
                    self.assertIn(f'{executable} --help user=byclaw', log)
                self.assertIn('npm cache clean --force', log)

    def test_install_failure_stops_before_cli_checks(self):
        for name in DOCKERFILES:
            with self.subTest(dockerfile=name):
                result, log = self.run_install(name, {'FAIL_INSTALL': '1'})
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn('--version', log)
                self.assertNotIn('npm cache clean', log)

    def test_cli_failures_are_not_hidden_by_cache_cleanup(self):
        for name in DOCKERFILES:
            for executable in ('wecom-cli', 'lark-cli'):
                for failure in ('WRONG_VERSION', 'FAIL_VERSION', 'FAIL_HELP', 'MISSING'):
                    with self.subTest(dockerfile=name, executable=executable, failure=failure):
                        result, log = self.run_install(
                            name, {failure: executable}, executable if failure == 'MISSING' else None,
                        )
                        self.assertNotEqual(result.returncode, 0, log)
                        self.assertNotIn('npm cache clean', log)


if __name__ == '__main__':
    unittest.main()
