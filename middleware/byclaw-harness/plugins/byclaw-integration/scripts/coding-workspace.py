#!/usr/bin/env python3
"""Lease-local Codex workspace, native Skills, resume and original UserFS snapshots.

Invoked by Harness with trusted JSON as an argv value. No shell interpolation,
credentials in prompts, model summarizer, Skill copies or delivery manifests.
"""
import contextlib
import errno
import difflib
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import tempfile
import threading
import time
import tomllib
import uuid


OUTPUT_LOCK = threading.Lock()


def emit(kind, **values):
    with OUTPUT_LOCK:
        print(json.dumps(dict(type=kind, **values), ensure_ascii=False), flush=True)


@contextlib.contextmanager
def timing(stage, **metadata):
    """Only explicit counters/labels; never include prompts, paths or credentials."""
    started = time.monotonic()
    status = 'error'
    try:
        yield metadata
        status = 'success'
    finally:
        emit('byclaw.timing', stage=stage, status=status,
             elapsedMs=round((time.monotonic() - started) * 1000), **metadata)


def atomic_text(path, text):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.is_symlink():
        raise ValueError('EXECUTION_UNSAFE_STATE_PATH')
    if path.is_file() and path.read_text(encoding='utf-8') == text:
        return
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix='.coding-')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as output:
            output.write(text)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


PUBLICATION_MCP_SERVER = r'''#!/usr/bin/env python3
import json
import os
from pathlib import Path
import sys
import time
import uuid


TOOL_NAME = 'prepare_group_task_publication'
TOOL_DESCRIPTION = ('用户明确要求发到群里、发布到群里或准备回群成果时调用；只准备待确认卡片，'
                    '不上传附件、不发送群消息、不完成任务。成功后等待用户确认。')


def respond(message_id, result=None, error=None):
    value = {'jsonrpc': '2.0', 'id': message_id}
    if error is not None:
        value['error'] = error
    else:
        value['result'] = result
    sys.stdout.write(json.dumps(value, ensure_ascii=False) + '\n')
    sys.stdout.flush()


def fail(message):
    return {'content': [{'type': 'text', 'text': message}], 'isError': True}


def config():
    if len(sys.argv) != 2:
        raise RuntimeError('发布工具配置缺失。')
    path = Path(sys.argv[1])
    if path.is_symlink() or not path.is_file():
        raise RuntimeError('发布工具配置不可读取。')
    data = json.loads(path.read_text(encoding='utf-8'))
    directory = data.get('bridgeDirectory')
    if not isinstance(directory, str) or not Path(directory).is_dir() or any(p.is_symlink() for p in (Path(directory), *Path(directory).parents)):
        raise RuntimeError('发布工具桥接不可用。')
    return data


def prepare(arguments):
    data = config()
    if not isinstance(arguments, dict):
        raise ValueError('参数无效。')
    # The bound host callback owns argument, identity, tenant, file and authentication checks.
    payload = json.dumps({'arguments': arguments}, ensure_ascii=False)
    if len(payload.encode('utf-8')) > 1024 * 1024:
        raise ValueError('发布工具参数过大。')
    directory = Path(data['bridgeDirectory'])
    request_id = str(uuid.uuid4())
    request = directory / (request_id + '.request.json')
    response = directory / (request_id + '.response.json')
    temporary = directory / (request_id + '.tmp')
    try:
        with open(temporary, 'x', encoding='utf-8') as output:
            os.chmod(temporary, 0o600)
            output.write(payload)
        os.replace(temporary, request)
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            if response.is_file():
                if response.is_symlink() or response.stat().st_size > 1024 * 1024:
                    raise RuntimeError('发布工具桥接响应无效。')
                result = json.loads(response.read_text(encoding='utf-8'))
                if not isinstance(result, dict):
                    raise RuntimeError('发布工具桥接响应无效。')
                if isinstance(result.get('error'), str):
                    raise RuntimeError(result['error'])
                if 'result' not in result:
                    raise RuntimeError('发布工具桥接响应无效。')
                return {'content': [{'type': 'text', 'text': json.dumps(result['result'], ensure_ascii=False)}]}
            time.sleep(0.05)
        raise RuntimeError('准备待发布内容超时，结果不确定；请查询最新待发布卡片，不要自动重试。')
    finally:
        # A request may already be in flight; cleanup never resends it.
        temporary.unlink(missing_ok=True)


def main():
    for line in sys.stdin:
        try:
            request = json.loads(line)
            method = request.get('method')
            message_id = request.get('id')
            if method == 'initialize':
                respond(message_id, {'protocolVersion': '2024-11-05',
                    'capabilities': {'tools': {'listChanged': False}},
                    'serverInfo': {'name': 'byclaw-group-task-publication', 'version': '1.0.0'}})
            elif method == 'notifications/initialized':
                continue
            elif method == 'tools/list':
                respond(message_id, {'tools': [{'name': TOOL_NAME, 'description': TOOL_DESCRIPTION,
                    'inputSchema': {'type': 'object', 'properties': {
                        'text': {'type': 'string', 'maxLength': 100000},
                        'sourcePaths': {'type': 'array', 'maxItems': 100, 'items': {'type': 'string', 'minLength': 1, 'maxLength': 4096}},
                    }, 'additionalProperties': False}}]})
            elif method == 'tools/call':
                params = request.get('params') or {}
                if params.get('name') != TOOL_NAME:
                    respond(message_id, error={'code': -32601, 'message': 'Unknown tool'})
                else:
                    try:
                        respond(message_id, prepare(params.get('arguments') or {}))
                    except Exception as error:
                        respond(message_id, fail(str(error)))
            elif message_id is not None:
                respond(message_id, error={'code': -32601, 'message': 'Method not found'})
        except Exception as error:
            if 'message_id' in locals() and message_id is not None:
                respond(message_id, error={'code': -32603, 'message': str(error)})


if __name__ == '__main__':
    main()
'''


