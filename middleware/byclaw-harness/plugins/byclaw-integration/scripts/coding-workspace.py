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
import time
import tomllib
import uuid


def emit(kind, **values):
    print(json.dumps(dict(type=kind, **values), ensure_ascii=False), flush=True)


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
    data['approval_policy'] = 'never'
    data['sandbox_mode'] = 'danger-full-access'
    data['developer_instructions'] = manifest['persona']
    # Application identity is stable and explicit for scripts invoked through shared Skills.
    skills = data.setdefault('skills', {})
    skills['config'] = connect_skills(home, manifest['skills'], cwd)
    atomic_text(home / 'config.toml', toml_document(data))
    atomic_text(home / 'AGENTS.md', manifest['persona'] + '\n')


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


def scan(root):
    entries = {}
    total_text = 0
    complete = True
    for directory, children, files in os.walk(root, followlinks=False):
        children[:] = sorted(name for name in children if name not in EXCLUDED and not (Path(directory) / name).is_symlink())
        for name in sorted(files):
            path = Path(directory) / name
            if path.is_symlink() or name.startswith('.coding-'):
                continue
            try:
                info = path.stat()
                if not stat.S_ISREG(info.st_mode):
                    continue
                if len(entries) >= MAX_FILES:
                    complete = False
                    break
                text = None
                digest = None
                if info.st_size <= MAX_TEXT and total_text + info.st_size <= MAX_TOTAL_TEXT:
                    with path.open('rb') as source:
                        content = source.read(MAX_TEXT + 1)
                    # A concurrent writer can grow the file after stat(); never read it unbounded.
                    digest = hashlib.sha256(content).hexdigest() if len(content) <= MAX_TEXT else None
                    if digest is not None and b'\0' not in content:
                        try:
                            text = content.decode('utf-8')
                            total_text += len(content)
                        except UnicodeDecodeError:
                            pass
                entries[path.relative_to(root).as_posix()] = dict(size=info.st_size, mtime=info.st_mtime_ns, digest=digest, text=text)
            except (FileNotFoundError, PermissionError):
                complete = False
        if not complete and len(entries) >= MAX_FILES:
            break
    return entries, complete


def file_changes(root, session_id, before, after, by_root):
    previous, before_complete = before
    current, after_complete = after
    files = []
    for path in sorted(previous.keys() | current.keys()):
        old, new = previous.get(path), current.get(path)
        # A bounded scan cannot prove absence outside its covered set.
        if (old is None and not before_complete) or (new is None and not after_complete):
            continue
        if old == new or (old and new and old['digest'] is not None and old['digest'] == new['digest']):
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
    default_home = Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex')))
    default_config = default_home / 'config.toml'
    home, cwd = prepare(manifest, root)
    with identity_lock(home / '.execution.lock'):
        if manifest.get('prepareAgentSkills'):
            prepare_agent_skills(manifest, root)
        setup_config(manifest, home, cwd, default_config)
        thread = resume_id(home, manifest['identity'], cwd)
        emit('byclaw.workspace', status='resumed' if thread else 'created')
        args = ['codex', 'exec', '--json', '--skip-git-repo-check']
        if thread:
            args += ['resume', thread]
        if os.environ.get('CODEX_MODEL'):
            args += ['--model', os.environ['CODEX_MODEL']]
        if os.environ.get('CODEX_BASE_URL'):
            args += ['-c', 'model_providers.byclaw.base_url=' + json.dumps(os.environ['CODEX_BASE_URL'])]
        publication = manifest.get('publication')
        if publication:
            schema = home / 'output-schema.json'
            atomic_text(schema, json.dumps(publication_schema()))
            args += ['--output-schema', str(schema)]
            prompt += '\n\n最终输出遵循 JSON Schema。answer 填用户可读答复；仅当用户要求准备群任务成果时填写 publication.text 和完整 sourcePaths，否则 publication=null。' + publication['description']
            prompt += '\n填写 publication 仅是请求；宿主调用成功后才表示已准备待确认内容，不得声称已上传、发群或完成任务。'
        environment = dict(os.environ, CODEX_HOME=str(home), BYCLAW_AGENT_ID=manifest['employeeId'], DSH_BYCLAW_AGENT_ID=manifest['employeeId'])
        roots = list(dict.fromkeys([cwd, Path(manifest['workspace']['sessionRoot'])]))
        before = {path: scan(path) for path in roots}
        environment.update(deployment_values)
        deployment = deployment_environment(environment, root)
        environment = deployment.__enter__()
        deploying = 'BYCLAW_DEPLOY_CONTEXT' in environment
        child = None
        try:
            # stdin avoids argv limits and "Reading additional input" ambiguity in Codex.
            child = subprocess.Popen(args + ['-'], cwd=cwd, env=environment, stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, stderr=None, text=True, encoding='utf-8',
                                     start_new_session=deploying)
            child.stdin.write(prompt)
            child.stdin.close()
            for line in child.stdout:
                try:
                    event = json.loads(line)
                    if event.get('type') == 'thread.started' and isinstance(event.get('thread_id'), str):
                        atomic_text(home / 'byclaw-session.json', json.dumps(dict(version=1, identity=manifest['identity'],
                            threadId=event['thread_id'], cwd=str(cwd), home=str(home))))
                except json.JSONDecodeError:
                    raise ValueError('CODEX_INVALID_JSONL')
                sys.stdout.write(line)
                sys.stdout.flush()
            code = child.wait()
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
                deployment.__exit__(None, None, None)
            for path in roots:
                file_changes(path, Path(manifest['workspace']['sessionRoot']).name, before[path], scan(path), root)
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
