"""Disposable identities only; no model, production host, or user credentials."""
import base64
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
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'builtin/runtime-tools/server-ssh.py'
spec = importlib.util.spec_from_file_location('server_ssh', SCRIPT)
ssh = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ssh)


class ServerSshTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='byclaw-deploy-', dir='/tmp')
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.file = self.directory / 'context.json'
        public = b'ssh-ed25519'
        blob = len(public).to_bytes(4, 'big') + public + (32).to_bytes(4, 'big') + b'x' * 32
        self.data = dict(host='example.invalid', user='deploy', port='2222', root='/opt/apps/demo',
                         private_key='-----BEGIN OPENSSH PRIVATE KEY-----\nsynthetic-only\n-----END OPENSSH PRIVATE KEY-----\n',
                         host_key='ssh-ed25519 ' + base64.b64encode(blob).decode())
        self.environment = dict(os.environ, BYCLAW_DEPLOY_CONTEXT=str(self.file),
                                BYCLAW_DEPLOY_PRIVATE_KEY='must-not-reach-ssh')
        self.write()

    def write(self):
        self.file.write_text(json.dumps(self.data))
        self.file.chmod(0o600)

    def test_config_checks_and_context_never_use_persistent_paths(self):
        for env in ({}, {'BYCLAW_DEPLOY_CONTEXT': '/by/context.json'}):
            with self.assertRaises(ssh.DeploymentError):
                ssh.context(env)
        self.file.chmod(0o644)
        with self.assertRaises(ssh.DeploymentError):
            ssh.context(self.environment)
        self.file.unlink()
        other = self.directory / 'other'
        other.write_text('{}')
        self.file.symlink_to(other)
        with self.assertRaises(ssh.DeploymentError):
            ssh.context(self.environment)

    def test_rejects_injected_target_port_path_and_host_key(self):
        for field, value in [('host', '-oProxyCommand=bad'), ('host', 'host\nother'),
                             ('user', 'root;id'), ('port', '-1'), ('port', '65536'),
                             ('root', '/'), ('root', '/opt/../etc'), ('root', '/opt/a;id'),
                             ('host_key', 'ssh-ed25519 not-base64'), ('private_key', 'bad')]:
            with self.subTest(field=field, value=value):
                original = self.data[field]
                self.data[field] = value
                self.write()
                with self.assertRaises(ssh.DeploymentError):
                    ssh.context(self.environment)
                self.data[field] = original

    def test_strict_options_private_modes_literal_commands_and_failure_cleanup(self):
        paths = []
        command = 'printf "%s" "$HOME"; exit 7'
        def run(argv, environment):
            key = Path(argv[argv.index('-i') + 1])
            paths.append(key.parent)
            self.assertEqual(key.stat().st_mode & 0o777, 0o600)
            self.assertEqual(key.parent.stat().st_mode & 0o777, 0o700)
            self.assertIn('StrictHostKeyChecking=yes', argv)
            self.assertIn('IdentityAgent=none', argv)
            self.assertIn('ForwardAgent=no', argv)
            known = Path(next(x.split('=', 1)[1] for x in argv if x.startswith('UserKnownHostsFile=')))
            self.assertTrue(known.read_text().startswith('[example.invalid]:2222 ssh-ed25519 '))
            self.assertNotIn('synthetic-only', ' '.join(argv))
            self.assertEqual(argv[-1], "mkdir -p -- /opt/apps/demo && cd -- /opt/apps/demo && " + command)
            return 7
        with patch.object(ssh, 'run', run):
            self.assertEqual(ssh.main(['exec', command], self.environment), 7)
        self.assertTrue(paths)
        self.assertTrue(all(not path.exists() for path in paths))
        with patch.object(ssh, 'run', side_effect=KeyboardInterrupt), self.assertRaises(KeyboardInterrupt):
            ssh.main(['check'], self.environment)
        self.assertEqual(list(self.directory.iterdir()), [self.file])

    def test_root_is_optional_with_home_directory_default(self):
        for value in [None, '', '  ']:
            with self.subTest(value=value):
                if value is None:
                    self.data.pop('root', None)
                else:
                    self.data['root'] = value
                self.write()
                data, _ = ssh.context(self.environment)
                self.assertEqual(ssh.remote_path(data, 'easel/source.tar.gz'), 'apps/easel/source.tar.gz')
                calls = []
                with patch.object(ssh, 'run', side_effect=lambda argv, env: calls.append(argv) or 0):
                    self.assertEqual(ssh.main(['exec', 'pwd'], self.environment), 0)
                self.assertEqual(calls[0][-1], 'mkdir -p -- "$HOME"/apps && cd -- "$HOME"/apps && pwd')

    def test_minimal_host_and_private_key_use_defaults_and_persistent_first_use_trust(self):
        trust = self.directory / '.server-deploy'
        trust.mkdir(mode=0o700)
        self.data = {k: self.data[k] for k in ['host', 'private_key']}
        self.data['known_hosts'] = str(trust / 'known_hosts')
        self.write()
        data, _ = ssh.context(self.environment)
        self.assertEqual((data['user'], data['port'], data['root']), ('root', '22', 'apps'))
        with ssh.identity(data, self.directory) as options:
            self.assertIn('StrictHostKeyChecking=accept-new', options)
            self.assertIn('UserKnownHostsFile=' + str(trust / 'known_hosts'), options)
        self.assertTrue((trust / 'known_hosts').is_file())
        self.assertEqual(list(self.directory.glob('ssh-*')), [])

    def test_single_line_base64_private_key_preserves_original_newlines(self):
        original = self.data['private_key']
        self.data['private_key'] = base64.b64encode(original.encode()).decode()
        self.write()
        data, _ = ssh.context(self.environment)
        self.assertEqual(data['private_key'], original)

    def test_upload_validates_paths_and_creates_parent_without_shell_interpolation(self):
        archive = self.directory / 'release.tar.gz'
        # Upload data must not come from the task's credential directory.
        archive.write_bytes(b'source')
        with self.assertRaises(ssh.DeploymentError):
            ssh.main(['upload', str(archive), 'releases/v1/source.tar.gz'], self.environment)
        with tempfile.TemporaryDirectory() as release:
            archive = Path(release) / 'source.tar.gz'
            archive.write_bytes(b'source')
            calls = []
            with patch.object(ssh, 'run', side_effect=lambda argv, env: calls.append(argv) or 0):
                self.assertEqual(ssh.main(['upload', str(archive), 'releases/v1/source.tar.gz'], self.environment), 0)
            self.assertEqual(calls[0][-1], 'mkdir -p -- /opt/apps/demo/releases/v1')
            self.assertEqual(calls[1][-1], 'deploy@example.invalid:/opt/apps/demo/releases/v1/source.tar.gz')
            self.assertEqual(calls[1][:2], ['scp', '-s'])
            for relative in ['../x', '/etc/x', 'v1/../../x', 'v1/$(id)', '-O', 'a//b']:
                with self.subTest(relative=relative), self.assertRaises(ssh.DeploymentError):
                    ssh.main(['upload', '--', str(archive), relative], self.environment)

    def test_child_environment_drops_all_deployment_values(self):
        seen = []
        class Child:
            def __init__(self, argv, **kwargs):
                seen.append(kwargs)
            def wait(self):
                return 0
            def poll(self):
                return 0
        with patch.object(ssh.subprocess, 'Popen', Child):
            self.assertEqual(ssh.run(['ssh'], self.environment), 0)
        self.assertFalse(any(k.startswith('BYCLAW_DEPLOY_') for k in seen[0]['env']))

    def test_sigterm_cleans_private_identity_during_actual_subprocess(self):
        # A local fake SSH executable blocks after identity creation; no network access.
        binaries = self.directory / 'bin'
        binaries.mkdir()
        executable = binaries / 'ssh'
        marker = self.directory / 'started'
        executable.write_text('#!/bin/sh\nprintf ready > "' + str(marker) + '"\nexec sleep 30\n')
        executable.chmod(0o700)
        env = dict(self.environment, PATH=str(binaries) + os.pathsep + os.environ['PATH'])
        process = subprocess.Popen([sys.executable, str(SCRIPT), 'check'], env=env,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            deadline = time.monotonic() + 5
            while not marker.exists() and time.monotonic() < deadline:
                time.sleep(0.02)
            self.assertTrue(marker.exists())
            self.assertTrue(list(self.directory.glob('ssh-*')))
            process.send_signal(signal.SIGTERM)
            self.assertEqual(process.wait(timeout=5), 130)
            self.assertEqual(list(self.directory.glob('ssh-*')), [])
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()


if __name__ == '__main__':
    unittest.main()