class PublicationBridge:
    """Forward local MCP requests over the existing runner stdout/lease file channel."""

    def __init__(self, directory, bridge_id):
        self.directory = directory
        self.bridge_id = bridge_id
        self.stopped = threading.Event()
        self.seen = set()
        self.worker = threading.Thread(target=self.watch, daemon=True)

    def start(self):
        self.worker.start()

    def close(self):
        self.stopped.set()
        self.worker.join(timeout=2)
        # Only this turn's flat IPC directory is disposable, never project/session contents.
        if not self.worker.is_alive() and not self.directory.is_symlink():
            for path in self.directory.iterdir():
                if path.is_file() or path.is_symlink():
                    path.unlink(missing_ok=True)
            try:
                self.directory.rmdir()
            except OSError:
                pass

    def watch(self):
        while not self.stopped.wait(0.05):
            for path in self.directory.glob('*.request.json'):
                if self.stopped.is_set():
                    return
                request_id = path.name.removesuffix('.request.json')
                if request_id in self.seen or not re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', request_id):
                    continue
                self.seen.add(request_id)
                try:
                    if len(self.seen) > 100:
                        raise ValueError('request limit exceeded')
                    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0))
                    with os.fdopen(fd, 'rb') as source:
                        info = os.fstat(source.fileno())
                        if not stat.S_ISREG(info.st_mode) or info.st_size > 1024 * 1024 or path.is_symlink():
                            raise ValueError('invalid request')
                        payload = source.read(1024 * 1024 + 1)
                        if len(payload) > 1024 * 1024:
                            raise ValueError('request too large')
                        data = json.loads(payload)
                    emit('byclaw.publication.request', bridgeId=self.bridge_id, requestId=request_id,
                         arguments=data.get('arguments'))
                except (OSError, ValueError, AttributeError):
                    atomic_text(self.directory / (request_id + '.response.json'),
                                json.dumps({'error': '发布工具桥接请求无效。'}, ensure_ascii=False))


@contextlib.contextmanager
def identity_lock(path):
    """OS-owned lock survives cross-worker contention, releases on process death."""
    if path.is_symlink():
        raise ValueError('EXECUTION_UNSAFE_STATE_PATH')
    with open(path, 'a+b') as handle:
        waiting = False
        while True:
            try:
                if os.name == 'nt':
                    import msvcrt
                    handle.seek(0)
                    msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError as error:
                if error.errno not in (errno.EAGAIN, errno.EWOULDBLOCK, errno.EACCES):
                    raise ValueError('EXECUTION_LOCK_UNAVAILABLE') from None
                if not waiting:
                    emit('byclaw.workspace', status='waiting', reason='identity_lock')
                    waiting = True
                time.sleep(0.1)
        try:
            yield
        finally:
            if os.name == 'nt':
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle, fcntl.LOCK_UN)


def toml_value(value):
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, list):
        return '[' + ', '.join(toml_value(item) for item in value) + ']'
    if isinstance(value, dict):
        return '{' + ', '.join(toml_value(key) + ' = ' + toml_value(item) for key, item in value.items()) + '}'
    raise ValueError('EXECUTION_UNSUPPORTED_IMAGE_CONFIG')


def toml_document(data):
    # Inline tables preserve arbitrary nested image settings without another dependency.
    text = '\n'.join(toml_value(key) + ' = ' + toml_value(value) for key, value in data.items()) + '\n'
    tomllib.loads(text)
    return text


def safe_directory(path, root):
    if '..' in path.parts or not path.is_absolute() or not path.is_relative_to(root):
        raise ValueError('EXECUTION_UNSAFE_WORKSPACE')
    current = root
    for component in path.relative_to(root).parts:
        current = current / component
        if current.is_symlink():
            raise ValueError('EXECUTION_UNSAFE_STATE_PATH')
        current.mkdir(mode=0o700, exist_ok=True)
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError('EXECUTION_UNSAFE_WORKSPACE')


def repo_name(value):
    if (not isinstance(value, str) or not value or value != value.strip() or value in ('.', '..')
            or re.search(r'[\\/\x00-\x1f:]', value)):
        raise ValueError('EXECUTION_INVALID_REPO_DIR')
    return value


