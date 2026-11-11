#!/usr/bin/env python3
"""Direct, user-authorized ECS access. Credentials never enter argv or UserFS."""
import argparse
import base64
import contextlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import signal
import stat
import subprocess
import sys
import tempfile


class DeploymentError(Exception):
    pass


def context(environment):
    path = Path(environment.get('BYCLAW_DEPLOY_CONTEXT', ''))
    # The runner owns this task-specific directory. Reject persistent paths and symlinks.
    if (not path.is_absolute() or path.parent.parent != Path('/tmp')
            or not path.parent.name.startswith('byclaw-deploy-') or path.name != 'context.json'):
        raise DeploymentError('DEPLOYMENT_CONTEXT_UNAVAILABLE')
    try:
        for item in (path.parent, path):
            info = item.lstat()
            if (stat.S_ISLNK(info.st_mode) or info.st_uid != os.getuid()
                    or info.st_mode & 0o077):
                raise DeploymentError('DEPLOYMENT_CONTEXT_UNSAFE')
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, 'r', encoding='utf-8') as stream:
            raw = stream.read(65537)
        if len(raw.encode()) > 65536:
            raise DeploymentError('DEPLOYMENT_CONTEXT_TOO_LARGE')
        data = json.loads(raw)
    except (OSError, ValueError):
        raise DeploymentError('DEPLOYMENT_CONTEXT_UNAVAILABLE') from None
    if not isinstance(data, dict) or any(not isinstance(v, str) for v in data.values()):
        raise DeploymentError('DEPLOYMENT_CONFIG_INVALID')
    host, user = data.get('host', ''), data.get('user', '') or 'root'
    data['user'] = user
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.-]{0,252}', host):
        raise DeploymentError('DEPLOYMENT_HOST_INVALID')
    if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_-]{0,63}', user):
        raise DeploymentError('DEPLOYMENT_USER_INVALID')
    port = data.get('port', '') or '22'
    if not port.isascii() or not port.isdigit() or not 1 <= int(port) <= 65535:
        raise DeploymentError('DEPLOYMENT_PORT_INVALID')
    data['port'] = str(int(port))
    root = data.get('root', '').strip()
    if root and (not re.fullmatch(r'/[A-Za-z0-9_./-]+', root) or root == '/'
            or '..' in root.split('/') or PurePosixPath(root).as_posix() != root.rstrip('/')):
        raise DeploymentError('DEPLOYMENT_ROOT_INVALID')
    # Relative SFTP paths resolve under the deployment account's home directory.
    data['root'] = root.rstrip('/') if root else 'apps'
    key = data.get('private_key', '').strip()
    if not key.startswith('-----BEGIN '):
        try:
            # Personal parameters currently use a single-line password input.
            key = base64.b64decode(key, validate=True).decode('utf-8').strip()
        except (ValueError, UnicodeError):
            raise DeploymentError('DEPLOYMENT_PRIVATE_KEY_INVALID') from None
    if not re.fullmatch(r'-----BEGIN (OPENSSH |RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----\n[\s\S]+\n-----END \1PRIVATE KEY-----', key):
        # Generic PKCS8 uses no prefix; backreferences to an unmatched group do not match.
        if not re.fullmatch(r'-----BEGIN PRIVATE KEY-----\n[\s\S]+\n-----END PRIVATE KEY-----', key):
            raise DeploymentError('DEPLOYMENT_PRIVATE_KEY_INVALID')
    data['private_key'] = key + '\n'
    parts = data.get('host_key', '').strip().split()
    if not parts:
        known = Path(data.get('known_hosts', ''))
        if not known.is_absolute() or known.name != 'known_hosts' or known.parent.name != '.server-deploy':
            raise DeploymentError('DEPLOYMENT_TRUST_STORE_UNAVAILABLE')
        data['host_key'] = ''
        return data, path.parent
    if len(parts) != 2 or not re.fullmatch(r'(?:ssh-|ecdsa-)[A-Za-z0-9@.-]+', parts[0]):
        raise DeploymentError('DEPLOYMENT_HOST_KEY_INVALID')
    try:
        decoded = base64.b64decode(parts[1], validate=True)
        size = int.from_bytes(decoded[:4], 'big')
        if not decoded or decoded[4:4 + size].decode('ascii') != parts[0]:
            raise ValueError()
    except (ValueError, UnicodeError):
        raise DeploymentError('DEPLOYMENT_HOST_KEY_INVALID') from None
    data['host_key'] = ' '.join(parts)
    return data, path.parent


