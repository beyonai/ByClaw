#!/usr/bin/env python3
"""Initialize editable source without copying image dependencies into personal storage."""
from __future__ import annotations

from contextlib import contextmanager
import errno
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import shutil
import sys
import tarfile
import tempfile

SOURCE = Path('/opt/easel-source')
WORKSPACE_ROOT = Path('/by')
WORKSPACE = WORKSPACE_ROOT / 'Easel'
VENV = Path('/opt/easel-venv')
REMOTION_RUNTIME = Path('/opt/easel-runtime/remotion')
REMOTION_RELATIVE = Path('skills/builtin/video-production/vendor/video-pipeline-sdk/deps/remotion')
TOOL_ENTRYPOINT = '/usr/local/bin/byclaw-tool-slim-entrypoint'
SOURCE_REVISION = '5c12e42e9019d276368130b52385b770749ffa6f'
REVISION_FILE = '.byclaw-easel-source-revision'
LAYOUT_FILE = '.byclaw-easel-workspace.json'
EXCLUDED = {'.git', 'node_modules', '.venv', '__pycache__', '.pytest_cache', '.ruff_cache'}
REQUIRED = ('pyproject.toml', 'easel/cli.py', '.env.example',
            'web/frontend/dist/index.html', str(REMOTION_RELATIVE / 'package-lock.json'))


def log(message: str) -> None:
    print(f'[easel-codex] {message}', flush=True)


def owner_ids() -> tuple[int, int]:
    user = pwd.getpwnam('byclaw')
    return user.pw_uid, user.pw_gid


def own(path: Path) -> None:
    if os.geteuid() == 0:
        os.chown(path, *owner_ids(), follow_symlinks=False)


def safe_parents(path: Path) -> None:
    """Root initialization must not follow workspace links into unrelated directories."""
    relative = path.relative_to(WORKSPACE_ROOT)
    current = WORKSPACE_ROOT
    for part in relative.parts[:-1]:
        current /= part
        if current.is_symlink() or (current.exists() and not current.is_dir()):
            raise RuntimeError(f'unsafe workspace parent: {current}')


def write_if_missing(path: Path, content: str) -> None:
    safe_parents(path)
    # lexists also preserves broken user links; never follow them as root.
    if os.path.lexists(path):
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x', encoding='utf-8') as stream:
        stream.write(content)
    own(path)


def validate_tree(root: Path) -> None:
    missing = [name for name in REQUIRED if not (root / name).is_file()]
    if missing:
        raise RuntimeError(f'incomplete Easel tree at {root}; missing {missing}. '
                           'Existing source is never overwritten; restore it or move it aside before retrying.')


def check_budget() -> None:
    """Statvfs is a preflight only; actual EDQUOT/ENOSPC still fail explicitly."""
    entries, size = 64, 16 * 1024 * 1024  # Small reserve for config and normal startup.
    for root, dirs, files in os.walk(SOURCE, followlinks=False):
        dirs[:] = [name for name in dirs if name not in EXCLUDED]
        names = dirs + [name for name in files if name not in EXCLUDED]
        entries += len(names)
        for name in files:
            path = Path(root) / name
            if name not in EXCLUDED and not path.is_symlink():
                size += path.stat().st_size
    usage = os.statvfs(WORKSPACE_ROOT)
    if usage.f_files and usage.f_favail < entries:
        raise RuntimeError(f'personal workspace file-count quota is insufficient: '
                           f'{usage.f_favail} free nodes, at least {entries} needed. '
                           'Free files or raise the file-count quota; rebuilding the sandbox will not help.')
    if usage.f_blocks and usage.f_bavail * usage.f_frsize < size:
        raise RuntimeError(f'personal workspace byte quota is insufficient; at least {size} bytes needed')


def link_dependency(link: Path, target: Path) -> None:
    safe_parents(link)
    if link.is_symlink():
        # Refresh only links installed by this sandbox, preserving custom environments.
        known = {target, SOURCE / REMOTION_RELATIVE / 'node_modules'}
        if Path(os.readlink(link)) not in known:
            log(f'preserved custom dependency link: {link}')
            return
        if Path(os.readlink(link)) == target:
            return
        link.unlink()
    elif link.exists():
        log(f'preserved local dependencies: {link}; use migrate-dependencies to back up '
            'and replace the bundled Remotion dependencies')
        return
    link.parent.mkdir(parents=True, exist_ok=True)
    link.symlink_to(target, target_is_directory=True)
    own(link)