def plain_path(path, root):
    if not path.is_absolute() or '..' in path.parts or not path.is_relative_to(root):
        raise ValueError('EXECUTION_UNSAFE_WORKSPACE')
    if any(part.is_symlink() for part in (path, *path.parents)):
        raise ValueError('EXECUTION_UNSAFE_STATE_PATH')


def git_read(cwd, *args):
    environment = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
    environment.update(GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull, GIT_TERMINAL_PROMPT='0')
    try:
        result = subprocess.run(['git', '-C', str(cwd), *args], env=environment,
                                capture_output=True, text=True, encoding='utf-8', timeout=15)
    except (OSError, subprocess.TimeoutExpired):
        raise ValueError('EXECUTION_REPOSITORY_INVALID') from None
    if result.returncode:
        raise ValueError('EXECUTION_REPOSITORY_INVALID')
    return result.stdout.strip()


def check_repository(path, root):
    plain_path(path, root)
    for entry in (path / '.git', path / '.git' / 'HEAD', path / '.git' / 'objects', path / 'AGENTS.md'):
        plain_path(entry, root)
    if (not (path / '.git').is_dir() or not (path / '.git' / 'HEAD').is_file()
            or not (path / '.git' / 'objects').is_dir() or not (path / 'AGENTS.md').is_file()
            or (path / '.git' / 'objects' / 'info' / 'alternates').exists()):
        raise ValueError('EXECUTION_REPOSITORY_INVALID')
    try:
        with (path / 'AGENTS.md').open('r', encoding='utf-8') as handle:
            handle.read(1)
        if Path(git_read(path, 'rev-parse', '--show-toplevel')).resolve() != path.resolve():
            raise ValueError('EXECUTION_REPOSITORY_INVALID')
        git_read(path, 'rev-parse', '--verify', 'HEAD^{commit}')
        git_read(path, 'cat-file', '-e', 'HEAD^{tree}')
    except (OSError, UnicodeError):
        raise ValueError('EXECUTION_REPOSITORY_INVALID') from None


def repository_state(path, root):
    check_repository(path, root)
    revision = git_read(path, 'rev-parse', '--verify', 'HEAD')
    dirty = bool(git_read(path, 'status', '--porcelain', '--untracked-files=all'))
    return dict(revision=revision, dirty=dirty)


def resolve_workspace(request, root):
    """Pin the first valid repository per space; no copying, extraction, or git init."""
    workspace = dict(request['workspace'])
    session = Path(workspace['sessionRoot'])
    base = Path(workspace['cwd'])
    previous = request.get('previousCwd')
    name = repo_name(request['repoDir'])
    if (session.parent != root / '.sessions' or not re.fullmatch(r'[a-zA-Z0-9_-]+', session.name)
            or Path(workspace['sharedRoot']) != root / '.shared'):
        raise ValueError('EXECUTION_UNSAFE_WORKSPACE')
    # A recovered cwd may already be a repository. Never append repo/repo.
    def is_base(path):
        return path == session or (path.parent == root / '.shared' and re.fullmatch(r'project_-?\d+', path.name))
    if not is_base(base):
        repo_name(base.name)
        base = base.parent
    if not is_base(base):
        raise ValueError('EXECUTION_UNSAFE_WORKSPACE')
    safe_directory(session, root)
    safe_directory(base, root)
    registry = base / '.byclaw' / 'coding-repository.json'
    plain_path(registry, root)
    selected = base / name
    bound = registry.exists()
    if bound:
        if registry.stat().st_size > 4096:
            raise ValueError('EXECUTION_REPOSITORY_BINDING_INVALID')
        binding = json.loads(registry.read_text(encoding='utf-8'))
        if binding.get('version') != 1 or binding.get('space') != str(base):
            raise ValueError('EXECUTION_REPOSITORY_BINDING_INVALID')
        selected = base / repo_name(binding.get('directory'))
    elif previous and Path(previous) != base:
        old = Path(previous)
        if old.parent != base:
            raise ValueError('EXECUTION_PROJECT_BINDING_CHANGED')
        selected = base / repo_name(old.name)
    plain_path(selected, root)
    if selected.exists() or bound or (previous and Path(previous) != base):
        try:
            check_repository(selected, root)
        except ValueError as error:
            if bound or (previous and Path(previous) != base) or str(error) != 'EXECUTION_REPOSITORY_INVALID':
                raise
            # An uninitialized folder must not disable ordinary chat or create another code copy.
            cwd = base
            workspace.pop('repository', None)
            workspace['repositoryIssue'] = 'EXECUTION_REPOSITORY_INVALID'
        else:
            cwd = selected
            workspace['repository'] = str(cwd)
            workspace.pop('repositoryIssue', None)
    else:
        cwd = base
        workspace.pop('repository', None)
        workspace.pop('repositoryIssue', None)
    if previous is not None and Path(previous) != cwd:
        # Retain the native session and old files for an explicit operator migration.
        raise ValueError('EXECUTION_WORKSPACE_CHANGED')
    if cwd != base and not bound:
        safe_directory(registry.parent, root)
        atomic_text(registry, json.dumps(dict(version=1, space=str(base), directory=cwd.name)))
    workspace.update(cwd=str(cwd), defaultOutputRoot=str(cwd))
    return workspace


