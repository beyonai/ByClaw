"""Real OpenSSH client against a disposable loopback SSH/SFTP server.

Optional test dependency: paramiko in an isolated test venv. No ECS credentials.
"""
import json
import base64
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import unittest

try:
    import paramiko
except ImportError:
    paramiko = None

SCRIPT = Path(__file__).resolve().parents[1] / 'builtin/runtime-tools/server-ssh.py'


@unittest.skipUnless(paramiko is not None, 'install paramiko in a test venv for loopback SSH/SFTP acceptance')
class LoopbackDeploymentTests(unittest.TestCase):
    def test_real_exec_upload_and_host_mismatch_without_authentication(self):
        with tempfile.TemporaryDirectory(prefix='byclaw-deploy-', dir='/tmp') as directory:
            root = Path(directory)
            key = root / 'client'
            subprocess.run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(key)], check=True)
            client = paramiko.Ed25519Key.from_private_key_file(str(key))
            host = paramiko.RSAKey.generate(2048)
            host_keys = [host]
            remote = root / 'remote'
            remote.mkdir()
            authenticated = []
            transports = []
            workers = []

            class Server(paramiko.ServerInterface):
                def check_auth_publickey(self, username, offered):
                    if username in ('deploy', 'root') and offered.asbytes() == client.asbytes():
                        authenticated.append(username)
                        return paramiko.AUTH_SUCCESSFUL
                    return paramiko.AUTH_FAILED

                def get_allowed_auths(self, username):
                    return 'publickey'

                def check_channel_request(self, kind, channel_id):
                    return paramiko.OPEN_SUCCEEDED if kind == 'session' else paramiko.OPEN_FAILED_ADMINISTRATIVELY_PROHIBITED

                def check_channel_exec_request(self, channel, command):
                    def execute():
                        result = subprocess.run(command.decode(), shell=True, capture_output=True, timeout=10,
                                                cwd=remote, env=dict(os.environ, HOME=str(remote)))
                        channel.sendall(result.stdout)
                        channel.sendall_stderr(result.stderr)
                        channel.send_exit_status(result.returncode)
                        channel.close()
                    worker = threading.Thread(target=execute, daemon=True)
                    workers.append(worker)
                    worker.start()
                    return True

            class Sftp(paramiko.SFTPServerInterface):
                def safe(self, path):
                    resolved = (Path(path) if Path(path).is_absolute() else remote / path).resolve()
                    if not resolved.is_relative_to(remote):
                        raise OSError('outside fixture')
                    return resolved

                def canonicalize(self, path):
                    return str(self.safe(path))

                def stat(self, path):
                    try:
                        return paramiko.SFTPAttributes.from_stat(self.safe(path).stat())
                    except OSError as error:
                        return paramiko.SFTPServer.convert_errno(error.errno)

                lstat = stat

                def open(self, path, flags, attr):
                    try:
                        fd = os.open(self.safe(path), flags, 0o600)
                        mode = 'wb' if flags & os.O_WRONLY else 'r+b' if flags & os.O_RDWR else 'rb'
                        handle = paramiko.SFTPHandle(flags)
                        handle.readfile = handle.writefile = os.fdopen(fd, mode)
                        return handle
                    except OSError as error:
                        return paramiko.SFTPServer.convert_errno(error.errno)

                def chattr(self, path, attr):
                    return paramiko.SFTP_OK

            listener = socket.socket()
            listener.bind(('127.0.0.1', 0))
            listener.listen()
            listener.settimeout(0.2)
            port = listener.getsockname()[1]
            stop = threading.Event()

            class SftpSubsystem(paramiko.SFTPServer):
                def finish_subsystem(self):
                    self.sock.send_exit_status(0)
                    super().finish_subsystem()

            def serve():
                while not stop.is_set():
                    try:
                        connection, _ = listener.accept()
                    except socket.timeout:
                        continue
                    except OSError:
                        break
                    transport = paramiko.Transport(connection)
                    transports.append(transport)
                    transport.add_server_key(host_keys[0])
                    transport.set_subsystem_handler('sftp', SftpSubsystem, Sftp)
                    try:
                        transport.start_server(server=Server())
                    except (EOFError, paramiko.SSHException):
                        transport.close()

            server = threading.Thread(target=serve, daemon=True)
            server.start()
            config = dict(host='127.0.0.1', port=str(port), user='deploy', root=str(remote),
                          private_key=key.read_text(), host_key=host.get_name() + ' ' + host.get_base64())
            context = root / 'context.json'
            context.write_text(json.dumps(config))
            context.chmod(0o600)
            env = dict(os.environ, BYCLAW_DEPLOY_CONTEXT=str(context))

            def invoke(*args):
                return subprocess.run([sys.executable, str(SCRIPT), *args], env=env,
                                      capture_output=True, text=True, timeout=20)
            try:
                wrong = paramiko.RSAKey.generate(2048)
                context.write_text(json.dumps(dict(config, host_key=wrong.get_name() + ' ' + wrong.get_base64())))
                rejected = invoke('check')
                self.assertNotEqual(rejected.returncode, 0)
                self.assertEqual(authenticated, [], 'host mismatch must fail before user authentication')
                context.write_text(json.dumps(config))
                checked = invoke('check')
                self.assertEqual(checked.returncode, 0, checked.stderr)
                executed = invoke('exec', 'printf DEPLOY_REAL_SSH_OK')
                self.assertEqual(executed.returncode, 0, executed.stderr)
                self.assertEqual(executed.stdout, 'DEPLOY_REAL_SSH_OK')
                # Source is outside the credential context; destination exists only via the wrapper's mkdir.
                with tempfile.TemporaryDirectory() as release:
                    source = Path(release) / 'source.tar.gz'
                    source.write_bytes(b'disposable release archive')
                    uploaded = invoke('upload', str(source), 'releases/v1/source.tar.gz')
                    self.assertEqual(uploaded.returncode, 0, uploaded.stderr)
                    self.assertEqual((remote / 'releases/v1/source.tar.gz').read_bytes(), source.read_bytes())
                failed = invoke('exec', 'exit 23')
                self.assertEqual(failed.returncode, 23)
                context.write_text(json.dumps({k: v for k, v in config.items() if k != 'root'}))
                default_root = invoke('exec', 'pwd')
                self.assertEqual(default_root.returncode, 0, default_root.stderr)
                self.assertEqual(default_root.stdout.strip(), str(remote / 'apps'))
                with tempfile.TemporaryDirectory() as release:
                    source = Path(release) / 'source.tar.gz'
                    source.write_bytes(b'default directory release')
                    uploaded = invoke('upload', str(source), 'easel/releases/v2/source.tar.gz')
                    self.assertEqual(uploaded.returncode, 0, uploaded.stderr)
                    self.assertEqual((remote / 'apps/easel/releases/v2/source.tar.gz').read_bytes(), source.read_bytes())
                self.assertEqual(list(root.glob('ssh-*')), [])
                trust = root / '.server-deploy'
                trust.mkdir(mode=0o700)
                minimal = dict(host='127.0.0.1', port=str(port), private_key=base64.b64encode(key.read_bytes()).decode(),
                               known_hosts=str(trust / 'known_hosts'))
                context.write_text(json.dumps(minimal))
                first = invoke('check')
                self.assertEqual(first.returncode, 0, first.stderr)
                pinned = (trust / 'known_hosts').read_text()
                self.assertIn(host.get_base64(), pinned)
                self.assertEqual(authenticated[-1], 'root')
                self.assertEqual(invoke('check').returncode, 0)
                count = len(authenticated)
                host_keys[0] = wrong
                self.assertNotEqual(invoke('check').returncode, 0)
                self.assertEqual(len(authenticated), count, 'changed first-use key must fail before authentication')
                self.assertEqual((trust / 'known_hosts').read_text(), pinned)
            finally:
                stop.set()
                listener.close()
                for transport in transports:
                    transport.close()
                server.join(timeout=3)
                for worker in workers:
                    worker.join(timeout=3)


if __name__ == '__main__':
    unittest.main()