def configure(root: Path) -> None:
    link_dependency(root / '.venv', VENV)
    remotion = root / REMOTION_RELATIVE
    # User-edited manifests may require a different dependency graph.
    compatible = all((remotion / name).is_file()
                     and (remotion / name).read_bytes() == (REMOTION_RUNTIME / name).read_bytes()
                     for name in ('package.json', 'package-lock.json'))
    if compatible:
        link_dependency(remotion / 'node_modules', REMOTION_RUNTIME / 'node_modules')
    else:
        log('Remotion manifests differ from the image; preserved project dependencies. '
            'Install custom dependencies outside personal storage and link them explicitly.')
    write_if_missing(root / '.env', (root / '.env.example').read_text(encoding='utf-8'))
    harness = root / 'outputs' / '_harness'
    safe_parents(harness / 'config.json')
    harness.mkdir(parents=True, exist_ok=True)
    own(root / 'outputs')
    own(harness)
    write_if_missing(harness / 'config.json', json.dumps({
        'runtime': 'codex', 'models': {}, 'sandbox': 'workspace-write', 'codex_auto_approve': False,
    }, indent=2) + '\n')
    write_if_missing(root / 'AGENTS.md', '\n'.join([
        '# Easel Codex sandbox', '',
        'This is persistent editable source. Python and bundled Remotion dependencies stay in the image.',
        'Use `.venv` or `/opt/easel-venv/bin/python`; run `pytest` and `easel web --port 7860`.',
        'Do not install node_modules into /by: personal storage has a file-count quota.',
        'For frontend changes, install dependencies on instance-local storage and link node_modules',
        'before running npm run build. Keep final outputs in /by and disposable caches outside /by.',
        'Custom project manifests and existing local dependencies are preserved.',
        '`EASEL_AGENT_RUNTIME=codex` and `outputs/_harness/config.json` select Codex.',
        'Ask before publishing to external platforms or other irreversible side effects.', '',
    ]))
    write_if_missing(root / LAYOUT_FILE, json.dumps({
        'version': 2, 'sourceRevision': SOURCE_REVISION,
        'dependencies': 'image', 'localDependencies': 'preserved-if-present',
    }, indent=2) + '\n')


@contextmanager
def workspace_lock():
    WORKSPACE_ROOT.mkdir(parents=True, exist_ok=True)
    path = WORKSPACE_ROOT / '.easel-workspace.lock'
    fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        own(path)
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        os.close(fd)


def validate_runtime() -> None:
    for target in (VENV / 'bin/python', REMOTION_RUNTIME / 'node_modules/remotion/package.json',
                   REMOTION_RUNTIME / 'package.json', REMOTION_RUNTIME / 'package-lock.json'):
        if not target.is_file():
            raise RuntimeError(f'image runtime is missing: {target}')


def prepare_workspace() -> None:
    validate_tree(SOURCE)
    validate_runtime()
    with workspace_lock():
        if WORKSPACE.is_symlink():
            raise RuntimeError(f'refusing symlink workspace: {WORKSPACE}')
        if not WORKSPACE.exists():
            check_budget()
            # Same filesystem: rename publishes one complete tree, without a second copy.
            with tempfile.TemporaryDirectory(prefix='.Easel-init-', dir=WORKSPACE_ROOT) as temporary:
                stage = Path(temporary) / 'Easel'
                shutil.copytree(SOURCE, stage, symlinks=True, ignore=shutil.ignore_patterns(*EXCLUDED))
                validate_tree(stage)
                configure(stage)
                (stage / REVISION_FILE).write_text(SOURCE_REVISION + '\n', encoding='utf-8')
                for parent, dirs, files in os.walk(stage, followlinks=False):
                    own(Path(parent))
                    for name in dirs + files:
                        own(Path(parent) / name)
                if WORKSPACE.exists() or WORKSPACE.is_symlink():
                    raise RuntimeError('workspace appeared during initialization; refusing to overwrite it')
                stage.rename(WORKSPACE)
            log(f'initialized editable source at {WORKSPACE}; dependencies remain in the image')
        else:
            validate_tree(WORKSPACE)
            configure(WORKSPACE)
        codex_home = WORKSPACE_ROOT / '.codex'
        if codex_home.is_symlink():
            raise RuntimeError('refusing symlink Codex home')
        codex_home.mkdir(mode=0o700, exist_ok=True)
        own(codex_home)
        codex_home.chmod(0o700)


def snapshot(root: Path) -> dict:
    result = {}
    for parent, dirs, files in os.walk(root, followlinks=False):
        for name in dirs + files:
            path = Path(parent) / name
            stat = path.lstat()
            result[str(path.relative_to(root))] = (stat.st_mode, stat.st_size, stat.st_mtime_ns,
                                                  os.readlink(path) if path.is_symlink() else None)
    return result