def connect_skills(home, skills, cwd):
    """Only symlink the effective employee view; missing shared mounts fail visibly."""
    directory = home / 'skills'
    if directory.is_symlink():
        raise ValueError('EXECUTION_UNSAFE_STATE_PATH')
    directory.mkdir(mode=0o700, exist_ok=True)
    selected = {}
    for skill in skills:
        name = skill['name']
        if not re.fullmatch(r'[^\W_]+(?:[-_][^\W_]+)*', name) or name in selected:
            raise ValueError('EXECUTION_INVALID_SKILL_NAME')
        source = Path(skill['path'])
        if not source.is_absolute() or source.name != 'SKILL.md' or not source.is_file():
            raise ValueError('EXECUTION_SKILL_MOUNT_MISSING')
        selected[name] = skill
    # This private directory contains only our symlinks and CLI-owned .system.
    for entry in directory.iterdir():
        if entry.name == '.system':
            continue
        if not entry.is_symlink():
            raise ValueError('EXECUTION_UNMANAGED_SKILL_DIRECTORY')
        if entry.name not in selected or os.readlink(entry) != str(Path(selected[entry.name]['path']).parent):
            entry.unlink()
    settings = []
    for name, skill in selected.items():
        link = directory / name
        if not link.is_symlink():
            link.symlink_to(Path(skill['path']).parent, target_is_directory=True)
        settings.append(dict(path=str(link / 'SKILL.md'), enabled=skill['enabled']))
    # User/project-native Skills outside the authorized view must not be auto-loaded.
    roots = [Path.home() / '.agents' / 'skills', Path('/etc/codex/skills')]
    roots += [parent / '.agents' / 'skills' for parent in (cwd, *cwd.parents)]
    roots += [directory / '.system']
    allowed = {Path(skill['path']).resolve() for skill in skills if skill['enabled']}
    for root in roots:
        if root.is_dir():
            for source in root.glob('*/SKILL.md'):
                if source.resolve() not in allowed:
                    settings.append(dict(path=str(source), enabled=False))
    return settings


def prepare(manifest, root):
    workspace = manifest['workspace']
    session = Path(workspace['sessionRoot'])
    cwd = Path(workspace['cwd'])
    home = Path(manifest['home'])
    if manifest.get('version') != 1 or not re.fullmatch(r'\d+', manifest['employeeId']):
        raise ValueError('EXECUTION_INVALID_CONTEXT')
    expected = session / 'executors' / manifest['employeeId'] / 'codex-home'
    if home != expected or not session.is_relative_to(root / '.sessions'):
        raise ValueError('EXECUTION_UNSAFE_WORKSPACE')
    for directory in [session, cwd, home]:
        safe_directory(directory, root)
    if workspace.get('repository') is not None:
        if workspace['repository'] != str(cwd):
            raise ValueError('EXECUTION_UNSAFE_WORKSPACE')
        check_repository(cwd, root)
    os.chmod(home, 0o700)
    return home, cwd


def setup_config(manifest, home, cwd, default_config):
    # Refresh from the coding image, never from another employee's CODEX_HOME/auth.json.
    data = tomllib.loads(default_config.read_text(encoding='utf-8'))
    # Per-turn platform selection owns the connection, including on resume.
    for key in ('model', 'model_provider', 'model_providers', 'model_reasoning_effort'):
        data.pop(key, None)
    data['approval_policy'] = 'never'
    data['sandbox_mode'] = 'danger-full-access'
    data['developer_instructions'] = manifest['persona']
    # Application identity is stable and explicit for scripts invoked through shared Skills.
    skills = data.setdefault('skills', {})
    skills['config'] = connect_skills(home, manifest['skills'], cwd)
    publication = manifest.get('publication')
    bridge_directory = None
    if isinstance(publication, dict) and publication.get('mode') == 'mcp':
        binding = publication.get('binding')
        if not isinstance(binding, dict) or not isinstance(binding.get('taskId'), str) or not isinstance(binding.get('userCode'), str):
            raise ValueError('EXECUTION_PUBLICATION_BINDING_INVALID')
        bridge = home / 'byclaw-publication-mcp.py'
        binding_file = home / 'byclaw-publication-binding.json'
        atomic_text(bridge, PUBLICATION_MCP_SERVER)
        os.chmod(bridge, 0o700)
        bridge_id = publication.get('bridgeId', '')
        if not isinstance(bridge_id, str) or not re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', bridge_id):
            raise ValueError('EXECUTION_PUBLICATION_BRIDGE_INVALID')
        bridge_directory = home / '.publication' / bridge_id
        safe_directory(bridge_directory, home)
        os.chmod(bridge_directory, 0o700)
        binding_data = {'bridgeDirectory': str(bridge_directory)}
        atomic_text(binding_file, json.dumps(binding_data, ensure_ascii=False))
        os.chmod(binding_file, 0o600)
        servers = data.setdefault('mcp_servers', {})
        if not isinstance(servers, dict):
            raise ValueError('EXECUTION_MCP_CONFIG_INVALID')
        servers['byclaw_group_task_publication'] = {
            'command': 'python3',
            'args': [str(bridge), str(binding_file)],
        }
    atomic_text(home / 'config.toml', toml_document(data))
    atomic_text(home / 'AGENTS.md', manifest['persona'] + '\n')
    return bridge_directory


