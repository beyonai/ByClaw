#!/usr/bin/env python3
"""Run the private development database and the existing SSH/browser tool runtime.

No user database or credential is initialized at image build time. PostgreSQL is
owned by postgres; the tool account gets CREATEDB, never database superuser access.
"""
import fcntl
import os
from pathlib import Path
import pwd
import re
import secrets
import shlex
import signal
import subprocess
import sys
import time

PG_BIN = Path('/usr/lib/postgresql/17/bin')
RUNTIME = Path('/run/byclaw-software-development')
DEFAULT_DATA = '/var/lib/postgresql/software-development/17/data'
TOOL_ENTRYPOINT = '/usr/local/bin/byclaw-tool-slim-entrypoint'


def log(message):
    print(f'[software-development] {message}', flush=True)


def data_path(value):
    path = Path(value)
    if not path.is_absolute() or '..' in path.parts or len(path.parts) < 4:
        raise ValueError('PGDATA must be an absolute dedicated directory, without ..')
    for ancestor in (path, *path.parents):
        if ancestor.is_symlink():
            raise ValueError('PGDATA and its ancestors must not be symlinks')
    return path


def number(name, default, minimum, maximum):
    value = int(os.environ.get(name, str(default)))
    if not minimum <= value <= maximum:
        raise ValueError(f'{name} must be between {minimum} and {maximum}')
    return value