def repair_workspace() -> None:
    """Explicitly restore missing source after an interrupted old initialization."""
    validate_tree(SOURCE)
    with workspace_lock():
        if WORKSPACE.is_symlink() or not WORKSPACE.is_dir():
            raise RuntimeError('repair requires an existing real Easel directory')
        check_budget()
        restored = 0
        for parent, dirs, files in os.walk(SOURCE, followlinks=False):
            dirs[:] = [name for name in dirs if name not in EXCLUDED]
            destination = WORKSPACE / Path(parent).relative_to(SOURCE)
            safe_parents(destination / 'file')
            if not destination.exists():
                destination.mkdir()
                own(destination)
            for name in files:
                if name in EXCLUDED:
                    continue
                source, target = Path(parent) / name, destination / name
                if os.path.lexists(target):
                    continue
                # A repair must neither follow image links nor replace user files.
                if source.is_symlink():
                    continue
                with source.open('rb') as incoming, target.open('xb') as outgoing:
                    try:
                        shutil.copyfileobj(incoming, outgoing)
                        outgoing.flush()
                        os.fsync(outgoing.fileno())
                    except BaseException:
                        target.unlink(missing_ok=True)
                        raise
                shutil.copymode(source, target)
                own(target)
                restored += 1
        validate_tree(WORKSPACE)
        log(f'repaired {restored} missing source files; existing files were preserved')


def migrate_dependencies() -> None:
    """Explicit maintenance: preserve a readable backup before removing legacy dependencies."""
    validate_runtime()
    with workspace_lock():
        validate_tree(WORKSPACE)
        directory = WORKSPACE / REMOTION_RELATIVE
        safe_parents(directory / 'node_modules')
        for name in ('package.json', 'package-lock.json'):
            if (directory / name).read_bytes() != (REMOTION_RUNTIME / name).read_bytes():
                raise RuntimeError('custom Remotion manifests differ from the image; migration refused')
        modules = directory / 'node_modules'
        if modules.is_dir() and not modules.is_symlink():
            before = snapshot(modules)
            backups = WORKSPACE / '.byclaw-dependency-backups'
            safe_parents(backups / 'archive')
            backups.mkdir(mode=0o700, exist_ok=True)
            own(backups)
            fd, temporary = tempfile.mkstemp(prefix='remotion-', suffix='.tar.gz', dir=backups)
            archive = Path(temporary)
            try:
                with os.fdopen(fd, 'wb') as stream:
                    with tarfile.open(fileobj=stream, mode='w:gz', dereference=False) as tar:
                        tar.add(modules, arcname='node_modules')
                    stream.flush()
                    os.fsync(stream.fileno())
                with tarfile.open(archive, 'r:gz') as tar:
                    members = tar.getmembers()
                    if len(members) != len(before) + 1:
                        raise RuntimeError('dependency backup entry count mismatch')
                if snapshot(modules) != before:
                    raise RuntimeError('dependencies changed during backup; stop active installs/renders and retry')
                own(archive)
                with archive.open('rb') as stream:
                    digest = hashlib.file_digest(stream, 'sha256').hexdigest()
                log(f'dependency backup verified: {archive}; sha256={digest}; entries={len(members)}')
            except BaseException:
                archive.unlink(missing_ok=True)
                raise
            # A failed removal leaves both the backup and remaining files. Never delete backups on retry.
            shutil.rmtree(modules)
        link_dependency(modules, REMOTION_RUNTIME / 'node_modules')
        log('Remotion dependencies now reference the image; source, config and outputs are preserved')


def main() -> int:
    args = sys.argv[1:]
    if args == ['repair-workspace']:
        repair_workspace()
        return 0
    if args == ['migrate-dependencies']:
        migrate_dependencies()
        return 0
    if args != ['tools']:
        raise ValueError('usage: byclaw-easel-codex-entrypoint tools | repair-workspace | migrate-dependencies')
    if os.geteuid() != 0:
        raise ValueError('Root is required to initialize /by before starting SSH')
    prepare_workspace()
    os.environ['EASEL_AGENT_RUNTIME'] = 'codex'
    os.environ['CODEX_HOME'] = str(WORKSPACE_ROOT / '.codex')
    os.environ['EASEL_PROJECT_ROOT'] = str(WORKSPACE)
    os.environ['PYTHONPATH'] = str(WORKSPACE)
    os.environ['PATH'] = str(VENV / 'bin') + ':' + os.environ.get('PATH', '')
    log('Easel source and image dependencies ready')
    os.execv(TOOL_ENTRYPOINT, [TOOL_ENTRYPOINT, 'tools'])
    return 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, ValueError, shutil.Error) as error:
        if isinstance(error, OSError) and error.errno in (errno.EDQUOT, errno.ENOSPC):
            log('Personal workspace quota exhausted (bytes or file count). Free files or increase '
                'the quota; rebuilding the sandbox cannot repair persistent storage.')
        else:
            log(str(error))
        raise SystemExit(1) from None
