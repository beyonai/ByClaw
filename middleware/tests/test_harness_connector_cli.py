"""Exercise the connector install RUN instructions without Docker or network access."""
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
HARNESS = ROOT / 'middleware/byclaw-harness'
DOCKERFILES = ('Dockerfile', 'Dockerfile.slim')
VERSION_ARGS = ('WECOM_CLI_VERSION', 'LARKSUITE_CLI_VERSION')

NPM_STUB = r"""#!/bin/sh
printf 'npm %s\n' "$*" >> "$COMMAND_LOG"
if [ "$1" = install ] && [ "${FAIL_INSTALL:-}" = 1 ]; then exit 23; fi
if [ "$1" = root ]; then printf '/mock/node_modules\n'; fi
"""

NODE_STUB = r"""#!/bin/sh
printf 'node %s\n' "$*" >> "$COMMAND_LOG"
if [ "${FAIL_NODE_SCRIPT:-}" = "$1" ]; then exit 24; fi
"""

CLI_STUB = r"""#!/bin/sh
tool="${0##*/}"
printf '%s %s user=%s\n' "$tool" "$*" "${MOCK_USER:-root}" >> "$COMMAND_LOG"
case "$tool" in
    wecom-cli) version="${WECOM_OUTPUT_VERSION:-$WECOM_CLI_VERSION}"; prefix=wecom-cli ;;
    lark-cli) version="$LARKSUITE_CLI_VERSION"; prefix='lark-cli version' ;;
esac
if [ "${WRONG_VERSION:-}" = "$tool" ]; then version=0.0.0; fi
case "$1" in
    --version)
        printf '%s %s\n' "$prefix" "$version"
        if [ "${MOCK_USER:-root}" = byclaw ] && [ "${FAIL_RUNTIME_VERSION:-}" = "$tool" ]; then exit 25; fi
        [ "${FAIL_VERSION:-}" != "$tool" ] ;;
    --help)
        # WeCom 1.x help fetches discovery and must never run during an image build.
        [ "$tool" != wecom-cli ] && [ "${FAIL_HELP:-}" != "$tool" ] ;;
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
        stages = re.split(r'^FROM ', text, flags=re.MULTILINE)
        connector_stages = [stage for stage in stages if stage.splitlines()[0].endswith(' AS connector-tools')]
        self.assertEqual(len(connector_stages), 1, f'{name}: missing connector-tools stage')
        connector = connector_stages[0]
        runtime = text.rsplit('\nFROM ', 1)[-1]
        versions = {}
        openclaw = (ROOT / 'middleware/openclaw/Dockerfile').read_text()
        for argument in VERSION_ARGS:
            pattern = rf'^ARG {argument}=(\d+\.\d+\.\d+)$'
            actual = re.search(pattern, connector, re.MULTILINE)
            expected = re.search(pattern, openclaw, re.MULTILINE)
            self.assertIsNotNone(actual, f'{name}: missing pinned connector {argument}')
            self.assertIsNotNone(expected, f'OpenClaw: missing pinned {argument}')
            self.assertEqual(actual.group(1), expected.group(1), f'{name}: {argument} drift')
            versions[argument] = actual.group(1)

        instructions = connector.replace('\\\n', ' ').splitlines()
        installs = [line for line in instructions if line.startswith('RUN ') and '@wecom/cli@' in line]
        self.assertEqual(len(installs), 1, f'{name}: expected one connector installation')
        install = installs[0]
        previous_users = [line for line in instructions[:instructions.index(install)] if line.startswith('USER ')]
        self.assertTrue(previous_users, f'{name}: missing installation user')
        self.assertEqual(previous_users[-1], 'USER root')
        self.assertIn('"@wecom/cli@${WECOM_CLI_VERSION}"', install)
        self.assertIn('"@larksuite/cli@${LARKSUITE_CLI_VERSION}"', install)
        self.assertIn('--ignore-scripts', install)
        self.assertIn('node /tmp/lark-mirror-first.mjs', install)
        self.assertIn('node "$(npm root -g)/@larksuite/cli/scripts/install.js"', install)
        if name == 'Dockerfile.slim':
            self.assertIn('scripts/install.js" --mirror-only', install)
        for scope, binary in (('@wecom', 'cli/bin/wecom.js'), ('@larksuite', 'cli/scripts/run.js')):
            self.assertIn(
                f'COPY --from=connector-tools /opt/nvm/current/lib/node_modules/{scope}/ '
                f'/opt/nvm/current/lib/node_modules/{scope}/', runtime,
            )
            self.assertIn(f'ln -sf ../lib/node_modules/{scope}/{binary}', runtime)
        return install.removeprefix('RUN '), versions

    def run_install(self, name, overrides=None, missing=None):
        command, versions = self.install_contract(name)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            scripts = {'npm': NPM_STUB, 'node': NODE_STUB, 'wecom-cli': CLI_STUB,
                       'lark-cli': CLI_STUB, 'su': SU_STUB}
            for executable, script in scripts.items():
                if executable == missing:
                    continue
                path = root / executable
                path.write_text(script)
                path.chmod(0o755)
            (root / 'awk').symlink_to(shutil.which('awk'))
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
                    'npm install --global --ignore-scripts --no-audit --no-fund --update-notifier=false '
                    f'@wecom/cli@{versions["WECOM_CLI_VERSION"]} '
                    f'@larksuite/cli@{versions["LARKSUITE_CLI_VERSION"]}', log,
                )
                for executable in ('wecom-cli', 'lark-cli'):
                    self.assertIn(f'{executable} --version user=root', log)
                self.assertIn('wecom-cli --version user=byclaw', log)
                self.assertNotIn('wecom-cli --help', log)
                self.assertIn('lark-cli --help user=byclaw', log)
                patch_installer = 'node /tmp/lark-mirror-first.mjs /mock/node_modules/@larksuite/cli/scripts/install.js'
                if name == 'Dockerfile.slim':
                    patch_installer += ' --mirror-only'
                self.assertIn(f'{patch_installer}\n', log)
                self.assertIn('node /mock/node_modules/@larksuite/cli/scripts/install.js', log)
                self.assertIn('npm cache clean --force', log)

    def test_wecom_build_metadata_is_accepted_but_other_versions_are_rejected(self):
        for name in DOCKERFILES:
            _, versions = self.install_contract(name)
            version = versions['WECOM_CLI_VERSION']
            for actual, success in (
                (f'{version} (wecom 2026-09-23T11:50:48Z f9b2815)', True),
                ('1.3.40', False),
                ('0.1.9 (wecom 2026-09-23T11:50:48Z f9b2815)', False),
                (f'{version}-rc.1', False),
                (f'{version} unexpected', False),
                (f'{version} (wecom 2026-09-23T11:50:48Z f9b2815) garbage', False),
                (f'{version}\nwecom-cli 0.1.9', False),
                (f'{version} (wecom 2026-09-23T11:50:48Z f9b2815)\nwecom-cli {version}', False),
            ):
                with self.subTest(dockerfile=name, output_version=actual):
                    result, log = self.run_install(name, {'WECOM_OUTPUT_VERSION': actual})
                    self.assertEqual(result.returncode == 0, success, result.stderr)
                    if not success:
                        self.assertNotIn('npm cache clean', log)

    def test_upgraded_execution_images_pin_the_same_wecom_version(self):
        _, versions = self.install_contract('Dockerfile')
        for relative_path in (
            'middleware/openclaw/Dockerfile',
            'byclaw-be/Dockerfile',
        ):
            text = (ROOT / relative_path).read_text()
            with self.subTest(dockerfile=relative_path):
                actual = re.search(r'^ARG WECOM_CLI_VERSION=(\S+)$', text, re.MULTILINE)
                self.assertIsNotNone(actual)
                self.assertEqual(actual.group(1), versions['WECOM_CLI_VERSION'])

    def test_backend_version_checks_reject_wrong_and_malformed_cli_versions(self):
        for name in ('Dockerfile',):
            text = (ROOT / 'byclaw-be' / name).read_text()
            lines = text.replace('\\\n', '\n').splitlines()
            check = [line.strip().removeprefix('&& ') for line in lines
                     if 'wecom_version=' in line or '"${wecom_version}" | awk' in line]
            with self.subTest(dockerfile=name):
                self.assertEqual(len(check), 2, 'BE must validate the actual installed version')
                self.assertNotIn('wecom-cli --help', text)
            for actual, success in (
                ('1.3.4 (wecom 2026-09-23T11:50:48Z f9b2815)', True),
                ('0.1.9', False),
                ('1.3.40', False),
                ('1.3.4\nwecom-cli 1.3.4', False),
            ):
                with self.subTest(dockerfile=name, output=actual), tempfile.TemporaryDirectory() as directory:
                    root = Path(directory)
                    cli = root / 'wecom-cli'
                    cli.write_text(CLI_STUB)
                    cli.chmod(0o755)
                    (root / 'awk').symlink_to(shutil.which('awk'))
                    result = subprocess.run(['/bin/sh', '-c', ' && '.join(check)], env={
                        'PATH': str(root), 'HOME': str(root), 'COMMAND_LOG': str(root / 'commands.log'),
                        'WECOM_CLI_VERSION': '1.3.4', 'WECOM_OUTPUT_VERSION': actual,
                    }, capture_output=True, text=True, timeout=10)
                    self.assertEqual(result.returncode == 0, success, result.stderr)

    def test_explicit_lark_setup_failure_stops_before_cli_checks(self):
        for name in DOCKERFILES:
            for script in ('/tmp/lark-mirror-first.mjs', '/mock/node_modules/@larksuite/cli/scripts/install.js'):
                with self.subTest(dockerfile=name, script=script):
                    result, log = self.run_install(name, {'FAIL_NODE_SCRIPT': script})
                    self.assertNotEqual(result.returncode, 0)
                    self.assertNotIn('--version', log)
                    self.assertNotIn('npm cache clean', log)

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
                failures = ['WRONG_VERSION', 'FAIL_VERSION', 'MISSING']
                failures.append('FAIL_RUNTIME_VERSION' if executable == 'wecom-cli' else 'FAIL_HELP')
                for failure in failures:
                    with self.subTest(dockerfile=name, executable=executable, failure=failure):
                        result, log = self.run_install(
                            name, {failure: executable}, executable if failure == 'MISSING' else None,
                        )
                        self.assertNotEqual(result.returncode, 0, log)
                        self.assertNotIn('npm cache clean', log)


if __name__ == '__main__':
    unittest.main()