class DevelopmentRuntime:
    def __init__(self):
        self.data = data_path(os.environ.get('BYCLAW_SOFTWARE_DEVELOPMENT_PGDATA', DEFAULT_DATA))
        self.port = number('BYCLAW_SOFTWARE_DEVELOPMENT_PGPORT', 5432, 1024, 65535)
        self.timeout = number('BYCLAW_SOFTWARE_DEVELOPMENT_STARTUP_TIMEOUT', 60, 5, 300)
        self.database = os.environ.get('BYCLAW_SOFTWARE_DEVELOPMENT_DATABASE', 'development')
        if not re.fullmatch(r'[a-z][a-z0-9_]{0,62}', self.database):
            raise ValueError('Database name must contain lowercase ASCII letters, digits or underscores')
        self.postgres = pwd.getpwnam('postgres')
        self.user = pwd.getpwnam('byclaw')
        self.pg = None
        self.tools = None
        self.lock = None
        self.runtime_lock = None
        self.owns_runtime = False
        self.stopping = False

    def pg_command(self, binary, *args, **options):
        # Do not forward SSH identities, provider tokens, libpq overrides or user env.
        env = {'PATH': f'{PG_BIN}:/usr/bin:/bin', 'HOME': self.postgres.pw_dir, 'LANG': 'C.UTF-8'}
        return subprocess.run([str(PG_BIN / binary), *args], env=env,
                              user=self.postgres.pw_uid, group=self.postgres.pw_gid,
                              extra_groups=[], umask=0o077, check=True, timeout=self.timeout,
                              **options)

    def sql(self, database, statement):
        return self.pg_command('psql', '-X', '--no-password', '-v', 'ON_ERROR_STOP=1',
                               '-h', str(RUNTIME / 'socket'), '-p', str(self.port),
                               '-U', 'postgres', '-d', database, '-At',
                               input=statement, text=True, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE).stdout.strip()

    def prepare(self):
        self.data.parent.mkdir(parents=True, exist_ok=True)
        if not self.data.exists():
            self.data.mkdir(mode=0o700)
        # Lock the directory inode itself: a leaf bind mount must share the lock
        # too, and initdb requires that the new data directory remain empty.
        self.lock = os.open(self.data, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('Another software-development runtime owns this database directory') from None
        entries = list(self.data.iterdir())
        # A newly attached empty volume commonly belongs to root. Only that
        # empty dedicated directory may be adopted; never chown existing data.
        if not entries and self.data.stat().st_uid == 0:
            os.chown(self.data, self.postgres.pw_uid, self.postgres.pw_gid)
        if self.data.stat().st_uid != self.postgres.pw_uid:
            raise ValueError('PGDATA must be owned by postgres; refusing recursive ownership changes')
        if entries:
            version = self.data / 'PG_VERSION'
            if not version.is_file() or version.is_symlink() or version.read_text().strip() != '17':
                raise ValueError('PGDATA is not a PostgreSQL 17 cluster; no files were replaced')
        os.chmod(self.data, 0o700)
        # Network workspaces require separate database-storage qualification.
        fs = subprocess.run(['findmnt', '-n', '-o', 'FSTYPE', '-T', str(self.data)],
                            check=True, capture_output=True, text=True).stdout.strip()
        if fs in {'nfs', 'nfs4', 'cifs', 'smb3', '9p'} or fs.startswith('fuse'):
            raise ValueError('Network/FUSE PGDATA is unsupported; use local or qualified block storage')
        RUNTIME.mkdir(mode=0o755, parents=True, exist_ok=True)
        fd = os.open(RUNTIME / '.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        self.runtime_lock = os.fdopen(fd, 'w')
        try:
            fcntl.flock(self.runtime_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('Another software-development runtime owns the process state') from None
        self.owns_runtime = True
        (RUNTIME / 'ready').unlink(missing_ok=True)
        socket = RUNTIME / 'socket'
        socket.mkdir(mode=0o755, exist_ok=True)
        os.chown(socket, self.postgres.pw_uid, self.postgres.pw_gid)
        client = RUNTIME / 'client'
        client.mkdir(mode=0o750, exist_ok=True)
        # The user can read its credential file, but cannot replace its parent.
        os.chown(client, 0, self.user.pw_gid)
        client.chmod(0o750)
        if not entries:
            self.pg_command('initdb', '-D', str(self.data), '--encoding=UTF8',
                            '--locale=C.UTF-8', '--auth-local=peer', '--auth-host=scram-sha-256')
        hba = RUNTIME / 'pg_hba.conf'
        hba.write_text('local all postgres peer\nlocal all byclaw peer\nlocal all all reject\n'
                       'host all byclaw 127.0.0.1/32 scram-sha-256\nhost all all 0.0.0.0/0 reject\n')
        hba.chmod(0o644)

    def start_database(self):
        env = {'PATH': f'{PG_BIN}:/usr/bin:/bin', 'HOME': self.postgres.pw_dir, 'LANG': 'C.UTF-8'}
        self.pg = subprocess.Popen([
            str(PG_BIN / 'postgres'), '-D', str(self.data),
            '-c', 'listen_addresses=127.0.0.1', '-c', f'port={self.port}',
            '-c', f'unix_socket_directories={RUNTIME / "socket"}',
            '-c', f'hba_file={RUNTIME / "pg_hba.conf"}',
            '-c', 'password_encryption=scram-sha-256', '-c', 'shared_buffers=128MB',
            '-c', 'max_connections=40', '-c', 'max_wal_size=256MB',
            '-c', 'logging_collector=off', '-c', 'log_statement=none'],
            env=env, user=self.postgres.pw_uid, group=self.postgres.pw_gid,
            extra_groups=[], umask=0o077, start_new_session=True)
        deadline = time.monotonic() + self.timeout
        while time.monotonic() < deadline and not self.stopping:
            if self.pg.poll() is not None:
                raise RuntimeError('PostgreSQL exited before readiness')
            try:
                self.sql('postgres', 'SELECT 1;')
                return
            except subprocess.CalledProcessError:
                time.sleep(0.2)
        raise RuntimeError('PostgreSQL startup interrupted or timed out')

    def provision(self):
        # A fresh runtime password is generated on every start, including restores.
        password = secrets.token_hex(32)
        exists = self.sql('postgres', "SELECT 1 FROM pg_roles WHERE rolname='byclaw';")
        action = 'ALTER' if exists else 'CREATE'
        self.sql('postgres', f"{action} ROLE byclaw LOGIN CREATEDB NOSUPERUSER NOCREATEROLE "
                            f"NOREPLICATION NOBYPASSRLS PASSWORD '{password}';")
        # New project databases inherit vector without granting extension superuser access.
        self.sql('template1', 'CREATE EXTENSION IF NOT EXISTS vector;')
        owner = self.sql('postgres', "SELECT pg_get_userbyid(datdba) FROM pg_database "
                                    f"WHERE datname='{self.database}';")
        if not owner:
            self.sql('postgres', f'CREATE DATABASE "{self.database}" OWNER byclaw;')
        elif owner != 'byclaw':
            raise ValueError('Development database belongs to another role; refusing ownership changes')
        self.sql(self.database, 'CREATE EXTENSION IF NOT EXISTS vector;')
        env = {'PGHOST': '127.0.0.1', 'PGPORT': str(self.port), 'PGUSER': 'byclaw',
               'PGDATABASE': self.database, 'PGPASSWORD': password,
               'DATABASE_URL': f'postgresql://byclaw:{password}@127.0.0.1:{self.port}/{self.database}'}
        file = RUNTIME / 'client/database.env'
        # Replace a previous credential file without following any symlink.
        file.unlink(missing_ok=True)
        fd = os.open(file, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as out:
            out.write(''.join(f'export {k}={shlex.quote(v)}\n' for k, v in env.items()))
        os.chown(file, self.user.pw_uid, self.user.pw_gid)
        return env

    def stop(self, signum=None, frame=None):
        self.stopping = True

    @staticmethod
    def terminate(process, signum, timeout):
        if process is None:
            return
        try:
            os.killpg(process.pid, signum)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()

    def run(self):
        for signum in (signal.SIGTERM, signal.SIGINT):
            signal.signal(signum, self.stop)
        try:
            self.prepare()
            self.start_database()
            env = self.provision()
            if self.stopping:
                return 0
            # The existing sshd launcher forwards these runtime values to SSH sessions.
            self.tools = subprocess.Popen([TOOL_ENTRYPOINT, 'tools'],
                                          env={**os.environ, **env}, start_new_session=True)
            (RUNTIME / 'ready').touch(mode=0o644)
            log('PostgreSQL 17 + pgvector ready on loopback; starting tool SSH/browser runtime')
            while not self.stopping:
                if self.pg.poll() is not None:
                    raise RuntimeError('PostgreSQL exited; stopping tools to prevent partial readiness')
                code = self.tools.poll()
                if code is not None:
                    return code if code >= 0 else 128 - code
                time.sleep(0.2)
            return 0
        finally:
            if self.owns_runtime:
                (RUNTIME / 'ready').unlink(missing_ok=True)
            self.terminate(self.tools, signal.SIGTERM, 10)
            # SIGINT is PostgreSQL's fast, transactional shutdown (not immediate shutdown).
            self.terminate(self.pg, signal.SIGINT, 30)
            if self.owns_runtime:
                (RUNTIME / 'client/database.env').unlink(missing_ok=True)
            if self.runtime_lock:
                self.runtime_lock.close()
            if self.lock is not None:
                os.close(self.lock)


def main():
    if sys.argv[1:] not in ([], ['tools']):
        raise ValueError('Software development sandbox supports tools mode only')
    if os.geteuid() != 0:
        raise ValueError('Root is required to prepare PostgreSQL and SSH, then drop privileges')
    return DevelopmentRuntime().run()


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, RuntimeError, OSError, subprocess.SubprocessError) as error:
        # SQL may contain credentials: never print CalledProcessError command/input/stderr.
        log(str(error) if isinstance(error, (ValueError, RuntimeError)) else type(error).__name__)
        sys.exit(1)