def prepare_agent_skills(manifest, root):
    """Resolve Skills inside this lease, with the original user launch environment."""
    program = os.environ.get('BYCLAW_AGENT_SKILLS_PREPARER')
    if not program or not Path(program).is_file():
        raise ValueError('EXECUTION_SKILL_PREPARER_MISSING')
    cache = root / '.byclaw'
    safe_directory(cache, root)
    emit('byclaw.workspace', status='skills-started')
    # Multiple employees may update the same user's version cache concurrently.
    with identity_lock(cache / '.agent-skills.lock'):
        child = subprocess.Popen(['node', '--experimental-transform-types', program, manifest['employeeId'], str(root)],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8')
        try:
            output, errors = child.communicate()
            if child.returncode != 0:
                labels = re.findall(r'^EXECUTION_SKILL_[A-Z_]+$', errors, re.MULTILINE)
                raise ValueError(labels[-1] if labels else 'EXECUTION_SKILL_PREPARE_FAILED')
            data = json.loads(output)
            skills = data.get('skills')
            if not isinstance(skills, list):
                raise ValueError('EXECUTION_SKILL_PREPARE_FAILED')
            manifest['skills'] = skills
        finally:
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait()
            child.stdout.close()
            child.stderr.close()
    emit('byclaw.workspace', status='skills-ready', count=len(manifest['skills']))


EXCLUDED = {'.byclaw', '.git', 'node_modules', '.venv', '__pycache__', 'executors', '.file_changes'}
MAX_FILES = 10000
MAX_TEXT = 256 * 1024
MAX_TOTAL_TEXT = 16 * 1024 * 1024


def is_runtime_environment(path):
    """Recognize standard Python environments without reserving a directory name."""
    if (path / 'pyvenv.cfg').is_file():
        return True
    if (path / 'bin' / 'activate').is_file() and any((path / 'bin' / name).is_file() for name in ('python', 'python3')):
        return True
    if (path / 'Scripts' / 'activate').is_file() and any((path / 'Scripts' / name).is_file() for name in ('python.exe', 'python')):
        return True
    return False


def scan(root, cached=None, metrics=None):
    """Enumerate once per directory; reuse content only for an identical stat fingerprint.

    The cache is limited to this execution, never persisted. A commit cannot hide a
    change because the comparison is of filesystem snapshots, not final git status.
    """
    entries = {}
    total_text = 0
    complete = True
    cached = cached or {}
    counters = metrics if metrics is not None else {}
    counters.update(files=0, readBytes=0, cacheHits=0)
    stable_before = time.time_ns() - 1_000_000_000
    directories = [root]
    while directories:
        directory = directories.pop()
        try:
            with os.scandir(directory) as source:
                children = sorted(source, key=lambda entry: entry.name)
            names = {entry.name for entry in children}
            # Avoid probing three absent environment markers in every source directory on NFS.
            if ('pyvenv.cfg' in names or 'bin' in names or 'Scripts' in names) and is_runtime_environment(directory):
                continue
        except (FileNotFoundError, PermissionError):
            complete = False
            continue
        subdirectories = []
        for entry in children:
            name = entry.name
            try:
                if entry.is_symlink():
                    continue
                path = Path(entry.path)
                if entry.is_dir(follow_symlinks=False):
                    if name not in EXCLUDED:
                        subdirectories.append(path)
                    continue
                if name.startswith('.coding-'):
                    continue
                info = entry.stat(follow_symlinks=False)
                if not stat.S_ISREG(info.st_mode):
                    continue
                if len(entries) >= MAX_FILES:
                    complete = False
                    break
                text = None
                digest = None
                key = path.relative_to(root).as_posix()
                fingerprint = (info.st_dev, info.st_ino, info.st_mode, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
                old = cached.get(key)
                if info.st_size <= MAX_TEXT and total_text + info.st_size <= MAX_TOTAL_TEXT:
                    # Windows ctime is creation time, so it cannot detect an mtime-restored edit.
                    if (os.name != 'nt' and old is not None and old.get('stable')
                            and old.get('fingerprint') == fingerprint and old['digest'] is not None):
                        digest, text = old['digest'], old['text']
                        counters['cacheHits'] += 1
                        if text is not None:
                            total_text += len(text.encode('utf-8'))
                        entries[key] = dict(old)
                        continue
                    with path.open('rb') as source:
                        content = source.read(MAX_TEXT + 1)
                    counters['readBytes'] += len(content)
                    # A concurrent writer can grow the file after stat(); never read it unbounded.
                    digest = hashlib.sha256(content).hexdigest() if len(content) <= MAX_TEXT else None
                    if digest is not None and b'\0' not in content:
                        try:
                            text = content.decode('utf-8')
                            total_text += len(content)
                        except UnicodeDecodeError:
                            pass
                entries[key] = dict(size=info.st_size, mtime=info.st_mtime_ns, digest=digest, text=text, fingerprint=fingerprint,
                                    stable=max(info.st_mtime_ns, info.st_ctime_ns) < stable_before)
            except (FileNotFoundError, PermissionError):
                complete = False
        if not complete and len(entries) >= MAX_FILES:
            break
        directories.extend(reversed(subdirectories))
    counters.update(files=len(entries), complete=complete)
    return entries, complete


def select_prompt(value, home, thread):
    """Legacy callers remain valid; missing native state always restores full history."""
    try:
        data = json.loads(value)
    except ValueError:
        return value, None
    if not isinstance(data, dict) or data.get('byclawPromptVersion') != 1:
        return value, None
    history = data['history']
    keys = [hashlib.sha256(json.dumps(item, ensure_ascii=False, sort_keys=True).encode()).hexdigest() for item in history]
    previous = []
    if thread:
        state = json.loads((home / 'byclaw-session.json').read_text(encoding='utf-8'))
        previous = state.get('historyKeys', [])
    known = set(previous)
    selected = [(key, item) for key, item in zip(keys, history) if key not in known]
    def render():
        return data['background'] + '\n\n' + json.dumps({'recentHistory': [item for _, item in selected]}, ensure_ascii=False)
    background = render()
    while selected and len(background.encode()) > 40 * 1024:
        selected.pop(0)
        background = render()
    prompt = '\n\n'.join([background, '<current-user-task>', data['task'], '</current-user-task>'])
    emit('byclaw.timing', stage='context_input', status='success', elapsedMs=0,
         promptBytes=len(prompt.encode()), historyItems=len(selected), omittedHistoryItems=len(history) - len(selected), resumed=bool(thread))
    # Store only hashes, and only after a successful native turn. Bound state size.
    return prompt, list(dict.fromkeys([*previous, *(key for key, _ in selected)]))[-256:]


def file_changes(root, session_id, before, after, by_root):
    previous, before_complete = before
    current, after_complete = after
    files = []
    for path in sorted(previous.keys() | current.keys()):
        old, new = previous.get(path), current.get(path)
        # A bounded scan cannot prove absence outside its covered set.
        if (old is None and not before_complete) or (new is None and not after_complete):
            continue
        if old == new or (old and new and old.get('fingerprint') is not None and old['fingerprint'] == new.get('fingerprint')) or (old and new and old['digest'] is not None and old['digest'] == new['digest']):
            continue
        old_text, new_text = old and old['text'], new and new['text']
        binary = (old is not None and old_text is None) or (new is not None and new_text is None)
        change = 'added' if old is None else 'deleted' if new is None else 'modified'
        additions = deletions = 0
        if not binary:
            matcher = difflib.SequenceMatcher(None, (old_text or '').splitlines(), (new_text or '').splitlines(), autojunk=False)
            for tag, a, b, c, d in matcher.get_opcodes():
                if tag in ('replace', 'delete'):
                    deletions += b - a
                if tag in ('replace', 'insert'):
                    additions += d - c
        identifier = str(uuid.uuid4())
        detail = dict(version=2, uuid=identifier, sessionId=session_id, filePath=path, workspace=str(root),
                      absolutePath=str(root / path), changeType=change, changed=True, binary=binary, contentEncoding='utf-8',
                      originalExists=old is not None, modifiedExists=new is not None,
                      originalSize=old['size'] if old else 0, modifiedSize=new['size'] if new else 0,
                      originalContent=old_text, modifiedContent=new_text, additions=additions, deletions=deletions, sources=['write'])
        destination = by_root / '.file_changes' / session_id / 'files'
        safe_directory(destination, by_root)
        atomic_text(destination / (identifier + '.json'), json.dumps(detail, ensure_ascii=False))
        files.append(dict(uuid=identifier, path=path, changeType=change, binary=binary, additions=additions, deletions=deletions, sources=['write']))
    # Keep every JSONL event below the existing one-MiB parser/SSH chunk budget.
    batch, size = [], 0
    def publish(items):
        summary = dict(total=len(items), added=sum(f['changeType'] == 'added' for f in items),
                       modified=sum(f['changeType'] == 'modified' for f in items), deleted=sum(f['changeType'] == 'deleted' for f in items))
        emit('byclaw.file_changes', workspace=str(root), payload=dict(type='file_changes', version=2, sessionId=session_id, summary=summary, files=items))
    for file in files:
        length = len(json.dumps(file, ensure_ascii=False).encode('utf-8'))
        if batch and size + length > 256 * 1024:
            publish(batch)
            batch, size = [], 0
        batch.append(file)
        size += length
    if batch:
        publish(batch)
    if not before_complete or not after_complete:
        emit('byclaw.workspace', status='partial', reason='file_scan_limit_or_unreadable')


def resume_id(home, identity, cwd):
    state_path = home / 'byclaw-session.json'
    if state_path.is_symlink():
        raise ValueError('EXECUTION_UNSAFE_STATE_PATH')
    if not state_path.exists():
        return None
    state = json.loads(state_path.read_text(encoding='utf-8'))
    if state.get('identity') != identity:
        raise ValueError('EXECUTION_SESSION_SCOPE_MISMATCH')
    if state.get('cwd') != str(cwd):
        raise ValueError('EXECUTION_WORKSPACE_CHANGED')
    thread = state.get('threadId', '')
    if not re.fullmatch(r'[a-fA-F0-9-]{36}', thread):
        raise ValueError('EXECUTION_INVALID_THREAD_ID')
    if state.get('cwd') == str(cwd) and any((home / 'sessions').rglob('*' + thread + '*.jsonl')):
        return thread
    emit('byclaw.workspace', status='recreated', reason='native_state_missing')
    return None


def publication_schema():
    return dict(type='object', additionalProperties=False, required=['answer', 'publication'], properties=dict(
        answer=dict(type='string'), publication=dict(anyOf=[dict(type='null'), dict(type='object', additionalProperties=False,
        required=['text', 'sourcePaths'], properties=dict(text=dict(type='string'), sourcePaths=dict(type='array', items=dict(type='string'))))])))


@contextlib.contextmanager
def deployment_environment(environment, workspace_root=None):
    """Lease-local credentials, outside UserFS and native Codex history/config."""
    clean = {k: v for k, v in environment.items() if not k.startswith('BYCLAW_DEPLOY_')}
    if environment.get('BYCLAW_DEPLOY_ENABLED') != '1':
        yield clean
        return
    fields = ('HOST', 'PORT', 'USER', 'PRIVATE_KEY', 'HOST_KEY', 'ROOT')
    data = {k.lower(): environment.get('BYCLAW_DEPLOY_' + k, '') for k in fields}
    if workspace_root is not None and not data['host_key'].strip():
        # Public server identities persist across disposable coding instances; no private key here.
        trust = Path(workspace_root) / '.server-deploy'
        safe_directory(trust, Path(workspace_root))
        data['known_hosts'] = str(trust / 'known_hosts')
    payload = json.dumps(data)
    if len(payload.encode()) > 65536:
        raise ValueError('EXECUTION_DEPLOYMENT_CONFIG_TOO_LARGE')
    # Explicit /tmp ignores caller TMPDIR, which may point into persistent /by.
    with tempfile.TemporaryDirectory(prefix='byclaw-deploy-', dir='/tmp') as directory:
        path = Path(directory) / 'context.json'
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as output:
            output.write(payload)
        yield dict(clean, BYCLAW_DEPLOY_CONTEXT=str(path))


def run(manifest, prompt, root):
    # Remove before Skill preparation or any other subprocess can inherit raw material.
    deployment_values = {k: os.environ.pop(k) for k in list(os.environ) if k.startswith('BYCLAW_DEPLOY_')}
    model_values = os.environ.pop('BYCLAW_CODEX_CONNECTION', '')
    for key in ('CODEX_AUTH', 'CODEX_MODEL', 'CODEX_BASE_URL', 'BYCLAW_CODEX_API_KEY'):
        os.environ.pop(key, None)
    with timing('workspace_prepare'):
        home, cwd = prepare(manifest, root)
    with identity_lock(home / '.execution.lock'):
        try:
            connection = json.loads(model_values)
            if not all(isinstance(connection.get(key), str) and connection[key] for key in ('baseUrl', 'model', 'apiKey')):
                raise ValueError()
        except (ValueError, TypeError, AttributeError):
            raise ValueError('CODEX_MODEL_CONNECTION_UNAVAILABLE') from None
        default_home = Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex')))
        default_config = default_home / 'config.toml'
        if manifest.get('prepareAgentSkills'):
            with timing('skills_prepare'):
                prepare_agent_skills(manifest, root)
        with timing('config_prepare'):
            bridge_directory = setup_config(manifest, home, cwd, default_config)
        with timing('native_resume'):
            thread = resume_id(home, manifest['identity'], cwd)
            prompt, history_keys = select_prompt(prompt, home, thread)
        emit('byclaw.workspace', status='resumed' if thread else 'created')
        args = ['codex', 'exec', '--json', '--skip-git-repo-check']
        if thread:
            args += ['resume', thread]
        args += ['--model', connection['model'], '-c', 'model_provider="byclaw"']
        provider = dict(name='ByClaw', base_url=connection['baseUrl'], wire_api='responses',
                        env_key='BYCLAW_CODEX_API_KEY', requires_openai_auth=False)
        for key, value in provider.items():
            args += ['-c', 'model_providers.byclaw.' + key + '=' + json.dumps(value)]
        if connection.get('reasoningEffort'):
            args += ['-c', 'model_reasoning_effort=' + json.dumps(connection['reasoningEffort'])]
        publication = manifest.get('publication')
        if publication:
            schema = home / 'output-schema.json'
            atomic_text(schema, json.dumps(publication_schema()))
            args += ['--output-schema', str(schema)]
            if publication.get('mode') == 'mcp':
                prompt += '\n\n当前会话已提供 DSH 兼容的 prepare_group_task_publication 工具。用户明确要求发到群里、发布到群里或准备回群成果时，调用该工具；普通问候、只读检查或未完成任务不要调用。工具成功后只表示已准备待确认卡片，不得声称已经上传、发群或完成任务。最终输出仍遵循 JSON Schema：answer 填用户可读答复，publication 必须为 null。' + publication['description']
            else:
                prompt += '\n\n最终输出遵循 JSON Schema。answer 填用户可读答复；仅当用户要求准备群任务成果时填写 publication.text 和完整 sourcePaths，否则 publication=null。' + publication['description']
                prompt += '\n填写 publication 仅是请求；宿主调用成功后才表示已准备待确认内容，不得声称已上传、发群或完成任务。'
        environment = dict(os.environ, BYCLAW_CODEX_API_KEY=connection['apiKey'], CODEX_HOME=str(home), BYCLAW_AGENT_ID=manifest['employeeId'], DSH_BYCLAW_AGENT_ID=manifest['employeeId'])
        roots = list(dict.fromkeys([cwd, Path(manifest['workspace']['sessionRoot'])]))
        before = {}
        for path in roots:
            with timing('scan_before', scope='project' if path == cwd else 'session') as metrics:
                before[path] = scan(path, metrics=metrics)
        environment.update(deployment_values)
        deployment = deployment_environment(environment, root)
        environment = deployment.__enter__()
        deploying = 'BYCLAW_DEPLOY_CONTEXT' in environment
        child = None
        bridge = PublicationBridge(bridge_directory, publication['bridgeId']) if bridge_directory is not None else None
        cli_started = time.monotonic()
        first_json = first_message = final_message = turn_complete = False
        try:
            if bridge is not None:
                bridge.start()
            # stdin avoids argv limits and "Reading additional input" ambiguity in Codex.
            child = subprocess.Popen(args + ['-'], cwd=cwd, env=environment, stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, stderr=None, text=True, encoding='utf-8',
                                     start_new_session=deploying)
            child.stdin.write(prompt)
            child.stdin.close()
            for line in child.stdout:
                try:
                    event = json.loads(line)
                    milestones = []
                    if not first_json:
                        first_json = True
                        milestones.append('cli_first_json')
                    item = event.get('item') or {}
                    if event.get('type') == 'item.completed' and item.get('type') == 'agent_message':
                        if not first_message:
                            first_message = True
                            milestones.append('cli_first_message')
                        if item.get('phase') == 'final_answer' and not final_message:
                            final_message = True
                            milestones.append('cli_final_message')
                    if event.get('type') == 'turn.completed':
                        turn_complete = True
                        milestones.append('cli_turn_completed')
                    for milestone in milestones:
                        emit('byclaw.timing', stage=milestone, status='success', elapsedMs=round((time.monotonic() - cli_started) * 1000))
                    if event.get('type') == 'thread.started' and isinstance(event.get('thread_id'), str):
                        atomic_text(home / 'byclaw-session.json', json.dumps(dict(version=1, identity=manifest['identity'],
                            threadId=event['thread_id'], cwd=str(cwd), home=str(home))))
                except json.JSONDecodeError:
                    raise ValueError('CODEX_INVALID_JSONL')
                with OUTPUT_LOCK:
                    sys.stdout.write(line)
                    sys.stdout.flush()
            code = child.wait()
            emit('byclaw.timing', stage='cli_exit', status='success' if code == 0 else 'error',
                 elapsedMs=round((time.monotonic() - cli_started) * 1000))
            if code == 0 and turn_complete and history_keys is not None:
                state_path = home / 'byclaw-session.json'
                state = json.loads(state_path.read_text(encoding='utf-8'))
                state['historyKeys'] = history_keys
                atomic_text(state_path, json.dumps(state))
        finally:
            try:
                if child is not None:
                    if deploying:
                        try:
                            os.killpg(child.pid, signal.SIGTERM)
                        except ProcessLookupError:
                            pass
                    if child.poll() is None:
                        child.terminate()
                        try:
                            child.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            child.kill()
                            child.wait()
                    child.stdout.close()
            finally:
                if bridge is not None:
                    with timing('runner_bridge_close'):
                        bridge.close()
                deployment.__exit__(None, None, None)
            for path in roots:
                scope = 'project' if path == cwd else 'session'
                with timing('scan_after', scope=scope) as metrics:
                    after = scan(path, cached=before[path][0], metrics=metrics)
                with timing('file_changes', scope=scope):
                    file_changes(path, Path(manifest['workspace']['sessionRoot']).name, before[path], after, root)
        return code


def main():
    # Let the existing finally blocks stop preparation/CLI children on user cancellation.
    def stop_execution(*_):
        raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, stop_execution)
    try:
        if sys.argv[1] == '--resolve':
            print(json.dumps(resolve_workspace(json.loads(sys.argv[2]), Path(sys.argv[3]))))
            return 0
        if sys.argv[1] == '--revision':
            print(json.dumps(repository_state(Path(sys.argv[2]), Path(sys.argv[3]))))
            return 0
        manifest = json.loads(sys.argv[1])
        return run(manifest, sys.argv[2], Path(sys.argv[3]))
    except KeyboardInterrupt:
        return 130
    except Exception as error:
        # Never print the JSON manifest, prompt, configuration, or arbitrary transport exception.
        label = str(error)
        print(label if re.fullmatch(r'(?:EXECUTION|CODEX)_[A-Z_]+', label) else 'EXECUTION_WORKSPACE_FAILED', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
