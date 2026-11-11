"""Real Codex native discovery test. Usage: python .../coding-native-skills-verify.py /path/to/codex

Uses isolated temporary CODEX_HOME and the read-only app-server skills/list API.
No authentication, model calls or modifications to the user's Codex configuration.
Run with the pinned 0.167.0 binary, including Linux in the target coding image.
"""
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import tempfile
import threading

spec = importlib.util.spec_from_file_location('coding_workspace', Path(__file__).with_name('coding-workspace.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def native_skills(executable, home, cwd, name='shared-demo'):
    environment = {name: value for name, value in os.environ.items()
                   if name.upper() in {'PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PATHEXT'}}
    environment['CODEX_HOME'] = str(home)
    process = subprocess.Popen([executable, 'app-server'], env=environment, cwd=cwd,
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                               text=True, encoding='utf-8')
    incoming = queue.Queue()
    def read():
        for line in process.stdout:
            incoming.put(json.loads(line))
        incoming.put(None)
    threading.Thread(target=read, daemon=True).start()
    def send(item):
        process.stdin.write(json.dumps(item) + '\n')
        process.stdin.flush()
    def response(identifier):
        while True:
            item = incoming.get(timeout=30)
            if item is None:
                raise RuntimeError('app-server exited')
            if item.get('id') == identifier:
                if 'error' in item:
                    raise RuntimeError(json.dumps(item['error']))
                return item['result']
    try:
        send(dict(id=1, method='initialize', params=dict(clientInfo=dict(name='byclaw-native-skill-test', version='1.0'))))
        response(1)
        send(dict(method='initialized'))
        send(dict(id=2, method='skills/list', params=dict(cwds=[str(cwd)], forceReload=True)))
        result = response(2)
        return [skill for entry in result['data'] for skill in entry['skills'] if skill['name'] == name]
    finally:
        process.terminate()
        process.wait(timeout=10)
        process.stdin.close()
        process.stdout.close()


def main():
    executable = str(Path(sys.argv[1]).resolve())
    version = subprocess.check_output([executable, '--version'], text=True, timeout=30).strip()
    assert version == 'codex-cli 0.167.0', version
    with tempfile.TemporaryDirectory(prefix='byclaw-native-skills-') as temporary:
        root = Path(temporary)
        home, cwd = root / 'home', root / 'project'
        home.mkdir()
        cwd.mkdir()
        original = root / 'shared' / 'original'
        overlay = root / 'shared' / 'overlay'
        for directory, description in [(original, 'First revision'), (overlay, 'Employee override')]:
            (directory / 'scripts').mkdir(parents=True)
            (directory / 'scripts' / 'demo.py').write_text('print("NATIVE_SKILL_OK")', encoding='utf-8')
            (directory / 'SKILL.md').write_text('---\nname: shared-demo\ndescription: ' + description + '\n---\nRead scripts/demo.py.\n', encoding='utf-8')
        def configure(source, enabled=True, name='shared-demo'):
            skills = [] if source is None else [dict(name=name, path=str(source / 'SKILL.md'), enabled=enabled)]
            if os.name == 'nt':
                # Windows without Developer Mode cannot create Unix-style symlinks.
                # Exercise the native shared-directory alias using an NTFS junction.
                directory = home / 'skills'
                directory.mkdir(exist_ok=True)
                link = directory / name
                if link.is_junction():
                    link.rmdir()
                if source is not None:
                    subprocess.run(['cmd', '/c', 'mklink', '/J', str(link), str(source)], check=True, stdout=subprocess.DEVNULL)
                settings = [] if source is None else [dict(path=str(link / 'SKILL.md'), enabled=enabled)]
            else:
                settings = runner.connect_skills(home, skills, cwd)
            runner.atomic_text(home / 'config.toml', runner.toml_document(dict(skills=dict(config=settings))))
        configure(original)
        found = native_skills(executable, home, cwd)
        assert len(found) == 1 and found[0]['enabled'], found
        assert Path(found[0]['path']).resolve() == (original / 'SKILL.md').resolve(), found
        assert (home / 'skills' / 'shared-demo' / 'scripts' / 'demo.py').read_text() == 'print("NATIVE_SKILL_OK")'
        (original / 'SKILL.md').write_text('---\nname: shared-demo\ndescription: Updated revision\n---\nUpdated body\n', encoding='utf-8')
        assert native_skills(executable, home, cwd)[0]['description'] == 'Updated revision'
        configure(original, False)
        found = native_skills(executable, home, cwd)
        assert len(found) == 1 and not found[0]['enabled'], found
        configure(overlay)
        found = native_skills(executable, home, cwd)
        assert len(found) == 1 and found[0]['enabled'] and found[0]['description'] == 'Employee override', found
        assert Path(found[0]['path']).resolve() == (overlay / 'SKILL.md').resolve()
        configure(None)
        assert native_skills(executable, home, cwd) == []
        (overlay / 'SKILL.md').write_text('---\nname: report_企业\ndescription: Unicode name\n---\nBody\n', encoding='utf-8')
        configure(overlay, name='report_企业')
        found = native_skills(executable, home, cwd, 'report_企业')
        assert len(found) == 1 and found[0]['enabled'], found
    print('PASS: Codex 0.167.0 native discovery, shared directory alias (' + ('NTFS junction' if os.name == 'nt' else 'symlink') + '), live revision, disable, overlay and revocation')


if __name__ == '__main__':
    main()