@contextlib.contextmanager
def identity(data, directory):
    with tempfile.TemporaryDirectory(prefix='ssh-', dir=directory) as temporary:
        key, known = Path(temporary) / 'identity', Path(temporary) / 'known_hosts'
        host = data['host'] if data['port'] == '22' else f"[{data['host']}]:{data['port']}"
        files = [(key, data['private_key'])]
        if data['host_key']:
            files.append((known, f"{host} {data['host_key']}\n"))
        else:
            known = Path(data['known_hosts'])
            if known.parent.is_symlink() or not known.parent.is_dir():
                raise DeploymentError('DEPLOYMENT_TRUST_STORE_UNSAFE')
            fd = os.open(known, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
            os.close(fd)
        for path, content in files:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'w', encoding='utf-8') as output:
                output.write(content)
        options = ['-F', '/dev/null', '-i', str(key)]
        for option in ('BatchMode=yes', 'IdentitiesOnly=yes', 'IdentityAgent=none',
                       'StrictHostKeyChecking=' + ('yes' if data['host_key'] else 'accept-new'), 'GlobalKnownHostsFile=/dev/null',
                       f'UserKnownHostsFile={known}', 'UpdateHostKeys=no', 'ForwardAgent=no',
                       'ClearAllForwardings=yes', 'PasswordAuthentication=no',
                       'KbdInteractiveAuthentication=no', 'ConnectTimeout=15',
                       'ServerAliveInterval=15', 'ServerAliveCountMax=3', 'ControlMaster=no',
                       'ControlPath=none', 'ProxyCommand=none', 'ProxyJump=none'):
            options += ['-o', option]
        yield options


def remote_path(data, relative):
    if (not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_./-]*', relative)
            or any(p in ('', '.', '..') for p in relative.split('/'))):
        raise DeploymentError('DEPLOYMENT_REMOTE_PATH_INVALID')
    return data['root'] + '/' + relative


def run(argv, environment):
    # No raw credential environment is passed to SSH, proxy programs or subprocesses.
    clean = {k: v for k, v in environment.items() if not k.startswith('BYCLAW_DEPLOY_')}
    child = subprocess.Popen(argv, env=clean, stdin=subprocess.DEVNULL)
    try:
        return child.wait()
    finally:
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=3)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()


def main(argv=None, environment=None):
    parser = argparse.ArgumentParser(description='Use the current authorized coding task to deploy via SSH/SCP.')
    sub = parser.add_subparsers(dest='action', required=True)
    sub.add_parser('check')
    upload = sub.add_parser('upload')
    upload.add_argument('source', help='A curated release archive, never the whole workspace.')
    upload.add_argument('destination', help='Relative file path below the configured deployment root.')
    execute = sub.add_parser('exec')
    execute.add_argument('command', help='One remote shell script, executed from the configured deployment root.')
    args = parser.parse_args(argv)
    environment = os.environ if environment is None else environment
    data, directory = context(environment)
    target = f"{data['user']}@{data['host']}"
    with identity(data, directory) as options:
        if args.action == 'upload':
            source = Path(args.source).resolve(strict=True)
            if not source.is_file() or source.is_relative_to(directory):
                raise DeploymentError('DEPLOYMENT_SOURCE_INVALID')
            destination = remote_path(data, args.destination)
            # SCP's default SFTP transport requires the parent to exist; create it through SSH.
            code = run(['ssh', *options, '-p', data['port'], target,
                        'mkdir -p -- ' + shlex.quote(str(PurePosixPath(destination).parent))], environment)
            if code:
                return code
            return run(['scp', '-s', *options, '-P', data['port'], '--', str(source),
                        target + ':' + destination], environment)
        script = 'true' if args.action == 'check' else args.command
        if '\0' in script or len(script.encode()) > 65536:
            raise DeploymentError('DEPLOYMENT_COMMAND_INVALID')
        root = '"$HOME"/apps' if data['root'] == 'apps' else shlex.quote(data['root'])
        command = 'mkdir -p -- ' + root + ' && cd -- ' + root + ' && ' + script
        if args.action == 'check':
            command = 'true'  # Connection check does not require an initialized deployment directory.
        return run(['ssh', *options, '-p', data['port'], target, command], environment)


if __name__ == '__main__':
    def interrupted(*_):
        raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, interrupted)
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
    except (DeploymentError, OSError):
        # Never stringify arbitrary exceptions, config or subprocess environments.
        print('DEPLOYMENT_FAILED: check the configured target, task authorization and SSH connection.', file=sys.stderr)
        sys.exit(1)
